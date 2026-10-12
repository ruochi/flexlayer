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

  it('正向点沿着连着的楼身长满，点在近处的地面上不会把楼带上', () => {
    const depth = depthOf(48, 36, (x, y) => {
      const inTower = x >= 18 && x <= 30 && y >= 8 && y <= 24
      const ground = y >= 26
      if (inTower) return 100 + (y - 8) * 3
      if (ground) return 230
      if (y >= 14) return 40
      return 0
    })
    const spire = splitLayers({ depth, width: 48, height: 36, points: [{ x: 24, y: 8 }] })
    const base = splitLayers({ depth, width: 48, height: 36, points: [{ x: 24, y: 24 }] })
    const yard = splitLayers({ depth, width: 48, height: 36, points: [{ x: 24, y: 32 }] })
    expect(spire.alpha[8 * 48 + 24]).toBeGreaterThan(128)
    expect(spire.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(spire.alpha[23 * 48 + 24]).toBeGreaterThan(200)
    expect(spire.alpha[30 * 48 + 24]).toBe(0)
    expect(spire.alpha[18 * 48 + 4]).toBe(0)
    expect(base.alpha[8 * 48 + 24]).toBeGreaterThan(128)
    expect(base.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(base.alpha[30 * 48 + 24]).toBe(0)
    expect(yard.alpha[32 * 48 + 24]).toBeGreaterThan(200)
    expect(yard.alpha[16 * 48 + 24]).toBe(0)
  })

  it('反向点把离它更近的一段去掉，楼身还留着', () => {
    const depth = depthOf(48, 36, (x, y) => {
      if (y < 8) return 0
      if (y >= 31) return 250
      return 90 + (y - 8) * 4
    })
    const open = splitLayers({ depth, width: 48, height: 36, points: [{ x: 24, y: 10 }] })
    const cut = splitLayers({
      depth,
      width: 48,
      height: 36,
      points: [{ x: 24, y: 10 }],
      omit: [{ x: 24, y: 28 }],
    })
    expect(open.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(open.alpha[28 * 48 + 24]).toBeGreaterThan(200)
    expect(cut.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(cut.alpha[28 * 48 + 24]).toBe(0)
    expect(cut.alpha[2 * 48 + 24]).toBe(0)
  })

  it('差不多远的反向点把旁边那一块去掉', () => {
    const depth = depthOf(48, 36, (x, y) => {
      const tower = x >= 8 && x <= 20 && y >= 8 && y <= 24
      const wing = x >= 27 && x <= 40 && y >= 8 && y <= 24
      const bridge = x >= 21 && x <= 26 && y >= 14 && y <= 16
      if (tower || wing || bridge) return 150
      if (y >= 28) return 230
      return 0
    })
    const split = splitLayers({
      depth,
      width: 48,
      height: 36,
      points: [{ x: 14, y: 16 }],
      omit: [{ x: 34, y: 16 }],
    })
    expect(split.alpha[12 * 48 + 14]).toBeGreaterThan(200)
    expect(split.alpha[12 * 48 + 36]).toBe(0)
    expect(split.alpha[30 * 48 + 14]).toBe(0)
    expect(split.alpha[4 * 48 + 14]).toBe(0)
  })

  it('只写反向点时，从自动遮罩里挖掉那一块', () => {
    const kept = splitLayers({ depth: tower(), width: 48, height: 36, omit: [{ x: 4, y: 30 }] })
    expect(kept.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(kept.flat).toBe(false)
    const gone = splitLayers({ depth: tower(), width: 48, height: 36, omit: [{ x: 24, y: 16 }] })
    expect(gone.flat).toBe(true)
    expect(gone.box).toBeNull()
  })

  it('点在一圈轮廓上时，把连着的里面补上', () => {
    const depth = depthOf(40, 30, (x, y) => {
      const ground = y >= 26
      const inside = x >= 14 && x <= 26 && y >= 10 && y <= 16
      const edge = x >= 12 && x <= 28 && y >= 8 && y <= 18 && !inside
      if (ground) return 230
      if (inside) return 120
      if (edge) return 100
      return 0
    })
    const split = splitLayers({ depth, width: 40, height: 30, points: [{ x: 12, y: 12 }] })
    expect(split.alpha[12 * 40 + 12]).toBeGreaterThan(128)
    expect(split.alpha[13 * 40 + 20]).toBeGreaterThan(200)
    expect(split.alpha[28 * 40 + 20]).toBe(0)
    expect(split.alpha[2 * 40 + 2]).toBe(0)
  })

  it('点在楼身上的一条缝时，仍选中这座楼', () => {
    const depth = tower()
    depth[16 * 48 + 24] = 0
    const split = splitLayers({ depth, width: 48, height: 36, points: [{ x: 24, y: 16 }] })
    expect(split.alpha[16 * 48 + 22]).toBeGreaterThan(200)
    expect(split.alpha[10 * 48 + 24]).toBeGreaterThan(200)
    expect(split.alpha[30 * 48 + 24]).toBe(0)
  })

  it('点在楼和远处那一块上，两块都留，地面不进来', () => {
    const split = splitLayers({
      depth: tower(),
      width: 48,
      height: 36,
      points: [{ x: 24, y: 16 }, { x: 38, y: 16 }],
    })
    expect(split.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(split.alpha[16 * 48 + 38]).toBeGreaterThan(200)
    expect(split.alpha[30 * 48 + 24]).toBe(0)
    expect(split.alpha[4 * 48 + 24]).toBe(0)
  })

  it('点要落在图片里面', () => {
    expect(() => splitLayers({ depth: tower(), width: 48, height: 36, points: [{ x: 48, y: 10 }] })).toThrow('点要落在图片里面')
    expect(() => splitLayers({ depth: tower(), width: 48, height: 36, points: [{ x: -1, y: 10 }] })).toThrow('点要落在图片里面')
    expect(() => splitLayers({ depth: tower(), width: 48, height: 36, omit: [{ x: 10, y: 40 }] })).toThrow('点要落在图片里面')
  })

  it('refine 时正向点留在抠图边上，没点到的远处那一块去掉', () => {
    const depth = tower()
    const matte = new Uint8ClampedArray(48 * 36)
    for (let y = 8; y <= 24; y++) {
      for (let x = 18; x <= 30; x++) matte[y * 48 + x] = 255
      for (let x = 34; x <= 42; x++) matte[y * 48 + x] = 255
    }
    const towerOnly = splitLayers({ depth, width: 48, height: 36, matte, points: [{ x: 24, y: 16 }] })
    expect(towerOnly.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(towerOnly.alpha[16 * 48 + 38]).toBeLessThan(20)
    const both = splitLayers({
      depth,
      width: 48,
      height: 36,
      matte,
      points: [{ x: 24, y: 16 }, { x: 38, y: 16 }],
    })
    expect(both.alpha[16 * 48 + 24]).toBeGreaterThan(200)
    expect(both.alpha[16 * 48 + 38]).toBeGreaterThan(100)
  })
})
