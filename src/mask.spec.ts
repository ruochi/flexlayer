import { createCanvas, loadImage, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { canvas } from './canvas.js'
import { initFontsForMeasure } from './fonts.js'
import { h } from './h.js'
import { layoutSource } from './layout.js'
import { checkFvg, renderFvg } from './render.js'

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

function pngDataUrl(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): string {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  paint(ctx)
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}

describe('mask', () => {
  it('圆形 mask 留下圆心，清掉角上的像素，画布底色还在', async () => {
    const { png, report } = await renderFvg(`
      <layer width="80" height="80" background="#0000ff">
        <mask><circle cx="40" cy="40" r="18" /></mask>
        <rect x="0" y="0" width="80" height="80" fill="#ff0000"  />
      </layer>
    `)
    const center = await pixelAt(png, 40, 40)
    const corner = await pixelAt(png, 4, 4)
    expect(center[0]).toBeGreaterThan(200)
    expect(center[2]).toBeLessThan(30)
    expect(corner[2]).toBeGreaterThan(200)
    expect(corner[0]).toBeLessThan(30)
    expect(corner[3]).toBe(255)
    expect(report.elements.map((el) => el.tag)).not.toContain('circle')
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
  })

  it('省略 fill 的多边形是不透明的', async () => {
    const { png } = await renderFvg(`
      <layer width="40" height="40" background="#00ff00">
        <mask><polygon points="0,0 40,0 40,40 0,40" /></mask>
        <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
      </layer>
    `)
    const center = await pixelAt(png, 20, 20)
    expect(center[0]).toBeGreaterThan(200)
    expect(center[1]).toBeLessThan(30)
  })

  it('渐变 alpha 从上到下淡出', async () => {
    const { png } = await renderFvg(`
      <layer width="40" height="40" background="#0000ff">
        <mask>
          <rect x="0" y="0" width="40" height="40" fill="linear-gradient(to bottom, #fff, #fff0)"  />
        </mask>
        <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
      </layer>
    `)
    const top = await pixelAt(png, 20, 2)
    const bottom = await pixelAt(png, 20, 37)
    expect(top[0]).toBeGreaterThan(top[2])
    expect(bottom[2]).toBeGreaterThan(bottom[0])
  })

  it('后写的透明形状不会把先写的挖空', async () => {
    const { png } = await renderFvg(`
      <layer width="40" height="40" background="#00ff00">
        <mask>
          <rect x="0" y="0" width="40" height="40" fill="#fff"  />
          <circle cx="20" cy="20" r="10" fill="#fff0" />
        </mask>
        <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
      </layer>
    `)
    const center = await pixelAt(png, 20, 20)
    expect(center[0]).toBeGreaterThan(200)
    expect(center[1]).toBeLessThan(30)
  })

  it('带洞的 path 中间露底', async () => {
    const { png } = await renderFvg(`
      <layer width="40" height="40" background="#00ff00">
        <mask>
          <path d="M0 0 H40 V40 H0 Z M10 10 V30 H30 V10 H10 Z" fill="#fff" />
        </mask>
        <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
      </layer>
    `)
    const ring = await pixelAt(png, 5, 20)
    const hole = await pixelAt(png, 20, 20)
    expect(ring[0]).toBeGreaterThan(200)
    expect(hole[1]).toBeGreaterThan(200)
    expect(hole[0]).toBeLessThan(30)
  })

  it('形状的 rotate 照常改变蒙版', async () => {
    const { png } = await renderFvg(`
      <layer width="80" height="80" background="#000000">
        <mask>
          <rect x="0" y="30" width="80" height="20" fill="#fff" rotate="90"  />
        </mask>
        <rect x="0" y="0" width="80" height="80" fill="#ffffff"  />
      </layer>
    `)
    const vertical = await pixelAt(png, 40, 8)
    const horizontal = await pixelAt(png, 8, 40)
    expect(vertical[0]).toBeGreaterThan(200)
    expect(horizontal[0]).toBeLessThan(20)
  })

  it('模糊之后再裁，mask 边外保持底色', async () => {
    const { png } = await renderFvg(`
      <layer width="100" height="100" background="#000000" blur="8">
        <mask><rect x="40" y="0" width="20" height="100"  /></mask>
        <rect x="0" y="0" width="100" height="100" fill="#ffffff"  />
      </layer>
    `)
    const kept = await pixelAt(png, 50, 50)
    const cut = await pixelAt(png, 20, 50)
    const edge = await pixelAt(png, 36, 50)
    expect(kept[0]).toBeGreaterThan(240)
    expect(cut[0]).toBeLessThan(8)
    expect(edge[0]).toBeLessThan(8)
  })

  it('阴影在 mask 外面被裁掉', async () => {
    const { png } = await renderFvg(`
      <layer width="90" height="60" background="#000000">
        <mask><circle cx="30" cy="30" r="16" /></mask>
        <rect x="20" y="20" width="20" height="20" fill="#ffffff" shadow="24 0 0 #ff0000" />
      </layer>
    `)
    const body = await pixelAt(png, 30, 30)
    const shadow = await pixelAt(png, 62, 30)
    expect(body[0]).toBeGreaterThan(200)
    expect(shadow[0]).toBeLessThan(20)
  })

  it('overflow=hidden 先裁子元素，mask 不会把盒子外的像素找回来', async () => {
    const { png } = await renderFvg(`
      <layer width="100" height="80" background="#000000">
        <layer x="0" y="0" width="40" height="40" overflow="hidden">
          <mask><rect x="-10" y="0" width="90" height="40"  /></mask>
          <rect x="20" y="0" width="50" height="40" fill="#ffffff"  />
        </layer>
      </layer>
    `)
    const inside = await pixelAt(png, 30, 20)
    const outside = await pixelAt(png, 55, 20)
    expect(inside[0]).toBeGreaterThan(200)
    expect(outside[0]).toBeLessThan(20)
  })

  it('img 的 alpha 可以当蒙版', async () => {
    const src = pngDataUrl(40, 40, (ctx) => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 20, 40)
    })
    const { png } = await renderFvg(`
      <layer width="40" height="40" background="#00ff00">
        <mask><img src="${src}" style="width:40px; height:40px" /></mask>
        <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
      </layer>
    `)
    const left = await pixelAt(png, 6, 20)
    const right = await pixelAt(png, 30, 20)
    expect(left[0]).toBeGreaterThan(200)
    expect(right[1]).toBeGreaterThan(200)
    expect(right[0]).toBeLessThan(30)
  })

  it('mask 不撑大 layer，也不把形状算进报告', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="80"><layer id="card"><mask><circle cx="0" cy="0" r="200" /></mask><rect width="30" height="16" fill="#fff" /></layer></layer>`,
      process.cwd(),
    )
    const card = doc.root.children[0]
    expect(card?.kind).toBe('layer')
    if (card?.kind !== 'layer') return
    expect(card.width).toBe(30)
    expect(card.height).toBe(16)
    expect(card.mask).toHaveLength(1)
    expect(card.children).toHaveLength(1)
    const report = await checkFvg(
      `<layer width="40" height="40"><mask><circle cx="0" cy="0" r="200" /></mask><rect x="0" y="0" width="10" height="10" fill="#fff"  /></layer>`,
    )
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
    expect(report.elements.some((el) => el.tag === 'circle' || el.tag === 'mask')).toBe(false)
  })

  it('被 mask 挡住、落到画布外的内容不报 overflow-canvas', async () => {
    const hidden = await checkFvg(
      `<layer width="80" height="80" background="#000"><mask><circle cx="40" cy="40" r="24" /></mask><rect x="-30" y="-30" width="140" height="140" fill="#fff"  /></layer>`,
    )
    expect(hidden.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
    const shown = await checkFvg(
      `<layer width="80" height="80" background="#000"><mask><rect x="-8" y="0" width="96" height="80"  /></mask><rect x="-8" y="0" width="96" height="80" fill="#fff"  /></layer>`,
    )
    expect(shown.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(true)
  })

  it('mask 挡住的光晕不报 effect-clipped', async () => {
    const masked = await checkFvg(
      `<layer width="80" height="80" background="#000"><mask><circle cx="40" cy="40" r="18" /></mask><rect x="0" y="0" width="80" height="80" fill="#fff" glow="36 #fff"  /></layer>`,
    )
    expect(masked.issues.some((issue) => issue.code === 'effect-clipped')).toBe(false)
    const open = await checkFvg(
      `<layer width="80" height="80" background="#000"><rect x="0" y="0" width="80" height="80" fill="#fff" glow="36 #fff"  /></layer>`,
    )
    expect(open.issues.some((issue) => issue.code === 'effect-clipped')).toBe(true)
  })

  it('空 mask、第二个 mask、放错位置都会 warn', async () => {
    const empty = await checkFvg(`<layer width="40" height="40" background="#00ff00"><mask></mask><rect x="0" y="0" width="40" height="40" fill="#ff0000"  /></layer>`)
    expect(empty.issues.some((issue) => issue.code === 'empty-mask')).toBe(true)
    const { png } = await renderFvg(`<layer width="40" height="40" background="#00ff00"><mask></mask><rect x="0" y="0" width="40" height="40" fill="#ff0000"  /></layer>`)
    expect((await pixelAt(png, 20, 20))[0]).toBeGreaterThan(200)

    const extra = await checkFvg(`
      <layer width="40" height="40" background="#00ff00">
        <mask><circle cx="20" cy="20" r="8" /></mask>
        <mask><rect x="0" y="0" width="40" height="40"  /></mask>
        <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
      </layer>
    `)
    expect(extra.issues.some((issue) => issue.message.includes('一个 mask'))).toBe(true)
    const extraPng = await renderFvg(`
      <layer width="40" height="40" background="#00ff00">
        <mask><circle cx="20" cy="20" r="8" /></mask>
        <mask><rect x="0" y="0" width="40" height="40"  /></mask>
        <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
      </layer>
    `)
    const corner = await pixelAt(extraPng.png, 2, 2)
    const mid = await pixelAt(extraPng.png, 20, 20)
    expect(corner[1]).toBeGreaterThan(200)
    expect(mid[0]).toBeGreaterThan(200)

    const line = await checkFvg(`<layer width="40" height="40"><mask><line x1="0" y1="0" x2="10" y2="10" /></mask></layer>`)
    expect(line.issues.some((issue) => issue.code === 'invalid-child' && issue.message.includes('line'))).toBe(true)

    const flex = await checkFvg(`<layer width="80" height="40"><div style="display:flex"><mask><circle cx="10" cy="10" r="4" /></mask></div></layer>`)
    expect(flex.issues.some((issue) => issue.code === 'invalid-child' && issue.message.includes('直接子元素'))).toBe(true)

    const onShape = await checkFvg(`<layer width="40" height="40"><rect width="20" height="20"><mask><circle cx="10" cy="10" r="4" /></mask></rect></layer>`)
    expect(onShape.issues.some((issue) => issue.code === 'invalid-child' && issue.message.includes('直接子元素'))).toBe(true)

    const styled = await checkFvg(`<layer width="40" height="40"><rect x="15" y="15" width="10" height="10" style="mask: url(#a)" /></layer>`)
    expect(styled.issues.some((issue) => issue.message.includes('style'))).toBe(true)
  })

  it('canvas.create 量出 mask 的面积、外接矩形和碎片数', () => {
    const layer = canvas.create(
      h(
        'layer',
        { x: '10', y: '10', width: '100', height: '50' },
        h('mask', {}, h('rect', { x: '0', y: '0', width: '20', height: '50' }), h('rect', { x: '60', y: '10', width: '30', height: '20' })),
        h('rect', { x: '0', y: '0', width: '100', height: '50', fill: '#f00' }),
      ),
    )
    expect(layer.mask).toBeDefined()
    expect(layer.mask!.area).toBeCloseTo((20 * 50 + 30 * 20) / (100 * 50), 3)
    expect(layer.mask!.pieces).toBe(2)
    expect(layer.mask!.softEdge).toBeLessThan(1)
    expect(layer.mask!.ink).toMatchObject({ left: 0, top: 0, right: 90, bottom: 50 })
  })

  it('没有 mask 时不写，全藏起来时 ink 是 null', () => {
    const plain = canvas.create(h('layer', { width: '20', height: '20' }, h('rect', { width: '20', height: '20', fill: '#fff' })))
    expect(plain.mask).toBeUndefined()
    const hidden = canvas.create(
      h(
        'layer',
        { width: '20', height: '20' },
        h('mask', {}, h('rect', { x: '0', y: '0', width: '20', height: '20', fill: '#fff0' })),
        h('rect', { width: '20', height: '20', fill: '#fff' }),
      ),
    )
    expect(hidden.mask).toMatchObject({ area: 0, ink: null, pieces: 0, softEdge: 0 })
  })

  it('渐变 mask 的软边比实心圆宽得多', () => {
    const soft = canvas.create(
      h(
        'layer',
        { width: '40', height: '40' },
        h('mask', {}, h('rect', { x: '0', y: '0', width: '40', height: '40', fill: 'linear-gradient(to bottom, #fff, #fff0)' })),
        h('rect', { width: '40', height: '40', fill: '#fff' }),
      ),
    )
    const hard = canvas.create(
      h(
        'layer',
        { width: '40', height: '40' },
        h('mask', {}, h('circle', { cx: '20', cy: '20', r: '15' })),
        h('rect', { width: '40', height: '40', fill: '#fff' }),
      ),
    )
    expect(soft.mask!.area).toBeCloseTo(0.5, 1)
    expect(soft.mask!.softEdge).toBeGreaterThan(20)
    expect(hard.mask!.pieces).toBe(1)
    expect(hard.mask!.softEdge).toBeLessThan(2)
  })

  it('图片的 alpha 也算进统计', () => {
    const src = pngDataUrl(40, 40, (ctx) => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 10, 40)
      ctx.fillRect(30, 0, 10, 40)
    })
    const layer = canvas.create(
      h(
        'layer',
        { width: '40', height: '40' },
        h('mask', {}, h('img', { src, style: 'width:40px; height:40px' })),
        h('rect', { width: '40', height: '40', fill: '#fff' }),
      ),
    )
    expect(layer.mask!.area).toBeCloseTo(0.5, 2)
    expect(layer.mask!.pieces).toBe(2)
  })

  it('嵌套层的 mask 在 elements 里，ink 跟着这一层的位置和缩放', () => {
    const page = canvas.create(
      h(
        'layer',
        { width: '200', height: '200' },
        h(
          'layer',
          { id: 'cut', x: '40', y: '20', width: '50', height: '50', scale: '2', origin: 'top-left' },
          h('mask', {}, h('rect', { x: '10', y: '10', width: '20', height: '20' })),
          h('rect', { width: '50', height: '50', fill: '#fff' }),
        ),
      ),
    )
    expect(page.mask).toBeUndefined()
    const cut = page.elements.find((el) => el.id === 'cut')
    expect(cut?.mask?.area).toBeCloseTo(400 / 2500, 3)
    expect(cut?.mask?.ink).toMatchObject({ left: 60, top: 40, right: 100, bottom: 80 })
  })

  it('报告里带 mask 的 layer 写出统计，ink 是画布坐标', async () => {
    const report = await checkFvg(
      `<layer width="100" height="100"><layer id="cut" x="20" y="30" width="40" height="40"><mask><rect x="0" y="0" width="20" height="40" /></mask><rect width="40" height="40" fill="#fff" /></layer></layer>`,
    )
    const cut = report.elements.find((el) => el.id === 'cut')
    expect(cut?.mask).toMatchObject({ area: 0.5, pieces: 1, ink: { x: 20, y: 30, width: 20, height: 40 } })
    expect(report.elements.find((el) => el.tag === 'rect')?.mask).toBeUndefined()
  })

  it('symbol 里的 mask 跟着 use 生效', async () => {
    const { png } = await renderFvg(`
      <layer width="40" height="40" background="#00ff00">
        <symbol id="card" width="40" height="40">
          <mask><circle cx="20" cy="20" r="10" /></mask>
          <rect x="0" y="0" width="40" height="40" fill="#ff0000"  />
        </symbol>
        <use href="#card" x="0" y="0" />
      </layer>
    `)
    const center = await pixelAt(png, 20, 20)
    const corner = await pixelAt(png, 2, 2)
    expect(center[0]).toBeGreaterThan(200)
    expect(corner[1]).toBeGreaterThan(200)
  })
})
