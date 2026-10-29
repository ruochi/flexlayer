import { describe, expect, it } from 'vitest'
import { edgeLineCv, edgeStairShare, facetStripe, materialFeatures, moireEnergy, ssrChecker, steppedShare } from '../scripts/metrics-image.mjs'

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

describe('倒角连续性', () => {
  it('均匀的一行通过', () => {
    const samples = Array.from({ length: 80 }, () => 160)
    const result = edgeLineCv(samples)
    expect(result.sd).toBe(0)
    expect(result.peakShare).toBe(0)
  })

  it('10 像素周期的虚线倒角会被算出来', () => {
    // Matches the macbook base-front row recorded in QUALITY-4 §2.2.
    const pattern = [162, 135, 144, 144, 152, 160, 160, 187, 187, 187]
    const samples = Array.from({ length: 120 }, (_, i) => pattern[i % pattern.length])
    const result = edgeLineCv(samples)
    expect(result.sd).toBeGreaterThan(4)
    expect(result.peakShare).toBeGreaterThan(0.02)
  })
})

describe('圆柱分段条纹', () => {
  it('平滑渐变没有大跳', () => {
    const width = 64
    const height = 32
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = 100 + Math.round((x / width) * 40)
        const i = (y * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    expect(facetStripe(rgba, width, height)).toBeLessThanOrEqual(3)
  })

  it('平面分段亮度跳变会被抓到', () => {
    const width = 64
    const height = 32
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = 80 + Math.floor(x / 4) * 12
        const i = (y * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    expect(facetStripe(rgba, width, height)).toBeGreaterThan(3)
  })
})

describe('材质特征', () => {
  it('亮斑面积和暗部底限能读出来', () => {
    const width = 40
    const height = 40
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - 20
        const dy = y - 20
        const v = Math.hypot(dx, dy) < 6 ? 240 : 50
        const i = (y * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    const features = materialFeatures(rgba, width, height)
    expect(features.darkFloor).toBeLessThan(60)
    expect(features.highlightArea).toBeGreaterThan(0.01)
  })
})

describe('SSR 棋盘格', () => {
  function fill(width: number, height: number, value: (x: number, y: number) => number) {
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = value(x, y)
        const i = (y * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    return rgba
  }

  it('1px 棋盘格接近 1，平滑渐变接近 0', () => {
    const width = 48
    const height = 48
    const checker = fill(width, height, (x, y) => ((x + y) & 1 ? 40 : 120))
    const ramp = fill(width, height, (x, y) => 40 + x * 2 + y)
    expect(ssrChecker(checker, width, height)).toBeGreaterThan(0.9)
    expect(ssrChecker(ramp, width, height)).toBe(0)
  })

  it('对角软边不算棋盘格', () => {
    const width = 64
    const height = 64
    const soft = fill(width, height, (x, y) => {
      const d = Math.hypot(x - 32, y - 32)
      return Math.max(40, Math.min(255, Math.round(180 - d * 3)))
    })
    expect(ssrChecker(soft, width, height)).toBeLessThan(0.01)
  })
})

describe('莫尔能量', () => {
  it('低频平滑区域接近 0', () => {
    const width = 64
    const height = 32
    const rgba = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = 120 + Math.round(20 * Math.sin((x / width) * Math.PI))
        const i = (y * width + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    expect(moireEnergy(rgba, width, height)).toBeLessThan(0.2)
  })
})
