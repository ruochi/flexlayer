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
