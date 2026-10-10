/**
 * 两只网格在 layer 空间里的交线。
 * 共面、退化、只碰到一个点时不算。面贴面不描。
 */

export type Vec3 = { x: number; y: number; z: number }

export type Segment = { a: Vec3; b: Vec3 }

const PLANE_EPS = 1e-8
const SPAN_EPS = 1e-6

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

function planeNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const n = cross(sub(b, a), sub(c, a))
  const len = Math.hypot(n.x, n.y, n.z)
  if (!(len > 1e-12)) return null
  return { x: n.x / len, y: n.y / len, z: n.z / len }
}

/** 三角被另一张平面切开的那一段。顶点贴在平面上、或整条边落在平面上时返回 null。 */
function planeCut(verts: [Vec3, Vec3, Vec3], dist: [number, number, number]): [Vec3, Vec3] | null {
  const on = [0, 1, 2].filter((i) => Math.abs(dist[i]) <= PLANE_EPS)
  if (on.length >= 2) return null
  const hits: Vec3[] = []
  if (on.length === 1) hits.push(verts[on[0]!]!)
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    const di = dist[i]!
    const dj = dist[j]!
    if (Math.abs(di) <= PLANE_EPS || Math.abs(dj) <= PLANE_EPS) continue
    if (di * dj < 0) hits.push(lerp(verts[i]!, verts[j]!, di / (di - dj)))
  }
  if (hits.length !== 2) return null
  const dx = hits[1]!.x - hits[0]!.x
  const dy = hits[1]!.y - hits[0]!.y
  const dz = hits[1]!.z - hits[0]!.z
  if (dx * dx + dy * dy + dz * dz <= SPAN_EPS * SPAN_EPS) return null
  return [hits[0]!, hits[1]!]
}

function overlap(first: [Vec3, Vec3], second: [Vec3, Vec3], dir: Vec3): Segment | null {
  const len2 = dot(dir, dir)
  if (!(len2 > 1e-16)) return null
  const origin = first[0]
  const tOf = (p: Vec3) => dot(sub(p, origin), dir)
  let t0 = tOf(first[0])
  let t1 = tOf(first[1])
  let u0 = tOf(second[0])
  let u1 = tOf(second[1])
  if (t0 > t1) {
    const swap = t0
    t0 = t1
    t1 = swap
  }
  if (u0 > u1) {
    const swap = u0
    u0 = u1
    u1 = swap
  }
  const lo = Math.max(t0, u0)
  const hi = Math.min(t1, u1)
  if (!(hi - lo > SPAN_EPS)) return null
  const at = (t: number): Vec3 => ({
    x: origin.x + (dir.x * t) / len2,
    y: origin.y + (dir.y * t) / len2,
    z: origin.z + (dir.z * t) / len2,
  })
  return { a: at(lo), b: at(hi) }
}

/** 两个三角的交线段。平行、共面、退化或只碰到一个点时返回 null。 */
export function triTriSegment(a0: Vec3, a1: Vec3, a2: Vec3, b0: Vec3, b1: Vec3, b2: Vec3): Segment | null {
  const n1 = planeNormal(a0, a1, a2)
  const n2 = planeNormal(b0, b1, b2)
  if (!n1 || !n2) return null
  const db: [number, number, number] = [dot(n1, sub(b0, a0)), dot(n1, sub(b1, a0)), dot(n1, sub(b2, a0))]
  const da: [number, number, number] = [dot(n2, sub(a0, b0)), dot(n2, sub(a1, b0)), dot(n2, sub(a2, b0))]
  const straddles = (d: [number, number, number]) => {
    let pos = 0
    let neg = 0
    for (const value of d) {
      if (value > PLANE_EPS) pos++
      else if (value < -PLANE_EPS) neg++
    }
    return pos > 0 && neg > 0
  }
  if (!straddles(da) || !straddles(db)) return null
  const cutA = planeCut([a0, a1, a2], da)
  const cutB = planeCut([b0, b1, b2], db)
  if (!cutA || !cutB) return null
  return overlap(cutA, cutB, cross(n1, n2))
}

type Tri = {
  i0: number
  i1: number
  i2: number
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

type Aabb = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

function collect(verts: readonly Vec3[], indices: ArrayLike<number>): { tris: Tri[]; box: Aabb } | null {
  const tris: Tri[] = []
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const i0 = indices[i]!
    const i1 = indices[i + 1]!
    const i2 = indices[i + 2]!
    const a = verts[i0]
    const b = verts[i1]
    const c = verts[i2]
    if (!a || !b || !c) continue
    const tri: Tri = {
      i0,
      i1,
      i2,
      minX: Math.min(a.x, b.x, c.x),
      minY: Math.min(a.y, b.y, c.y),
      minZ: Math.min(a.z, b.z, c.z),
      maxX: Math.max(a.x, b.x, c.x),
      maxY: Math.max(a.y, b.y, c.y),
      maxZ: Math.max(a.z, b.z, c.z),
    }
    tris.push(tri)
    minX = Math.min(minX, tri.minX)
    minY = Math.min(minY, tri.minY)
    minZ = Math.min(minZ, tri.minZ)
    maxX = Math.max(maxX, tri.maxX)
    maxY = Math.max(maxY, tri.maxY)
    maxZ = Math.max(maxZ, tri.maxZ)
  }
  if (tris.length === 0) return null
  return { tris, box: { minX, minY, minZ, maxX, maxY, maxZ } }
}

function separated(a: Aabb, b: Aabb) {
  return a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY || a.maxZ < b.minZ || b.maxZ < a.minZ
}

function gridCount(box: Aabb, triangles: number) {
  const sx = box.maxX - box.minX
  const sy = box.maxY - box.minY
  const sz = box.maxZ - box.minZ
  const target = Math.max(1, Math.round(Math.cbrt(Math.max(triangles, 1))))
  const volume = Math.max(sx * sy * sz, 1e-12)
  const scale = target / Math.cbrt(volume)
  const clamp = (span: number) => Math.max(1, Math.min(32, Math.round(Math.max(span, 1e-6) * scale)))
  return { nx: clamp(sx), ny: clamp(sy), nz: clamp(sz) }
}

function cellOf(value: number, min: number, max: number, count: number) {
  const span = max - min
  if (!(span > 0)) return 0
  const t = (value - min) / span
  if (t <= 0) return 0
  if (t >= 1) return count - 1
  return Math.min(count - 1, Math.floor(t * count))
}

/**
 * A 的每个三角只和落在同一格里的 B 三角求交。
 * 返回的线段在两只网格共用的坐标里。
 */
export function meshIntersections(
  vertsA: readonly Vec3[],
  indicesA: ArrayLike<number>,
  vertsB: readonly Vec3[],
  indicesB: ArrayLike<number>,
): Segment[] {
  const meshA = collect(vertsA, indicesA)
  const meshB = collect(vertsB, indicesB)
  if (!meshA || !meshB || separated(meshA.box, meshB.box)) return []
  const { nx, ny, nz } = gridCount(meshB.box, meshB.tris.length)
  const buckets = new Map<number, number[]>()
  const key = (ix: number, iy: number, iz: number) => ix + nx * (iy + ny * iz)
  const box = meshB.box
  for (let i = 0; i < meshB.tris.length; i++) {
    const tri = meshB.tris[i]!
    const x0 = cellOf(tri.minX, box.minX, box.maxX, nx)
    const x1 = cellOf(tri.maxX, box.minX, box.maxX, nx)
    const y0 = cellOf(tri.minY, box.minY, box.maxY, ny)
    const y1 = cellOf(tri.maxY, box.minY, box.maxY, ny)
    const z0 = cellOf(tri.minZ, box.minZ, box.maxZ, nz)
    const z1 = cellOf(tri.maxZ, box.minZ, box.maxZ, nz)
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const id = key(ix, iy, iz)
          const list = buckets.get(id)
          if (list) list.push(i)
          else buckets.set(id, [i])
        }
      }
    }
  }
  const out: Segment[] = []
  const seen = new Set<number>()
  for (const tri of meshA.tris) {
    if (separated(tri, box)) continue
    const x0 = cellOf(Math.max(tri.minX, box.minX), box.minX, box.maxX, nx)
    const x1 = cellOf(Math.min(tri.maxX, box.maxX), box.minX, box.maxX, nx)
    const y0 = cellOf(Math.max(tri.minY, box.minY), box.minY, box.maxY, ny)
    const y1 = cellOf(Math.min(tri.maxY, box.maxY), box.minY, box.maxY, ny)
    const z0 = cellOf(Math.max(tri.minZ, box.minZ), box.minZ, box.maxZ, nz)
    const z1 = cellOf(Math.min(tri.maxZ, box.maxZ), box.minZ, box.maxZ, nz)
    seen.clear()
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const list = buckets.get(key(ix, iy, iz))
          if (!list) continue
          for (const index of list) {
            if (seen.has(index)) continue
            seen.add(index)
            const other = meshB.tris[index]!
            if (separated(tri, other)) continue
            const segment = triTriSegment(
              vertsA[tri.i0]!,
              vertsA[tri.i1]!,
              vertsA[tri.i2]!,
              vertsB[other.i0]!,
              vertsB[other.i1]!,
              vertsB[other.i2]!,
            )
            if (segment) out.push(segment)
          }
        }
      }
    }
  }
  return out
}
