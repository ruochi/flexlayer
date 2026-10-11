import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { initFontsForMeasure } from './fonts.js'
import { checkFvg, renderFvg } from './render.js'

beforeAll(async () => {
  await initFontsForMeasure({ fontsCacheDir: join(homedir(), '.cache', 'flexlayer', 'fonts') })
})

async function pixels(png: Buffer) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  const at = (x: number, y: number) => {
    const i = (y * img.width + x) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const
  }
  return { at, width: img.width, height: img.height }
}

describe('绘制', () => {
  it('Path 画在路径坐标上，不再叠加盒子偏移', async () => {
    const { png } = await renderFvg(
      `<layer width="200" height="200" background="#ffffff"><path d="M 80 90 L 140 90" stroke="#0000ff" stroke-width="4" /></layer>`,
    )
    const { at } = await pixels(png)
    const onLine = at(100, 90)
    const doubled = at(160, 180)
    expect(onLine[2]).toBeGreaterThan(200)
    expect(doubled[0]).toBeGreaterThan(240)
    expect(doubled[2]).toBeGreaterThan(240)
  })

  it('夜空渐变上深下浅，月晕染到圆的外面', async () => {
    const { png } = await renderFvg(
      `<layer width="120" height="120" background="#ffffff"><rect x="0" y="0" width="120" height="120" fill="linear-gradient(#102038, #d8e2ea)" /><circle cx="60" cy="60" r="16" fill="#f4efe4" glow="18 #f4efe4" /></layer>`,
    )
    const { at } = await pixels(png)
    expect(at(10, 8)[2]).toBeGreaterThan(at(10, 8)[0])
    expect(at(10, 110)[0]).toBeGreaterThan(at(10, 8)[0])
    const halo = at(60, 36)
    const sky = at(8, 36)
    expect(halo[0]).toBeGreaterThan(sky[0] + 20)
  })

  it('同一 symbol 可以摆两次', async () => {
    const { png } = await renderFvg(
      `<layer width="80" height="40" background="#ffffff"><symbol id="dot"><circle cx="8" cy="8" r="6" fill="#ff0000" /></symbol><use href="#dot" x="8" y="12" /><use href="#dot" x="48" y="12" /></layer>`,
    )
    const { at } = await pixels(png)
    expect(at(16, 20)[0]).toBeGreaterThan(200)
    expect(at(56, 20)[0]).toBeGreaterThan(200)
    expect(at(36, 20)[0]).toBeGreaterThan(240)
  })

  it('内阴影压暗圆角矩形内侧', async () => {
    const { png, report } = await renderFvg(
      `<layer width="120" height="80" background="#ffffff"><rect x="20" y="15" width="80" height="50" rx="8" fill="#6aa1ff" inner-shadow="0 6 8 #000000aa" /></layer>`,
    )
    const plain = await renderFvg(
      `<layer width="120" height="80" background="#ffffff"><rect x="20" y="15" width="80" height="50" rx="8" fill="#6aa1ff" /></layer>`,
    )
    const { at } = await pixels(png)
    const base = await pixels(plain.png)
    const bottomInner = at(60, 58)
    const plainBottom = base.at(60, 58)
    expect(bottomInner[0] + bottomInner[1] + bottomInner[2]).toBeLessThan(
      plainBottom[0] + plainBottom[1] + plainBottom[2] - 20,
    )
    expect(report.elements.some((el) => el.innerShadow?.y === 6)).toBe(true)
  })

  it('图层模糊把硬边染开', async () => {
    const sharp = await renderFvg(
      `<layer width="80" height="80" background="#000000"><rect x="30" y="30" width="20" height="20" fill="#ffffff" /></layer>`,
    )
    const soft = await renderFvg(
      `<layer width="80" height="80" background="#000000"><rect x="30" y="30" width="20" height="20" fill="#ffffff" blur="6" /></layer>`,
    )
    const a = await pixels(sharp.png)
    const b = await pixels(soft.png)
    expect(a.at(40, 22)[0]).toBeLessThan(10)
    expect(b.at(40, 22)[0]).toBeGreaterThan(20)
    expect(soft.report.elements.some((el) => el.blur === 6)).toBe(true)
  })

  it('backdrop-blur 糊掉半透明块背后的条纹', async () => {
    const scene = (backdrop: string) =>
      `<layer width="120" height="80" background="#102038">
        <rect x="0" y="0" width="120" height="80" fill="#204060" />
        <rect x="0" y="30" width="120" height="8" fill="#f4efe4" />
        <rect x="25" y="20" width="70" height="40" rx="8" fill="#ffffff55" ${backdrop} />
      </layer>`
    const withBlur = await renderFvg(scene('backdrop-blur="8"'))
    const without = await renderFvg(scene(''))
    const a = await pixels(withBlur.png)
    const b = await pixels(without.png)
    // 条纹上方：有 backdrop 时奶油色会渗上来
    expect(a.at(60, 26)[0]).toBeGreaterThan(b.at(60, 26)[0] + 15)
    expect(withBlur.report.elements.some((el) => el.backdropBlur === 8)).toBe(true)
  })
  it('filter grayscale 去掉饱和色', async () => {
    const color = await renderFvg(
      `<layer width="40" height="40" background="#000000"><rect x="5" y="5" width="30" height="30" fill="#ff0000" /></layer>`,
    )
    const gray = await renderFvg(
      `<layer width="40" height="40" background="#000000"><rect x="5" y="5" width="30" height="30" fill="#ff0000" filter="grayscale(1)" /></layer>`,
    )
    const c = await pixels(color.png)
    const g = await pixels(gray.png)
    expect(c.at(20, 20)[0]).toBeGreaterThan(c.at(20, 20)[1] + 50)
    expect(Math.abs(g.at(20, 20)[0] - g.at(20, 20)[1])).toBeLessThan(8)
  })

  it('noise 与 blend 进入报告', async () => {
    const { report } = await renderFvg(
      `<layer width="60" height="60" background="#112233"><rect x="10" y="10" width="40" height="40" fill="#3ecfc4" noise="0.2" blend="multiply" inner-glow="10 #ffffff" /></layer>`,
    )
    const el = report.elements.find((e) => e.tag === 'rect')
    expect(el?.noise).toEqual({ amount: 0.2 })
    expect(el?.blend).toBe('multiply')
    expect(el?.innerGlow?.blur).toBe(10)
  })

  it('layer overlay 纯色叠加变暗，并进入报告', async () => {
    const plain = await renderFvg(
      `<layer width="80" height="80" background="#000000">
        <layer x="10" y="10" width="60" height="60">
          <rect x="0" y="0" width="60" height="60" fill="#ffffff" />
        </layer>
      </layer>`,
    )
    const over = await renderFvg(
      `<layer width="80" height="80" background="#000000">
        <layer x="10" y="10" width="60" height="60" overlay="#00000088">
          <rect x="0" y="0" width="60" height="60" fill="#ffffff" />
        </layer>
      </layer>`,
    )
    const p = await pixels(plain.png)
    const o = await pixels(over.png)
    expect(p.at(40, 40)[0]).toBeGreaterThan(240)
    expect(o.at(40, 40)[0]).toBeLessThan(200)
    expect(o.at(40, 40)[0]).toBeGreaterThan(40)
    const layer = over.report.elements.find((e) => e.tag === 'layer' && e.overlay)
    expect(layer?.overlay).toEqual({ paint: '#00000088', opacity: 1, blend: 'source-over' })
  })

  it('layer overlay 渐变 + multiply', async () => {
    const { png, report } = await renderFvg(
      `<layer width="100" height="40" background="#ffffff">
        <layer width="100" height="40" overlay="linear-gradient(to right, #ff0000, #0000ff) multiply">
          <rect x="0" y="0" width="100" height="40" fill="#ffffff" />
        </layer>
      </layer>`,
    )
    const { at } = await pixels(png)
    const left = at(8, 20)
    const right = at(92, 20)
    expect(left[0]).toBeGreaterThan(left[2] + 40)
    expect(right[2]).toBeGreaterThan(right[0] + 40)
    const layer = report.elements.find((e) => e.overlay)
    expect(layer?.overlay?.blend).toBe('multiply')
    expect(layer?.overlay?.paint).toContain('linear-gradient')
  })

  it('layer grade 调整子树颜色，报告里有展开后的参数', async () => {
    const { png, report } = await renderFvg(
      `<layer width="80" height="80" background="#000000">
        <layer x="10" y="10" width="60" height="60" grade="mono, contrast 1">
          <rect x="0" y="0" width="60" height="60" fill="#e04020" />
        </layer>
      </layer>`,
    )
    const { at } = await pixels(png)
    const [r, g, b] = at(40, 40)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(3)
    const layer = report.elements.find((e) => e.grade)
    expect(layer?.grade).toMatchObject({ preset: 'mono', saturate: 0, contrast: 1, amount: 1 })
  })

  it('grade-mask 透明处保持原图', async () => {
    const { png } = await renderFvg(
      `<layer width="100" height="40" background="#000000">
        <layer x="0" y="0" width="100" height="40" grade="mono" grade-mask="linear-gradient(to right, #fff0 50%, #fff 50%)">
          <rect x="0" y="0" width="100" height="40" fill="#e04020" />
        </layer>
      </layer>`,
    )
    const { at } = await pixels(png)
    const left = at(10, 20)
    const right = at(90, 20)
    expect(left[0]).toBeGreaterThan(left[2] + 100)
    expect(Math.max(...right.slice(0, 3)) - Math.min(...right.slice(0, 3))).toBeLessThanOrEqual(3)
  })

  it('根 layer 的 grade 作用到画布底色', async () => {
    const { png } = await renderFvg(`<layer width="40" height="40" background="#e04020" grade="mono"></layer>`)
    const [r, g, b] = (await pixels(png)).at(20, 20)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(3)
  })

  it('grade 之后再叠 noise，颗粒不被染色', async () => {
    const scene = (grade: string) =>
      `<layer width="60" height="60" background="#808080">
        <layer x="10" y="10" width="40" height="40" border="40px solid #808080" noise="0.6 #ff0000" ${grade}>
          <rect x="0" y="0" width="40" height="40" fill="#808080" />
        </layer>
      </layer>`
    const graded = await pixels((await renderFvg(scene('grade="mono"'))).png)
    let redder = 0
    for (let y = 12; y < 48; y++) {
      for (let x = 12; x < 48; x++) {
        const [r, g] = graded.at(x, y)
        if (r > g + 20) redder++
      }
    }
    expect(redder).toBeGreaterThan(20)
  })

  it('Rect 上的 overlay 不生效', async () => {
    const { png, report } = await renderFvg(
      `<layer width="60" height="60" background="#000000">
        <rect x="10" y="10" width="40" height="40" fill="#ffffff" overlay="#ff0000" />
      </layer>`,
    )
    const { at } = await pixels(png)
    expect(at(30, 30)[0]).toBeGreaterThan(240)
    expect(at(30, 30)[1]).toBeGreaterThan(240)
    expect(report.issues.some((i) => i.message.includes('overlay'))).toBe(true)
    expect(report.elements.find((e) => e.tag === 'rect')?.overlay).toBeUndefined()
  })

  it('clear glass 不模糊：中心原样透出，边缘弧面把内侧内容折射出来', async () => {
    // 左红右青，分界 x=165；圆心 (100,100) r=80 → 右缘弧面里的青色像素被向内折射成红色
    const scene = (glass: string) =>
      `<layer width="240" height="200" background="#000000">
        <rect x="0" y="0" width="165" height="200" fill="#ff0000" />
        <rect x="165" y="0" width="75" height="200" fill="#00e5ff" />
        <circle cx="100" cy="100" r="80" fill="#ffffff00" ${glass} />
      </layer>`
    const withGlass = await renderFvg(scene('glass="clear"'))
    const plain = await renderFvg(scene(''))
    const g = await pixels(withGlass.png)
    const p = await pixels(plain.png)
    expect(g.at(100, 100)).toEqual(p.at(100, 100))
    expect(p.at(172, 100)[0]).toBeLessThan(15)
    expect(g.at(172, 100)[0]).toBeGreaterThan(150)
    // 折射后的红青分界仍然锐利：过渡不超过 3px
    let soft = 0
    for (let x = 100; x < 178; x++) {
      const r = g.at(x, 100)[0]
      if (r > 30 && r < 225) soft++
    }
    expect(soft).toBeLessThanOrEqual(3)
    expect(withGlass.report.elements.some((el) => el.glass?.variant === 'clear' && el.glass.blur === 0)).toBe(true)
  })

  it('文字投影跟随字形墨迹，不是整块盒子', async () => {
    // 「一」只有中间横笔；红影右移 20px。盒子上沿内侧若出现红斑，说明仍按 box 投影。
    const { png, report } = await renderFvg(
      `<layer width="200" height="100" background="#ffffff" color="#0000ff">
        <layer x="100" y="50" anchor="center">
          <h1 style="font-size:64px; color:#0000ff; shadow:20 0 0 #ff0000">一</h1>
        </layer>
      </layer>`,
    )
    const { at } = await pixels(png)
    const h1 = report.elements.find((el) => el.tag === 'h1')!
    const aboveStrokeX = Math.round(h1.box.left + h1.box.width / 2 + 20)
    const aboveStrokeY = Math.round(h1.box.top + 6)
    const above = at(aboveStrokeX, aboveStrokeY)
    // 横笔上方应仍是白底（字形投影），不能是盒子投下的红块
    expect(above[0]).toBeGreaterThan(240)
    expect(above[1]).toBeGreaterThan(240)
    expect(above[2]).toBeGreaterThan(240)
    // 墨迹右侧应能采到红色投影
    let red = 0
    for (let y = Math.floor(h1.ink.top); y < Math.ceil(h1.ink.bottom); y++) {
      for (let x = Math.floor(h1.ink.right); x < Math.min(200, Math.ceil(h1.ink.right + 28)); x++) {
        const p = at(x, y)
        if (p[0]! > 200 && p[1]! < 80 && p[2]! < 80) red++
      }
    }
    expect(red).toBeGreaterThan(20)
  })

  it('stroke-dasharray 在线条和形状上留下空隙，写错会警告', async () => {
    const { png } = await renderFvg(`
      <layer width="160" height="90" background="#000000">
        <line x1="10" y1="20" x2="150" y2="20" stroke="#ffffff" stroke-width="4" stroke-dasharray="12 12" />
        <rect x="20" y="46" width="120" height="28" fill="none" stroke="#ffffff" stroke-width="4" stroke-dasharray="12,12" />
      </layer>
    `)
    const { at } = await pixels(png)
    const on = (at(16, 20)[0] ?? 0) > 200
    const off = (at(28, 20)[0] ?? 0) < 30
    expect(on).toBe(true)
    expect(off).toBe(true)
    const edgeOn = (at(26, 46)[0] ?? 0) > 200
    const edgeOff = (at(38, 46)[0] ?? 0) < 30
    expect(edgeOn).toBe(true)
    expect(edgeOff).toBe(true)
    const bad = await checkFvg(
      `<layer width="80" height="40"><line x1="0" y1="10" x2="40" y2="10" stroke="#fff" stroke-dasharray="8 foo" /></layer>`,
    )
    expect(bad.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('stroke-dasharray'))).toBe(true)
  })

  it('layer 上的 shadow 跟着子树，透视和网格也能投下', async () => {
    const flat = await renderFvg(`
      <layer width="200" height="160" background="#ffffff">
        <layer x="60" y="40" width="80" height="40" shadow="0 28 0 #ff0000">
          <rect x="0" y="0" width="80" height="40" fill="#0000ff" />
        </layer>
      </layer>
    `)
    const { at } = await pixels(flat.png)
    const body = at(100, 60)
    const below = at(100, 96)
    expect(body[2]).toBeGreaterThan(200)
    expect(below[0]).toBeGreaterThan(200)
    expect(below[2]).toBeLessThan(40)

    const inside = await checkFvg(`
      <layer width="200" height="160" background="#ffffff">
        <layer x="60" y="40" width="80" height="40" shadow="0 28 0 #ff0000">
          <rect x="0" y="0" width="80" height="40" fill="#0000ff" />
        </layer>
      </layer>
    `)
    expect(inside.issues.some((issue) => issue.code === 'effect-clipped')).toBe(false)

    const tilted = await renderFvg(`
      <layer width="240" height="220" background="#ffffff" perspective="800">
        <layer x="70" y="55" width="100" height="50" rotateY="18" shadow="0 36 0 #ff0000">
          <rect x="0" y="0" width="100" height="50" fill="#0000ff" />
        </layer>
      </layer>
    `)
    const view = await pixels(tilted.png)
    let red = 0
    for (let y = 70; y < 200; y++) {
      for (let x = 60; x < 190; x++) {
        const p = view.at(x, y)
        if (p[0] > 180 && p[2] < 80) red++
      }
    }
    expect(red).toBeGreaterThan(20)

    const mesh = await renderFvg(`
      <layer width="180" height="150" background="#ffffff" perspective="500" shadow="0 48 0 #ff0000">
        <box x="70" y="32" width="40" height="36" depth="16" fill="#0000ff" />
      </layer>
    `)
    const scene = await pixels(mesh.png)
    let meshRed = 0
    for (let y = 80; y < 140; y++) {
      const p = scene.at(90, y)
      if (p[0] > 180 && p[2] < 80) meshRed++
    }
    expect(meshRed).toBeGreaterThan(4)
  }, 30000)

  it('空心图形和图层上的光影只跟着描边，不填满内部', async () => {
    const shadow = await renderFvg(`
      <layer width="220" height="140" background="#ffffff">
        <circle cx="70" cy="70" r="36" fill="none" stroke="#2244aa" stroke-width="8" shadow="70 0 0 #ff0000" />
      </layer>
    `)
    const { at } = await pixels(shadow.png)
    const hole = at(140, 70)
    const ring = at(140, 36)
    expect(hole[0]).toBeGreaterThan(240)
    expect(hole[1]).toBeGreaterThan(240)
    expect(ring[0]).toBeGreaterThan(180)
    expect(ring[2]).toBeLessThan(80)

    const layer = await renderFvg(`
      <layer width="160" height="160" background="#101014">
        <layer x="20" y="20" width="120" height="120" glow="0 #ff88aa" shadow="0 0 0 #000000">
          <circle cx="60" cy="60" r="40" fill="none" stroke="#2244aa" stroke-width="8" />
        </layer>
      </layer>
    `)
    const view = await pixels(layer.png)
    const center = view.at(80, 80)
    expect(center[0]).toBeLessThan(40)
    expect(center[1]).toBeLessThan(40)
    expect(center[2]).toBeLessThan(40)
  })
})

function isWhite(p: readonly number[]) {
  return p[0]! > 230 && p[1]! > 230 && p[2]! > 230
}
function isBlack(p: readonly number[]) {
  return p[0]! < 45 && p[1]! < 45 && p[2]! < 45
}
function isGreen(p: readonly number[]) {
  return p[1]! > 120 && p[0]! < 80 && p[2]! < 80
}
function isRed(p: readonly number[]) {
  return p[0]! > 170 && p[1]! < 90 && p[2]! < 90
}
function isBlue(p: readonly number[]) {
  return p[2]! > 170 && p[0]! < 90 && p[1]! < 90
}

/** 横笔「一」的上沿。返回笔画中线和最上一个墨迹像素。 */
function barTop(
  at: (x: number, y: number) => readonly number[],
  width: number,
  height: number,
  ink: (p: readonly number[]) => boolean,
) {
  let best = 0
  let row = 0
  let x0 = 0
  let x1 = 0
  for (let y = 0; y < height; y++) {
    let count = 0
    let left = -1
    let right = -1
    for (let x = 0; x < width; x++) {
      if (!ink(at(x, y))) continue
      count++
      if (left < 0) left = x
      right = x
    }
    if (count > best) {
      best = count
      row = y
      x0 = left
      x1 = right
    }
  }
  const midX = Math.round((x0 + x1) / 2)
  let top = row
  while (top > 0 && ink(at(midX, top - 1))) top--
  return { midX, top, x0, x1, count: best }
}

describe('墨迹 spread 与 stroke', () => {
  const bar = (style: string) =>
    `<Layer width="420" height="240" background="#00aa00">
      <Layer cx="24" cy="16" anchor="top-left">
        <h1 style="font-size:150px; font-weight:700; color:#ffffff; ${style}">一</h1>
      </Layer>
    </Layer>`

  it('文字 shadow 的 spread 按字形外扩，spread 0 与无投影一致', async () => {
    const spread = await renderFvg(
      `<Layer width="420" height="240" background="#e8dcc4">
        <Layer cx="24" cy="16" anchor="top-left">
          <h1 style="font-size:150px; font-weight:700; color:#ffffff; shadow:0 0 0 6 #1b1612">一</h1>
        </Layer>
      </Layer>`,
    )
    const zero = await renderFvg(
      `<Layer width="420" height="240" background="#e8dcc4">
        <Layer cx="24" cy="16" anchor="top-left">
          <h1 style="font-size:150px; font-weight:700; color:#ffffff; shadow:0 0 0 0 #1b1612">一</h1>
        </Layer>
      </Layer>`,
    )
    const plain = await renderFvg(
      `<Layer width="420" height="240" background="#e8dcc4">
        <Layer cx="24" cy="16" anchor="top-left">
          <h1 style="font-size:150px; font-weight:700; color:#ffffff">一</h1>
        </Layer>
      </Layer>`,
    )
    const s = await pixels(spread.png)
    const z = await pixels(zero.png)
    const p = await pixels(plain.png)
    const edge = barTop(p.at, p.width, p.height, isWhite)
    expect(edge.count).toBeGreaterThan(40)
    const outline = s.at(edge.midX, edge.top - 3)
    expect(outline[0]!).toBeLessThan(80)
    expect(outline[1]!).toBeLessThan(80)
    expect(s.at(edge.midX, edge.top - 9)[0]!).toBeGreaterThan(180)
    expect(isWhite(s.at(edge.midX, edge.top + 4))).toBe(true)
    expect(z.at(edge.midX, edge.top - 3)).toEqual(p.at(edge.midX, edge.top - 3))
    expect(z.at(edge.midX, edge.top + 4)).toEqual(p.at(edge.midX, edge.top + 4))
  })

  it('文字 glow 写 spread 时外圈更亮', async () => {
    const scene = (glow: string) =>
      `<Layer width="420" height="240" background="#000000">
        <Layer cx="24" cy="16" anchor="top-left">
          <h1 style="font-size:150px; font-weight:700; color:#ffffff; glow:${glow}">一</h1>
        </Layer>
      </Layer>`
    const tight = await pixels((await renderFvg(scene('8 0 #ff6600'))).png)
    const wide = await pixels((await renderFvg(scene('8 16 #ff6600'))).png)
    const edge = barTop(tight.at, tight.width, tight.height, isWhite)
    const far = edge.top - 14
    expect(wide.at(edge.midX, far)[0]!).toBeGreaterThan(tight.at(edge.midX, far)[0]! + 25)
  })

  it('图片 shadow 的 spread 跟着透明通道，不按矩形盒子', async () => {
    const canvas = createCanvas(80, 80)
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, 80, 80)
    ctx.fillStyle = '#ff00ff'
    ctx.beginPath()
    ctx.arc(40, 40, 16, 0, Math.PI * 2)
    ctx.fill()
    const src = `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
    const { png } = await renderFvg(
      `<Layer width="160" height="160" background="#ffffff">
        <Layer x="40" y="40">
          <img src="${src}" style="width:80px; height:80px; shadow:0 0 0 8 #112233" />
        </Layer>
      </Layer>`,
    )
    const { at } = await pixels(png)
    // 圆心 (80,80)，半径 16。spread 8 后约到半径 24；盒子角仍是白底。
    expect(at(42, 42)[0]!).toBeGreaterThan(240)
    const rim = at(80, 102)
    expect(rim[0]!).toBeLessThan(80)
    expect(rim[1]!).toBeLessThan(80)
    expect(at(80, 80)[0]!).toBeGreaterThan(180)
  })

  it('形状的纯色 stroke 仍居中，文字的颜色加宽度沿外侧描', async () => {
    const shape = await renderFvg(
      `<Layer width="120" height="80" background="#ffffff">
        <rect x="20" y="20" width="40" height="30" fill="#000000" stroke="#ff0000" stroke-width="4" />
      </Layer>`,
    )
    const rect = shape.report.elements.find((el) => el.tag === 'rect')
    expect(rect?.inkStroke).toBeUndefined()
    const { at } = await pixels(shape.png)
    // 宽 4 居中：边内侧 1px 是描边，再往外 3px 已经回到白底。
    expect(at(21, 35)[0]!).toBeGreaterThan(200)
    expect(at(16, 35)[0]!).toBeGreaterThan(240)
    expect(at(16, 35)[1]!).toBeGreaterThan(240)
    const text = await renderFvg(
      `<Layer width="200" height="80"><h1 style="font-size:40px; color:#ffffff; stroke:#000000; stroke-width:6">一</h1></Layer>`,
    )
    expect(text.report.elements.find((el) => el.tag === 'h1')?.inkStroke).toEqual([
      { width: 6, color: '#000000', position: 'outside' },
    ])
  })

  it('白字 stroke 外圈是黑色，字内仍是白色', async () => {
    const { png, report } = await renderFvg(bar('stroke:6 #000000'))
    const { at, width, height } = await pixels(png)
    const edge = barTop(at, width, height, isWhite)
    expect(edge.count).toBeGreaterThan(40)
    expect(isBlack(at(edge.midX, edge.top - 3))).toBe(true)
    expect(isBlack(at(edge.midX, edge.top - 5))).toBe(true)
    expect(isGreen(at(edge.midX, edge.top - 8))).toBe(true)
    expect(isWhite(at(edge.midX, edge.top + 4))).toBe(true)
    const h1 = report.elements.find((el) => el.tag === 'h1')
    expect(h1?.inkStroke).toEqual([{ width: 6, color: '#000000', position: 'outside' }])
  })

  it('inside 只描字形内侧', async () => {
    const plain = await pixels((await renderFvg(bar(''))).png)
    const { png } = await renderFvg(bar('stroke:6 #000000 inside'))
    const stroked = await pixels(png)
    const edge = barTop(plain.at, plain.width, plain.height, isWhite)
    expect(isGreen(stroked.at(edge.midX, edge.top - 3))).toBe(true)
    expect(isBlack(stroked.at(edge.midX, edge.top + 1))).toBe(true)
    expect(isBlack(stroked.at(edge.midX, edge.top + 3))).toBe(true)
  })

  it('center 内外各约一半', async () => {
    const plain = await pixels((await renderFvg(bar(''))).png)
    const stroked = await pixels((await renderFvg(bar('stroke:6 #000000 center'))).png)
    const edge = barTop(plain.at, plain.width, plain.height, isWhite)
    // 外半约 3px：紧贴笔画外侧是黑，再往外回到背景。内半盖住笔画上沿。
    expect(isBlack(stroked.at(edge.midX, edge.top - 2))).toBe(true)
    expect(isGreen(stroked.at(edge.midX, edge.top - 6))).toBe(true)
    expect(isBlack(stroked.at(edge.midX, edge.top))).toBe(true)
    expect(isWhite(stroked.at(edge.midX, edge.top + 6))).toBe(true)
  })

  it('双层描边按到墨迹的总距离分带', async () => {
    const scene = `<Layer width="460" height="260" background="#0000ff">
      <Layer cx="30" cy="20" anchor="top-left">
        <h1 style="font-size:150px; font-weight:700; color:#00ff00; stroke:6 #ffffff, 14 #ff0000">一</h1>
      </Layer>
    </Layer>`
    const { png, report } = await renderFvg(scene)
    const { at, width, height } = await pixels(png)
    const edge = barTop(at, width, height, (p) => p[1]! > 180 && p[0]! < 80)
    expect(isWhite(at(edge.midX, edge.top - 3))).toBe(true)
    expect(isRed(at(edge.midX, edge.top - 10))).toBe(true)
    expect(isBlue(at(edge.midX, edge.top - 18))).toBe(true)
    expect(report.elements.find((el) => el.tag === 'h1')?.inkStroke).toEqual([
      { width: 6, color: '#ffffff', position: 'outside' },
      { width: 14, color: '#ff0000', position: 'outside' },
    ])
  })

  it('Layer 上的描边把重叠的字合成一圈', async () => {
    const one = (shift: number) =>
      `<Layer width="420" height="240" background="#00aa00">
        <Layer x="${40 + shift}" y="30">
          <h1 style="font-size:140px; font-weight:700; color:#ffffff">口</h1>
        </Layer>
      </Layer>`
    const left = await pixels((await renderFvg(one(0))).png)
    const right = await pixels((await renderFvg(one(48))).png)
    const both = await pixels(
      (
        await renderFvg(
          `<Layer width="420" height="240" background="#00aa00" stroke="8 #ff0000">
            <Layer x="40" y="30">
              <h1 style="font-size:140px; font-weight:700; color:#ffffff">口</h1>
            </Layer>
            <Layer x="88" y="30">
              <h1 style="font-size:140px; font-weight:700; color:#ffffff">口</h1>
            </Layer>
          </Layer>`,
        )
      ).png,
    )
    let overlap = 0
    let redInside = 0
    for (let y = 0; y < left.height; y++) {
      for (let x = 0; x < left.width; x++) {
        if (!isWhite(left.at(x, y)) || !isWhite(right.at(x, y))) continue
        overlap++
        if (isRed(both.at(x, y))) redInside++
      }
    }
    expect(overlap).toBeGreaterThan(30)
    expect(redInside).toBe(0)
    let redOutside = 0
    for (let y = 0; y < both.height; y++) {
      for (let x = 0; x < both.width; x++) {
        if (isRed(both.at(x, y))) redOutside++
      }
    }
    expect(redOutside).toBeGreaterThan(20)
  })

  it('渐变 overlay 染本体，不染外侧描边', async () => {
    const scene = (overlay: string) =>
      `<Layer width="360" height="200" background="#222222">
        <Layer cx="16" cy="12" anchor="top-left" ${overlay}>
          <h1 style="font-size:130px; font-weight:700; color:#ffffff; stroke:6 #000000">一</h1>
        </Layer>
      </Layer>`
    const plain = await pixels((await renderFvg(scene(''))).png)
    const graded = await pixels(
      (await renderFvg(scene('overlay="linear-gradient(to right, #ff0000, #0000ff)"'))).png,
    )
    const edge = barTop(plain.at, plain.width, plain.height, isWhite)
    const left = graded.at(edge.x0 + 12, edge.top + 3)
    const right = graded.at(edge.x1 - 12, edge.top + 3)
    expect(left[0]!).toBeGreaterThan(left[2]! + 80)
    expect(right[2]!).toBeGreaterThan(right[0]! + 80)
    expect(isBlack(graded.at(edge.midX, edge.top - 3))).toBe(true)
  })

  it('shadow 轮廓带着外侧描边', async () => {
    const scene = (stroke: string) =>
      `<Layer width="180" height="180" background="#000000">
        <rect x="60" y="50" width="40" height="40" fill="#ffffff" shadow="0 36 0 #ff0000" ${stroke} />
      </Layer>`
    const plain = await pixels((await renderFvg(scene(''))).png)
    const stroked = await pixels((await renderFvg(scene('stroke="10 #0000ff"'))).png)
    const bottomRed = (at: (x: number, y: number) => readonly number[]) => {
      let yMax = 0
      for (let y = 0; y < 180; y++) {
        if (isRed(at(80, y))) yMax = y
      }
      return yMax
    }
    expect(bottomRed(stroked.at)).toBeGreaterThan(bottomRed(plain.at) + 6)
  })

  it('描边颜色可以是渐变，坐标跟着元素盒子', async () => {
    const { png, report } = await renderFvg(
      `<Layer width="200" height="80" background="#000000">
        <rect x="60" y="28" width="80" height="24" fill="#222222" stroke="8 linear-gradient(to right, #ff0000, #0000ff)" />
      </Layer>`,
    )
    const { at } = await pixels(png)
    // 矩形左缘 x=60，描边再向左 8px；右缘 x=140。
    expect(at(54, 40)[0]!).toBeGreaterThan(at(54, 40)[2]! + 80)
    expect(at(146, 40)[2]!).toBeGreaterThan(at(146, 40)[0]! + 80)
    expect(report.elements.find((el) => el.tag === 'rect')?.inkStroke?.[0]?.color).toContain('linear-gradient')
  })

  it('旋转后的距离描边沿斜边过渡，填充边上不露黑缝', async () => {
    const { png } = await renderFvg(
      `<layer width="240" height="240" background="#000000">
        <rect x="40" y="70" width="160" height="80" fill="#ffffff" stroke="8 #ff0000 outside" rotate="24" />
      </layer>`,
    )
    const { at, width, height } = await pixels(png)
    const levels = new Set<number>()
    let edges = 0
    let seam = 0
    for (let y = 24; y < height - 8; y++) {
      let prev = 0
      for (let x = 1; x < width - 8; x++) {
        const red = at(x, y)[0]!
        if (prev >= 8 || red < 8) {
          prev = red
          continue
        }
        edges++
        levels.add(red)
        let peak = false
        for (let k = 1; k <= 10 && x + k + 1 < width; k++) {
          const px = at(x + k, y)
          if (px[0]! >= 240) peak = true
          else if (peak && px[0]! > 0 && px[0]! < 200 && px[1]! < 30 && at(x + k + 1, y)[0]! >= 240) seam++
        }
        break
      }
    }
    expect(edges).toBeGreaterThan(40)
    expect(levels.size).toBeGreaterThan(12)
    expect(seam).toBe(0)
  })

  it('描边贴近画布边缘时报 effect-clipped', async () => {
    const { report } = await renderFvg(
      `<Layer width="120" height="80" background="#ffffff">
        <rect x="9" y="25" width="30" height="30" fill="#000000" stroke="20 #ff0000" />
      </Layer>`,
    )
    expect(report.issues.some((issue) => issue.code === 'effect-clipped')).toBe(true)
  })

  it('文字 inner-shadow 的 spread 向笔画内侧扩', async () => {
    const none = await pixels((await renderFvg(bar('inner-shadow:0 0 0 0 #000000'))).png)
    const spread = await pixels((await renderFvg(bar('inner-shadow:0 0 0 6 #000000'))).png)
    const edge = barTop(none.at, none.width, none.height, isWhite)
    const rim = (at: (x: number, y: number) => readonly number[]) => at(edge.midX, edge.top + 2)
    expect(rim(none.at)[0]!).toBeGreaterThan(220)
    expect(rim(spread.at)[0]!).toBeLessThan(rim(none.at)[0]! - 40)
  })

  it('宽内描边提示会填死字腔，解析失败带 hint', async () => {
    const wide = await renderFvg(
      `<Layer width="200" height="80"><h1 style="font-size:40px; stroke:8 #000 inside">口</h1></Layer>`,
    )
    const narrow = await renderFvg(
      `<Layer width="400" height="220"><h1 style="font-size:180px; stroke:6 #000 inside">口</h1></Layer>`,
    )
    expect(wide.report.issues.some((issue) => issue.code === 'stroke-fill')).toBe(true)
    expect(narrow.report.issues.some((issue) => issue.code === 'stroke-fill')).toBe(false)
    const bad = await renderFvg(`<Layer width="200" height="80"><h1 style="stroke:6 outside">字</h1></Layer>`)
    const issue = bad.report.issues.find((item) => item.code === 'invalid-attr' && item.message.includes('stroke'))
    expect(issue?.hint).toContain('6 #000 outside')
    const legacy = await renderFvg(`<Layer width="200" height="80"><h1 style="ink-stroke:6 #000">字</h1></Layer>`)
    expect(legacy.report.issues.some((item) => item.message.includes('ink-stroke'))).toBe(true)
    expect(legacy.report.elements.find((el) => el.tag === 'h1')?.inkStroke).toBeUndefined()
    const alias = await renderFvg(
      `<Layer width="200" height="80"><h1 style="-webkit-text-stroke:2px #000; outline:2px solid #000">字</h1></Layer>`,
    )
    const info = alias.report.issues.find((item) => item.code === 'non-canonical' && item.hint?.includes('stroke'))
    expect(info).toBeTruthy()
  })

  it('layer 的描边和阴影罩住 g 里的路径，效果仍只记在 layer 上', async () => {
    const { png, report } = await renderFvg(
      `<layer width="160" height="160" background="#ffffff" stroke="8 #0000ff" shadow="16 0 0 0 #00ff00">
        <g transform="translate(10,0)">
          <g>
            <rect x="30" y="40" width="40" height="40" fill="#ff0000" />
          </g>
        </g>
      </layer>`,
    )
    const { at } = await pixels(png)
    // 平移后矩形在 x=40..80。外侧描边落在 x=32，阴影再往右偏 16。
    expect(at(60, 60)[0]!).toBeGreaterThan(200)
    expect(isBlue(at(36, 60))).toBe(true)
    expect(isGreen(at(90, 60))).toBe(true)
    expect(report.elements.find((el) => el.tag === 'rect')?.inkStroke).toBeUndefined()
    expect(report.elements.find((el) => el.tag === 'g')?.inkStroke).toBeUndefined()
    expect(report.elements.find((el) => el.tag === 'layer')?.inkStroke?.[0]).toEqual({
      width: 8,
      color: '#0000ff',
      position: 'outside',
    })
  })

  it('layer 的内侧描边切进 g 里的路径', async () => {
    const { png } = await renderFvg(
      `<layer width="160" height="160" background="#ffffff" stroke="6 #0000ff inside">
        <g><path d="M40 40 H80 V80 H40 Z" fill="#ff0000" /></g>
      </layer>`,
    )
    const { at } = await pixels(png)
    expect(isBlue(at(40, 60))).toBe(true)
    expect(at(60, 60)[0]!).toBeGreaterThan(200)
    expect(at(32, 60)).toEqual([255, 255, 255, 255])
  })
})
