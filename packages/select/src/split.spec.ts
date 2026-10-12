import { describe, expect, it } from 'vitest'
import { splitLayers } from './split.js'

function depthOf(width: number, height: number, fill: (x: number, y: number) => number) {
  const depth = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) depth[y * width + x] = fill(x, y)
  }
  return depth
}

/** 塔伸进天空，地面更近，左右是远处的楼。 */
function tower(width = 48, height = 36) {
  return depthOf(width, height, (x, y) => {
    const inTower = x >= 18 && x <= 30 && y >= 8 && y <= 24
    const ground = y >= 26
    if (inTower) return 140
    if (ground) return 220
    if (y >= 14) return 48
    return 0
  })
}

describe('splitLayers', () => {
  it('从伸进天空的尖长出前景，地面留在外面', () => {
    const split = splitLayers({ depth: tower(), width: 48, height: 36 })
    expect(split.flat).toBe(false)
    expect(split.alpha[10 * 48 + 24]).toBeGreaterThan(200)
    expect(split.alpha[4 * 48 + 24]).toBe(0)
    expect(split.alpha[30 * 48 + 24]).toBe(0)
    expect(split.alpha[18 * 48 + 4]).toBe(0)
    expect(split.box).not.toBeNull()
    expect(split.box!.x).toBeGreaterThanOrEqual(17)
    expect(split.box!.x).toBeLessThan(24)
    expect(split.box!.y).toBeLessThan(12)
    expect(split.box!.x + split.box!.width).toBeLessThanOrEqual(32)
    expect(split.box!.y + split.box!.height).toBeLessThanOrEqual(26)
  })

  it('深度没有起伏时遮罩是空的', () => {
    const split = splitLayers({ depth: depthOf(16, 12, () => 20), width: 16, height: 12 })
    expect(split.flat).toBe(true)
    expect(split.box).toBeNull()
    expect(split.alpha.every((value) => value === 0)).toBe(true)
  })

  it('refine 留下抠图的边，并丢掉远处粘上的一块', () => {
    const matte = new Uint8ClampedArray(48 * 36)
    for (let y = 8; y <= 24; y++) {
      for (let x = 18; x <= 30; x++) matte[y * 48 + x] = 255
      for (let x = 34; x <= 42; x++) matte[y * 48 + x] = 255
    }
    const split = splitLayers({ depth: tower(), width: 48, height: 36, matte })
    expect(split.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(split.alpha[16 * 48 + 38]).toBeLessThan(20)
    expect(split.box!.x).toBeGreaterThanOrEqual(18)
    expect(split.box!.x + split.box!.width).toBeLessThanOrEqual(32)
  })
})
