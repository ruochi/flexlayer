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

  it('没有文字时 text 是空数组', () => {
    const block = canvas.create(
      h('layer', { width: '80', height: '40' }, h('rect', { width: '80', height: '40', fill: '#fff' })),
    )
    expect(block.text).toEqual([])
  })

  it('一个字、一行、多行都是 lines，字在行里面', () => {
    const one = canvas.create(h('layer', {}, h('h1', { style: 'font-size:80px; white-space:nowrap' }, '春')))
    expect(one.text).toHaveLength(1)
    expect(one.text[0]!.path).toBe('h1[0]')
    expect(one.text[0]!.lines).toHaveLength(1)
    const charLine = one.text[0]!.lines[0]!
    expect(charLine.chars.map((char) => char.text)).toEqual(['春'])
    expect(charLine.chars[0]!.x).toBeCloseTo(charLine.x)
    expect(charLine.chars[0]!.width).toBeCloseTo(charLine.width)
    expect(charLine.baseline).toBeGreaterThan(charLine.y)
    expect(charLine.baseline).toBeLessThan(charLine.y + charLine.height)

    const row = canvas.create(h('layer', {}, h('h1', { style: 'font-size:40px; white-space:nowrap' }, '春眠不觉晓')))
    expect(row.text[0]!.lines).toHaveLength(1)
    const line = row.text[0]!.lines[0]!
    expect(line.chars.map((char) => char.text).join('')).toBe('春眠不觉晓')
    let pen = line.x
    for (const char of line.chars) {
      expect(char.x).toBeCloseTo(pen)
      pen += char.width
    }
    expect(pen).toBeCloseTo(line.x + line.width)

    const wrapped = canvas.create(
      h('layer', { width: '80' }, h('p', { style: 'font-size:40px' }, '春眠不觉晓处处闻啼鸟')),
    )
    const lines = wrapped.text[0]!.lines
    expect(wrapped.text[0]!.path).toBe('p[0]')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[1]!.baseline).toBeGreaterThan(lines[0]!.baseline)
    expect(lines[1]!.y).toBeGreaterThanOrEqual(lines[0]!.y + lines[0]!.height - 0.5)
  })

  it('字带上所属 span 的 id', () => {
    const block = canvas.create(
      h(
        'layer',
        {},
        h('p', { style: 'font-size:40px; white-space:nowrap' }, '前面', h('span', { id: 'here' }, '就是这里'), '后面'),
      ),
    )
    const chars = block.text[0]!.lines[0]!.chars
    expect(chars.map((char) => char.text).join('')).toBe('前面就是这里后面')
    expect(chars.filter((char) => char.id === 'here').map((char) => char.text).join('')).toBe('就是这里')
    expect(chars.filter((char) => char.id == null).map((char) => char.text).join('')).toBe('前面后面')

    const nested = canvas.create(
      h(
        'layer',
        {},
        h('p', { style: 'font-size:40px; white-space:nowrap' }, h('span', { id: 'outer' }, '甲', h('em', { id: 'inner' }, '乙'))),
      ),
    )
    const nestedChars = nested.text[0]!.lines[0]!.chars
    expect(nestedChars.find((char) => char.text === '甲')?.id).toBe('outer')
    expect(nestedChars.find((char) => char.text === '乙')?.id).toBe('inner')
  })

  it('letter-spacing 的 em 按声明处的字号换算，继承的是像素', () => {
    const gap = (node: ReturnType<typeof canvas.create>) => {
      const chars = node.text[0]!.lines[0]!.chars
      return chars[1]!.x - chars[0]!.x
    }
    const em = canvas.create(h('layer', {}, h('p', { style: 'font-size:40px; white-space:nowrap; letter-spacing:0.5em' }, 'AB')))
    const px = canvas.create(h('layer', {}, h('p', { style: 'font-size:40px; white-space:nowrap; letter-spacing:20px' }, 'AB')))
    expect(em.issues.filter((issue) => issue.code === 'invalid-attr')).toEqual([])
    expect(gap(em)).toBeCloseTo(gap(px), 0)

    const inherited = canvas.create(
      h(
        'layer',
        {},
        h('div', { style: 'font-size:40px; letter-spacing:0.5em' }, h('p', { style: 'font-size:80px; white-space:nowrap' }, 'AB')),
      ),
    )
    const fixed = canvas.create(h('layer', {}, h('p', { style: 'font-size:80px; white-space:nowrap; letter-spacing:20px' }, 'AB')))
    expect(gap(inherited)).toBeCloseTo(gap(fixed), 0)
  })

  it('字距算进笔位，居中和内边距挪动行盒', () => {
    const tight = canvas.create(h('layer', {}, h('p', { style: 'font-size:40px; white-space:nowrap' }, 'AB')))
    const spaced = canvas.create(
      h('layer', {}, h('p', { style: 'font-size:40px; white-space:nowrap; letter-spacing:10px' }, 'AB')),
    )
    const tightChars = tight.text[0]!.lines[0]!.chars
    const spacedChars = spaced.text[0]!.lines[0]!.chars
    expect(spacedChars).toHaveLength(2)
    expect(spacedChars[1]!.x - spacedChars[0]!.x).toBeGreaterThan(tightChars[1]!.x - tightChars[0]!.x + 5)
    expect(spacedChars[1]!.x).toBeCloseTo(spacedChars[0]!.x + spacedChars[0]!.width)

    const centered = canvas.create(
      h(
        'layer',
        { width: '300', height: '80', safe: '0' },
        h('h1', { style: 'font-size:40px; white-space:nowrap; text-align:center; width:300px' }, '春'),
      ),
    )
    const centeredLine = centered.text[0]!.lines[0]!
    expect(centeredLine.x + centeredLine.width / 2).toBeCloseTo(150, 0)

    const padded = canvas.create(
      h('layer', {}, h('p', { style: 'font-size:40px; white-space:nowrap; padding:16px' }, '春')),
    )
    expect(padded.text[0]!.lines[0]!.x).toBeCloseTo(16)
    expect(padded.text[0]!.lines[0]!.y).toBeCloseTo(16)
  })

  it('两段文字用 path 分开，竖排每个字一行', () => {
    const block = canvas.create(
      h(
        'layer',
        {},
        h(
          'div',
          { style: 'display:flex; flex-direction:column; gap:24px; align-items:flex-start' },
          h('p', { style: 'font-size:40px; white-space:nowrap' }, '甲'),
          h('p', { style: 'font-size:40px; white-space:nowrap' }, '乙'),
        ),
      ),
    )
    expect(block.text.map((item) => item.path)).toEqual(['div[0]/p[0]', 'div[0]/p[1]'])
    const [first, second] = block.text
    expect(second!.lines[0]!.y).toBeCloseTo(first!.lines[0]!.y + first!.lines[0]!.height + 24, 0)

    const column = canvas.create(
      h('layer', {}, h('h1', { style: 'writing-mode:vertical-rl; font-size:40px; letter-spacing:8px' }, '寒露')),
    )
    const lines = column.text[0]!.lines
    expect(lines.map((item) => item.chars.map((char) => char.text).join(''))).toEqual(['寒', '露'])
    expect(lines[1]!.y).toBeCloseTo(lines[0]!.y + lines[0]!.height + 8, 0)
    expect(lines[1]!.x).toBeCloseTo(lines[0]!.x, 0)
    expect(lines[1]!.baseline).toBeGreaterThan(lines[0]!.baseline)
  })

  it('嵌套层的位置和缩放算进坐标，这一层自己的 rotate 不算', () => {
    const plain = canvas.create(h('layer', {}, h('p', { style: 'font-size:40px; white-space:nowrap' }, '春')))
    const turned = canvas.create(
      h('layer', { rotate: '30' }, h('p', { style: 'font-size:40px; white-space:nowrap' }, '春')),
    )
    expect(turned.text[0]!.lines[0]!.baseline).toBeCloseTo(plain.text[0]!.lines[0]!.baseline)
    expect(turned.text[0]!.lines[0]!.x).toBeCloseTo(plain.text[0]!.lines[0]!.x)

    const nested = canvas.create(
      h('layer', {}, h('layer', { x: '12', y: '20' }, h('p', { style: 'font-size:40px; white-space:nowrap' }, '春'))),
    )
    expect(nested.text[0]!.path).toBe('layer[0]/p[0]')
    expect(nested.text[0]!.lines[0]!.x).toBeCloseTo(plain.text[0]!.lines[0]!.x + 12)
    expect(nested.text[0]!.lines[0]!.y).toBeCloseTo(plain.text[0]!.lines[0]!.y + 20)

    const scaled = canvas.create(
      h(
        'layer',
        { width: '400', height: '400', safe: '0' },
        h(
          'layer',
          { width: '200', height: '200', scale: '2', origin: 'top-left' },
          h('p', { style: 'font-size:40px; white-space:nowrap' }, '春'),
        ),
      ),
    )
    expect(scaled.text[0]!.lines[0]!.width).toBeCloseTo(plain.text[0]!.lines[0]!.width * 2, 0)
    expect(scaled.text[0]!.lines[0]!.baseline).toBeCloseTo(plain.text[0]!.lines[0]!.baseline * 2, 0)
  })

  it('只写宽时文字坐标落在缩放后的盒子里', () => {
    const block = canvas.create(
      h('layer', { width: '180' }, h('h1', { style: 'font-size:40px; white-space:nowrap' }, '春眠')),
    )
    const line = block.text[0]!.lines[0]!
    expect(block.width).toBeCloseTo(180)
    expect(line.x + line.width).toBeCloseTo(180, 0)
    expect(line.y).toBeGreaterThanOrEqual(-0.5)
    expect(line.baseline).toBeLessThanOrEqual(block.height + 0.5)
  })

  it('每个元素都有布局盒，和文字用同一套坐标', () => {
    const block = canvas.create(
      h(
        'layer',
        { x: '20', y: '30', width: '200', height: '120' },
        h('rect', { id: 'card', x: '10', y: '16', width: '80', height: '40', fill: '#fff' }),
        h('circle', { cx: '140', cy: '36', r: '16', fill: '#fff' }),
      ),
    )
    expect(block.elements.map((element) => element.path)).toEqual(['rect[0]', 'circle[1]'])
    const card = block.elements[0]!
    const dot = block.elements[1]!
    expect(card.id).toBe('card')
    expect(card.tag).toBe('rect')
    expect(card.box).toMatchObject({ left: 10, top: 16, width: 80, height: 40, right: 90, bottom: 56 })
    expect(card.ink).toEqual(card.box)
    expect(dot.id).toBeUndefined()
    expect(dot.box).toMatchObject({ left: 124, top: 20, width: 32, height: 32 })
    expect(dot.box.left + dot.box.width / 2).toBeCloseTo(140)
    expect(dot.box.top + dot.box.height / 2).toBeCloseTo(36)

    const column = canvas.create(
      h(
        'layer',
        {},
        h(
          'div',
          { style: 'display:flex; flex-direction:column; gap:24px; align-items:flex-start' },
          h('p', { style: 'font-size:40px; white-space:nowrap' }, '甲'),
          h('p', { style: 'font-size:40px; white-space:nowrap' }, '乙'),
        ),
      ),
    )
    const paragraphs = column.elements.filter((element) => element.tag === 'p')
    expect(paragraphs.map((element) => element.path)).toEqual(['div[0]/p[0]', 'div[0]/p[1]'])
    expect(paragraphs[1]!.box.top).toBeCloseTo(paragraphs[0]!.box.bottom + 24, 0)
    const line = column.text[0]!.lines[0]!
    expect(line.y).toBeGreaterThanOrEqual(paragraphs[0]!.box.top - 0.5)
    expect(line.y + line.height).toBeLessThanOrEqual(paragraphs[0]!.box.bottom + 0.5)
    expect(line.x).toBeGreaterThanOrEqual(paragraphs[0]!.box.left - 0.5)
  })

  it('元素坐标计入嵌套层的位置和缩放，不计这一层自己的旋转', () => {
    const plain = canvas.create(h('layer', {}, h('rect', { x: '10', y: '20', width: '30', height: '40', fill: '#fff' })))
    const turned = canvas.create(
      h('layer', { rotate: '30' }, h('rect', { x: '10', y: '20', width: '30', height: '40', fill: '#fff' })),
    )
    expect(turned.elements[0]!.box.left).toBeCloseTo(plain.elements[0]!.box.left)
    expect(turned.elements[0]!.box.top).toBeCloseTo(plain.elements[0]!.box.top)
    expect(turned.elements[0]!.ink.left).toBeCloseTo(plain.elements[0]!.ink.left)

    const nested = canvas.create(
      h(
        'layer',
        { width: '240', height: '160' },
        h(
          'layer',
          { x: '100', y: '80', anchor: 'center', width: '80', height: '40' },
          h('rect', { width: '80', height: '40', fill: '#fff' }),
        ),
      ),
    )
    const inner = nested.elements.find((element) => element.path === 'layer[0]')!
    const rect = nested.elements.find((element) => element.path === 'layer[0]/rect[0]')!
    expect(inner.box).toMatchObject({ left: 60, top: 60, width: 80, height: 40 })
    expect(rect.box.left).toBeCloseTo(inner.box.left)
    expect(rect.box.top).toBeCloseTo(inner.box.top)

    const scaled = canvas.create(
      h(
        'layer',
        { width: '400', height: '400', safe: '0' },
        h(
          'layer',
          { x: '10', y: '20', width: '100', height: '50', scale: '2', origin: 'top-left' },
          h('rect', { width: '100', height: '50', fill: '#fff' }),
        ),
      ),
    )
    const grown = scaled.elements.find((element) => element.path === 'layer[0]')!
    expect(grown.box).toMatchObject({ left: 10, top: 20, width: 200, height: 100 })
    expect(grown.ink.width).toBeCloseTo(200)
    const fitted = canvas.create(
      h('layer', { width: '90' }, h('rect', { x: '0', y: '0', width: '180', height: '60', fill: '#fff' })),
    )
    expect(fitted.elements[0]!.box.width).toBeCloseTo(90)
    expect(fitted.elements[0]!.box.height).toBeCloseTo(30)
  })

  it('转过的图形用 ink 躲开，线条含描边，g 的平移算进盒子', () => {
    const spun = canvas.create(
      h(
        'layer',
        { width: '200', height: '200' },
        h('rect', { x: '50', y: '50', width: '100', height: '40', rotate: '90', fill: '#fff' }),
      ),
    )
    const shape = spun.elements[0]!
    expect(shape.box).toMatchObject({ left: 50, top: 50, width: 100, height: 40 })
    expect(shape.ink.left).toBeCloseTo(80)
    expect(shape.ink.top).toBeCloseTo(20)
    expect(shape.ink.width).toBeCloseTo(40)
    expect(shape.ink.height).toBeCloseTo(100)

    const rule = canvas.create(
      h(
        'layer',
        { width: '80', height: '40' },
        h('line', { x1: '10', y1: '20', x2: '50', y2: '20', stroke: '#fff', 'stroke-width': '4' }),
      ),
    )
    expect(rule.elements[0]!.box).toMatchObject({ left: 10, top: 20, width: 40, height: 0 })
    expect(rule.elements[0]!.ink.left).toBeCloseTo(8)
    expect(rule.elements[0]!.ink.top).toBeCloseTo(18)
    expect(rule.elements[0]!.ink.width).toBeCloseTo(44)
    expect(rule.elements[0]!.ink.height).toBeCloseTo(4)

    const grouped = canvas.create(
      h(
        'layer',
        { width: '120', height: '80' },
        h('g', { transform: 'translate(20,10)' }, h('rect', { x: '0', y: '0', width: '40', height: '30', fill: '#0f0' })),
      ),
    )
    expect(grouped.elements.map((element) => element.path)).toEqual(['g[0]', 'g[0]/rect[0]'])
    expect(grouped.elements[0]!.box).toMatchObject({ left: 20, top: 10, width: 40, height: 30 })
    expect(grouped.elements[1]!.box).toMatchObject({ left: 20, top: 10, width: 40, height: 30 })

    const masked = canvas.create(
      h(
        'layer',
        { width: '80', height: '80' },
        h('mask', {}, h('circle', { cx: '40', cy: '40', r: '40' })),
        h('rect', { width: '80', height: '80', fill: '#fff' }),
      ),
    )
    expect(masked.elements.map((element) => element.tag)).toEqual(['rect'])
    expect(canvas.create(h('layer', { width: '10', height: '10' })).elements).toEqual([])
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
