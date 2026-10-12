/**
 * 渲染阶段给面数不多的网格加一条窄圆角。
 * 共面三角先并成面。不超过 200 个面时，折棱向里收，最多 8px。
 * 面太窄放不下的棱把圆角收小。圆角不改变布局盒子。
 */

const MAX_FACES = 200
const RADIUS = 8
export const BEVEL_RADIUS = RADIUS
const MIN_RADIUS = 0.75
const STEPS = 4
const CREASE_DOT = Math.cos((15 * Math.PI) / 180)
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

  const thetaOf = new Map<string, number>()
  const radiusOf = new Map<string, number>()
  for (const edge of creases) {
    const tanHalf = Math.tan(edge.theta / 2)
    if (!(tanHalf > 1e-4)) return null
    const key = edgeKey(edge.a, edge.b)
    thetaOf.set(key, edge.theta)
    radiusOf.set(key, Math.min(RADIUS, (0.45 * edge.length) / tanHalf))
  }
  if ([...radiusOf.values()].every((r) => r < MIN_RADIUS)) return null

  for (let pass = 0; pass < 12; pass++) {
    const built = buildBevel(radiusOf, points, planes, faceLoops, creases, incident, thetaOf)
    if (!built || !('shrink' in built)) return built
    const cut = new Set<string>()
    for (const f of built.shrink) {
      let worstKey = ''
      let worstT = -1
      const loop = faceLoops[f]!
      for (let i = 0; i < loop.length; i++) {
        const key = edgeKey(loop[i]!, loop[(i + 1) % loop.length]!)
        const theta = thetaOf.get(key) ?? 0
        const t = (radiusOf.get(key) ?? 0) * Math.tan(theta / 2)
        if (t > worstT) {
          worstT = t
          worstKey = key
        }
      }
      if (worstKey) cut.add(worstKey)
    }
    let changed = false
    for (const key of cut) {
      const r = radiusOf.get(key) ?? 0
      if (!(r > MIN_RADIUS)) return null
      radiusOf.set(key, Math.max(MIN_RADIUS, r * 0.72))
      changed = true
    }
    if (!changed) return null
  }
  return null
}

type CreaseEdge = { a: number; b: number; f0: number; f1: number; theta: number; length: number }

/** 三个面交成一个球心；更多面时没有公切球，调用方改用边上的内收点。 */
function sphereCenter(faces: number[], planes: Plane[], radius: number): V3 | null {
  if (faces.length !== 3) return null
  return intersectPlanes(
    faces.map((f) => {
      const plane = planes[f]!
      return { n: plane.n, d: plane.d - radius }
    }),
  )
}

function buildBevel(
  radiusOf: Map<string, number>,
  points: V3[],
  planes: Plane[],
  faceLoops: number[][],
  creases: CreaseEdge[],
  incident: Map<number, number[]>,
  thetaOf: Map<string, number>,
): BevelGeometry | { shrink: number[] } | null {
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

  const uniformAt = (id: number) => {
    const faces = incident.get(id)
    if (!faces || faces.length !== 3) return null
    let found: number | null = null
    for (const edge of creases) {
      if (edge.a !== id && edge.b !== id) continue
      const er = radiusOf.get(edgeKey(edge.a, edge.b)) ?? 0
      if (found == null) found = er
      else if (Math.abs(er - found) > 0.05) return null
    }
    return found
  }

  const insetAt = new Map<string, V3>()
  const facePoly: V3[][] = []
  const failed: number[] = []
  for (let f = 0; f < faceLoops.length; f++) {
    const plane = planes[f]!
    const loop = faceLoops[f]!
    const needsInset = loop.some((id) => uniformAt(id) == null)
    const inset = needsInset ? insetLoop(loop, plane.n, points, thetaOf, radiusOf) : null
    if (needsInset && !inset) return null
    const poly: V3[] = []
    for (let i = 0; i < loop.length; i++) {
      const id = loop[i]!
      const uniform = uniformAt(id)
      const center = uniform == null ? null : sphereCenter(incident.get(id) ?? [], planes, uniform)
      const point = center ? add(center, scale(plane.n, uniform!)) : inset![i]!
      insetAt.set(`${f}|${id}`, point)
      poly.push(point)
    }
    const area = loopArea(poly, plane.n)
    const orig = Math.abs(loopArea(loop.map((id) => points[id]!), plane.n))
    let ok = area > Math.max(0.05, orig * 0.02)
    if (ok) {
      for (let i = 0; i < poly.length; i++) {
        const prev = poly[(i + poly.length - 1) % poly.length]!
        if (!isConvex(prev, poly[i]!, poly[(i + 1) % poly.length]!, plane.n)) {
          ok = false
          break
        }
      }
    }
    if (!ok) {
      failed.push(f)
      continue
    }
    facePoly.push(poly)
  }
  if (failed.length > 0) return { shrink: failed }

  for (let f = 0; f < facePoly.length; f++) {
    const plane = planes[f]!
    const poly = facePoly[f]!
    const fans = earClip(poly, plane.n)
    if (!fans) return null
    for (let i = 0; i < fans.length; i += 3) {
      addTri(poly[fans[i]!]!, plane.n, poly[fans[i + 1]!]!, plane.n, poly[fans[i + 2]!]!, plane.n, plane.n)
    }
  }

  const arcAt = new Map<string, Array<{ p: V3; n: V3 }>>()
  for (const edge of creases) {
    const n0 = planes[edge.f0]!.n
    const n1 = planes[edge.f1]!.n
    const radius = radiusOf.get(edgeKey(edge.a, edge.b)) ?? 0
    if (!(radius >= MIN_RADIUS)) continue
    const samples = (vid: number) => {
      const pa = insetAt.get(`${edge.f0}|${vid}`)
      const pb = insetAt.get(`${edge.f1}|${vid}`)
      if (!pa || !pb) return null
      const uniform = uniformAt(vid)
      const sphere = uniform != null && Math.abs(uniform - radius) < 0.05 ? sphereCenter(incident.get(vid) ?? [], planes, radius) : null
      const center = sphere ?? scale(add(sub(pa, scale(n0, radius)), sub(pb, scale(n1, radius))), 0.5)
      const pts: Array<{ p: V3; n: V3 }> = []
      for (let k = 0; k <= STEPS; k++) {
        if (k === 0) {
          pts.push({ p: pa, n: n0 })
          continue
        }
        if (k === STEPS) {
          pts.push({ p: pb, n: n1 })
          continue
        }
        const dir = lerpDir(n0, n1, k / STEPS)
        if (!dir) return null
        pts.push({ p: add(center, scale(dir, radius)), n: dir })
      }
      return pts
    }
    const top = samples(edge.a)
    const bot = samples(edge.b)
    if (!top || !bot) return null
    arcAt.set(`${edge.a}|${edge.f0}|${edge.f1}`, top)
    arcAt.set(`${edge.b}|${edge.f0}|${edge.f1}`, bot)
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
    if (faces.length < 3) return null
    const ordered = orderFaceIds(faces, planes)
    if (!ordered || ordered.length < 3) return null
    const uniform = uniformAt(id)
    const sphere = uniform == null ? null : sphereCenter(faces, planes, uniform)
    if (sphere && uniform != null) {
      const orderedN = ordered.map((f) => planes[f]!.n)
      const apex = norm(orderedN.reduce((sum, n) => add(sum, n), v(0, 0, 0)))
      if (!apex) return null
      for (let i = 0; i < orderedN.length; i++) {
        const n0 = orderedN[i]!
        const n1 = orderedN[(i + 1) % orderedN.length]!
        for (let k = 0; k < STEPS; k++) {
          const a = lerpDir(n0, n1, k / STEPS)
          const b = lerpDir(n0, n1, (k + 1) / STEPS)
          if (!a || !b) return null
          addTri(add(sphere, scale(apex, uniform)), apex, add(sphere, scale(a, uniform)), a, add(sphere, scale(b, uniform)), b, apex)
        }
      }
      continue
    }
    const insets: V3[] = []
    for (const f of ordered) {
      const p = insetAt.get(`${f}|${id}`)
      if (!p) return null
      insets.push(p)
    }
    const apexP = scale(
      insets.reduce((sum, p) => add(sum, p), v(0, 0, 0)),
      1 / insets.length,
    )
    const apexN = norm(ordered.reduce((sum, f) => add(sum, planes[f]!.n), v(0, 0, 0)))
    if (!apexN) return null
    for (let i = 0; i < ordered.length; i++) {
      const f0 = ordered[i]!
      const f1 = ordered[(i + 1) % ordered.length]!
      let arc = arcAt.get(`${id}|${f0}|${f1}`)
      let reverse = false
      if (!arc) {
        arc = arcAt.get(`${id}|${f1}|${f0}`)
        reverse = true
      }
      if (!arc) return null
      const seq = reverse ? arc.slice().reverse() : arc
      for (let k = 0; k < seq.length - 1; k++) {
        const a = seq[k]!
        const b = seq[k + 1]!
        addTri(apexP, apexN, a.p, a.n, b.p, b.n, apexN)
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

/** 把每条棱沿面内法向收进 r·tan(θ/2)，相邻偏移线的交点是新顶点。 */
function insetLoop(
  loop: number[],
  normal: V3,
  points: V3[],
  thetaOf: Map<string, number>,
  radiusOf: Map<string, number>,
): V3[] | null {
  const lines: Array<{ p: V3; dir: V3 }> = []
  for (let i = 0; i < loop.length; i++) {
    const a = points[loop[i]!]!
    const b = points[loop[(i + 1) % loop.length]!]!
    const dir = norm(sub(b, a))
    if (!dir) return null
    const inward = norm(cross(normal, dir))
    if (!inward) return null
    const key = edgeKey(loop[i]!, loop[(i + 1) % loop.length]!)
    const theta = thetaOf.get(key)
    if (theta == null) return null
    const radius = radiusOf.get(key) ?? 0
    lines.push({ p: add(a, scale(inward, radius * Math.tan(theta / 2))), dir })
  }
  const poly: V3[] = []
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[(i + lines.length - 1) % lines.length]!
    const cur = lines[i]!
    const hit = lineHit(prev.p, prev.dir, cur.p, cur.dir, normal)
    if (!hit) return null
    poly.push(hit)
  }
  return poly
}

function lineHit(p0: V3, d0: V3, p1: V3, d1: V3, normal: V3): V3 | null {
  const denom = dot(cross(d0, d1), normal)
  if (Math.abs(denom) < 1e-8) return null
  const s = dot(cross(sub(p1, p0), d1), normal) / denom
  return add(p0, scale(d0, s))
}

function orderFaceIds(faces: number[], planes: Plane[]) {
  const normals = faces.map((f) => planes[f]!.n)
  const axis = norm(normals.reduce((sum, n) => add(sum, n), v(0, 0, 0)))
  if (!axis) return null
  const ref = Math.abs(axis.x) < 0.9 ? v(1, 0, 0) : v(0, 1, 0)
  const u = norm(cross(axis, ref))
  if (!u) return null
  const side = cross(axis, u)
  return [...faces].sort((a, b) => Math.atan2(dot(planes[a]!.n, side), dot(planes[a]!.n, u)) - Math.atan2(dot(planes[b]!.n, side), dot(planes[b]!.n, u)))
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

/** 多个面向里平移后的交点。三个面时是精确解，更多面时取最小二乘。 */
function intersectPlanes(planes: Array<{ n: V3; d: number }>): V3 | null {
  let a00 = 0
  let a01 = 0
  let a02 = 0
  let a11 = 0
  let a12 = 0
  let a22 = 0
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (const plane of planes) {
    const x = plane.n.x
    const y = plane.n.y
    const z = plane.n.z
    a00 += x * x
    a01 += x * y
    a02 += x * z
    a11 += y * y
    a12 += y * z
    a22 += z * z
    b0 += x * plane.d
    b1 += y * plane.d
    b2 += z * plane.d
  }
  const c00 = a11 * a22 - a12 * a12
  const c01 = a02 * a12 - a01 * a22
  const c02 = a01 * a12 - a02 * a11
  const c11 = a00 * a22 - a02 * a02
  const c12 = a01 * a02 - a00 * a12
  const c22 = a00 * a11 - a01 * a01
  const det = a00 * c00 + a01 * c01 + a02 * c02
  if (Math.abs(det) < 1e-8) return null
  return v((c00 * b0 + c01 * b1 + c02 * b2) / det, (c01 * b0 + c11 * b1 + c12 * b2) / det, (c02 * b0 + c12 * b1 + c22 * b2) / det)
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
