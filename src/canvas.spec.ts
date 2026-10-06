import { describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { canvas, layer, Graphic } from './canvas.js'
import { freshFontLoadsCount } from './fonts.js'
import { freshImageLoadsCount } from './image.js'
import { h } from './h.js'
import { checkLayer } from './render.js'

describe('canvas().layer()', () => {
  it('量出左上角盒子，at 之后和最终排版一致', async () => {
    const graphic = canvas({ width: 400, height: 300, background: '#111', color: '#fff', safe: 0 })
    const block = graphic.layer(h('rect', { x: '0', y: '0', width: '80', height: '40', fill: '#fff' }))
    expect(block.width).toBeCloseTo(80)
    expect(block.height).toBeCloseTo(40)
    expect(block.scale).toBe(1)
    const placed = block.at({ x: 20, y: 30 })
    expect(placed.left).toBe(20)
    expect(placed.top).toBe(30)
    expect(placed.right).toBe(100)
    expect(placed.bottom).toBe(70)
    expect(placed.cx).toBe(60)
    expect(placed.cy).toBe(50)
    const report = await checkLayer(graphic.root(placed))
    const rect = report.elements.find((element) => element.tag === 'rect')
    expect(rect?.box.left).toBeCloseTo(20)
    expect(rect?.box.top).toBeCloseTo(30)
    expect(report.issues.filter((issue) => issue.code === 'measure-mismatch')).toEqual([])
  })

  it('anchor 为 center 时 (x, y) 是缩放后盒子的中心', async () => {
    const graphic = canvas({ width: 400, height: 300, safe: 0 })
    const block = graphic.layer(h('rect', { width: '80', height: '40', fill: '#fff' }))
    const placed = block.at({ x: 100, y: 80, anchor: 'center' })
    expect(placed.left).toBeCloseTo(60)
    expect(placed.top).toBeCloseTo(60)
    expect(placed.cx).toBeCloseTo(100)
    expect(placed.cy).toBeCloseTo(80)
    const report = await checkLayer(graphic.root(placed))
    const rect = report.elements.find((element) => element.tag === 'rect')
    expect(rect?.box.left).toBeCloseTo(60)
    expect(rect?.box.top).toBeCloseTo(60)
  })

  it('fit 和 scaled 不改原对象，也不放大', async () => {
    const graphic = canvas({ width: 400, height: 300, safe: 0 })
    const block = graphic.layer(h('rect', { width: '100', height: '50', fill: '#fff' }), { glow: '40 #ffffff' })
    expect(block.effect.width).toBeGreaterThan(block.width)
    const fitted = block.fit({ width: 100, by: 'effect' })
    expect(fitted.scale).toBeLessThan(1)
    expect(fitted.effect.width).toBeLessThanOrEqual(100 + 0.01)
    expect(block.scale).toBe(1)
    const bigger = block.fit({ width: 400 })
    expect(bigger.scale).toBe(1)
    const half = block.scaled(0.5)
    expect(half.width).toBeCloseTo(50)
    expect(block.width).toBeCloseTo(100)
    const placed = half.at({ x: 10, y: 12 })
    expect(placed.attrs.scale).toBe('0.5')
    expect(placed.attrs.origin).toBe('top-left')
    expect(placed.width).toBeCloseTo(50)
  })

  it('没预先加载的图片报 missing-image，并指向 canvas({ images })', async () => {
    const graphic = canvas({ width: 200, height: 200, safe: 0 })
    const pic = graphic.layer(h('img', { src: 'nope.png', style: 'width:80px; height:40px' }))
    expect(pic.width).toBeCloseTo(80)
    expect(pic.height).toBeCloseTo(40)
    expect(pic.issues.some((issue) => issue.code === 'missing-image' && issue.hint?.includes('canvas({ images'))).toBe(true)
  })

  it('量到的换行和最终画布不一致时报 measure-mismatch', async () => {
    const graphic = canvas({ width: 400, height: 300, color: '#fff', safe: 0 })
    const title = graphic.layer(h('h1', { style: 'font-size:40px' }, '春眠不觉晓处处闻啼鸟'), { maxWidth: 80 })
    const report = await checkLayer(graphic.root(title.at({ x: 0, y: 0 })))
    const hit = report.issues.find((issue) => issue.code === 'measure-mismatch')
    expect(hit?.message).toContain('×')
    expect(hit?.hint).toContain('maxWidth')
  })

  it('换行宽度一致时不报 measure-mismatch', async () => {
    const graphic = canvas({ width: 400, height: 300, color: '#fff', safe: 0 })
    const title = graphic.layer(h('h1', { style: 'font-size:40px' }, '春眠不觉晓处处闻啼鸟'))
    const report = await checkLayer(graphic.root(title.at({ x: 16, y: 16 })))
    expect(report.issues.filter((issue) => issue.code === 'measure-mismatch')).toEqual([])
  })

  it('root 带上画布、颜色、字体和 font 声明', async () => {
    const graphic = canvas({
      width: 320,
      height: 180,
      background: '#0c1424',
      color: '#f4ecdf',
      fontFamily: 'Kai',
      fonts: { Cousine: '/usr/share/fonts/truetype/croscore/Cousine-Regular.ttf' },
      safe: 12,
    })
    const root = graphic.root(h('rect', { width: '10', height: '10', fill: '#fff' }))
    expect(root.attrs).toMatchObject({
      width: '320',
      height: '180',
      background: '#0c1424',
      color: '#f4ecdf',
      'font-family': 'Kai',
      safe: '12',
    })
    const font = root.children.find((child) => typeof child !== 'string' && child.tag === 'font')
    expect(typeof font !== 'string' && font && font.attrs).toMatchObject({
      family: 'Cousine',
      src: '/usr/share/fonts/truetype/croscore/Cousine-Regular.ttf',
    })
  })

  it('不经过 canvas 时不按画布宽度换行', async () => {
    canvas({ width: 40, height: 40, safe: 0 })
    const wide = layer(h('h1', { style: 'font-size:20px' }, '春眠不觉晓'))
    expect(wide.width).toBeGreaterThan(40)
    expect(wide.height).toBeLessThan(40)
  })

  it('canvas() 同步返回，字体和图片在进程里只准备一次', () => {
    const first = canvas({ width: 64, height: 64, fontFamily: 'Kai', safe: 0 })
    expect(first).toBeInstanceOf(Graphic)
    const fonts = freshFontLoadsCount()
    const images = freshImageLoadsCount()
    const sheet = createCanvas(8, 4)
    sheet.getContext('2d').fillRect(0, 0, 8, 4)
    const src = `data:image/png;base64,${sheet.toBuffer('image/png').toString('base64')}`
    const again = canvas({ width: 64, height: 64, fontFamily: 'Kai', images: [src], safe: 0 })
    const pic = again.layer(h('img', { src, style: 'width:8px; height:4px' }))
    expect(pic.issues.filter((issue) => issue.code === 'missing-image')).toEqual([])
    expect(freshImageLoadsCount()).toBe(images + 1)
    canvas({ width: 64, height: 64, fontFamily: 'Kai', images: [src], safe: 0 })
    expect(freshFontLoadsCount()).toBe(fonts)
    expect(freshImageLoadsCount()).toBe(images + 1)
  })
})
