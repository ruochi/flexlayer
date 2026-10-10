import { parseNumber } from './style.js'
import type { BoxEdge, CylinderRim } from './types.js'

/**
 * 棱上的圆角。`rx` 是半径，`round` 选择哪些棱。
 * 长方体：没写 `round` 时 12 条都圆。圆柱：没写 `round` 时上下两个圆口都圆。
 * 圆角和相邻的平面相切，布局盒子不变。
 */

export type RoundIssue = { message: string; hint: string }

type Axis = 'x' | 'y' | 'z'
type Vec3 = { x: number; y: number; z: number }
type VN = { p: Vec3; n: Vec3 }
type Corner = [number, number, number]

type EdgeRec = { id: BoxEdge; axis: Axis; sx: number; sy: number; sz: number }

type Builder = { positions: number[]; normals: number[]; indices: number[] }

const AXES: Axis[] = ['x', 'y', 'z']
const FILLET_STEPS = 8
const CYLINDER_SEGMENTS = 48

export const BOX_EDGES: readonly BoxEdge[] = [
  'front-top',
  'front-bottom',
  'front-left',
  'front-right',
  'back-top',
  'back-bottom',
  'back-left',
  'back-right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

const EDGE_TABLE: readonly EdgeRec[] = [
  { id: 'front-top', axis: 'x', sx: 0, sy: 1, sz: 1 },
  { id: 'front-bottom', axis: 'x', sx: 0, sy: -1, sz: 1 },
  { id: 'back-top', axis: 'x', sx: 0, sy: 1, sz: -1 },
  { id: 'back-bottom', axis: 'x', sx: 0, sy: -1, sz: -1 },
  { id: 'front-right', axis: 'y', sx: 1, sy: 0, sz: 1 },
  { id: 'front-left', axis: 'y', sx: -1, sy: 0, sz: 1 },
  { id: 'back-right', axis: 'y', sx: 1, sy: 0, sz: -1 },
  { id: 'back-left', axis: 'y', sx: -1, sy: 0, sz: -1 },
  { id: 'top-right', axis: 'z', sx: 1, sy: 1, sz: 0 },
  { id: 'top-left', axis: 'z', sx: -1, sy: 1, sz: 0 },
  { id: 'bottom-right', axis: 'z', sx: 1, sy: -1, sz: 0 },
  { id: 'bottom-left', axis: 'z', sx: -1, sy: -1, sz: 0 },
]

const EDGE_BY_ID = new Map(EDGE_TABLE.map((edge) => [edge.id, edge]))

const GROUPS: Record<string, readonly BoxEdge[]> = {
  all: BOX_EDGES,
  x: ['front-top', 'front-bottom', 'back-top', 'back-bottom'],
  y: ['front-left', 'front-right', 'back-left', 'back-right'],
  z: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  front: ['front-top', 'front-bottom', 'front-left', 'front-right'],
  back: ['back-top', 'back-bottom', 'back-left', 'back-right'],
  left: ['front-left', 'back-left', 'top-left', 'bottom-left'],
  right: ['front-right', 'back-right', 'top-right', 'bottom-right'],
  top: ['front-top', 'back-top', 'top-left', 'top-right'],
  bottom: ['front-bottom', 'back-bottom', 'bottom-left', 'bottom-right'],
}

const BOX_HINT = '可用 all、x、y、z、front、back、left、right、top、bottom，或 front-top 这种棱'
const CYLINDER_HINT = '口缘用 top、bottom 或 all。不写 round 时上下都圆'

const FACES: Array<{ axis: Axis; sign: number; corners: Corner[] }> = [
  { axis: 'z', sign: 1, corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { axis: 'z', sign: -1, corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { axis: 'x', sign: 1, corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { axis: 'x', sign: -1, corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { axis: 'y', sign: 1, corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { axis: 'y', sign: -1, corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
]

function formatPx(n: number) {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function tokensOf(raw: string | undefined): string[] | null {
  if (raw == null || raw.trim() === '') return null
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
}

function xEdge(sy: number, sz: number): BoxEdge {
  if (sz > 0) return sy > 0 ? 'front-top' : 'front-bottom'
  return sy > 0 ? 'back-top' : 'back-bottom'
}

function yEdge(sx: number, sz: number): BoxEdge {
  if (sz > 0) return sx > 0 ? 'front-right' : 'front-left'
  return sx > 0 ? 'back-right' : 'back-left'
}

function zEdge(sx: number, sy: number): BoxEdge {
  if (sy > 0) return sx > 0 ? 'top-right' : 'top-left'
  return sx > 0 ? 'bottom-right' : 'bottom-left'
}

function edgeAlong(axis: Axis, sx: number, sy: number, sz: number): BoxEdge {
  if (axis === 'x') return xEdge(sy, sz)
  if (axis === 'y') return yEdge(sx, sz)
  return zEdge(sx, sy)
}

function pairEdge(a: string, b: string): BoxEdge | null {
  const z = a === 'front' || a === 'back' ? a : b === 'front' || b === 'back' ? b : null
  const y = a === 'top' || a === 'bottom' ? a : b === 'top' || b === 'bottom' ? b : null
  const x = a === 'left' || a === 'right' ? a : b === 'left' || b === 'right' ? b : null
  const hits = [z, y, x].filter((item) => item != null).length
  if (hits !== 2 || (z && y && x)) return null
  if (z && y) return xEdge(y === 'top' ? 1 : -1, z === 'front' ? 1 : -1)
  if (z && x) return yEdge(x === 'right' ? 1 : -1, z === 'front' ? 1 : -1)
  if (x && y) return zEdge(x === 'right' ? 1 : -1, y === 'top' ? 1 : -1)
  return null
}

function tokenEdges(token: string): readonly BoxEdge[] | null {
  const group = GROUPS[token]
  if (group) return group
  const parts = token.split('-')
  if (parts.length !== 2) return null
  const edge = pairEdge(parts[0]!, parts[1]!)
  return edge ? [edge] : null
}

function positiveRadius(raw: string | undefined, issues: RoundIssue[]): number | null {
  if (raw == null || raw.trim() === '') return null
  const parsed = parseNumber(raw)
  if (parsed == null || !(parsed > 0)) {
    issues.push({ message: `无法解析 rx: ${raw}`, hint: '写成正的像素半径，例如 rx="12"' })
    return null
  }
  return parsed
}

function maxBoxRadius(width: number, height: number, depth: number, edges: ReadonlySet<BoxEdge>): number {
  const half = { x: width / 2, y: height / 2, z: depth / 2 }
  let limit = Infinity
  for (const id of edges) {
    const edge = EDGE_BY_ID.get(id)
    if (!edge) continue
    for (const axis of AXES) {
      if (axis !== edge.axis) limit = Math.min(limit, half[axis])
    }
    let insets = 0
    for (const end of [-1, 1]) {
      const signs = {
        x: edge.axis === 'x' ? end : edge.sx,
        y: edge.axis === 'y' ? end : edge.sy,
        z: edge.axis === 'z' ? end : edge.sz,
      }
      const others = AXES.filter((axis) => axis !== edge.axis)
      if (others.some((axis) => edges.has(edgeAlong(axis, signs.x, signs.y, signs.z)))) insets++
    }
    if (insets > 0) limit = Math.min(limit, (half[edge.axis] * 2) / insets)
  }
  return Number.isFinite(limit) ? Math.max(0, limit) : 0
}

/** 解析 box 的 rx / round。rx 为 0 或 edges 为空时保持直角。 */
export function readBoxFillet(
  rxRaw: string | undefined,
  roundRaw: string | undefined,
  width: number,
  height: number,
  depth: number,
): { rx: number; edges: BoxEdge[]; issues: RoundIssue[] } {
  const issues: RoundIssue[] = []
  const tokens = tokensOf(roundRaw)
  const rx = positiveRadius(rxRaw, issues)
  if (rx == null) {
    if (tokens) {
      issues.push({
        message: 'box 写了 round 但没有正的 rx，圆角不生效',
        hint: '例如 rx="12" round="front"',
      })
    }
    return { rx: 0, edges: [], issues }
  }
  const selected = new Set<BoxEdge>()
  if (!tokens) {
    for (const edge of BOX_EDGES) selected.add(edge)
  } else {
    for (const token of tokens) {
      const edges = tokenEdges(token)
      if (!edges) {
        issues.push({ message: `box 的 round 不认识「${token}」`, hint: BOX_HINT })
        continue
      }
      for (const edge of edges) selected.add(edge)
    }
  }
  const edges = BOX_EDGES.filter((edge) => selected.has(edge))
  if (edges.length === 0) {
    issues.push({ message: 'box 的 round 没有选中棱，圆角不生效', hint: BOX_HINT })
    return { rx: 0, edges: [], issues }
  }
  const limit = maxBoxRadius(width, height, depth, selected)
  if (rx > limit + 1e-6) {
    issues.push({
      message: `box 的 rx 放不下，已从 ${formatPx(rx)} 收到 ${formatPx(limit)}`,
      hint: '半径不能大于相邻棱能让开的距离',
    })
    return { rx: limit, edges, issues }
  }
  return { rx, edges, issues }
}

/** 解析 cylinder 的 rx / round。圆的是上下两个圆口。 */
export function readCylinderFillet(
  rxRaw: string | undefined,
  roundRaw: string | undefined,
  radius: number,
  height: number,
): { rx: number; rims: CylinderRim[]; issues: RoundIssue[] } {
  const issues: RoundIssue[] = []
  const tokens = tokensOf(roundRaw)
  const rx = positiveRadius(rxRaw, issues)
  if (rx == null) {
    if (tokens) {
      issues.push({
        message: 'cylinder 写了 round 但没有正的 rx，圆角不生效',
        hint: '例如 rx="12" round="top"',
      })
    }
    return { rx: 0, rims: [], issues }
  }
  const selected = new Set<CylinderRim>()
  if (!tokens) {
    selected.add('top')
    selected.add('bottom')
  } else {
    for (const token of tokens) {
      if (token === 'all') {
        selected.add('top')
        selected.add('bottom')
      } else if (token === 'top' || token === 'bottom') {
        selected.add(token)
      } else {
        issues.push({ message: `cylinder 的 round 不认识「${token}」`, hint: CYLINDER_HINT })
      }
    }
  }
  const rims: CylinderRim[] = (['top', 'bottom'] as const).filter((rim) => selected.has(rim))
  if (rims.length === 0) {
    issues.push({ message: 'cylinder 的 round 没有选中口缘，圆角不生效', hint: CYLINDER_HINT })
    return { rx: 0, rims: [], issues }
  }
  const along = rims.length === 2 ? height / 2 : height
  const limit = Math.max(0, Math.min(radius, along))
  if (rx > limit + 1e-6) {
    issues.push({
      message: `cylinder 的 rx 放不下，已从 ${formatPx(rx)} 收到 ${formatPx(limit)}`,
      hint: '要小于 r；两端都圆时还不能大于 height 的一半',
    })
    return { rx: limit, rims, issues }
  }
  return { rx, rims, issues }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function unit(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1
  return { x: a.x / len, y: a.y / len, z: a.z / len }
}

function axisVec(axis: Axis, sign: number): Vec3 {
  return { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 }
}

function addTri(mesh: Builder, a: VN, b: VN, c: VN) {
  const ux = b.p.x - a.p.x
  const uy = b.p.y - a.p.y
  const uz = b.p.z - a.p.z
  const vx = c.p.x - a.p.x
  const vy = c.p.y - a.p.y
  const vz = c.p.z - a.p.z
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  if (nx * nx + ny * ny + nz * nz < 1e-16) return
  const ox = a.n.x + b.n.x + c.n.x
  const oy = a.n.y + b.n.y + c.n.y
  const oz = a.n.z + b.n.z + c.n.z
  const flip = nx * ox + ny * oy + nz * oz < 0
  const verts = flip ? [a, c, b] : [a, b, c]
  const base = mesh.positions.length / 3
  for (const vert of verts) {
    mesh.positions.push(vert.p.x, vert.p.y, vert.p.z)
    mesh.normals.push(vert.n.x, vert.n.y, vert.n.z)
  }
  mesh.indices.push(base, base + 1, base + 2)
}

function addGrid(mesh: Builder, rows: VN[][]) {
  for (let i = 0; i < rows.length - 1; i++) {
    const row0 = rows[i]!
    const row1 = rows[i + 1]!
    const span = Math.min(row0.length, row1.length) - 1
    for (let j = 0; j < span; j++) {
      const a = row0[j]!
      const b = row0[j + 1]!
      const c = row1[j + 1]!
      const d = row1[j]!
      addTri(mesh, a, b, c)
      addTri(mesh, a, c, d)
    }
  }
}

function addFan(mesh: Builder, center: VN, ring: VN[]) {
  for (let k = 0; k < ring.length - 1; k++) addTri(mesh, center, ring[k]!, ring[k + 1]!)
}

function dedupeLoop(points: Vec3[]): Vec3[] {
  const out: Vec3[] = []
  for (const point of points) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(point.x - prev.x, point.y - prev.y, point.z - prev.z) < 1e-5) continue
    out.push(point)
  }
  if (out.length > 1) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < 1e-5) out.pop()
  }
  return out
}

function addConvexFace(mesh: Builder, points: Vec3[], normal: Vec3) {
  const loop = dedupeLoop(points)
  if (loop.length < 3) return
  const hint = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const u = unit(cross(hint, normal))
  const v = cross(normal, u)
  const origin = loop[0]!
  let area = 0
  const uv = loop.map((point) => {
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    const dz = point.z - origin.z
    return { x: dx * u.x + dy * u.y + dz * u.z, y: dx * v.x + dy * v.y + dz * v.z }
  })
  for (let i = 0; i < uv.length; i++) {
    const a = uv[i]!
    const b = uv[(i + 1) % uv.length]!
    area += a.x * b.y - a.y * b.x
  }
  if (Math.abs(area) < 1e-8) return
  const poly = area < 0 ? loop.slice().reverse() : loop
  const n = { x: normal.x, y: normal.y, z: normal.z }
  for (let i = 1; i < poly.length - 1; i++) {
    addTri(mesh, { p: poly[0]!, n }, { p: poly[i]!, n }, { p: poly[i + 1]!, n })
  }
}

/** φ = 0 朝第一根轴，φ = π/2 朝第二根。和角上的球面参数对齐。 */
function phiAxes(axis: Axis): [Axis, Axis] {
  if (axis === 'x') return ['z', 'y']
  if (axis === 'y') return ['z', 'x']
  return ['x', 'y']
}

function cylinderPoint(edge: EdgeRec, t: number, phi: number, rx: number, half: Record<Axis, number>): VN {
  const [a0, a1] = phiAxes(edge.axis)
  const signs = { x: edge.sx, y: edge.sy, z: edge.sz }
  const p = { x: 0, y: 0, z: 0 }
  const n = { x: 0, y: 0, z: 0 }
  p[edge.axis] = t
  p[a0] = signs[a0] * (half[a0] - rx)
  p[a1] = signs[a1] * (half[a1] - rx)
  p[a0] += signs[a0] * rx * Math.cos(phi)
  p[a1] += signs[a1] * rx * Math.sin(phi)
  n[a0] = signs[a0] * Math.cos(phi)
  n[a1] = signs[a1] * Math.sin(phi)
  return { p, n }
}

type EndKind = { kind: 'full' } | { kind: 'stop' } | { kind: 'trim'; keep: 'low' | 'high' }

function endKind(edge: EdgeRec, end: number, rounded: ReadonlySet<BoxEdge>): EndKind {
  const signs = {
    x: edge.axis === 'x' ? end : edge.sx,
    y: edge.axis === 'y' ? end : edge.sy,
    z: edge.axis === 'z' ? end : edge.sz,
  }
  const [a0, a1] = phiAxes(edge.axis)
  const low = rounded.has(edgeAlong(a0, signs.x, signs.y, signs.z))
  const high = rounded.has(edgeAlong(a1, signs.x, signs.y, signs.z))
  if (low && high) return { kind: 'stop' }
  if (!low && !high) return { kind: 'full' }
  return { kind: 'trim', keep: low ? 'low' : 'high' }
}

function addPhiStrip(mesh: Builder, edge: EdgeRec, t0: number, t1: number, rx: number, half: Record<Axis, number>) {
  if (t1 - t0 <= 1e-6) return
  const rows: VN[][] = []
  for (const t of [t0, t1]) {
    const row: VN[] = []
    for (let k = 0; k <= FILLET_STEPS; k++) {
      row.push(cylinderPoint(edge, t, (k / FILLET_STEPS) * (Math.PI / 2), rx, half))
    }
    rows.push(row)
  }
  addGrid(mesh, rows)
}

function addSphere(mesh: Builder, sx: number, sy: number, sz: number, rx: number, half: Record<Axis, number>) {
  const center = { x: sx * (half.x - rx), y: sy * (half.y - rx), z: sz * (half.z - rx) }
  const rows: VN[][] = []
  for (let ia = 0; ia <= FILLET_STEPS; ia++) {
    const a = (ia / FILLET_STEPS) * (Math.PI / 2)
    const row: VN[] = []
    for (let ib = 0; ib <= FILLET_STEPS; ib++) {
      const b = (ib / FILLET_STEPS) * (Math.PI / 2)
      const dir = {
        x: sx * Math.cos(b) * Math.sin(a),
        y: sy * Math.sin(b),
        z: sz * Math.cos(b) * Math.cos(a),
      }
      row.push({
        p: { x: center.x + rx * dir.x, y: center.y + rx * dir.y, z: center.z + rx * dir.z },
        n: dir,
      })
    }
    rows.push(row)
  }
  addGrid(mesh, rows)
}

function clamp01(n: number) {
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

/** 棱的末端只被另一条圆角挡住时，圆柱收到交线，法线取两边的角平分，避免折成一条硬棱。 */
function addTrim(mesh: Builder, edge: EdgeRec, end: number, keep: 'low' | 'high', rx: number, half: Record<Axis, number>) {
  const span = half[edge.axis]
  const signs = {
    x: edge.axis === 'x' ? end : edge.sx,
    y: edge.axis === 'y' ? end : edge.sy,
    z: edge.axis === 'z' ? end : edge.sz,
  }
  const [a0, a1] = phiAxes(edge.axis)
  const rows: VN[][] = []
  for (let i = 0; i <= FILLET_STEPS; i++) {
    const d = (i / FILLET_STEPS) * rx
    const t = end * (span - rx + d)
    const arg = clamp01(d / rx)
    const phi0 = keep === 'high' ? Math.asin(arg) : 0
    const phi1 = keep === 'low' ? Math.acos(arg) : Math.PI / 2
    const row: VN[] = []
    for (let k = 0; k <= FILLET_STEPS; k++) {
      const phi = phi0 + (phi1 - phi0) * (k / FILLET_STEPS)
      const vert = cylinderPoint(edge, t, phi, rx, half)
      const onSeam = (keep === 'high' && k === 0) || (keep === 'low' && k === FILLET_STEPS)
      if (onSeam) {
        const other = { x: 0, y: 0, z: 0 }
        const s = arg
        const c = Math.sqrt(Math.max(0, 1 - s * s))
        other[edge.axis] = signs[edge.axis] * s
        other[keep === 'high' ? a0 : a1] = signs[keep === 'high' ? a0 : a1] * c
        const nx = vert.n.x + other.x
        const ny = vert.n.y + other.y
        const nz = vert.n.z + other.z
        const len = Math.hypot(nx, ny, nz) || 1
        vert.n = { x: nx / len, y: ny / len, z: nz / len }
      }
      row.push(vert)
    }
    rows.push(row)
  }
  addGrid(mesh, rows)
}

function cornerTravel(prev: Corner, curr: Corner): Axis {
  if (prev[0] !== curr[0]) return 'x'
  if (prev[1] !== curr[1]) return 'y'
  return 'z'
}

function facePoint(faceAxis: Axis, corner: Corner, rounded: ReadonlySet<BoxEdge>, rx: number, half: Record<Axis, number>): Vec3 {
  const [sx, sy, sz] = corner
  const inPlane = AXES.filter((axis) => axis !== faceAxis)
  const signs = { x: sx, y: sy, z: sz }
  const p = { x: 0, y: 0, z: 0 }
  for (const axis of AXES) {
    let inset = 0
    if (axis !== faceAxis) {
      const other = inPlane[0] === axis ? inPlane[1]! : inPlane[0]!
      if (rounded.has(edgeAlong(other, sx, sy, sz))) inset = rx
    }
    p[axis] = signs[axis] * (half[axis] - inset)
  }
  return p
}

/** 直角盒子在 rx 为 0 时不走这里。坐标以盒子中心为原点，y 向上。 */
export function roundedBoxGeometry(
  hw: number,
  hh: number,
  hd: number,
  rx: number,
  edges: readonly BoxEdge[],
): { positions: number[]; normals: number[]; indices: number[] } {
  const mesh: Builder = { positions: [], normals: [], indices: [] }
  const rounded = new Set(edges)
  const half = { x: hw, y: hh, z: hd }
  for (const face of FACES) {
    const normal = axisVec(face.axis, face.sign)
    const poly: Vec3[] = []
    const count = face.corners.length
    for (let i = 0; i < count; i++) {
      const prev = face.corners[(i + count - 1) % count]!
      const curr = face.corners[i]!
      const [sx, sy, sz] = curr
      const inPlane = AXES.filter((axis) => axis !== face.axis)
      const boundariesSharp = inPlane.every((axis) => !rounded.has(edgeAlong(axis, sx, sy, sz)))
      const perp = edgeAlong(face.axis, sx, sy, sz)
      if (rounded.has(perp) && boundariesSharp) {
        const edge = EDGE_BY_ID.get(perp)!
        const [a0, a1] = phiAxes(edge.axis)
        const travel = cornerTravel(prev, curr)
        const forward = travel === a1
        const t = (edge.axis === 'x' ? sx : edge.axis === 'y' ? sy : sz) * half[edge.axis]
        for (let k = 0; k <= FILLET_STEPS; k++) {
          const u = forward ? k / FILLET_STEPS : (FILLET_STEPS - k) / FILLET_STEPS
          poly.push(cylinderPoint(edge, t, u * (Math.PI / 2), rx, half).p)
        }
      } else {
        poly.push(facePoint(face.axis, curr, rounded, rx, half))
      }
    }
    addConvexFace(mesh, poly, normal)
  }
  for (const edge of EDGE_TABLE) {
    if (!rounded.has(edge.id)) continue
    const start = endKind(edge, -1, rounded)
    const end = endKind(edge, 1, rounded)
    const span = half[edge.axis]
    const t0 = start.kind === 'full' ? -span : -(span - rx)
    const t1 = end.kind === 'full' ? span : span - rx
    addPhiStrip(mesh, edge, t0, t1, rx, half)
    if (start.kind === 'trim') addTrim(mesh, edge, -1, start.keep, rx, half)
    if (end.kind === 'trim') addTrim(mesh, edge, 1, end.keep, rx, half)
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (!rounded.has(xEdge(sy, sz)) || !rounded.has(yEdge(sx, sz)) || !rounded.has(zEdge(sx, sy))) continue
        addSphere(mesh, sx, sy, sz, rx, half)
      }
    }
  }
  return mesh
}

function circleRing(y: number, radius: number, normalY: number): VN[] {
  const row: VN[] = []
  for (let i = 0; i <= CYLINDER_SEGMENTS; i++) {
    const theta = (i / CYLINDER_SEGMENTS) * Math.PI * 2
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    row.push({ p: { x: radius * ct, y, z: radius * st }, n: { x: ct, y: normalY, z: st } })
  }
  return row
}

/** 竖直圆柱。rx 圆掉选中的口，侧面半径仍是 radius。 */
export function roundedCylinderGeometry(
  radius: number,
  half: number,
  rx: number,
  rims: readonly CylinderRim[],
): { positions: number[]; normals: number[]; indices: number[] } {
  const mesh: Builder = { positions: [], normals: [], indices: [] }
  const top = rims.includes('top')
  const bottom = rims.includes('bottom')
  const y0 = bottom ? -half + rx : -half
  const y1 = top ? half - rx : half
  if (y1 - y0 > 1e-6) {
    addGrid(mesh, [circleRing(y1, radius, 0), circleRing(y0, radius, 0)])
  }
  const addSharpCap = (sign: number) => {
    const y = sign * half
    const normal = { x: 0, y: sign, z: 0 }
    addFan(mesh, { p: { x: 0, y, z: 0 }, n: normal }, circleRing(y, radius, sign))
  }
  const addRim = (sign: number) => {
    const yBase = sign * (half - rx)
    const rows: VN[][] = []
    for (let iy = 0; iy <= FILLET_STEPS; iy++) {
      const phi = (iy / FILLET_STEPS) * (Math.PI / 2)
      const row: VN[] = []
      const radial = radius - rx + rx * Math.cos(phi)
      const y = yBase + sign * rx * Math.sin(phi)
      for (let i = 0; i <= CYLINDER_SEGMENTS; i++) {
        const theta = (i / CYLINDER_SEGMENTS) * Math.PI * 2
        const ct = Math.cos(theta)
        const st = Math.sin(theta)
        row.push({
          p: { x: radial * ct, y, z: radial * st },
          n: { x: ct * Math.cos(phi), y: sign * Math.sin(phi), z: st * Math.cos(phi) },
        })
      }
      rows.push(row)
    }
    addGrid(mesh, rows)
    const capY = sign * half
    const capR = Math.max(0, radius - rx)
    const normal = { x: 0, y: sign, z: 0 }
    addFan(mesh, { p: { x: 0, y: capY, z: 0 }, n: normal }, circleRing(capY, capR, sign))
  }
  if (top) addRim(1)
  else addSharpCap(1)
  if (bottom) addRim(-1)
  else addSharpCap(-1)
  return mesh
}
