import { describe, expect, it } from 'vitest'
import {
  analyzeMesh,
  boundsOf,
  closureOf,
  recommendBevels,
  weightedMedian,
  weldIndices,
  type BevelMesh,
} from './bevel-recommend.js'

/** 封闭长方体：6 个面 12 个三角形，24 个独立顶点（每个面各自一套）。 */
function closedBox(hx: number, hy: number, hz: number): BevelMesh {
  const corners = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ]
  const faces = [
    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
    [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2],
  ]
  const positions: number[] = []
  const indices: number[] = []
  /* 故意不共享顶点，模拟 Flexlayer 导出的「每三角形独立顶点」形态。 */
  for (const [a, b, c, d] of faces) {
    for (const corner of [a!, b!, c!, a!, c!, d!]) {
      positions.push(...(corners[corner!] as number[]))
      indices.push(indices.length)
    }
  }
  return { positions, indices }
}

/** 单张四边形片：两个三角形，完全是边界边，闭合度应为 1。 */
function openQuad(hx: number, hy: number): BevelMesh {
  const positions = [
    -hx, -hy, 0, hx, -hy, 0, hx, hy, 0,
    -hx, -hy, 0, hx, hy, 0, -hx, hy, 0,
  ]
  return { positions, indices: positions.map((_, i) => i) }
}

/** 细长杆：3 m 长、2 cm 粗。 */
function thinRod(): BevelMesh {
  return closedBox(1.5, 0.01, 0.01)
}

describe('包围盒', () => {
  it('量出三条边而不是被顶点顺序影响', () => {
    const bounds = boundsOf([1, 2, 3, -1, -2, -3])
    expect(bounds.size).toEqual([2, 4, 6])
    expect(bounds.min).toEqual([-1, -2, -3])
  })

  it('空输入全零，不返回 Infinity', () => {
    expect(boundsOf([])).toEqual({ min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] })
  })
})

describe('顶点焊接', () => {
  it('把重复顶点合并成一个', () => {
    /* 两个三角形共 6 个顶点，其中第一个�角形原样重复了 0 号点，焊接后只剩 4 个。 */
    const positions = [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 0, 1, 0, -1, 0, 0,
    ]
    const { vertices, triangles } = weldIndices(positions, undefined, 1e-6)
    expect(vertices.length / 3).toBe(4)
    expect(Array.from(triangles)).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('容差之内的抖动视为同一点，之外的不合并', () => {
    const near = weldIndices([0, 0, 0, 1e-7, 0, 0], undefined, 1e-5)
    expect(near.vertices.length / 3).toBe(1)
    const far = weldIndices([0, 0, 0, 1e-3, 0, 0], undefined, 1e-5)
    expect(far.vertices.length / 3).toBe(2)
  })
})

describe('闭合度', () => {
  it('封闭长方体为 0', () => {
    expect(analyzeMesh(closedBox(1, 1, 1)).closure).toBeCloseTo(0, 10)
  })

  it('单张四边形片为 0.8：四边是边界边，对角线被两个三角形共享', () => {
    expect(analyzeMesh(openQuad(5, 5)).closure).toBeCloseTo(0.8, 10)
  })

  it('没有三角形时按开放处理', () => {
    expect(closureOf([], [])).toBe(1)
  })

  it('不焊接顶点会让封闭实体被误判成开放', () => {
    const box = closedBox(1, 1, 1)
    const vertexCount = box.positions.length / 3
    const unwelded = closureOf(box.positions, box.indices!)
    /* 每个三角形三个独立顶点，每条边都只被用一次。 */
    expect(unwelded).toBeCloseTo(1, 10)
    const welded = weldIndices(box.positions, box.indices, 1e-5)
    expect(closureOf(welded.vertices, welded.triangles)).toBeCloseTo(0, 10)
    expect(vertexCount).toBe(36)
  })
})

describe('参考尺度', () => {
  it('加权中位数按权重落到累积过半的那一项', () => {
    expect(weightedMedian([
      { value: 1, weight: 1 },
      { value: 10, weight: 9 },
    ])).toBe(10)
  })

  it('权重全为零时退化成普通中位数', () => {
    expect(weightedMedian([
      { value: 1, weight: 0 },
      { value: 5, weight: 0 },
      { value: 9, weight: 0 },
    ])).toBe(5)
  })

  it('空输入返回 0 而不是 NaN', () => {
    expect(weightedMedian([])).toBe(0)
  })
})

describe('推荐半径', () => {
  it('尺度取中位边，不被细长物体的最长边骗到', () => {
    const rod = analyzeMesh(thinRod())
    expect(rod.extents[2]).toBeCloseTo(3, 6)
    expect(rod.scale).toBeCloseTo(0.02, 6)
  })

  it('细长杆的半径被最薄边钳住，不会比杆还粗', () => {
    const report = recommendBevels([closedBox(1, 1, 1), thinRod()], {
      scaleDivisor: 100,
      thicknessClamp: 0.2,
    })
    const rod = report.meshes[1]!
    expect(rod.limitedBy).toBe('thickness')
    expect(rod.radius).toBeCloseTo(0.02 * 0.2, 6)
  })

  it('小物体自动退化成细倒角或跳过，不需要名单', () => {
    /* 4×4×8 mm 的螺丝：最薄边 4 mm。全局锚点是 0.02 m，远大于它的壁厚余量。 */
    const bolt = closedBox(0.002, 0.002, 0.004)
    const report = recommendBevels([closedBox(1, 1, 1), bolt], { scaleDivisor: 100 })
    const tiny = report.meshes[1]!
    expect(tiny.extents[0]).toBeCloseTo(0.004, 9)
    expect(tiny.limitedBy).toBe('thickness')
    expect(tiny.radius).toBeCloseTo(0.004 * 0.2, 9)
  })

  it('地板和背景板被排除在参考尺度之外', () => {
    const floor = openQuad(500, 500)
    const box = closedBox(1, 1, 1)
    const withFloor = recommendBevels([floor, box], { scaleDivisor: 100 })
    const withoutFloor = recommendBevels([box], { scaleDivisor: 100 })
    expect(withFloor.excludedOpen).toBe(1)
    expect(withFloor.referenceScale).toBeCloseTo(withoutFloor.referenceScale, 10)
    /* closedBox(1,1,1) 的中位边是 2，所以锚点是 2/100。 */
    expect(withFloor.globalRadius).toBeCloseTo(2 / 100, 10)
  })

  it('零厚度的纯平面不倒角：没有棱可倒', () => {
    const floor = openQuad(500, 500)
    const report = recommendBevels([floor, closedBox(1, 1, 1)], { scaleDivisor: 100 })
    expect(analyzeMesh(floor).extents[0]).toBe(0)
    expect(report.meshes[0]!.radius).toBeNull()
    expect(report.meshes[0]!.limitedBy).toBe('flat')
  })

  it('有厚度的开放壳体仍然能拿到半径——只是不参与统计', () => {
    /* 沿 z 拉出一点厚度的开放壳：闭合度仍接近 1，但不是零厚度。 */
    const shell: BevelMesh = {
      positions: [
        -5, -5, 0, 5, -5, 0, 5, 5, 0, -5, -5, 0, 5, 5, 0, -5, 5, 0,
        -5, -5, 0.05, 5, -5, 0.05, 5, 5, 0.05, -5, -5, 0.05, 5, 5, 0.05, -5, 5, 0.05,
      ],
      indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    }
    const report = recommendBevels([shell, closedBox(1, 1, 1)], { scaleDivisor: 100 })
    expect(report.meshes[0]!.radius).not.toBeNull()
    expect(report.meshes[0]!.limitedBy).toBe('thickness')
  })

  it('像素下限把看不见的倒角整条关掉', () => {
    const box = closedBox(1, 1, 1)
    const report = recommendBevels([box], {
      scaleDivisor: 100,
      pixelsPerWorld: () => 1,
      minPixels: 0.5,
    })
    expect(report.meshes[0]!.radius).toBeNull()
    expect(report.meshes[0]!.limitedBy).toBe('invisible')
  })

  it('给了足够的分辨率就保留半径', () => {
    const box = closedBox(1, 1, 1)
    const report = recommendBevels([box], {
      scaleDivisor: 100,
      pixelsPerWorld: () => 100,
      minPixels: 0.5,
    })
    expect(report.meshes[0]!.radius).toBeCloseTo(0.02, 6)
    expect(report.meshes[0]!.limitedBy).toBe('reference')
  })

  it('退化网格返回 null 而不是零半径', () => {
    const report = recommendBevels([{ positions: [], indices: [] }], { scaleDivisor: 100 })
    expect(report.meshes[0]!.radius).toBeNull()
    expect(report.meshes[0]!.limitedBy).toBe('degenerate')
  })

  it('尺度越大半径越大，与 scaleDivisor 成反比', () => {
    const a = recommendBevels([closedBox(1, 1, 1)], { scaleDivisor: 100 })
    const b = recommendBevels([closedBox(1, 1, 1)], { scaleDivisor: 200 })
    expect(a.globalRadius / b.globalRadius).toBeCloseTo(2, 10)
  })

  it('场景里只有一个物体时，半径由它自己决定且受厚度限制', () => {
    const report = recommendBevels([closedBox(1, 1, 1)], { scaleDivisor: 100, thicknessClamp: 0.2 })
    expect(report.referenceScale).toBeCloseTo(2, 10)
    expect(report.globalRadius).toBeCloseTo(0.02, 10)
    expect(report.meshes[0]!.radius).toBeCloseTo(0.02, 10)
  })
})

describe('参数可调', () => {
  it('scaleDivisor 减半，半径恰好翻倍', () => {
    const box = closedBox(1, 1, 1)
    const wide = recommendBevels([box], { scaleDivisor: 50, thicknessClamp: 10 })
    const narrow = recommendBevels([box], { scaleDivisor: 100, thicknessClamp: 10 })
    expect(wide.meshes[0]!.radius! / narrow.meshes[0]!.radius!).toBeCloseTo(2, 10)
  })

  it('厚度钳制不会因为锚点放大而失效', () => {
    /* 锚点放到 0.2 m，仍然要被 4 mm 螺丝的壁厚余量夹住。 */
    const bolt = closedBox(0.002, 0.002, 0.004)
    const report = recommendBevels([closedBox(1, 1, 1), bolt], { scaleDivisor: 5, thicknessClamp: 0.2 })
    const tiny = report.meshes[1]!
    expect(tiny.limitedBy).toBe('thickness')
    expect(tiny.radius).toBeCloseTo(0.004 * 0.2, 9)
  })
})
