import { describe, expect, it } from 'vitest'
import { splitLayers } from './split.js'

function picture(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number, number]) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  const depth = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a, d] = fill(x, y)
      const o = (y * width + x) * 4
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = a
      depth[y * width + x] = d
    }
  }
  return { rgba, depth }
}

/** 塔伸进天空，地面更近，左右是远处的楼。 */
function tower(width = 48, height = 36) {
  return picture(width, height, (x, y) => {
    const inTower = x >= 18 && x <= 30 && y >= 8 && y <= 24
    const ground = y >= 26
    if (inTower) return [220, 160, 40, 255, 140]
    if (ground) return [30, 30, 30, 255, 220]
    if (y >= 14) return [20, 24, 40, 255, 48]
    return [8, 10, 16, 255, 0]
  })
}

describe('splitLayers', () => {
  it('从伸进天空的尖长出主体，地面留在背景', () => {
    const { rgba, depth } = tower()
    const split = splitLayers({ rgba, depth, width: 48, height: 36 })
    expect(split.flat).toBe(false)
    expect(split.alpha[10 * 48 + 24]).toBeGreaterThan(200)
    expect(split.alpha[4 * 48 + 24]).toBe(0)
    expect(split.alpha[30 * 48 + 24]).toBe(0)
    expect(split.alpha[18 * 48 + 4]).toBe(0)
    expect(split.spire?.y).toBeLessThan(12)
    expect(split.spire?.x).toBeGreaterThan(17)
    expect(split.spire?.x).toBeLessThan(32)
    expect(split.sky.height).toBeGreaterThan(4)
    const center = 16 * 48 + 24
    expect(split.subject[center * 4]).toBeGreaterThan(180)
    expect(split.subject[center * 4 + 3]).toBeGreaterThan(200)
    expect(split.plate[center * 4]).toBeLessThan(80)
  })

  it('深度没有起伏时不分层', () => {
    const { rgba, depth } = picture(16, 12, () => [40, 40, 40, 255, 20])
    const split = splitLayers({ rgba, depth, width: 16, height: 12 })
    expect(split.flat).toBe(true)
    expect(split.alpha.every((value) => value === 0)).toBe(true)
    expect(split.subjectBox).toBeNull()
    expect(split.plate[3]).toBe(255)
  })

  it('refine 留下抠图的边，并丢掉远处粘上的一块', () => {
    const { rgba, depth } = tower(48, 36)
    const matte = new Uint8ClampedArray(48 * 36)
    for (let y = 8; y <= 24; y++) {
      for (let x = 18; x <= 30; x++) matte[y * 48 + x] = 255
      for (let x = 34; x <= 42; x++) matte[y * 48 + x] = 255
    }
    const split = splitLayers({ rgba, depth, width: 48, height: 36, matte })
    expect(split.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(split.alpha[16 * 48 + 38]).toBeLessThan(20)
  })
})
