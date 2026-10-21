import { describe, expect, it } from 'vitest'
import { meshIntersections, triTriSegment, type Vec3 } from './mesh-intersect.js'

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

function box(hx: number, hy: number, hz: number): { verts: Vec3[]; indices: number[] } {
  const verts = [
    v(-hx, -hy, -hz),
    v(hx, -hy, -hz),
    v(hx, hy, -hz),
    v(-hx, hy, -hz),
    v(-hx, -hy, hz),
    v(hx, -hy, hz),
    v(hx, hy, hz),
    v(-hx, hy, hz),
  ]
  const faces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
  ]
  const indices: number[] = []
  for (const [a, b, c, d] of faces) indices.push(a!, b!, c!, a!, c!, d!)
  return { verts, indices }
}

/** 轴沿 y，侧壁是竖直的四边面。 */
function cylinder(radius: number, half: number, segments: number): { verts: Vec3[]; indices: number[] } {
  const verts: Vec3[] = []
  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2
    const t1 = ((i + 1) / segments) * Math.PI * 2
    const base = verts.length
    verts.push(v(radius * Math.cos(t0), half, radius * Math.sin(t0)))
    verts.push(v(radius * Math.cos(t0), -half, radius * Math.sin(t0)))
    verts.push(v(radius * Math.cos(t1), half, radius * Math.sin(t1)))
    verts.push(v(radius * Math.cos(t1), -half, radius * Math.sin(t1)))
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
  }
  return { verts, indices }
}

describe('三角求交', () => {
  it('两个相交三角得到切出来的那一段', () => {
    const segment = triTriSegment(
      v(0, 0, 0),
      v(2, 0, 0),
      v(0, 2, 0),
      v(0.5, 0.5, -1),
      v(0.5, 0.5, 1),
      v(1.5, 0.5, -1),
    )
    expect(segment).not.toBeNull()
    const ends = [segment!.a, segment!.b].sort((p, q) => p.x - q.x)
    expect(ends[0]!.x).toBeCloseTo(0.5, 5)
    expect(ends[0]!.y).toBeCloseTo(0.5, 5)
    expect(ends[0]!.z).toBeCloseTo(0, 5)
    expect(ends[1]!.x).toBeCloseTo(1, 5)
    expect(ends[1]!.y).toBeCloseTo(0.5, 5)
    expect(ends[1]!.z).toBeCloseTo(0, 5)
  })

  it('平行、共面、相离的三角没有交线', () => {
    const a0 = v(0, 0, 0)
    const a1 = v(1, 0, 0)
    const a2 = v(0, 1, 0)
    expect(triTriSegment(a0, a1, a2, v(0, 0, 1), v(1, 0, 1), v(0, 1, 1))).toBeNull()
    expect(triTriSegment(a0, a1, a2, v(0.2, 0.2, 0), v(1, 0.2, 0), v(0.2, 1, 0))).toBeNull()
    expect(triTriSegment(a0, a1, a2, v(5, 0, 0), v(6, 0, 1), v(5, 1, -1))).toBeNull()
    expect(triTriSegment(a0, a1, a2, a0, a1, a2)).toBeNull()
  })

  it('圆柱穿过长方体时，上下交线各自闭合成环，点都落在半径上', () => {
    const radius = 0.4
    const solid = box(1, 1, 1)
    const tube = cylinder(radius, 2, 16)
    const segments = meshIntersections(solid.verts, solid.indices, tube.verts, tube.indices)
    const rings = [1, -1].map((side) => segments.filter((segment) => segment.a.y * side > 0.5 && segment.b.y * side > 0.5))
    expect(rings[0]!.length).toBeGreaterThan(8)
    expect(rings[1]!.length).toBe(rings[0]!.length)
    for (const ring of rings) {
      const points: Vec3[] = []
      for (const segment of ring) points.push(segment.a, segment.b)
      const keys = new Set(points.map((point) => `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)},${Math.round(point.z * 1e5)}`))
      expect(keys.size).toBe(ring.length)
      for (const point of points) {
        const radial = Math.hypot(point.x, point.z)
        expect(radial).toBeGreaterThan(radius * 0.97)
        expect(radial).toBeLessThanOrEqual(radius + 1e-6)
        expect(Math.abs(Math.abs(point.y) - 1)).toBeLessThan(1e-5)
      }
    }
    expect(meshIntersections(box(0.3, 0.3, 0.3).verts, box(0.3, 0.3, 0.3).indices, box(0.3, 0.3, 0.3).verts.map((point) => v(point.x + 4, point.y, point.z)), box(0.3, 0.3, 0.3).indices)).toHaveLength(0)
  })
})
