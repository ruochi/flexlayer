import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { canvas } from './canvas.js'
import { arrowComponent } from './components.js'
import { emitLayer } from './emit.js'
import { freshFontLoadsCount } from './fonts.js'
import { h } from './h.js'
import { freshImageLoadsCount } from './image.js'
import { layoutSource } from './layout.js'
import { checkLayer, renderFvg } from './render.js'

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvasEl = createCanvas(img.width, img.height)
  const ctx = canvasEl.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

describe('canvas.create', () => {
  it('旧的 canvas({...}) 提示怎么改', () => {
    const call = canvas as unknown as (props: Record<string, unknown>) => unknown
    expect(() => call({ width: 100, background: '#fff' })).toThrow(/canvas\.create/)
  })

  it('只接受 layer', () => {
    expect(() => canvas.create(h('h1', {}, '甲'))).toThrow(/layer/)
    expect(() => canvas.create(h('rect', { width: '10', height: '10', fill: '#fff' }))).toThrow(/layer/)
  })

  it('量出左上角盒子，和最终排版一致', async () => {
    const block = canvas.create(
      h(
        'layer',
        { x: '20', y: '30', width: '80', height: '40' },
        h('rect', { x: '0', y: '0', width: '80', height: '40', fill: '#fff' }),
      ),
    )
    expect(block.left).toBe(20)
    expect(block.top).toBe(30)
    expect(block.right).toBe(100)
    expect(block.bottom).toBe(70)
    expect(block.width).toBeCloseTo(80)
    expect(block.height).toBeCloseTo(40)
    const page = canvas.create(
      h('layer', { width: '400', height: '300', color: '#fff', safe: '0' }, h('rect', { x: '0', y: '0', width: '400', height: '300', fill: '#111' }), block),
    )
    const report = await checkLayer(page)
    const rects = report.elements.filter((element) => element.tag === 'rect')
    expect(rects.some((element) => element.box.left === 20 && element.box.top === 30)).toBe(true)
    expect(report.issues.filter((issue) => issue.code === 'measure-mismatch')).toEqual([])
  })

  it('left 到 bottom 是布局盒，rotatedBox 是转完之后的外接矩形', () => {
    const block = canvas.create(
      h(
        'layer',
        { x: '100', y: '100', width: '200', height: '80', rotate: '45' },
        h('rect', { x: '0', y: '0', width: '200', height: '80', fill: '#fff' }),
      ),
    )
    expect(block.left).toBe(100)
    expect(block.top).toBe(100)
    expect(block.right).toBe(300)
    expect(block.bottom).toBe(180)
    expect(block.rotatedBox.top).toBeCloseTo(41, 0)
    expect(block.rotatedBox.bottom).toBeCloseTo(239, 0)
    expect(block.rotatedBox.width).toBeCloseTo(198, 0)
    expect(block.rotatedBox.height).toBeCloseTo(198, 0)
  })

  it('anchor 为 center 时 (x, y) 是盒子中心', () => {
    const block = canvas.create(
      h('layer', { x: '100', y: '80', anchor: 'center', width: '80', height: '40' }, h('rect', { width: '80', height: '40', fill: '#fff' })),
    )
    expect(block.left).toBeCloseTo(60)
    expect(block.top).toBeCloseTo(60)
    expect(block.right).toBeCloseTo(140)
    expect(block.bottom).toBeCloseTo(100)
  })

  it('只写宽时按比例放缩，下一块可以用 bottom', () => {
    const block = canvas.create(
      h('layer', { width: '90' }, h('rect', { x: '0', y: '0', width: '180', height: '60', fill: '#fff' })),
    )
    expect(block.width).toBeCloseTo(90)
    expect(block.height).toBeCloseTo(30)
    expect(Number(block.attrs.scale)).toBeCloseTo(0.5)
    expect(block.attrs.origin).toBe('top-left')
    const bigger = canvas.create(
      h('layer', { width: '200' }, h('rect', { x: '0', y: '0', width: '100', height: '40', fill: '#fff' })),
    )
    expect(bigger.width).toBeCloseTo(200)
    expect(bigger.height).toBeCloseTo(80)
    expect(Number(bigger.attrs.scale)).toBeCloseTo(2)
    const next = canvas.create(h('layer', { y: String(block.bottom), width: '10', height: '10' }, h('rect', { width: '10', height: '10', fill: '#fff' })))
    expect(next.top).toBeCloseTo(30)
  })

  it('换行文字不缩放，宽高都写了也不缩放', () => {
    const wrapped = canvas.create(
      h('layer', { width: '80', color: '#111' }, h('h1', { style: 'font-size:40px' }, '春眠不觉晓处处闻啼鸟')),
    )
    expect(wrapped.attrs.scale).toBeUndefined()
    expect(wrapped.height).toBeGreaterThan(40)
    const boxed = canvas.create(
      h('layer', { width: '100', height: '40' }, h('rect', { x: '0', y: '0', width: '180', height: '180', fill: '#fff' })),
    )
    expect(boxed.width).toBeCloseTo(100)
    expect(boxed.height).toBeCloseTo(40)
    expect(boxed.attrs.scale).toBeUndefined()
    const natural = canvas.create(h('layer', {}, h('rect', { x: '0', y: '0', width: '80', height: '40', fill: '#fff' })))
    expect(natural.width).toBeCloseTo(80)
    expect(natural.height).toBeCloseTo(40)
    expect(natural.attrs.scale).toBeUndefined()
  })

  it('换行宽度和最终画布一致时不报 measure-mismatch', async () => {
    const title = canvas.create(
      h('layer', { width: '80', color: '#fff' }, h('h1', { style: 'font-size:40px' }, '春眠不觉晓处处闻啼鸟')),
    )
    const page = canvas.create(h('layer', { width: '400', height: '300', color: '#fff', safe: '0' }, title))
    const report = await checkLayer(page)
    expect(report.issues.filter((issue) => issue.code === 'measure-mismatch')).toEqual([])
  })

  it('量完之后改了宽度，排版对不上时报 measure-mismatch', async () => {
    const title = canvas.create(
      h('layer', { width: '80', color: '#fff' }, h('h1', { style: 'font-size:40px' }, '春眠不觉晓处处闻啼鸟')),
    )
    title.attrs.width = '400'
    const page = canvas.create(h('layer', { width: '400', height: '300', color: '#fff', safe: '0' }, title))
    const report = await checkLayer(page)
    const hit = report.issues.find((issue) => issue.code === 'measure-mismatch')
    expect(hit?.message).toContain('×')
    expect(hit?.hint).toContain('safe')
  })

  it('没写 safe 的页面和最终排版用同一条边距', async () => {
    const page = canvas.create(
      h('layer', { width: '400', height: '300', color: '#fff' }, h('h1', { style: 'font-size:40px' }, '春眠不觉晓处处闻啼鸟')),
    )
    const report = await checkLayer(page)
    expect(report.issues.filter((issue) => issue.code === 'measure-mismatch')).toEqual([])
  })

  it('图片读不到时报 missing-image', () => {
    const pic = canvas.create(
      h('layer', { width: '200', height: '200', safe: '0' }, h('img', { src: 'nope.png', style: 'width:80px; height:40px' })),
    )
    expect(pic.width).toBeCloseTo(200)
    const missing = pic.issues.find((issue) => issue.code === 'missing-image')
    expect(missing?.message).toContain('nope.png')
  })

  it('字体和图片在进程里只准备一次', () => {
    canvas.create(h('layer', { width: '64', height: '64', 'font-family': 'Kai', safe: '0' }))
    const fonts = freshFontLoadsCount()
    const images = freshImageLoadsCount()
    const sheet = createCanvas(8, 4)
    sheet.getContext('2d').fillRect(0, 0, 8, 4)
    const src = `data:image/png;base64,${sheet.toBuffer('image/png').toString('base64')}`
    const again = canvas.create(
      h('layer', { width: '64', height: '64', 'font-family': 'Kai', safe: '0' }, h('img', { src, style: 'width:8px; height:4px' })),
    )
    expect(again.issues.filter((issue) => issue.code === 'missing-image')).toEqual([])
    expect(freshImageLoadsCount()).toBe(images + 1)
    canvas.create(
      h('layer', { width: '64', height: '64', 'font-family': 'Kai', safe: '0' }, h('img', { src, style: 'width:8px; height:4px' })),
    )
    expect(freshFontLoadsCount()).toBe(fonts)
    expect(freshImageLoadsCount()).toBe(images + 1)
  })

  it('字体还没注册时直接报错，注册后再按真字体量', () => {
    const src = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/croscore/Cousine-Regular.ttf'].find(
      (path) => existsSync(path),
    )
    if (!src) return
    const family = 'ProbeUnregisteredScale'
    const text = h('h1', { style: `font-family:${family}; font-size:48px; white-space:nowrap` }, '0000000000')
    expect(() => canvas.create(h('layer', { width: '200' }, text))).toThrow(/还没注册/)
    const fallback = canvas.create(
      h('layer', { width: '200', 'font-family': 'ChillDuanSans' }, h('h1', { style: 'font-size:48px; white-space:nowrap' }, '0000000000')),
    )
    canvas.font(family, src)
    const real = canvas.create(h('layer', { width: '200' }, h('h1', { style: `font-family:${family}; font-size:48px; white-space:nowrap` }, '0000000000')))
    expect(Math.abs(Number(real.attrs.scale) - Number(fallback.attrs.scale))).toBeGreaterThan(0.05)
  })
})

describe('g 与组件', () => {
  it('g 的 transform 盒子是变换后的并集，fill 传给子形状', async () => {
    const doc = await layoutSource(
      `<layer width="120" height="80"><g transform="translate(20,10)" fill="#00ff00"><rect x="0" y="0" width="40" height="30" /></g></layer>`,
      process.cwd(),
    )
    const group = doc.root.children[0] as { x: number; y: number; width: number; height: number; children: Array<{ fill: string }> }
    expect(group).toMatchObject({ x: 20, y: 10, width: 40, height: 30 })
    expect(group.children[0]?.fill).toBe('#00ff00')
    const { png } = await renderFvg(
      `<layer width="80" height="60" background="#000000"><g transform="translate(30,20)" fill="#00ff00"><rect x="0" y="0" width="10" height="10" /></g></layer>`,
    )
    const moved = await pixelAt(png, 35, 25)
    const origin = await pixelAt(png, 5, 5)
    expect(moved[1]).toBeGreaterThan(200)
    expect(origin[1]).toBeLessThan(20)
  })

  it('g 放进 flex 报 invalid-child', async () => {
    const doc = await layoutSource(
      `<layer width="80" height="40"><div style="display:flex"><g><rect x="0" y="0" width="10" height="10" /></g></div></layer>`,
      process.cwd(),
    )
    expect(doc.issues.some((issue) => issue.code === 'invalid-child' && issue.message.includes('g'))).toBe(true)
  })

  it('arrow 仍画出箭头，emit 保留标签', async () => {
    const source = `<layer width="120" height="40" background="#000000" color="#ff0000"><arrow x1="10" y1="20" x2="80" y2="20" stroke="#ff0000" stroke-width="4" /></layer>`
    const node = (await layoutSource(source, process.cwd())).root
    const group = node.children[0] as { tag: string; children: Array<{ tag: string }> }
    expect(group.tag).toBe('g')
    expect(group.children.map((child) => child.tag).sort()).toEqual(['line', 'polygon'])
    const { png } = await renderFvg(source)
    const shaft = await pixelAt(png, 40, 20)
    const head = await pixelAt(png, 68, 24)
    const sky = await pixelAt(png, 10, 4)
    const pastTip = await pixelAt(png, 82, 20)
    expect(shaft[0]).toBeGreaterThan(200)
    expect(head[0]).toBeGreaterThan(200)
    expect(sky[0]).toBeLessThan(20)
    expect(pastTip[0]).toBeLessThan(20)
    const parsed = await layoutSource(source, process.cwd())
    expect(parsed.issues.filter((issue) => issue.code === 'unknown-tag')).toEqual([])
    const emitted = emitLayer(
      h('layer', { width: '120', height: '40' }, h('arrow', { x1: '10', y1: '20', x2: '80', y2: '20', stroke: '#ff0000' })),
    )
    expect(emitted.source).toContain('<arrow')
  })

  it('canvas.component 可以新增和替换标签', async () => {
    canvas.component('badge', (props) => h('g', {}, h('circle', { cx: '20', cy: '20', r: '10', fill: props.fill ?? '#ffffff' })))
    try {
      const added = await layoutSource(`<layer width="80" height="80"><badge fill="#00ff00" /></layer>`, process.cwd())
      const group = added.root.children[0] as { children: Array<{ tag: string; fill: string }> }
      expect(group.children[0]).toMatchObject({ tag: 'circle', fill: '#00ff00' })
      canvas.component('arrow', () => h('g', {}, h('rect', { x: '0', y: '0', width: '8', height: '8', fill: '#ffffff' })))
      const replaced = await layoutSource(
        `<layer width="40" height="40"><arrow x1="0" y1="0" x2="20" y2="0" /></layer>`,
        process.cwd(),
      )
      const next = replaced.root.children[0] as { children: Array<{ tag: string }> }
      expect(next.children.map((child) => child.tag)).toEqual(['rect'])
    } finally {
      canvas.component('arrow', arrowComponent)
    }
  })
})
