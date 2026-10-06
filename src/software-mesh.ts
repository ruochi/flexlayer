import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { solidPaint } from './gradient.js'
import { parseGlb } from './glb.js'
import { originOffset } from './matrix.js'
import { applyPoseMatrix, PERSPECTIVE_AA, resolveSamples } from './perspective.js'
import { tessellateSvgPath } from './path.js'
import type { LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'

type MeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

/**
 * 和 headless-three 并行的三角形光栅。
 * 投影用 `project` 的同一套公式（这里直接算），深度大的像素盖住深度小的。
 * 正对镜头的面是 fill，侧面按和 WebGL 着色器相同的两盏光变暗。
 * 主光沿固定方向打一张正交深度图：不透明三角形互相挡住这盏光时，主光不计。
 * glb 只用文件里的底色乘这套明暗；金属和粗糙度仍留在 WebGL 路径。
 */

const MAX_RASTER_SIDE = 8192

type Mat4 = number[]
type Pt = { x: number; y: number }

type RasterBitmap = {
  canvas: Canvas
  logicalWidth: number
  logicalHeight: number
  localX: number
  localY: number
}

export type SoftwareMeshInput = {
  layer: LayerLayoutNode
  perspective: number
  meshes: Array<{ node: MeshLayoutNode; toLayer: Mat4 }>
  planes: Array<{ node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }>
  scale: number
  raster: (node: LayoutNode) => RasterBitmap
}

type Batch = {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array | null
  indices: Uint32Array
  r: number
  g: number
  b: number
  a: number
  doubleSided: boolean
  shaded: boolean
  depthWrite: boolean
  texture: Uint8ClampedArray | null
  tw: number
  th: number
  toLayer: Mat4
  originX: number
  originY: number
}

type Vert = {
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
  u: number
  v: number
}

type ScreenVert = Vert & { sx: number; sy: number; invW: number }

const KEY = unit(-0.6, 0.85, 1)
const FILL_LIGHT = unit(0.75, -0.2, 0.45)
const LIT_FRONT = lit(0, 0, 1)
/** 主光在作者空间里指向光源的方向。three 的 y 向上，作者 y 向下，所以 y 取反。 */
const LIGHT_BASIS = lightBasis()

function unit(x: number, y: number, z: number) {
  const len = Math.hypot(x, y, z) || 1
  return { x: x / len, y: y / len, z: z / len }
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function lightBasis() {
  const toward = unit(KEY.x, -KEY.y, KEY.z)
  const hint = Math.abs(toward.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const side = cross(hint, toward)
  const right = unit(side.x, side.y, side.z)
  const up = cross(toward, right)
  return { toward, right, up }
}

function lit(x: number, y: number, z: number, blocked = false) {
  const key = blocked ? 0 : 0.85 * Math.max(x * KEY.x + y * KEY.y + z * KEY.z, 0)
  return 0.5 + key + 0.3 * Math.max(x * FILL_LIGHT.x + y * FILL_LIGHT.y + z * FILL_LIGHT.z, 0)
}

/** 作者空间的法线。背面把法线翻向镜头，和着色器里的 gl_FrontFacing 一样。 */
function facing(nx: number, ny: number, nz: number, back: boolean) {
  let x = nx
  let y = -ny
  let z = nz
  const len = Math.hypot(x, y, z) || 1
  x /= len
  y /= len
  z /= len
  if (back) {
    x = -x
    y = -y
    z = -z
  }
  return { x, y, z }
}

function shadeOf(nx: number, ny: number, nz: number, back: boolean, blocked = false) {
  const n = facing(nx, ny, nz, back)
  return Math.min(1, lit(n.x, n.y, n.z, blocked) / Math.max(LIT_FRONT, 1e-3))
}

/** 被主光挡住时，贴图按「去掉主光 / 完整光照」变暗。没挡住的像素不乘这个系数。 */
function shadowScale(nx: number, ny: number, nz: number, back: boolean) {
  const n = facing(nx, ny, nz, back)
  const open = lit(n.x, n.y, n.z, false)
  const shut = lit(n.x, n.y, n.z, true)
  return open > 1e-4 ? shut / open : 1
}

function byte(n: number) {
  if (n <= 0) return 0
  if (n >= 255) return 255
  return Math.round(n)
}

function fillBytes(fill: string, opacity: number): [number, number, number, number] {
  const solid = solidPaint(fill, '#808080')
  let r = 128
  let g = 128
  let b = 128
  let alpha = 1
  const hex8 = /^#([0-9a-f]{8})$/i.exec(solid)
  const hex6 = /^#([0-9a-f]{6})$/i.exec(solid)
  const hex4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(solid)
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(solid)
  const rgba = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,\s/]+([0-9.]+))?\s*\)$/i.exec(solid)
  if (hex8) {
    r = Number.parseInt(hex8[1]!.slice(0, 2), 16)
    g = Number.parseInt(hex8[1]!.slice(2, 4), 16)
    b = Number.parseInt(hex8[1]!.slice(4, 6), 16)
    alpha = Number.parseInt(hex8[1]!.slice(6, 8), 16) / 255
  } else if (hex6) {
    r = Number.parseInt(hex6[1]!.slice(0, 2), 16)
    g = Number.parseInt(hex6[1]!.slice(2, 4), 16)
    b = Number.parseInt(hex6[1]!.slice(4, 6), 16)
  } else if (hex4) {
    r = Number.parseInt(hex4[1]! + hex4[1], 16)
    g = Number.parseInt(hex4[2]! + hex4[2], 16)
    b = Number.parseInt(hex4[3]! + hex4[3], 16)
    alpha = Number.parseInt(hex4[4]! + hex4[4], 16) / 255
  } else if (hex3) {
    r = Number.parseInt(hex3[1]! + hex3[1], 16)
    g = Number.parseInt(hex3[2]! + hex3[2], 16)
    b = Number.parseInt(hex3[3]! + hex3[3], 16)
  } else if (rgba) {
    r = byte(Number(rgba[1]))
    g = byte(Number(rgba[2]))
    b = byte(Number(rgba[3]))
    alpha = rgba[4] != null ? Number(rgba[4]) : 1
  }
  return [r, g, b, byte(alpha * opacity * 255)]
}

function transformPoint(toLayer: Mat4, ox: number, oy: number, gx: number, gy: number, gz: number) {
  return applyPoseMatrix(toLayer, gx + ox, oy - gy, gz)
}

function transformNormal(toLayer: Mat4, nx: number, ny: number, nz: number) {
  const x = nx
  const y = -ny
  const z = nz
  return unit(
    toLayer[0]! * x + toLayer[4]! * y + toLayer[8]! * z,
    toLayer[1]! * x + toLayer[5]! * y + toLayer[9]! * z,
    toLayer[2]! * x + toLayer[6]! * y + toLayer[10]! * z,
  )
}

function signedArea(points: Pt[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    area += p.x * q.y - q.x * p.y
  }
  return area / 2
}

function dedupe(points: Pt[]) {
  const out: Pt[] = []
  for (const p of points) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-6) continue
    out.push(p)
  }
  if (out.length > 2) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) out.pop()
  }
  return out
}

function pointInRing(x: number, y: number, ring: Pt[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    const hit = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x
    if (hit) inside = !inside
  }
  return inside
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)
  const d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)
  const d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x)
  return ((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) && ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))
}

function pointInTri(p: Pt, a: Pt, b: Pt, c: Pt) {
  const c0 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  const c1 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x)
  const c2 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x)
  return c0 > 1e-8 && c1 > 1e-8 && c2 > 1e-8
}

function segmentInside(ring: number[], pts: Pt[], a: Pt, b: Pt) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const poly = ring.map((index) => pts[index]!)
  if (!pointInRing(mid.x, mid.y, poly)) return false
  for (let i = 0; i < ring.length; i++) {
    const c = pts[ring[i]!]!
    const d = pts[ring[(i + 1) % ring.length]!]!
    if (segmentsCross(a, b, c, d)) return false
  }
  return true
}

function bridge(pts: Pt[], outer: number[], hole: number[]) {
  let hi = 0
  for (let i = 1; i < hole.length; i++) if (pts[hole[i]!]!.x > pts[hole[hi]!]!.x) hi = i
  const h = pts[hole[hi]!]!
  let best = 0
  let bestD = Infinity
  let found = false
  for (let i = 0; i < outer.length; i++) {
    const p = pts[outer[i]!]!
    if (p.x < h.x - 1e-8) continue
    if (!segmentInside(outer, pts, h, p)) continue
    const d = (p.x - h.x) ** 2 + (p.y - h.y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
      found = true
    }
  }
  if (!found) {
    for (let i = 0; i < outer.length; i++) {
      const p = pts[outer[i]!]!
      const d = (p.x - h.x) ** 2 + (p.y - h.y) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
  }
  const merged: number[] = []
  for (let i = 0; i <= best; i++) merged.push(outer[i]!)
  for (let k = 0; k < hole.length; k++) merged.push(hole[(hi + k) % hole.length]!)
  merged.push(hole[hi]!)
  merged.push(outer[best]!)
  for (let i = best + 1; i < outer.length; i++) merged.push(outer[i]!)
  return merged
}

function earClip(pts: Pt[], ring: number[]) {
  const idx = ring.slice()
  const tris: number[] = []
  let guard = idx.length * idx.length + 8
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length]!
      const i1 = idx[i]!
      const i2 = idx[(i + 1) % idx.length]!
      const a = pts[i0]!
      const b = pts[i1]!
      const c = pts[i2]!
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      if (cross <= 1e-10) continue
      let ear = true
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue
        if (pointInTri(pts[j]!, a, b, c)) {
          ear = false
          break
        }
      }
      if (!ear) continue
      tris.push(i0, i1, i2)
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (idx.length === 3) tris.push(idx[0]!, idx[1]!, idx[2]!)
  return tris
}

function triangulate(outerIn: Pt[], holesIn: Pt[][]) {
  const pts: Pt[] = []
  const add = (points: Pt[]) => {
    const base = pts.length
    const ring = dedupe(points)
    for (const p of ring) pts.push(p)
    return ring.map((_, i) => base + i)
  }
  let outer = add(signedArea(outerIn) < 0 ? outerIn.slice().reverse() : outerIn)
  if (outer.length < 3) return { pts, tris: [] as number[] }
  for (const holeIn of holesIn) {
    const holePts = signedArea(holeIn) > 0 ? holeIn.slice().reverse() : holeIn
    const hole = add(holePts)
    if (hole.length >= 3) outer = bridge(pts, outer, hole)
  }
  return { pts, tris: earClip(pts, outer) }
}

function pushFace(
  positions: number[],
  normals: number[],
  indices: number[],
  verts: Array<[number, number, number]>,
  normal: [number, number, number],
) {
  const base = positions.length / 3
  for (const v of verts) {
    positions.push(v[0], v[1], v[2])
    normals.push(normal[0], normal[1], normal[2])
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function buildSphere(node: MeshLayoutNode) {
  if (node.mesh.type !== 'sphere') return null
  const widthSegments = 48
  const heightSegments = 32
  const radius = node.mesh.r
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let iy = 0; iy <= heightSegments; iy++) {
    const phi = (iy / heightSegments) * Math.PI
    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    for (let ix = 0; ix <= widthSegments; ix++) {
      const theta = (ix / widthSegments) * Math.PI * 2
      const x = -radius * Math.cos(theta) * sinPhi
      const y = radius * cosPhi
      const z = radius * Math.sin(theta) * sinPhi
      positions.push(x, y, z)
      normals.push(x / radius, y / radius, z / radius)
    }
  }
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * (widthSegments + 1) + ix
      const b = a + widthSegments + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const o = originOffset(node.origin, node.width, node.height)
  const tx = node.width / 2 - o.x
  const ty = -(node.height / 2 - o.y)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! += tx
    positions[i + 1]! += ty
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) }
}

function buildBox(node: MeshLayoutNode) {
  if (node.mesh.type !== 'box') return null
  const hw = node.width / 2
  const hh = node.height / 2
  const hd = node.mesh.depth / 2
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const faces: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
    { n: [0, 0, 1], v: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]] },
    { n: [0, 0, -1], v: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]] },
    { n: [1, 0, 0], v: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]] },
    { n: [-1, 0, 0], v: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]] },
    { n: [0, 1, 0], v: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]] },
    { n: [0, -1, 0], v: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]] },
  ]
  for (const face of faces) pushFace(positions, normals, indices, face.v, face.n)
  const o = originOffset(node.origin, node.width, node.height)
  const tx = node.width / 2 - o.x
  const ty = -(node.height / 2 - o.y)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! += tx
    positions[i + 1]! += ty
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) }
}

function orient(points: Pt[], ccw: boolean) {
  const area = signedArea(points)
  if (ccw && area < 0) return points.slice().reverse()
  if (!ccw && area > 0) return points.slice().reverse()
  return points
}

function buildExtrude(node: MeshLayoutNode) {
  if (node.mesh.type !== 'extrude') return null
  const o = originOffset(node.origin, node.width, node.height)
  const rings = tessellateSvgPath(node.mesh.d, 16, Math.PI / 24)
    .map((ring) => dedupe(ring.points.map((p) => ({ x: p.x - o.x, y: -(p.y - o.y) }))))
    .filter((points) => points.length >= 3 && Math.abs(signedArea(points)) > 1e-4)
  const items = rings.map((points) => ({ points, area: Math.abs(signedArea(points)), parent: -1 }))
  for (let i = 0; i < items.length; i++) {
    const sample = items[i]!.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
    sample.x /= items[i]!.points.length
    sample.y /= items[i]!.points.length
    let best = -1
    let bestArea = Infinity
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue
      const other = items[j]!
      if (other.area <= items[i]!.area + 1e-4 || other.area >= bestArea) continue
      if (pointInRing(sample.x, sample.y, other.points)) {
        best = j
        bestArea = other.area
      }
    }
    items[i]!.parent = best
  }
  const depthOf = (index: number) => {
    let depth = 0
    let parent = items[index]!.parent
    const seen = new Set<number>()
    while (parent >= 0 && !seen.has(parent)) {
      seen.add(parent)
      depth++
      parent = items[parent]!.parent
    }
    return depth
  }
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const half = node.mesh.depth / 2
  for (let i = 0; i < items.length; i++) {
    if (depthOf(i) % 2 !== 0) continue
    const holes: Pt[][] = []
    for (let h = 0; h < items.length; h++) {
      if (depthOf(h) % 2 !== 1) continue
      let parent = items[h]!.parent
      const seen = new Set<number>()
      while (parent >= 0 && !seen.has(parent) && depthOf(parent) % 2 !== 0) {
        seen.add(parent)
        parent = items[parent]!.parent
      }
      if (parent === i) holes.push(items[h]!.points)
    }
    const outer = orient(items[i]!.points, true)
    const holeRings = holes.map((ring) => orient(ring, false))
    const cap = triangulate(outer, holeRings)
    if (cap.tris.length < 3) continue
    const front = positions.length / 3
    for (const p of cap.pts) {
      positions.push(p.x, p.y, half)
      normals.push(0, 0, 1)
    }
    for (let t = 0; t < cap.tris.length; t += 3) indices.push(front + cap.tris[t]!, front + cap.tris[t + 1]!, front + cap.tris[t + 2]!)
    const back = positions.length / 3
    for (const p of cap.pts) {
      positions.push(p.x, p.y, -half)
      normals.push(0, 0, -1)
    }
    for (let t = 0; t < cap.tris.length; t += 3) indices.push(back + cap.tris[t]!, back + cap.tris[t + 2]!, back + cap.tris[t + 1]!)
    for (const ring of [outer, ...holeRings]) {
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e]!
        const b = ring[(e + 1) % ring.length]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy) || 1
        const nx = dy / len
        const ny = -dx / len
        pushFace(
          positions,
          normals,
          indices,
          [
            [a.x, a.y, -half],
            [b.x, b.y, -half],
            [b.x, b.y, half],
            [a.x, a.y, half],
          ],
          [nx, ny, 0],
        )
      }
    }
  }
  if (indices.length === 0) return null
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) }
}

function smoothNormals(positions: Float32Array, indices: Uint32Array) {
  const out = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3
    const ib = indices[i + 1]! * 3
    const ic = indices[i + 2]! * 3
    const ax = positions[ib]! - positions[ia]!
    const ay = positions[ib + 1]! - positions[ia + 1]!
    const az = positions[ib + 2]! - positions[ia + 2]!
    const bx = positions[ic]! - positions[ia]!
    const by = positions[ic + 1]! - positions[ia + 1]!
    const bz = positions[ic + 2]! - positions[ia + 2]!
    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx
    for (const at of [ia, ib, ic]) {
      out[at]! += nx
      out[at + 1]! += ny
      out[at + 2]! += nz
    }
  }
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.hypot(out[i]!, out[i + 1]!, out[i + 2]!) || 1
    out[i]! /= len
    out[i + 1]! /= len
    out[i + 2]! /= len
  }
  return out
}

function buildModel(node: MeshLayoutNode) {
  if (node.mesh.type !== 'model' || !node.mesh.file) return []
  let prims
  try {
    prims = parseGlb(readFileSync(node.mesh.file))
  } catch {
    return []
  }
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const prim of prims) {
    const src = prim.positions
    for (let i = 0; i < src.length; i += 3) {
      minX = Math.min(minX, src[i]!)
      minY = Math.min(minY, src[i + 1]!)
      minZ = Math.min(minZ, src[i + 2]!)
      maxX = Math.max(maxX, src[i]!)
      maxY = Math.max(maxY, src[i + 1]!)
      maxZ = Math.max(maxZ, src[i + 2]!)
    }
  }
  const sizeX = maxX - minX
  const sizeY = maxY - minY
  const sx = sizeX > 1e-6 ? node.width / sizeX : Infinity
  const sy = sizeY > 1e-6 ? node.height / sizeY : Infinity
  const s = Math.min(sx, sy)
  if (!Number.isFinite(s) || s <= 0) return []
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  const o = originOffset(node.origin, node.width, node.height)
  const shiftX = node.width / 2 - o.x
  const shiftY = -(node.height / 2 - o.y)
  const out: Array<{ positions: Float32Array; normals: Float32Array; indices: Uint32Array; color: [number, number, number, number]; doubleSided: boolean }> = []
  for (const prim of prims) {
    const src = prim.positions
    const positions = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      positions[i] = (src[i]! - cx) * s + shiftX
      positions[i + 1] = (src[i + 1]! - cy) * s + shiftY
      positions[i + 2] = (src[i + 2]! - cz) * s
    }
    const count = Math.floor(positions.length / 3)
    const indices = prim.indices ?? Uint32Array.from({ length: count - (count % 3) }, (_, i) => i)
    if (indices.length < 3) continue
    const normals = prim.normals && prim.normals.length === src.length ? prim.normals : smoothNormals(positions, indices)
    const color = prim.color
    out.push({
      positions,
      normals,
      indices,
      color: [
        byte(color[0] * 255),
        byte(color[1] * 255),
        byte(color[2] * 255),
        byte(color[3] * node.opacity * 255),
      ],
      doubleSided: prim.doubleSided,
    })
  }
  return out
}

function geometryOf(node: MeshLayoutNode) {
  if (node.mesh.type === 'sphere') return buildSphere(node)
  if (node.mesh.type === 'box') return buildBox(node)
  if (node.mesh.type === 'extrude') return buildExtrude(node)
  return null
}

function sampleTexture(data: Uint8ClampedArray, tw: number, th: number, u: number, v: number) {
  if (tw < 1 || th < 1) return [0, 0, 0, 0] as const
  const x = Math.min(Math.max(u, 0), 1) * Math.max(tw - 1, 0)
  const y = (1 - Math.min(Math.max(v, 0), 1)) * (th - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, tw - 1)
  const y1 = Math.min(y0 + 1, th - 1)
  const tx = x - x0
  const ty = y - y0
  const at = (ix: number, iy: number, channel: number) => data[(iy * tw + ix) * 4 + channel] ?? 0
  const mix = (channel: number) => {
    const top = at(x0, y0, channel) * (1 - tx) + at(x1, y0, channel) * tx
    const bot = at(x0, y1, channel) * (1 - tx) + at(x1, y1, channel) * tx
    return top * (1 - ty) + bot * ty
  }
  return [mix(0), mix(1), mix(2), mix(3)] as const
}

function lerpVert(a: Vert, b: Vert, z: number): Vert {
  const denom = b.z - a.z
  const t = Math.abs(denom) < 1e-8 ? 0 : (z - a.z) / denom
  const mix = (p: number, q: number) => p + (q - p) * t
  return {
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z,
    nx: mix(a.nx, b.nx),
    ny: mix(a.ny, b.ny),
    nz: mix(a.nz, b.nz),
    u: mix(a.u, b.u),
    v: mix(a.v, b.v),
  }
}

function clipNear(poly: Vert[], limit: number) {
  const out: Vert[] = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!
    const nxt = poly[(i + 1) % poly.length]!
    const curIn = cur.z < limit
    const nxtIn = nxt.z < limit
    if (curIn && nxtIn) out.push(nxt)
    else if (curIn && !nxtIn) out.push(lerpVert(cur, nxt, limit))
    else if (!curIn && nxtIn) {
      out.push(lerpVert(cur, nxt, limit))
      out.push(nxt)
    }
  }
  return out
}

type ShadowMap = {
  depth: Float32Array
  width: number
  height: number
  minU: number
  minV: number
  scaleU: number
  scaleV: number
  bias: number
  toward: { x: number; y: number; z: number }
  right: { x: number; y: number; z: number }
  up: { x: number; y: number; z: number }
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/** 主光正交深度图。离光源更近的不透明表面留下更大的深度。 */
function buildShadowMap(batches: Batch[], authored: Vert[][], pixels: number): ShadowMap | null {
  const { toward, right, up } = LIGHT_BASIS
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  let count = 0
  for (const verts of authored) {
    for (const v of verts) {
      const p = { x: v.x, y: v.y, z: v.z }
      minU = Math.min(minU, dot(p, right))
      minV = Math.min(minV, dot(p, up))
      maxU = Math.max(maxU, dot(p, right))
      maxV = Math.max(maxV, dot(p, up))
      count++
    }
  }
  if (count === 0 || !Number.isFinite(minU)) return null
  const pad = Math.max((maxU - minU) * 0.02, (maxV - minV) * 0.02, 1)
  minU -= pad
  maxU += pad
  minV -= pad
  maxV += pad
  const spanU = Math.max(maxU - minU, 1e-3)
  const spanV = Math.max(maxV - minV, 1e-3)
  const side = Math.max(64, Math.min(2048, Math.round(pixels)))
  const longest = Math.max(spanU, spanV)
  const width = Math.max(1, Math.round((side * spanU) / longest))
  const height = Math.max(1, Math.round((side * spanV) / longest))
  const depth = new Float32Array(width * height)
  depth.fill(-1e30)
  const scaleU = width / spanU
  const scaleV = height / spanV
  const toLight = (v: Vert): ScreenVert => {
    const p = { x: v.x, y: v.y, z: v.z }
    return {
      ...v,
      z: dot(p, toward),
      sx: (dot(p, right) - minU) * scaleU,
      sy: (dot(p, up) - minV) * scaleV,
      invW: 1,
    }
  }
  batches.forEach((batch, batchIndex) => {
    if (!batch.texture && batch.a < 128) return
    const verts = authored[batchIndex]!
    const indices = batch.indices
    for (let i = 0; i < indices.length; i += 3) {
      drawShadowTriangle(
        depth,
        width,
        height,
        toLight(verts[indices[i]!]!),
        toLight(verts[indices[i + 1]!]!),
        toLight(verts[indices[i + 2]!]!),
        batch,
      )
    }
  })
  const texel = Math.max(1 / scaleU, 1 / scaleV)
  return {
    depth,
    width,
    height,
    minU,
    minV,
    scaleU,
    scaleV,
    bias: texel * 2 + 0.35,
    toward,
    right,
    up,
  }
}

function drawShadowTriangle(
  map: Float32Array,
  width: number,
  height: number,
  a: ScreenVert,
  b: ScreenVert,
  c: ScreenVert,
  batch: Batch,
) {
  const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx)
  if (Math.abs(area) < 1e-6) return
  const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)))
  const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)))
  for (let iy = minY; iy <= maxY; iy++) {
    const py = iy + 0.5
    for (let ix = minX; ix <= maxX; ix++) {
      const px = ix + 0.5
      const w0 = ((b.sy - c.sy) * (px - c.sx) + (c.sx - b.sx) * (py - c.sy)) / area
      const w1 = ((c.sy - a.sy) * (px - c.sx) + (a.sx - c.sx) * (py - c.sy)) / area
      const w2 = 1 - w0 - w1
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue
      if (batch.texture) {
        const u = w0 * a.u + w1 * b.u + w2 * c.u
        const v = w0 * a.v + w1 * b.v + w2 * c.v
        if (sampleTexture(batch.texture, batch.tw, batch.th, u, v)[3] < 128) continue
      }
      const d = w0 * a.z + w1 * b.z + w2 * c.z
      const di = iy * width + ix
      if (d > map[di]!) map[di] = d
    }
  }
}

function occluded(map: ShadowMap, x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  const p = { x, y, z }
  const sx = (dot(p, map.right) - map.minU) * map.scaleU
  const sy = (dot(p, map.up) - map.minV) * map.scaleV
  const ix = Math.floor(sx)
  const iy = Math.floor(sy)
  if (ix < 0 || iy < 0 || ix >= map.width || iy >= map.height) return false
  const stored = map.depth[iy * map.width + ix]!
  if (stored < -1e20) return false
  const nlen = Math.hypot(nx, ny, nz) || 1
  const nd = Math.abs((nx * map.toward.x + ny * map.toward.y + nz * map.toward.z) / nlen)
  const bias = map.bias / Math.max(nd, 0.25)
  return stored > dot(p, map.toward) + bias
}

function drawTriangle(
  color: Uint8ClampedArray,
  depth: Float32Array,
  width: number,
  height: number,
  a: ScreenVert,
  b: ScreenVert,
  c: ScreenVert,
  batch: Batch,
  shadow: ShadowMap | null,
) {
  const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx)
  if (Math.abs(area) < 1e-8) return
  // y 向下的屏幕里，朝外的面（几何里逆时针、y 向上）面积为负。
  const back = area > 0
  if (back && !batch.doubleSided) return
  let minX = Math.floor(Math.min(a.sx, b.sx, c.sx))
  let maxX = Math.ceil(Math.max(a.sx, b.sx, c.sx))
  let minY = Math.floor(Math.min(a.sy, b.sy, c.sy))
  let maxY = Math.ceil(Math.max(a.sy, b.sy, c.sy))
  if (maxX < 0 || maxY < 0 || minX >= width || minY >= height) return
  if (minX < 0) minX = 0
  if (minY < 0) minY = 0
  if (maxX >= width) maxX = width - 1
  if (maxY >= height) maxY = height - 1
  for (let iy = minY; iy <= maxY; iy++) {
    const py = iy + 0.5
    for (let ix = minX; ix <= maxX; ix++) {
      const px = ix + 0.5
      const w0 = ((b.sy - c.sy) * (px - c.sx) + (c.sx - b.sx) * (py - c.sy)) / area
      const w1 = ((c.sy - a.sy) * (px - c.sx) + (a.sx - c.sx) * (py - c.sy)) / area
      const w2 = 1 - w0 - w1
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue
      const iw = w0 * a.invW + w1 * b.invW + w2 * c.invW
      if (iw <= 1e-8) continue
      const x = (w0 * a.x * a.invW + w1 * b.x * b.invW + w2 * c.x * c.invW) / iw
      const y = (w0 * a.y * a.invW + w1 * b.y * b.invW + w2 * c.y * c.invW) / iw
      const z = (w0 * a.z * a.invW + w1 * b.z * b.invW + w2 * c.z * c.invW) / iw
      const di = iy * width + ix
      if (z < depth[di]! - 1e-4) continue
      const nx = (w0 * a.nx * a.invW + w1 * b.nx * b.invW + w2 * c.nx * c.invW) / iw
      const ny = (w0 * a.ny * a.invW + w1 * b.ny * b.invW + w2 * c.ny * c.invW) / iw
      const nz = (w0 * a.nz * a.invW + w1 * b.nz * b.invW + w2 * c.nz * c.invW) / iw
      const blocked = shadow !== null && occluded(shadow, x, y, z, nx, ny, nz)
      let sr = batch.r
      let sg = batch.g
      let sb = batch.b
      let sa = batch.a
      if (batch.texture) {
        const u = (w0 * a.u * a.invW + w1 * b.u * b.invW + w2 * c.u * c.invW) / iw
        const v = (w0 * a.v * a.invW + w1 * b.v * b.invW + w2 * c.v * c.invW) / iw
        const tex = sampleTexture(batch.texture, batch.tw, batch.th, u, v)
        const dim = blocked ? shadowScale(nx, ny, nz, back) : 1
        sr = byte(tex[0] * dim)
        sg = byte(tex[1] * dim)
        sb = byte(tex[2] * dim)
        sa = tex[3]
      } else if (batch.shaded) {
        const shade = shadeOf(nx, ny, nz, back, blocked)
        sr = byte(batch.r * shade)
        sg = byte(batch.g * shade)
        sb = byte(batch.b * shade)
      } else if (blocked) {
        const dim = shadowScale(nx, ny, nz, back)
        sr = byte(batch.r * dim)
        sg = byte(batch.g * dim)
        sb = byte(batch.b * dim)
      }
      if (batch.depthWrite) depth[di] = z
      const pi = di * 4
      if (sa <= 0) continue
      if (sa >= 255 || color[pi + 3] === 0) {
        color[pi] = sr
        color[pi + 1] = sg
        color[pi + 2] = sb
        color[pi + 3] = sa
        continue
      }
      const inv = 255 - sa
      const dA = color[pi + 3]!
      const outA = sa + (dA * inv) / 255
      color[pi] = byte((sr * sa + color[pi]! * dA * inv / 255) / outA)
      color[pi + 1] = byte((sg * sa + color[pi + 1]! * dA * inv / 255) / outA)
      color[pi + 2] = byte((sb * sa + color[pi + 2]! * dA * inv / 255) / outA)
      color[pi + 3] = byte(outA)
    }
  }
}

function rasterize(batches: Batch[], layer: LayerLayoutNode, perspective: number, scale: number): MeshFrame {
  const vx = layer.width / 2
  const vy = layer.height / 2
  let minX = 0
  let minY = 0
  let maxX = layer.width
  let maxY = layer.height
  const authored: Vert[][] = []
  for (const batch of batches) {
    const verts: Vert[] = []
    const count = batch.positions.length / 3
    for (let i = 0; i < count; i++) {
      const p = transformPoint(batch.toLayer, batch.originX, batch.originY, batch.positions[i * 3]!, batch.positions[i * 3 + 1]!, batch.positions[i * 3 + 2]!)
      const n = transformNormal(batch.toLayer, batch.normals[i * 3]!, batch.normals[i * 3 + 1]!, batch.normals[i * 3 + 2]!)
      const u = batch.uvs ? batch.uvs[i * 2]! : 0
      const v = batch.uvs ? batch.uvs[i * 2 + 1]! : 0
      verts.push({ x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z, u, v })
      if (p.z < perspective * (1 - 1e-3)) {
        const w = 1 - p.z / perspective
        const x = vx + (p.x - vx) / w
        const y = vy + (p.y - vy) / w
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    authored.push(verts)
  }
  let padL = Math.max(0, -minX)
  let padT = Math.max(0, -minY)
  let padR = Math.max(0, maxX - layer.width)
  let padB = Math.max(0, maxY - layer.height)
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
  const base = Math.max(scale, 1e-3)
  const maxSide = MAX_RASTER_SIDE / base
  let viewW = layer.width + padL + padR
  let viewH = layer.height + padT + padB
  if (viewW > maxSide || viewH > maxSide) {
    const sx = padL + padR > 0 ? Math.max(0, (maxSide - layer.width) / (padL + padR)) : 1
    const sy = padT + padB > 0 ? Math.max(0, (maxSide - layer.height) / (padT + padB)) : 1
    const fit = Math.min(1, sx, sy)
    padL *= fit
    padR *= fit
    padT *= fit
    padB *= fit
    viewW = layer.width + padL + padR
    viewH = layer.height + padT + padB
  }
  let samples = PERSPECTIVE_AA
  while (samples > 1 && (viewW * base * samples > MAX_RASTER_SIDE || viewH * base * samples > MAX_RASTER_SIDE)) samples /= 2
  const pixelScale = base * samples
  const pw = Math.max(1, Math.round(viewW * pixelScale))
  const ph = Math.max(1, Math.round(viewH * pixelScale))
  const color = new Uint8ClampedArray(pw * ph * 4)
  const depth = new Float32Array(pw * ph)
  depth.fill(-1e30)
  const shadow = buildShadowMap(batches, authored, Math.max(layer.width, layer.height) * base * 2)
  const near = perspective * (1 - 1e-3)
  const toScreen = (v: Vert): ScreenVert => {
    const w = 1 - v.z / perspective
    return {
      ...v,
      sx: (vx + (v.x - vx) / w + padL) * pixelScale,
      sy: (vy + (v.y - vy) / w + padT) * pixelScale,
      invW: 1 / w,
    }
  }
  batches.forEach((batch, batchIndex) => {
    const verts = authored[batchIndex]!
    const indices = batch.indices
    for (let i = 0; i < indices.length; i += 3) {
      const tri = [verts[indices[i]!]!, verts[indices[i + 1]!]!, verts[indices[i + 2]!]!]
      const clipped = clipNear(tri, near)
      for (let k = 1; k < clipped.length - 1; k++) {
        const a = clipped[0]!
        const b = clipped[k]!
        const c = clipped[k + 1]!
        drawTriangle(color, depth, pw, ph, toScreen(a), toScreen(b), toScreen(c), batch, shadow)
      }
    }
  })
  const hi = createCanvas(pw, ph)
  const image = hi.getContext('2d').createImageData(pw, ph)
  image.data.set(color)
  hi.getContext('2d').putImageData(image, 0, 0)
  const outW = Math.max(1, Math.round(viewW * base))
  const outH = Math.max(1, Math.round(viewH * base))
  const out = hi.width >= outW && hi.height >= outH ? resolveSamples(hi, outW, outH) : hi
  return { canvas: out, x: -padL, y: -padT, width: viewW, height: viewH }
}

function planeBatch(plane: SoftwareMeshInput['planes'][number], raster: SoftwareMeshInput['raster']): Batch | null {
  const painted = raster(plane.peeled)
  if (painted.logicalWidth <= 0 || painted.logicalHeight <= 0) return null
  const pixels = painted.canvas.getContext('2d').getImageData(0, 0, painted.canvas.width, painted.canvas.height)
  const o = originOffset(plane.node.origin, plane.node.width, plane.node.height)
  const { localX, localY } = painted
  const corners: Array<[number, number]> = [
    [localX, localY],
    [localX + painted.logicalWidth, localY],
    [localX + painted.logicalWidth, localY + painted.logicalHeight],
    [localX, localY + painted.logicalHeight],
  ]
  // 作者空间 y 向下，正面（法线朝镜头）的屏幕面积为负，和网格的 back 判定一致。
  const order = [0, 2, 1, 0, 3, 2]
  const positions = new Float32Array(order.length * 3)
  const uvs = new Float32Array(order.length * 2)
  const normals = new Float32Array(order.length * 3)
  order.forEach((corner, slot) => {
    const [u, v] = corners[corner]!
    positions[slot * 3] = u - o.x
    positions[slot * 3 + 1] = -(v - o.y)
    positions[slot * 3 + 2] = 0
    uvs[slot * 2] = (u - localX) / painted.logicalWidth
    uvs[slot * 2 + 1] = 1 - (v - localY) / painted.logicalHeight
    normals[slot * 3 + 2] = 1
  })
  return {
    positions,
    normals,
    uvs,
    indices: Uint32Array.from(order.map((_, i) => i)),
    r: 255,
    g: 255,
    b: 255,
    a: 255,
    doubleSided: true,
    shaded: false,
    depthWrite: true,
    texture: pixels.data,
    tw: painted.canvas.width,
    th: painted.canvas.height,
    toLayer: plane.toLayer,
    originX: o.x,
    originY: o.y,
  }
}

export function renderMeshSoftware(input: SoftwareMeshInput): MeshFrame {
  const { layer, perspective, meshes, planes, scale, raster } = input
  const batches: Batch[] = []
  for (const instance of meshes) {
    const node = instance.node
    if (node.width <= 0 && node.mesh.type !== 'extrude') continue
    const o = originOffset(node.origin, node.width, node.height)
    if (applyPoseMatrix(instance.toLayer, o.x, o.y, 0).z >= perspective) continue
    if (node.mesh.type === 'model') {
      for (const prim of buildModel(node)) {
        batches.push({
          positions: prim.positions,
          normals: prim.normals,
          uvs: null,
          indices: prim.indices,
          r: prim.color[0],
          g: prim.color[1],
          b: prim.color[2],
          a: prim.color[3],
          doubleSided: prim.doubleSided,
          shaded: true,
          depthWrite: prim.color[3] >= 255,
          texture: null,
          tw: 0,
          th: 0,
          toLayer: instance.toLayer,
          originX: o.x,
          originY: o.y,
        })
      }
      continue
    }
    const geometry = geometryOf(node)
    if (!geometry) continue
    const [r, g, b, a] = fillBytes(node.fill, node.opacity)
    batches.push({
      positions: geometry.positions,
      normals: geometry.normals,
      uvs: null,
      indices: geometry.indices,
      r,
      g,
      b,
      a,
      doubleSided: node.mesh.type === 'extrude',
      shaded: true,
      depthWrite: a >= 255,
      texture: null,
      tw: 0,
      th: 0,
      toLayer: instance.toLayer,
      originX: o.x,
      originY: o.y,
    })
  }
  for (const plane of planes) {
    const batch = planeBatch(plane, raster)
    if (batch) batches.push(batch)
  }
  return rasterize(batches, layer, perspective, scale)
}
