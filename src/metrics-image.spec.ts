import { describe, expect, it } from 'vitest'
import { edgeStairShare, steppedShare } from '../scripts/metrics-image.mjs'

/** A tall image whose every row is `values`. */
function rows(values, height = values.length) {
  const width = values.length
  const out = []
  for (let y = 0; y < height; y++) out.push(...values)
  const rgba = new Uint8Array(width * height * 4)
  out.forEach((value, i) => {
    rgba[i * 4] = value
    rgba[i * 4 + 1] = value
    rgba[i * 4 + 2] = value
    rgba[i * 4 + 3] = 255
  })
  return { rgba, width, height }
}

describe('阶梯检测', () => {
  it('平滑的渐变没有台阶', () => {
    // One code value per pixel all the way down the ramp.
    const values = Array.from({ length: 60 }, (_, i) => 200 - i)
    const { rgba, width, height } = rows(values)
    expect(steppedShare(rgba, width, height)).toBe(0)
  })

  it('最近邻阴影的方块台阶会被算出来', () => {
    // A ramp drawn in 8-wide cells: one pixel jumps 6 values, then 8 flat.
    const values = []
    for (let cell = 0; cell < 8; cell++) {
      for (let i = 0; i < 8; i++) values.push(200 - cell * 6)
    }
    const { rgba, width, height } = rows(values)
    expect(steppedShare(rgba, width, height)).toBeGreaterThan(0.05)
  })

  it('双线性把同样的亮度范围摊开之后就低于阈值', () => {
    // The same 48-value drop in 24 steps of 2 instead of 6 steps of 8.
    const values = Array.from({ length: 60 }, (_, i) => Math.max(152, 200 - Math.floor(i / 2) * 2))
    const { rgba, width, height } = rows(values)
    expect(steppedShare(rgba, width, height)).toBeLessThan(0.02)
  })

  it('平坦区域不计入分母', () => {
    const flat = new Uint8Array(40 * 40 * 4).fill(200)
    expect(steppedShare(flat, 40, 40)).toBe(null)
  })
})

describe('边缘阶梯检测', () => {
  it('每行都推进同样比例的边缘没有阶梯', () => {
    const edge = (y) => 100 + (y - 200) * 0.7
    const result = edgeStairShare(edge, 200, 279)
    expect(result.hold).toBe(0)
    expect(result.gap).toBe(0)
  })

  it('最近邻把边缘按格子推进会被算成阶梯', () => {
    // Holds for four rows, then jumps four pixels: a shadow-map cell.
    const edge = (y) => 100 + Math.floor((y - 200) / 4) * 4 + 0.5
    const result = edgeStairShare(edge, 200, 279)
    expect(result.hold).toBeGreaterThan(0.6)
  })

  it('有一半的行找不到过渡就记成硬切，而不是 null', () => {
    const edge = (y) => ((y - 200) % 2 === 0 ? 100 + (y - 200) * 0.5 : null)
    const result = edgeStairShare(edge, 200, 279)
    expect(result.hold).toBe(0)
    expect(result.gap).toBeCloseTo(0.5, 5)
  })

  it('大部分行没有过渡就判为硬边', () => {
    // Only 20 of 80 rows have a crossing; the rest are a hard cut.
    const edge = (y) => (y >= 260 ? 120 : null)
    const result = edgeStairShare(edge, 200, 279)
    expect(result.hold).toBe(0)
    expect(result.gap).toBeCloseTo(0.75, 5)
  })

  it('太短的一段不判', () => {
    expect(edgeStairShare(() => 100, 200, 204)).toBe(null)
  })
})
