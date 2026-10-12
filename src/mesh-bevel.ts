/**
 * 渲染阶段给面数少的网格加一条窄圆角。
 * 共面三角先并成面。面数超过 12，或棱短到放不下，就保持原来的棱。
 * 圆角向里收，不改变布局盒子。
 */

const MAX_FACES = 12
const RADIUS = 8
export const BEVEL_RADIUS = RADIUS
const MIN_RADIUS = 0.75
const STEPS = 4
const CREASE_DOT = Math.cos((40 * Math.PI) / 180)
const PLANE_DOT = Math.cos((5 * Math.PI) / 180)
const PLANE_DIST = 0.25

export type BevelGeometry = { positions: Float32Array; normals: Float32Array; indices: Uint32Array }

type V3 = { x: number; y: number; z: number }
type Plane = { n: V3; d: number; tris: number[] }

const v = (x: number, y: number, z: number): V3 => ({ x, y, z })
const add = (a: V3, b: V3) => v(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a: V3, b: V3) => v(a.x - b.x, a.y - b.y, a.z - b.z)
const scale = (a: V3, s: number) => v(a.x * s, a.y * s, a.z * s)
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: V3, b: V3) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a: V3) => Math.hypot(a.x, a.y, a.z)

function norm(a: V3): V3 | null {
  const l = len(a)
  if (l < 1e-8) return null
  return scale(a, 1 / l)
}

function lerpDir(a: V3, b: V3, t: number): V3 | null {
  return norm(add(scale(a, 1 - t), scale(b, t)))
}

function weldKey(p: V3) {
  return `${Math.round(p.x * 1e3)},${Math.round(p.y * 1e3)},${Math.round(p.z * 1e3)}`
}

function edgeKey(a: number, b: number) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** 面数少就返回带窄圆角的网格，否则返回 null，调用方继续用原来的网格。 */
export function bevelFewFaces(srcPos: Float32Array, srcIdx: Uint32Array): BevelGeometry | null {
  const triCount = Math.floor(srcIdx.length / 3)
  if (triCount < 4) return null

  const points: V3[] = []
  const weld = new Map<string, number>()
  const at = (index: number) => {
    const p = v(srcPos[index * 3]!, srcPos[index * 3 + 1]!, srcPos[index * 3 + 2]!)
    const key = weldKey(p)
    let id = weld.get(key)
    if (id == null) {
      id = points.length
      points.push(p)
      weld.set(key, id)
    }
    return id
  }

  const tris: Array<{ a: number; b: number; c: number; n: V3 }> = []
  for (let t = 0; t < triCount; t++) {
    const a = at(srcIdx[t * 3]!)
    const b = at(srcIdx[t * 3 + 1]!)
    const c = at(srcIdx[t * 3 + 2]!)
    if (a === b || b === c || c === a) continue
    const n = norm(cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!)))
    if (!n) continue
    tris.push({ a, b, c, n })
  }
  if (tris.length < 4) return null

  const planes: Plane[] = []
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i]!
    const pa = points[tri.a]!
    const pb = points[tri.b]!
    const pc = points[tri.c]!
    let host: Plane | null = null
    for (const plane of planes) {
      if (dot(tri.n, plane.n) < PLANE_DOT) continue
      if (Math.abs(dot(plane.n, pa) - plane.d) > PLANE_DIST) continue
      if (Math.abs(dot(plane.n, pb) - plane.d) > PLANE_DIST) continue
      if (Math.abs(dot(plane.n, pc) - plane.d) > PLANE_DIST) continue
      host = plane
      break
    }
    if (!host) {
      planes.push({ n: tri.n, d: dot(tri.n, pa), tris: [i] })
    } else {
      host.tris.push(i)
    }
  }
  if (planes.length < 4 || planes.length > MAX_FACES) return null

  type DirEdge = { a: number; b: number; face: number }
  const seam = new Map<string, DirEdge[]>()
  const faceLoops: number[][] = []
  for (let f = 0; f < planes.length; f++) {
    const plane = planes[f]!
    const directed = new Map<string, { a: number; b: number; count: number }>()
    for (const ti of plane.tris) {
      const tri = tris[ti]!
      const cycle = [tri.a, tri.b, tri.c]
      for (let e = 0; e < 3; e++) {
        const a = cycle[e]!
        const b = cycle[(e + 1) % 3]!
        const key = edgeKey(a, b)
        const have = directed.get(key)
        if (!have) directed.set(key, { a, b, count: 1 })
        else if (have.a === a && have.b === b) have.count++
        else have.count--
      }
    }
    const boundary: Array<[number, number]> = []
    for (const edge of directed.values()) {
      if (edge.count === 0) continue
      if (Math.abs(edge.count) !== 1) return null
      boundary.push(edge.count > 0 ? [edge.a, edge.b] : [edge.b, edge.a])
    }
    const loops = chainLoops(boundary)
    if (!loops || loops.length !== 1) return null
    const loop = orientLoop(loops[0]!, plane.n, points)
    if (loop.length < 3) return null
    faceLoops.push(loop)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!
      const b = loop[(i + 1) % loop.length]!
      const key = edgeKey(a, b)
      const list = seam.get(key) ?? []
      list.push({ a, b, face: f })
      seam.set(key, list)
    }
  }

  type Crease = { a: number; b: number; f0: number; f1: number; theta: number; length: number }
  const creases: Crease[] = []
  for (const list of seam.values()) {
    if (list.length !== 2) return null
    const e0 = list[0]!
    const e1 = list[1]!
    const n0 = planes[e0.face]!.n
    const n1 = planes[e1.face]!.n
    const nd = Math.max(-1, Math.min(1, dot(n0, n1)))
    if (nd >= CREASE_DOT) return null
    const theta = Math.acos(nd)
    if (theta > (150 * Math.PI) / 180) return null
    creases.push({
      a: e0.a,
      b: e0.b,
      f0: e0.face,
      f1: e1.face,
      theta,
      length: len(sub(points[e0.b]!, points[e0.a]!)),
    })
  }
  if (creases.length === 0) return null

  const incident = new Map<number, number[]>()
  for (let f = 0; f < faceLoops.length; f++) {
    for (const id of faceLoops[f]!) {
      const list = incident.get(id) ?? []
      if (!list.includes(f)) list.push(f)
      incident.set(id, list)
    }
  }

  let radius = RADIUS
  for (const edge of creases) {
    const tanHalf = Math.tan(edge.theta / 2)
    if (!(tanHalf > 1e-4)) return null
    radius = Math.min(radius, (0.4 * edge.length) / tanHalf)
  }
  if (!(radius >= MIN_RADIUS)) return null

  const centers = new Map<number, V3>()
  for (const [id, faces] of incident) {
    if (faces.length !== 3) return null
    const [f0, f1, f2] = faces as [number, number, number]
    const p0 = planes[f0]!
    const p1 = planes[f1]!
    const p2 = planes[f2]!
    const center = intersectPlanes(p0.n, p0.d - radius, p1.n, p1.d - radius, p2.n, p2.d - radius)
    if (!center) return null
    centers.set(id, center)
  }

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const push = (p: V3, n: V3) => {
    const i = positions.length / 3
    positions.push(p.x, p.y, p.z)
    normals.push(n.x, n.y, n.z)
    return i
  }
  const addTri = (a: V3, na: V3, b: V3, nb: V3, c: V3, nc: V3, outward: V3) => {
    const gn = cross(sub(b, a), sub(c, a))
    const ia = push(a, na)
    const ib = push(b, nb)
    const ic = push(c, nc)
    if (dot(gn, outward) >= 0) indices.push(ia, ib, ic)
    else indices.push(ia, ic, ib)
  }

  for (let f = 0; f < faceLoops.length; f++) {
    const plane = planes[f]!
    const loop = faceLoops[f]!
    const poly: V3[] = []
    for (const id of loop) {
      const center = centers.get(id)
      if (!center) return null
      poly.push(add(center, scale(plane.n, radius)))
    }
    const area = loopArea(poly, plane.n)
    const orig = loopArea(loop.map((id) => points[id]!), plane.n)
    if (!(area > 1) || area < Math.abs(orig) * 0.05) return null
    const fans = earClip(poly, plane.n)
    if (!fans) return null
    for (let i = 0; i < fans.length; i += 3) {
      const a = poly[fans[i]!]!
      const b = poly[fans[i + 1]!]!
      const c = poly[fans[i + 2]!]!
      addTri(a, plane.n, b, plane.n, c, plane.n, plane.n)
    }
  }

  for (const edge of creases) {
    const n0 = planes[edge.f0]!.n
    const n1 = planes[edge.f1]!.n
    const ca = centers.get(edge.a)
    const cb = centers.get(edge.b)
    if (!ca || !cb) return null
    const row = (center: V3) => {
      const pts: Array<{ p: V3; n: V3 }> = []
      for (let k = 0; k <= STEPS; k++) {
        const dir = lerpDir(n0, n1, k / STEPS)
        if (!dir) return null
        pts.push({ p: add(center, scale(dir, radius)), n: dir })
      }
      return pts
    }
    const top = row(ca)
    const bot = row(cb)
    if (!top || !bot) return null
    for (let k = 0; k < STEPS; k++) {
      const a = top[k]!
      const b = bot[k]!
      const c = bot[k + 1]!
      const d = top[k + 1]!
      const outward = norm(add(a.n, c.n)) ?? a.n
      addTri(a.p, a.n, b.p, b.n, c.p, c.n, outward)
      addTri(a.p, a.n, c.p, c.n, d.p, d.n, outward)
    }
  }

  for (const [id, faces] of incident) {
    const center = centers.get(id)
    if (!center) return null
    const ordered = orderNormals(faces.map((f) => planes[f]!.n))
    if (ordered.length !== 3) return null
    const [n0, n1, n2] = ordered as [V3, V3, V3]
    const grid: V3[][] = []
    for (let i = 0; i <= STEPS; i++) {
      const row: V3[] = []
      for (let j = 0; j <= STEPS - i; j++) {
        const u = i / STEPS
        const w = j / STEPS
        const t = 1 - u - w
        const dir = norm(add(add(scale(n0, t), scale(n1, u)), scale(n2, w)))
        if (!dir) return null
        row.push(dir)
      }
      grid.push(row)
    }
    for (let i = 0; i < STEPS; i++) {
      for (let j = 0; j < STEPS - i; j++) {
        const a = grid[i]![j]!
        const b = grid[i + 1]![j]!
        const c = grid[i]![j + 1]!
        addTri(add(center, scale(a, radius)), a, add(center, scale(b, radius)), b, add(center, scale(c, radius)), c, a)
        if (j + 1 < STEPS - i) {
          const d = grid[i + 1]![j + 1]!
          addTri(add(center, scale(b, radius)), b, add(center, scale(d, radius)), d, add(center, scale(c, radius)), c, b)
        }
      }
    }
  }

  if (indices.length < 3) return null
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  }
}

function chainLoops(edges: Array<[number, number]>): number[][] | null {
  const next = new Map<number, number[]>()
  for (const [a, b] of edges) {
    const list = next.get(a) ?? []
    list.push(b)
    next.set(a, list)
  }
  const used = new Set<string>()
  const loops: number[][] = []
  for (const [start, to] of edges) {
    const stamp = `${start}->${to}`
    if (used.has(stamp)) continue
    const loop = [start]
    let cur = start
    let nxt = to
    let guard = 0
    while (guard++ < edges.length + 2) {
      const outs = next.get(cur) ?? []
      if (outs.length !== 1) return null
      used.add(`${cur}->${nxt}`)
      if (nxt === start) break
      loop.push(nxt)
      cur = nxt
      const follow = next.get(cur)
      if (!follow || follow.length !== 1) return null
      nxt = follow[0]!
    }
    if (nxt !== start || loop.length < 3) return null
    loops.push(loop)
  }
  return loops
}

function orientLoop(loop: number[], normal: V3, points: V3[]) {
  const poly = loop.map((id) => points[id]!)
  if (loopArea(poly, normal) < 0) return loop.slice().reverse()
  return loop
}

function loopArea(poly: V3[], normal: V3) {
  let acc = v(0, 0, 0)
  for (let i = 0; i < poly.length; i++) {
    acc = add(acc, cross(poly[i]!, poly[(i + 1) % poly.length]!))
  }
  return dot(acc, normal) * 0.5
}

function intersectPlanes(n1: V3, d1: number, n2: V3, d2: number, n3: V3, d3: number): V3 | null {
  const c23 = cross(n2, n3)
  const c31 = cross(n3, n1)
  const c12 = cross(n1, n2)
  const det = dot(n1, c23)
  if (Math.abs(det) < 1e-8) return null
  return scale(add(add(scale(c23, d1), scale(c31, d2)), scale(c12, d3)), 1 / det)
}

function orderNormals(normals: V3[]) {
  const axis = norm(normals.reduce((sum, n) => add(sum, n), v(0, 0, 0)))
  if (!axis) return normals
  const ref = Math.abs(axis.x) < 0.9 ? v(1, 0, 0) : v(0, 1, 0)
  const u = norm(cross(axis, ref))
  if (!u) return normals
  const side = cross(axis, u)
  return [...normals].sort((a, b) => Math.atan2(dot(a, side), dot(a, u)) - Math.atan2(dot(b, side), dot(b, u)))
}

function earClip(poly: V3[], normal: V3): number[] | null {
  const idx = poly.map((_, i) => i)
  const out: number[] = []
  let guard = 0
  while (idx.length > 3) {
    if (guard++ > idx.length * idx.length) return null
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length]!
      const i1 = idx[i]!
      const i2 = idx[(i + 1) % idx.length]!
      if (!isConvex(poly[i0]!, poly[i1]!, poly[i2]!, normal)) continue
      let inside = false
      for (const other of idx) {
        if (other === i0 || other === i1 || other === i2) continue
        if (pointInTri(poly[other]!, poly[i0]!, poly[i1]!, poly[i2]!, normal)) {
          inside = true
          break
        }
      }
      if (inside) continue
      out.push(i0, i1, i2)
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) return null
  }
  out.push(idx[0]!, idx[1]!, idx[2]!)
  return out
}

function isConvex(a: V3, b: V3, c: V3, normal: V3) {
  return dot(cross(sub(b, a), sub(c, b)), normal) > 1e-6
}

function pointInTri(p: V3, a: V3, b: V3, c: V3, normal: V3) {
  const c1 = dot(cross(sub(b, a), sub(p, a)), normal)
  const c2 = dot(cross(sub(c, b), sub(p, b)), normal)
  const c3 = dot(cross(sub(a, c), sub(p, c)), normal)
  const eps = 1e-5
  return c1 >= -eps && c2 >= -eps && c3 >= -eps
}
