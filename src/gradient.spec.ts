import { describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { parseGradient, sampleGradient } from './gradient.js'
import { layoutSource } from './layout.js'
import { paintDocument } from './paint.js'
import { parseGlow, parseShadow } from './style.js'

describe('parseGradient', () => {
  it('线性渐变默认从上到下，补齐色标', () => {
    expect(parseGradient('linear-gradient(#0c1424, #6e7c72)')).toMatchObject({
      kind: 'linear',
      angle: 180,
      stops: [
        { color: '#0c1424', offset: 0 },
        { color: '#6e7c72', offset: 1 },
      ],
    })
  })

  it('径向渐变可以挪圆心', () => {
    expect(parseGradient('radial-gradient(at 40% 35%, #fff, #fff0)')).toMatchObject({
      kind: 'radial',
      at: { x: 0.4, y: 0.35 },
    })
  })
})

const box = { x: 0, y: 0, width: 100, height: 100 }

async function pixelAt(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const img = await loadImage(png)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0]!, d[1]!, d[2]!, d[3]!]
}

async function render(source: string, scale = 1) {
  const doc = await layoutSource(source, process.cwd())
  const png = await paintDocument(doc.root, {
    width: doc.width,
    height: doc.height,
    background: doc.background,
    scale,
    debug: false,
    t: 0,
  })
  return { doc, png }
}

describe('gradient()', () => {
  it('一行是从左到右，一列是从上到下，斜杠是矩阵', () => {
    const horizontal = parseGradient('gradient(#000000, #ffffff)')
    const vertical = parseGradient('gradient(#000000 / #ffffff)')
    const matrix = parseGradient('gradient(#ff0000 #00ff00 / #0000ff #ffffff)')
    expect(horizontal && 'domain' in horizontal && horizontal.domain).toEqual({ kind: 'box' })
    expect(horizontal && 'rows' in horizontal && horizontal.rows).toHaveLength(1)
    expect(vertical && 'rows' in vertical && vertical.rows).toHaveLength(2)
    expect(matrix && 'rows' in matrix && matrix.rows.map((row) => row.length)).toEqual([2, 2])
  })

  it('linear、radial、conic 只改变坐标映射', () => {
    const linear = parseGradient('gradient(linear 0 0 80px 0, #fff, #000)')
    const radial = parseGradient('gradient(radial 10 20 30, #fff)')
    const radial2 = parseGradient('gradient(radial 10 20 4 30, rgb(1, 2, 3))')
    const conic = parseGradient('gradient(conic 40 50 90, #fff, #000)')
    expect(linear && 'domain' in linear && linear.domain).toEqual({
      kind: 'linear',
      x1: 0,
      y1: 0,
      x2: 80,
      y2: 0,
    })
    expect(radial && 'domain' in radial && radial.domain).toMatchObject({ kind: 'radial', r0: 0, r1: 30 })
    expect(radial2 && 'domain' in radial2 && radial2.domain).toMatchObject({ r0: 4, r1: 30 })
    expect(conic && 'domain' in conic && conic.domain).toMatchObject({ kind: 'conic', from: 90 })
    expect(parseGradient('gradient(linear 0 0, #fff)')).toBeNull()
    expect(parseGradient('gradient()')).toBeNull()
  })

  it('两端颜色保持原色，黑白中点在 OKLab 里比 sRGB 中灰更暗', () => {
    const g = parseGradient('gradient(#000000, #ffffff)')
    if (!g || !('domain' in g)) throw new Error('expected field gradient')
    const left = sampleGradient(g, 0, 0, box)
    const right = sampleGradient(g, 100, 50, box)
    const mid = sampleGradient(g, 50, 0, box)
    expect(left).toMatchObject({ r: 0, g: 0, b: 0, a: 255 })
    expect(right).toMatchObject({ r: 255, g: 255, b: 255, a: 255 })
    expect(mid.r).toBe(mid.g)
    expect(mid.g).toBe(mid.b)
    expect(mid.r).toBeLessThan(128)
    expect(mid.r).toBeGreaterThan(80)
  })

  it('矩阵四角就是四个颜色', () => {
    const g = parseGradient('gradient(#ff0000 #00ff00 / #0000ff #ffffff)')
    if (!g || !('domain' in g)) throw new Error('expected field gradient')
    expect(sampleGradient(g, 0, 0, box)).toMatchObject({ r: 255, g: 0, b: 0 })
    expect(sampleGradient(g, 100, 0, box)).toMatchObject({ r: 0, g: 255, b: 0 })
    expect(sampleGradient(g, 0, 100, box)).toMatchObject({ r: 0, g: 0, b: 255 })
    expect(sampleGradient(g, 100, 100, box)).toMatchObject({ r: 255, g: 255, b: 255 })
  })

  it('径向看半径，锥形 0 度在正上方', () => {
    const radial = parseGradient('gradient(radial 50 50 0 50, #ffffff, #000000)')
    if (!radial || !('domain' in radial)) throw new Error('expected field gradient')
    expect(sampleGradient(radial, 50, 50, box).r).toBe(255)
    expect(sampleGradient(radial, 50, 0, box).r).toBe(0)
    const conic = parseGradient('gradient(conic 50 50, #ff0000, #00ff00)')
    if (!conic || !('domain' in conic)) throw new Error('expected field gradient')
    expect(sampleGradient(conic, 50, 10, box)).toMatchObject({ r: 255, g: 0, b: 0 })
    const right = sampleGradient(conic, 90, 50, box)
    const bottom = sampleGradient(conic, 50, 90, box)
    expect(right.r).toBeGreaterThan(right.g)
    expect(right.g).toBeGreaterThan(20)
    expect(bottom.g).toBeGreaterThan(right.g)
  })

  it('画布上的矩形和线条用同一套采样', async () => {
    const { png } = await render(
      `<layer width="21" height="11" background="#000000">
        <rect cx="10.5" cy="5.5" width="21" height="11" fill="gradient(#000000, #ffffff)" />
      </layer>`,
    )
    const g = parseGradient('gradient(#000000, #ffffff)')
    if (!g || !('domain' in g)) throw new Error('expected field gradient')
    const expected = sampleGradient(g, 10.5, 5, { x: 0, y: 0, width: 21, height: 11 })
    const pix = await pixelAt(png, 10, 5)
    expect(Math.abs(pix[0] - expected.r)).toBeLessThanOrEqual(2)
    expect(pix[3]).toBe(255)

    const scaled = await render(
      `<layer width="21" height="1" background="#000000">
        <rect cx="10.5" cy="0.5" width="21" height="1" fill="gradient(#000000, #ffffff)" />
      </layer>`,
      2,
    )
    const scaledPix = await pixelAt(scaled.png, 20, 0)
    expect(Math.abs(scaledPix[0] - expected.r)).toBeLessThanOrEqual(8)

    const line = await render(
      `<layer width="21" height="11" background="#000000" color="#ffffff">
        <line x1="0" y1="5" x2="21" y2="5" stroke="gradient(#ff0000, #0000ff)" stroke-width="4" />
      </layer>`,
    )
    const linePix = await pixelAt(line.png, 10, 5)
    expect(linePix[0]).toBeGreaterThan(40)
    expect(linePix[2]).toBeGreaterThan(40)
  })

  it('矩阵铺满 Rect', async () => {
    const { png } = await render(
      `<layer width="20" height="20" background="#000000">
        <rect x="0" y="0" width="20" height="20" fill="gradient(#ff0000 #000000 / #000000 #00ff00)" />
      </layer>`,
    )
    const topLeft = await pixelAt(png, 1, 1)
    const bottomRight = await pixelAt(png, 18, 18)
    expect(topLeft[0]).toBeGreaterThan(200)
    expect(bottomRight[1]).toBeGreaterThan(200)
  })

  it('layer 的 background 不绘制，画布底色仍在', async () => {
    const { png, doc } = await render(
      `<layer width="20" height="20" background="#0000ff"><layer width="20" height="20" background="#ff0000" /></layer>`,
    )
    expect(doc.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('background'))).toBe(true)
    const pix = await pixelAt(png, 10, 10)
    expect(pix[2]).toBeGreaterThan(200)
    expect(pix[0]).toBeLessThan(20)
  })

  it('写错的渐变退回纯色并报告', async () => {
    const { doc } = await render(`<layer width="20" height="20"><rect cx="10" cy="10" width="10" height="10" fill="gradient(nope)" /></layer>`)
    expect(doc.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('fill'))).toBe(true)
    const shape = doc.root.children[0]
    expect(shape && shape.kind === 'shape' && shape.fill).toBe('#000000')
  })
})

describe('shadow and glow', () => {
  it('补上缺省的 blur 和 spread', () => {
    expect(parseShadow('0 8 #00000055')).toEqual({ x: 0, y: 8, blur: 0, spread: 0, color: '#00000055' })
    expect(parseGlow('48px #f6f1e7')).toEqual({ blur: 48, spread: 0, color: '#f6f1e7' })
    expect(parseShadow('big')).toBeUndefined()
  })
})
