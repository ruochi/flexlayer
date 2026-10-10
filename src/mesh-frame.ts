import { collectMeshInstances } from './mesh.js'
import { originOffset } from './matrix.js'
import { applyPoseMatrix } from './perspective.js'
import { serializeSvgPath } from './path.js'
import {
  layerSphere,
  meshEdges,
  meshPrims,
  meshWritesDepth,
  sphereRing,
  transformNormal,
  transformPoint,
  type MeshEdge,
} from './software-mesh.js'
import type { LayerLayoutNode } from './types.js'

/**
 * 透视里的网格，投影到和 `box` 同一套坐标之后才有。
 * 看得见的点带 `visible`，被挡住的带 `hidden`。观众身后的点不在这里。
 */
export type MeshPoint = {
  x: number
  y: number
  visible?: true
  hidden?: true
}

export type MeshEdgeKind = 'outline' | 'crease' | 'hidden'

/** `a`、`b` 是 `points` 的下标。轮廓优先于折棱；被挡住的整条棱都是 `hidden`。 */
export type MeshProjectedEdge = {
  a: number
  b: number
  kind: MeshEdgeKind
}

type Point = { x: number; y: number; z: number }

type RawEdge = {
  a: Point
  b: Point
  crease: boolean
  silhouette: boolean
}

type Tri = { p: [Point, Point, Point]; owner: number; doubleSided: boolean }

type Prepared = {
  path: string
  owner: number
  edges: RawEdge[]
  /** 均匀球的轮廓采样。不是球时没有。 */
  ring: Point[] | null
}

/** 投影还在相机这一层的局部像素里，调用方再乘上嵌套层的位置和缩放。 */
export type LocalMeshFrame = {
  points: Array<{ x: number; y: number; hidden: boolean }>
  edges: Array<{ a: number; b: number; kind: MeshEdgeKind }>
  ring: Array<{ x: number; y: number; hidden: boolean } | null> | null
}

type DepthMap = {
  depth: Float32Array
  owners: Int16Array
  pw: number
  ph: number
  padL: number
  padT: number
  scale: number
  vx: number
  vy: number
  perspective: number
}

const BIAS = 1.5
const MAX_SIDE = 1024

function quant(n: number) {
  return Math.round(n * 1e3)
}

function weldKey(p: Point) {
  return `${quant(p.x)},${quant(p.y)},${quant(p.z)}`
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

function lerp(a: Point, b: Point, z: number): Point {
  const denom = b.z - a.z
  const t = Math.abs(denom) < 1e-8 ? 0 : (z - a.z) / denom
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z }
}

function inFront(p: Point, perspective: number) {
  return p.z < perspective * (1 - 1e-3)
}

function project(p: Point, vx: number, vy: number, perspective: number): { x: number; y: number } | null {
  const w = 1 - p.z / perspective
  if (w <= 1e-4) return null
  return { x: vx + (p.x - vx) / w, y: vy + (p.y - vy) / w }
}

function facesCamera(normal: [number, number, number], toLayer: number[], mid: Point, vx: number, vy: number, perspective: number) {
  const n = transformNormal(toLayer, normal[0], normal[1], normal[2])
  return n.x * (vx - mid.x) + n.y * (vy - mid.y) + n.z * (perspective - mid.z) > 1e-4
}

function silhouetteOf(edge: MeshEdge, a: Point, b: Point, toLayer: number[], vx: number, vy: number, perspective: number) {
  const mid = midpoint(a, b)
  const front0 = facesCamera(edge.n0, toLayer, mid, vx, vy, perspective)
  if (!edge.n1) return front0
  return front0 !== facesCamera(edge.n1, toLayer, mid, vx, vy, perspective)
}

function clipPoly(poly: Point[], limit: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!
    const nxt = poly[(i + 1) % poly.length]!
    const curIn = cur.z < limit
    const nxtIn = nxt.z < limit
    if (curIn && nxtIn) out.push(nxt)
    else if (curIn && !nxtIn) out.push(lerp(cur, nxt, limit))
    else if (!curIn && nxtIn) {
      out.push(lerp(cur, nxt, limit))
      out.push(nxt)
    }
  }
  return out
}

function screenOf(map: DepthMap, p: Point): { sx: number; sy: number; invW: number } | null {
  const w = 1 - p.z / map.perspective
  if (w <= 1e-4) return null
  return {
    sx: (map.vx + (p.x - map.vx) / w + map.padL) * map.scale,
    sy: (map.vy + (p.y - map.vy) / w + map.padT) * map.scale,
    invW: 1 / w,
  }
}

function drawDepth(map: DepthMap, a: Point, b: Point, c: Point, owner: number, doubleSided: boolean) {
  const sa = screenOf(map, a)
  const sb = screenOf(map, b)
  const sc = screenOf(map, c)
  if (!sa || !sb || !sc) return
  const area = (sb.sx - sa.sx) * (sc.sy - sa.sy) - (sb.sy - sa.sy) * (sc.sx - sa.sx)
  if (Math.abs(area) < 1e-8) return
  if (area > 0 && !doubleSided) return
  let minX = Math.floor(Math.min(sa.sx, sb.sx, sc.sx))
  let maxX = Math.ceil(Math.max(sa.sx, sb.sx, sc.sx))
  let minY = Math.floor(Math.min(sa.sy, sb.sy, sc.sy))
  let maxY = Math.ceil(Math.max(sa.sy, sb.sy, sc.sy))
  if (maxX < 0 || maxY < 0 || minX >= map.pw || minY >= map.ph) return
  if (minX < 0) minX = 0
  if (minY < 0) minY = 0
  if (maxX >= map.pw) maxX = map.pw - 1
  if (maxY >= map.ph) maxY = map.ph - 1
  const e0x = (sb.sy - sc.sy) / area
  const e0y = (sc.sx - sb.sx) / area
  const e1x = (sc.sy - sa.sy) / area
  const e1y = (sa.sx - sc.sx) / area
  for (let iy = minY; iy <= maxY; iy++) {
    const py = iy + 0.5
    let w0 = e0x * (minX + 0.5 - sc.sx) + e0y * (py - sc.sy)
    let w1 = e1x * (minX + 0.5 - sc.sx) + e1y * (py - sc.sy)
    for (let ix = minX; ix <= maxX; ix++) {
      const w2 = 1 - w0 - w1
      if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
        const iw = w0 * sa.invW + w1 * sb.invW + w2 * sc.invW
        if (iw > 1e-8) {
          const z = (w0 * a.z * sa.invW + w1 * b.z * sb.invW + w2 * c.z * sc.invW) / iw
          const di = iy * map.pw + ix
          if (z >= map.depth[di]! - 1e-4) {
            map.depth[di] = z
            map.owners[di] = owner
          }
        }
      }
      w0 += e0x
      w1 += e1x
    }
  }
}

function buildDepth(
  tris: Tri[],
  extra: Point[],
  width: number,
  height: number,
  perspective: number,
): DepthMap {
  const vx = width / 2
  const vy = height / 2
  let minX = 0
  let minY = 0
  let maxX = width
  let maxY = height
  const consider = (p: Point) => {
    const q = project(p, vx, vy, perspective)
    if (!q) return
    minX = Math.min(minX, q.x)
    minY = Math.min(minY, q.y)
    maxX = Math.max(maxX, q.x)
    maxY = Math.max(maxY, q.y)
  }
  for (const tri of tris) for (const p of tri.p) consider(p)
  for (const p of extra) consider(p)
  let padL = Math.max(0, -minX)
  let padT = Math.max(0, -minY)
  let padR = Math.max(0, maxX - width)
  let padB = Math.max(0, maxY - height)
  if (padL + padT + padR + padB > 0.5) {
    padL = Math.ceil(padL + 1)
    padT = Math.ceil(padT + 1)
    padR = Math.ceil(padR + 1)
    padB = Math.ceil(padB + 1)
  } else {
    padL = 0
    padT = 0
    padR = 0
    padB = 0
  }
  const viewW = width + padL + padR
  const viewH = height + padT + padB
  const scale = Math.min(1, MAX_SIDE / Math.max(viewW, viewH, 1))
  const pw = Math.max(1, Math.round(viewW * scale))
  const ph = Math.max(1, Math.round(viewH * scale))
  const depth = new Float32Array(pw * ph)
  const owners = new Int16Array(pw * ph)
  depth.fill(-1e30)
  owners.fill(-1)
  const map: DepthMap = { depth, owners, pw, ph, padL, padT, scale, vx, vy, perspective }
  const near = perspective * (1 - 1e-3)
  for (const tri of tris) {
    const clipped = clipPoly(tri.p, near)
    for (let k = 1; k < clipped.length - 1; k++) {
      drawDepth(map, clipped[0]!, clipped[k]!, clipped[k + 1]!, tri.owner, tri.doubleSided)
    }
  }
  return map
}

/** 比表面上的深度更近才算挡住。轮廓贴着自己的表面时仍算看得见。 */
function occluded(map: DepthMap, p: Point, owner: number, outline: boolean): boolean {
  const s = screenOf(map, p)
  if (!s) return true
  const ix = Math.round(s.sx)
  const iy = Math.round(s.sy)
  if (ix < 0 || iy < 0 || ix >= map.pw || iy >= map.ph) return false
  const di = iy * map.pw + ix
  const stored = map.depth[di]!
  if (stored < -1e20 || stored <= p.z + BIAS) return false
  if (map.owners[di] !== owner) return true
  return !outline
}

function prepare(layer: LayerLayoutNode, perspective: number): { meshes: Prepared[]; tris: Tri[]; extra: Point[] } {
  const vx = layer.width / 2
  const vy = layer.height / 2
  const meshes: Prepared[] = []
  const tris: Tri[] = []
  const extra: Point[] = []
  let nextOwner = 1
  for (const instance of collectMeshInstances(layer)) {
    const node = instance.node
    if (node.width <= 0 && node.mesh.type !== 'extrude') continue
    const origin = originOffset(node.origin, node.width, node.height)
    if (applyPoseMatrix(instance.toLayer, origin.x, origin.y, 0).z >= perspective) continue
    const owner = nextOwner++
    const opacity = instance.opacity * node.opacity
    const sphere = layerSphere(node, instance.toLayer)
    const edges: RawEdge[] = []
    const seen = new Set<string>()
    for (const prim of meshPrims(node)) {
      const count = prim.positions.length / 3
      const verts: Point[] = []
      for (let i = 0; i < count; i++) {
        verts.push(
          transformPoint(
            instance.toLayer,
            origin.x,
            origin.y,
            prim.positions[i * 3]!,
            prim.positions[i * 3 + 1]!,
            prim.positions[i * 3 + 2]!,
          ),
        )
      }
      if (meshWritesDepth(node, opacity, prim.alpha)) {
        const index = prim.indices
        for (let i = 0; i < index.length; i += 3) {
          const a = verts[index[i]!]
          const b = verts[index[i + 1]!]
          const c = verts[index[i + 2]!]
          if (!a || !b || !c) continue
          tris.push({ p: [a, b, c], owner, doubleSided: prim.doubleSided })
        }
      }
      if (sphere) continue
      for (const edge of meshEdges(prim.positions, prim.indices)) {
        const a = verts[edge.a]
        const b = verts[edge.b]
        if (!a || !b) continue
        const silhouette = silhouetteOf(edge, a, b, instance.toLayer, vx, vy, perspective)
        if (!edge.crease && !silhouette) continue
        const ka = weldKey(a)
        const kb = weldKey(b)
        if (ka === kb) continue
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ a, b, crease: edge.crease, silhouette })
        extra.push(a, b)
      }
    }
    let ring: Point[] | null = null
    if (sphere) {
      const samples = sphereRing(sphere, sphere.radius, vx, vy, perspective)
      if (samples) {
        ring = samples.map((sample) => ({ x: sample.x, y: sample.y, z: sample.z }))
        extra.push(...ring)
      }
    }
    if (edges.length > 0 || ring) meshes.push({ path: node.path, owner, edges, ring })
  }
  return { meshes, tris, extra }
}

function emitFrame(mesh: Prepared, map: DepthMap): LocalMeshFrame {
  const points: LocalMeshFrame['points'] = []
  const edges: LocalMeshFrame['edges'] = []
  const indexOf = new Map<string, number>()
  const keep = (p: Point): number | null => {
    if (!inFront(p, map.perspective)) return null
    const xy = project(p, map.vx, map.vy, map.perspective)
    if (!xy) return null
    const key = weldKey(p)
    const found = indexOf.get(key)
    if (found != null) return found
    const id = points.length
    points.push({ x: xy.x, y: xy.y, hidden: occluded(map, p, mesh.owner, false) })
    indexOf.set(key, id)
    return id
  }
  for (const edge of mesh.edges) {
    let a = edge.a
    let b = edge.b
    const aIn = inFront(a, map.perspective)
    const bIn = inFront(b, map.perspective)
    if (!aIn && !bIn) continue
    if (!aIn || !bIn) {
      const clipped = lerp(a, b, map.perspective * (1 - 1e-3))
      if (!aIn) a = clipped
      else b = clipped
    }
    const ia = keep(a)
    const ib = keep(b)
    if (ia == null || ib == null || ia === ib) continue
    const mid = midpoint(a, b)
    const hidden = occluded(map, mid, mesh.owner, !edge.crease && edge.silhouette)
    const kind: MeshEdgeKind = hidden ? 'hidden' : edge.silhouette ? 'outline' : 'crease'
    edges.push({ a: ia, b: ib, kind })
  }
  let ring: LocalMeshFrame['ring'] = null
  if (mesh.ring) {
    ring = mesh.ring.map((sample) => {
      const xy = project(sample, map.vx, map.vy, map.perspective)
      if (!xy) return null
      return { x: xy.x, y: xy.y, hidden: occluded(map, sample, mesh.owner, true) }
    })
  }
  return { points, edges, ring }
}

/**
 * 这一层相机里每只网格的投影。键是布局路径。
 * 不在这台相机里的网格没有记录。填充不在这里做。
 */
export function projectMeshFrames(layer: LayerLayoutNode): Map<string, LocalMeshFrame> {
  const out = new Map<string, LocalMeshFrame>()
  const perspective = layer.perspective
  if (perspective == null || perspective <= 0 || layer.width <= 0 || layer.height <= 0) return out
  const { meshes, tris, extra } = prepare(layer, perspective)
  if (meshes.length === 0) return out
  const depth = buildDepth(tris, extra, layer.width, layer.height, perspective)
  for (const mesh of meshes) out.set(mesh.path, emitFrame(mesh, depth))
  return out
}

function mark(x: number, y: number, hidden: boolean): MeshPoint {
  return hidden ? { x, y, hidden: true as const } : { x, y, visible: true as const }
}

function outlineCommands(points: MeshPoint[], edges: MeshProjectedEdge[]): Array<{ op: string; args: number[] }> {
  const segs = edges.filter((edge) => edge.kind === 'outline')
  const adj = new Map<number, number[]>()
  const add = (vertex: number, index: number) => {
    const list = adj.get(vertex)
    if (list) list.push(index)
    else adj.set(vertex, [index])
  }
  segs.forEach((edge, index) => {
    add(edge.a, index)
    add(edge.b, index)
  })
  const used = new Array<boolean>(segs.length).fill(false)
  const commands: Array<{ op: string; args: number[] }> = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = true
    const chain = [segs[i]!.a, segs[i]!.b]
    let closed = false
    const grow = (forward: boolean) => {
      for (;;) {
        const tip = forward ? chain[chain.length - 1]! : chain[0]!
        const nextEdge = (adj.get(tip) ?? []).find((index) => !used[index])
        if (nextEdge == null) return
        const edge = segs[nextEdge]!
        const next = edge.a === tip ? edge.b : edge.a
        if (forward && next === chain[0]) {
          used[nextEdge] = true
          closed = true
          return
        }
        used[nextEdge] = true
        if (forward) chain.push(next)
        else chain.unshift(next)
      }
    }
    grow(true)
    if (!closed) grow(false)
    if (chain.length < 2) continue
    chain.forEach((index, at) => {
      const point = points[index]!
      commands.push({ op: at === 0 ? 'M' : 'L', args: [point.x, point.y] })
    })
    if (closed) commands.push({ op: 'Z', args: [] })
  }
  return commands
}

function ringCommands(samples: Array<MeshPoint | null>): Array<{ op: string; args: number[] }> {
  const visible = samples.map((sample) => sample?.visible === true)
  if (visible.length > 2 && visible.every(Boolean)) {
    const commands = samples.map((sample, index) => ({
      op: index === 0 ? 'M' : 'L',
      args: [sample!.x, sample!.y],
    }))
    commands.push({ op: 'Z', args: [] })
    return commands
  }
  const runs: MeshPoint[][] = []
  let run: MeshPoint[] = []
  const flush = () => {
    if (run.length >= 2) runs.push(run)
    run = []
  }
  samples.forEach((sample) => {
    if (sample?.visible) run.push(sample)
    else flush()
  })
  flush()
  if (runs.length >= 2 && visible[0] && visible[visible.length - 1]) {
    const first = runs[0]!
    const last = runs.pop()!
    runs[0] = last.concat(first)
  }
  const commands: Array<{ op: string; args: number[] }> = []
  for (const points of runs) {
    points.forEach((point, index) => {
      commands.push({ op: index === 0 ? 'M' : 'L', args: [point.x, point.y] })
    })
  }
  return commands
}

/** 把相机局部坐标变到 `elements` 那一套，并串出看得见的轮廓。 */
export function placeMeshFrame(
  frame: LocalMeshFrame,
  map: (x: number, y: number) => { x: number; y: number },
): { points?: MeshPoint[]; edges?: MeshProjectedEdge[]; d?: string } {
  const points = frame.points.map((point) => {
    const xy = map(point.x, point.y)
    return mark(xy.x, xy.y, point.hidden)
  })
  const edges = frame.edges
  const commands = frame.ring
    ? ringCommands(
        frame.ring.map((sample) => {
          if (!sample) return null
          const xy = map(sample.x, sample.y)
          return mark(xy.x, xy.y, sample.hidden)
        }),
      )
    : outlineCommands(points, edges)
  const d = commands.length > 0 ? serializeSvgPath(commands) : undefined
  const placed: { points?: MeshPoint[]; edges?: MeshProjectedEdge[]; d?: string } = {}
  if (!frame.ring && points.length > 0) {
    placed.points = points
    placed.edges = edges
  }
  if (d) placed.d = d
  return placed
}
