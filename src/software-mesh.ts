import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { studioAt } from './env-map.js'
import { solidPaint } from './gradient.js'
import { parseGlb } from './glb.js'
import { originOffset } from './matrix.js'
import { applyPoseMatrix, PERSPECTIVE_AA, resolveSamples } from './perspective.js'
import { roundedBoxGeometry, roundedCylinderGeometry } from './mesh-round.js'
import { tessellateSvgPath } from './path.js'
import type { LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'

type MeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

/**
 * 网格的三角形光栅。
 * 投影用 `project` 的同一套公式（这里直接算），深度大的像素盖住深度小的。
 * 正对镜头的面是 fill，侧面按内置主光和补光变暗。
 * 主光沿固定方向打一张正交深度图：不透明三角形互相挡住这盏光时，主光不计。
 * glb 用文件里的底色乘这套明暗。
 * 写了 stroke 时，缩小抗锯齿之后再按屏幕像素描折棱和轮廓。
 * hidden 只画被这只网格自己挡住的棱，虚线是 6 实 4 空。
 * 不写 material 时是磨砂：主光乘 fill。plastic 加高光，metal 和 glass 映一张横向的工作室环境，glass 后画叠色。
 * 同一条折线上的短段接成一条再取虚线相位，圆弧不会接成实线。
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
  meshes: Array<{ node: MeshLayoutNode; toLayer: Mat4; opacity?: number }>
  planes: Array<{ node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }>
  scale: number
  raster: (node: LayoutNode) => RasterBitmap
}

type MeshEdge = {
  a: number
  b: number
  n0: [number, number, number]
  n1: [number, number, number] | null
  crease: boolean
}

type LineStyle = {
  css: string
  hiddenCss: string | null
  /** 屏幕像素：轮廓、折棱、隐藏线。 */
  widths: [number, number, number]
  halo: number
}

/** 球心在网格坐标里。半径均匀时画解析轮廓，否则退回三角网的轮廓边。 */
type SphereOutline = { x: number; y: number; z: number; r: number }

const NO_EDGES: MeshEdge[] = []
/** 相邻面法线夹角超过这个值才算折棱。圆弧细分不会变成笼子。 */
const CREASE_DOT = Math.cos((40 * Math.PI) / 180)

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
  /** lambert 是默认磨砂（matte）和平面的明暗。glass 不写主光阴影，半透明时不写深度。 */
  material: 'lambert' | 'plastic' | 'metal' | 'glass'
  roughness: number
  texture: Uint8ClampedArray | null
  tw: number
  th: number
  toLayer: Mat4
  originX: number
  originY: number
  /** 同一只网格的图元共用，用来区分「自己挡住」和「别的物体挡住」。 */
  owner: number
  edges: MeshEdge[]
  lines: LineStyle | null
  outline: SphereOutline | null
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

function clamp01(n: number) {
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function shininess(roughness: number) {
  return 2 ** (8 * (1 - clamp01(roughness)))
}

function shadeNormal(nx: number, ny: number, nz: number, back: boolean) {
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

function reflectView(v: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }) {
  const d = v.x * n.x + v.y * n.y + v.z * n.z
  return unit(2 * d * n.x - v.x, 2 * d * n.y - v.y, 2 * d * n.z - v.z)
}

type ShadeCamera = { x: number; y: number; z: number }

/** 塑料加白高光。金属用 fill 给工作室环境染色。玻璃边缘映出同一张环境，中心透出底下。 */
function materialBytes(
  batch: Batch,
  nx: number,
  ny: number,
  nz: number,
  back: boolean,
  shade: number,
  blocked: boolean,
  x: number,
  y: number,
  z: number,
  camera: ShadeCamera,
): [number, number, number, number] {
  const n = shadeNormal(nx, ny, nz, back)
  const v = unit(camera.x - x, y - camera.y, camera.z - z)
  const h = unit(KEY.x + v.x, KEY.y + v.y, KEY.z + v.z)
  const ndoth = Math.max(n.x * h.x + n.y * h.y + n.z * h.z, 0)
  const spec = blocked ? 0 : ndoth ** shininess(batch.roughness)
  if (batch.material === 'plastic') {
    const add = spec * 255 * 0.95
    return [
      byte(Math.min(255, batch.r * shade + add)),
      byte(Math.min(255, batch.g * shade + add)),
      byte(Math.min(255, batch.b * shade + add)),
      batch.a,
    ]
  }
  const reflect = reflectView(v, n)
  const env = studioAt(reflect.x, reflect.y, reflect.z, batch.roughness)
  const envR = env.r
  const envG = env.g
  const envB = env.b
  if (batch.material === 'metal') {
    const ndotv = clamp01(n.x * v.x + n.y * v.y + n.z * v.z)
    const fres = (1 - ndotv) ** 5
    const exposure = blocked ? 0.32 : 0.5 + 0.5 * Math.min(1, shade)
    const specAdd = spec * 220
    const tint = (channel: number, envC: number) => {
      const f = channel / 255
      return Math.min(255, (f + (1 - f) * fres) * envC * exposure + specAdd * (0.25 + 0.75 * f))
    }
    return [byte(tint(batch.r, envR)), byte(tint(batch.g, envG)), byte(tint(batch.b, envB)), batch.a]
  }
  const ndotv = clamp01(n.x * v.x + n.y * v.y + n.z * v.z)
  const edge = (1 - ndotv) ** 2.2
  const body = batch.a / 255
  const alpha = body + (1 - body) * edge * 0.9
  const whiten = edge * 0.8
  const lit = (0.72 + 0.28 * Math.min(1, shade)) * (blocked ? 0.72 : 1)
  const specAdd = spec * 255
  const chan = (c: number, envC: number) => Math.min(255, c * lit * (1 - whiten) + envC * whiten + specAdd)
  return [byte(chan(batch.r, envR)), byte(chan(batch.g, envG)), byte(chan(batch.b, envB)), byte(alpha * 255)]
}

function shadeOf(nx: number, ny: number, nz: number, back: boolean, blocked = false) {
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
  return Math.min(1, lit(x, y, z, blocked) / Math.max(LIT_FRONT, 1e-3))
}

/** 被主光挡住时，贴图按「去掉主光 / 完整光照」变暗。没挡住的像素不乘这个系数。 */
function shadowScale(nx: number, ny: number, nz: number, back: boolean) {
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
  const open = lit(x, y, z, false)
  const shut = lit(x, y, z, true)
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

/** 子圈整段都落在外圈里才是洞。笔画搭接时重心可能掉进对方，但形状本身伸到外面，仍是另一块实体。 */
function ringContains(outer: Pt[], inner: Pt[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of outer) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  let inside = 0
  for (const p of inner) {
    if (p.x < minX - 0.75 || p.x > maxX + 0.75 || p.y < minY - 0.75 || p.y > maxY + 0.75) return false
    if (pointInRing(p.x, p.y, outer)) inside++
  }
  return inside >= inner.length * 0.9
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
  if (node.mesh.rx > 0 && node.mesh.edges.length > 0 && hw > 0 && hh > 0 && hd > 0) {
    const built = roundedBoxGeometry(hw, hh, hd, node.mesh.rx, node.mesh.edges)
    centerMesh(node, built.positions)
    return {
      positions: Float32Array.from(built.positions),
      normals: Float32Array.from(built.normals),
      indices: Uint32Array.from(built.indices),
    }
  }
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

type Vec3 = { x: number; y: number; z: number }

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

function centerMesh(node: MeshLayoutNode, positions: number[]) {
  const o = originOffset(node.origin, node.width, node.height)
  const tx = node.width / 2 - o.x
  const ty = -(node.height / 2 - o.y)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! += tx
    positions[i + 1]! += ty
  }
}

function addDisk(positions: number[], normals: number[], indices: number[], center: Vec3, ring: Vec3[], normal: Vec3, reverse: boolean) {
  const base = positions.length / 3
  positions.push(center.x, center.y, center.z)
  normals.push(normal.x, normal.y, normal.z)
  for (const v of ring) {
    positions.push(v.x, v.y, v.z)
    normals.push(normal.x, normal.y, normal.z)
  }
  const radial = ring.length - 1
  for (let k = 0; k < radial; k++) {
    const i0 = base + 1 + k
    const i1 = base + 2 + k
    if (reverse) indices.push(base, i1, i0)
    else indices.push(base, i0, i1)
  }
}

/** 轴沿画面竖直方向。圆截面在 xz，朝镜头的一侧法线是 +z。 */
function buildCylinder(node: MeshLayoutNode) {
  if (node.mesh.type !== 'cylinder') return null
  const radius = node.mesh.r
  const half = node.mesh.height / 2
  if (!(radius > 0) || !(half > 0)) return null
  if (node.mesh.rx > 0 && node.mesh.rims.length > 0) {
    const built = roundedCylinderGeometry(radius, half, node.mesh.rx, node.mesh.rims)
    centerMesh(node, built.positions)
    return {
      positions: Float32Array.from(built.positions),
      normals: Float32Array.from(built.normals),
      indices: Uint32Array.from(built.indices),
    }
  }
  const segments = 48
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let iy = 0; iy <= 1; iy++) {
    const y = iy === 0 ? half : -half
    for (let ix = 0; ix <= segments; ix++) {
      const theta = (ix / segments) * Math.PI * 2
      const nx = Math.cos(theta)
      const nz = Math.sin(theta)
      positions.push(radius * nx, y, radius * nz)
      normals.push(nx, 0, nz)
    }
  }
  const cols = segments + 1
  for (let ix = 0; ix < segments; ix++) {
    const a = ix
    const b = ix + cols
    indices.push(a, a + 1, b, a + 1, b + 1, b)
  }
  const top: Vec3[] = []
  const bottom: Vec3[] = []
  for (let ix = 0; ix <= segments; ix++) {
    const theta = (ix / segments) * Math.PI * 2
    const x = radius * Math.cos(theta)
    const z = radius * Math.sin(theta)
    top.push(vec3(x, half, z))
    bottom.push(vec3(x, -half, z))
  }
  addDisk(positions, normals, indices, vec3(0, half, 0), top, vec3(0, 1, 0), true)
  addDisk(positions, normals, indices, vec3(0, -half, 0), bottom, vec3(0, -1, 0), false)
  centerMesh(node, positions)
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) }
}

/** 环躺在 xy 平面。r 是环心到管心，tube 是管半径。 */
function buildTorus(node: MeshLayoutNode) {
  if (node.mesh.type !== 'torus') return null
  const major = node.mesh.r
  const tube = node.mesh.tube
  if (!(major > 0) || !(tube > 0) || tube >= major) return null
  const tubular = 48
  const radial = 24
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let iy = 0; iy <= radial; iy++) {
    const psi = (iy / radial) * Math.PI * 2
    const cy = Math.cos(psi)
    const sy = Math.sin(psi)
    for (let ix = 0; ix <= tubular; ix++) {
      const phi = (ix / tubular) * Math.PI * 2
      const cx = Math.cos(phi)
      const sx = Math.sin(phi)
      positions.push((major + tube * cy) * cx, (major + tube * cy) * sx, tube * sy)
      normals.push(cy * cx, cy * sx, sy)
    }
  }
  const cols = tubular + 1
  for (let iy = 0; iy < radial; iy++) {
    for (let ix = 0; ix < tubular; ix++) {
      const a = iy * cols + ix
      const b = a + cols
      indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  centerMesh(node, positions)
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) }
}

function tangentOf(points: Vec3[], index: number, closed: boolean): Vec3 {
  const n = points.length
  const curr = points[index]!
  const prev = closed ? points[(index - 1 + n) % n]! : points[Math.max(0, index - 1)]!
  const next = closed ? points[(index + 1) % n]! : points[Math.min(n - 1, index + 1)]!
  let x = next.x - prev.x
  let y = next.y - prev.y
  let z = next.z - prev.z
  if (x * x + y * y + z * z < 1e-8) {
    x = curr.x - prev.x
    y = curr.y - prev.y
    z = curr.z - prev.z
  }
  if (x * x + y * y + z * z < 1e-8) {
    x = next.x - curr.x
    y = next.y - curr.y
    z = next.z - curr.z
  }
  return unit(x, y, z)
}

function tubeFrame(tangent: Vec3): { n: Vec3; b: Vec3 } | null {
  const up = Math.abs(tangent.z) < 0.9 ? vec3(0, 0, 1) : vec3(0, 1, 0)
  const side = cross(up, tangent)
  const n = unit(side.x, side.y, side.z)
  if (n.x === 0 && n.y === 0 && n.z === 0) return null
  const bin = cross(tangent, n)
  return { n, b: unit(bin.x, bin.y, bin.z) }
}

/** 圆截面沿路径扫出一根管子。路径在所在平面，y 向下。 */
function buildTube(node: MeshLayoutNode) {
  if (node.mesh.type !== 'tube') return null
  const radius = node.mesh.r
  if (!(radius > 0)) return null
  const o = originOffset(node.origin, node.width, node.height)
  const rings = tessellateSvgPath(node.mesh.d, 12, Math.PI / 20)
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const radial = 16
  for (const ring of rings) {
    const points = dedupe(ring.points).map((p) => vec3(p.x - o.x, -(p.y - o.y), 0))
    const closed = ring.closed && points.length >= 3
    if (points.length < 2) continue
    const frames: Array<{ n: Vec3; b: Vec3; t: Vec3 }> = []
    let broken = false
    for (let i = 0; i < points.length; i++) {
      const t = tangentOf(points, i, closed)
      const frame = tubeFrame(t)
      if (!frame) {
        broken = true
        break
      }
      frames.push({ ...frame, t })
    }
    if (broken || frames.length !== points.length) continue
    const base = positions.length / 3
    const cols = radial + 1
    const samples: Vec3[][] = []
    for (let i = 0; i < points.length; i++) {
      const frame = frames[i]!
      const p = points[i]!
      const row: Vec3[] = []
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2
        const c = Math.cos(ang)
        const s = Math.sin(ang)
        const nx = c * frame.n.x + s * frame.b.x
        const ny = c * frame.n.y + s * frame.b.y
        const nz = c * frame.n.z + s * frame.b.z
        const vertex = vec3(p.x + radius * nx, p.y + radius * ny, p.z + radius * nz)
        row.push(vertex)
        positions.push(vertex.x, vertex.y, vertex.z)
        normals.push(nx, ny, nz)
      }
      samples.push(row)
    }
    const rows = points.length
    const segCount = closed ? rows : rows - 1
    for (let i = 0; i < segCount; i++) {
      const i0 = base + i * cols
      const i1 = base + ((i + 1) % rows) * cols
      for (let k = 0; k < radial; k++) {
        const a = i0 + k
        const b = i1 + k
        indices.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
    if (!closed) {
      const last = points.length - 1
      const startT = frames[0]!.t
      const endT = frames[last]!.t
      addDisk(positions, normals, indices, points[0]!, samples[0]!, vec3(-startT.x, -startT.y, -startT.z), true)
      addDisk(positions, normals, indices, points[last]!, samples[last]!, endT, false)
    }
  }
  if (indices.length === 0) return null
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
    let best = -1
    let bestArea = Infinity
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue
      const other = items[j]!
      if (other.area <= items[i]!.area + 1e-4 || other.area >= bestArea) continue
      if (ringContains(other.points, items[i]!.points)) {
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
  if (node.mesh.type === 'cylinder') return buildCylinder(node)
  if (node.mesh.type === 'torus') return buildTorus(node)
  if (node.mesh.type === 'tube') return buildTube(node)
  if (node.mesh.type === 'extrude') return buildExtrude(node)
  return null
}

type Texel = { r: number; g: number; b: number; a: number }

const TEXEL: Texel = { r: 0, g: 0, b: 0, a: 0 }

function sampleTexture(data: Uint8ClampedArray, tw: number, th: number, u: number, v: number): Texel {
  if (tw < 1 || th < 1) {
    TEXEL.r = 0
    TEXEL.g = 0
    TEXEL.b = 0
    TEXEL.a = 0
    return TEXEL
  }
  const x = Math.min(Math.max(u, 0), 1) * Math.max(tw - 1, 0)
  const y = (1 - Math.min(Math.max(v, 0), 1)) * (th - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, tw - 1)
  const y1 = Math.min(y0 + 1, th - 1)
  const tx = x - x0
  const ty = y - y0
  const row0 = y0 * tw
  const row1 = y1 * tw
  const i00 = (row0 + x0) * 4
  const i10 = (row0 + x1) * 4
  const i01 = (row1 + x0) * 4
  const i11 = (row1 + x1) * 4
  const mix = (channel: number) => {
    const top = data[i00 + channel]! * (1 - tx) + data[i10 + channel]! * tx
    const bot = data[i01 + channel]! * (1 - tx) + data[i11 + channel]! * tx
    return top * (1 - ty) + bot * ty
  }
  TEXEL.r = mix(0)
  TEXEL.g = mix(1)
  TEXEL.b = mix(2)
  TEXEL.a = mix(3)
  return TEXEL
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
    if (batch.material === 'glass') return
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
        if (sampleTexture(batch.texture, batch.tw, batch.th, u, v).a < 128) continue
      }
      const d = w0 * a.z + w1 * b.z + w2 * c.z
      const di = iy * width + ix
      if (d > map[di]!) map[di] = d
    }
  }
}

function shadowBias(map: ShadowMap, nx: number, ny: number, nz: number) {
  const nlen = Math.hypot(nx, ny, nz) || 1
  const nd = Math.abs((nx * map.toward.x + ny * map.toward.y + nz * map.toward.z) / nlen)
  return map.bias / Math.max(nd, 0.25)
}

function occluded(map: ShadowMap, x: number, y: number, z: number, nx: number, ny: number, nz: number, bias = shadowBias(map, nx, ny, nz)) {
  const sx = (x * map.right.x + y * map.right.y + z * map.right.z - map.minU) * map.scaleU
  const sy = (x * map.up.x + y * map.up.y + z * map.up.z - map.minV) * map.scaleV
  const ix = Math.floor(sx)
  const iy = Math.floor(sy)
  if (ix < 0 || iy < 0 || ix >= map.width || iy >= map.height) return false
  const stored = map.depth[iy * map.width + ix]!
  if (stored < -1e20) return false
  const toward = x * map.toward.x + y * map.toward.y + z * map.toward.z
  return stored > toward + bias
}

function drawTriangle(
  color: Uint8ClampedArray,
  depth: Float32Array,
  owners: Int16Array,
  width: number,
  height: number,
  a: ScreenVert,
  b: ScreenVert,
  c: ScreenVert,
  batch: Batch,
  shadow: ShadowMap | null,
  camera: ShadeCamera,
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
  const e0x = (b.sy - c.sy) / area
  const e0y = (c.sx - b.sx) / area
  const e1x = (c.sy - a.sy) / area
  const e1y = (a.sx - c.sx) / area
  const flat =
    a.nx === b.nx &&
    a.ny === b.ny &&
    a.nz === b.nz &&
    a.nx === c.nx &&
    a.ny === c.ny &&
    a.nz === c.nz
  const openShade = flat && batch.shaded ? shadeOf(a.nx, a.ny, a.nz, back, false) : 0
  const shutShade = flat && batch.shaded ? shadeOf(a.nx, a.ny, a.nz, back, true) : 0
  const flatBias = flat && shadow ? shadowBias(shadow, a.nx, a.ny, a.nz) : 0
  const texture = batch.texture
  for (let iy = minY; iy <= maxY; iy++) {
    const py = iy + 0.5
    let w0 = e0x * (minX + 0.5 - c.sx) + e0y * (py - c.sy)
    let w1 = e1x * (minX + 0.5 - c.sx) + e1y * (py - c.sy)
    for (let ix = minX; ix <= maxX; ix++) {
      const w2 = 1 - w0 - w1
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) {
        w0 += e0x
        w1 += e1x
        continue
      }
      const iw = w0 * a.invW + w1 * b.invW + w2 * c.invW
      if (iw <= 1e-8) {
        w0 += e0x
        w1 += e1x
        continue
      }
      const x = (w0 * a.x * a.invW + w1 * b.x * b.invW + w2 * c.x * c.invW) / iw
      const y = (w0 * a.y * a.invW + w1 * b.y * b.invW + w2 * c.y * c.invW) / iw
      const z = (w0 * a.z * a.invW + w1 * b.z * b.invW + w2 * c.z * c.invW) / iw
      const di = iy * width + ix
      if (z < depth[di]! - 1e-4) {
        w0 += e0x
        w1 += e1x
        continue
      }
      const nx = flat ? a.nx : (w0 * a.nx * a.invW + w1 * b.nx * b.invW + w2 * c.nx * c.invW) / iw
      const ny = flat ? a.ny : (w0 * a.ny * a.invW + w1 * b.ny * b.invW + w2 * c.ny * c.invW) / iw
      const nz = flat ? a.nz : (w0 * a.nz * a.invW + w1 * b.nz * b.invW + w2 * c.nz * c.invW) / iw
      const blocked = shadow !== null && occluded(shadow, x, y, z, nx, ny, nz, flat ? flatBias : undefined)
      let sr = batch.r
      let sg = batch.g
      let sb = batch.b
      let sa = batch.a
      if (texture) {
        const u = (w0 * a.u * a.invW + w1 * b.u * b.invW + w2 * c.u * c.invW) / iw
        const v = (w0 * a.v * a.invW + w1 * b.v * b.invW + w2 * c.v * c.invW) / iw
        const tex = sampleTexture(texture, batch.tw, batch.th, u, v)
        const dim = blocked ? shadowScale(nx, ny, nz, back) : 1
        sr = byte(tex.r * dim)
        sg = byte(tex.g * dim)
        sb = byte(tex.b * dim)
        sa = tex.a
      } else if (batch.material !== 'lambert') {
        const shade = flat ? (blocked ? shutShade : openShade) : shadeOf(nx, ny, nz, back, blocked)
        const painted = materialBytes(batch, nx, ny, nz, back, shade, blocked, x, y, z, camera)
        sr = painted[0]
        sg = painted[1]
        sb = painted[2]
        sa = painted[3]
      } else if (batch.shaded) {
        const shade = flat ? (blocked ? shutShade : openShade) : shadeOf(nx, ny, nz, back, blocked)
        sr = byte(batch.r * shade)
        sg = byte(batch.g * shade)
        sb = byte(batch.b * shade)
      } else if (blocked) {
        const dim = shadowScale(nx, ny, nz, back)
        sr = byte(batch.r * dim)
        sg = byte(batch.g * dim)
        sb = byte(batch.b * dim)
      }
      if (batch.depthWrite) {
        depth[di] = z
        owners[di] = batch.owner
      }
      const pi = di * 4
      if (sa > 0) {
        if (sa >= 255 || color[pi + 3] === 0) {
          color[pi] = sr
          color[pi + 1] = sg
          color[pi + 2] = sb
          color[pi + 3] = sa
        } else {
          const inv = 255 - sa
          const dA = color[pi + 3]!
          const outA = sa + (dA * inv) / 255
          color[pi] = byte((sr * sa + (color[pi]! * dA * inv) / 255) / outA)
          color[pi + 1] = byte((sg * sa + (color[pi + 1]! * dA * inv) / 255) / outA)
          color[pi + 2] = byte((sb * sa + (color[pi + 2]! * dA * inv) / 255) / outA)
          color[pi + 3] = byte(outA)
        }
      }
      w0 += e0x
      w1 += e1x
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
  const owners = new Int16Array(pw * ph)
  depth.fill(-1e30)
  owners.fill(-1)
  const shadow = buildShadowMap(batches, authored, Math.max(layer.width, layer.height) * base * 2)
  const near = perspective * (1 - 1e-3)
  const camera: ShadeCamera = { x: vx, y: vy, z: perspective }
  const toScreen = (v: Vert): ScreenVert => {
    const w = 1 - v.z / perspective
    return {
      ...v,
      sx: (vx + (v.x - vx) / w + padL) * pixelScale,
      sy: (vy + (v.y - vy) / w + padT) * pixelScale,
      invW: 1 / w,
    }
  }
  const paintBatch = (batchIndex: number) => {
    const batch = batches[batchIndex]!
    const verts = authored[batchIndex]!
    const indices = batch.indices
    for (let i = 0; i < indices.length; i += 3) {
      const tri = [verts[indices[i]!]!, verts[indices[i + 1]!]!, verts[indices[i + 2]!]!]
      const clipped = clipNear(tri, near)
      for (let k = 1; k < clipped.length - 1; k++) {
        const a = clipped[0]!
        const b = clipped[k]!
        const c = clipped[k + 1]!
        drawTriangle(color, depth, owners, pw, ph, toScreen(a), toScreen(b), toScreen(c), batch, shadow, camera)
      }
    }
  }
  const solid: number[] = []
  const glass: number[] = []
  batches.forEach((batch, index) => {
    if (batch.material === 'glass') glass.push(index)
    else solid.push(index)
  })
  glass.sort((a, b) => {
    const za = authored[a]!.reduce((sum, vert) => sum + vert.z, 0)
    const zb = authored[b]!.reduce((sum, vert) => sum + vert.z, 0)
    return za - zb
  })
  for (const index of solid) paintBatch(index)
  for (const index of glass) paintBatch(index)
  const hi = createCanvas(pw, ph)
  const image = hi.getContext('2d').createImageData(pw, ph)
  image.data.set(color)
  hi.getContext('2d').putImageData(image, 0, 0)
  const outW = Math.max(1, Math.round(viewW * base))
  const outH = Math.max(1, Math.round(viewH * base))
  const out = hi.width >= outW && hi.height >= outH ? resolveSamples(hi, outW, outH) : hi
  paintMeshLines(out, batches, authored, depth, owners, pw, ph, layer, perspective, padL, padT, viewW, viewH)
  return { canvas: out, x: -padL, y: -padT, width: viewW, height: viewH }
}

function rgbaCss(r: number, g: number, b: number, a: number) {
  return `rgba(${r},${g},${b},${(a / 255).toFixed(4)})`
}

function lineStyleOf(node: MeshLayoutNode, opacity: number): LineStyle | null {
  const widths = node.strokeWidths
  if (node.stroke === 'none' || !(Math.max(widths[0], widths[1], widths[2]) > 0)) return null
  const [r, g, b, a] = fillBytes(node.stroke, opacity)
  if (a <= 0) return null
  let hiddenCss: string | null = null
  if (node.hidden !== 'none') {
    const [hr, hg, hb, ha] = fillBytes(node.hidden, opacity)
    if (ha > 0) hiddenCss = rgbaCss(hr, hg, hb, ha)
  }
  return { css: rgbaCss(r, g, b, a), hiddenCss, widths, halo: node.halo }
}

function sphereOutlineOf(node: MeshLayoutNode): SphereOutline | null {
  if (node.mesh.type !== 'sphere') return null
  const o = originOffset(node.origin, node.width, node.height)
  return { x: node.width / 2 - o.x, y: -(node.height / 2 - o.y), z: 0, r: node.mesh.r }
}

function quantCoord(n: number) {
  return Math.round(n * 1e3)
}

/** 按位置焊顶点，丢掉共面三角的对角线，留下折棱和边界。 */
function extractEdges(positions: Float32Array, indices: Uint32Array): MeshEdge[] {
  type Acc = { a: number; b: number; n0: [number, number, number] | null; n1: [number, number, number] | null }
  const map = new Map<string, Acc>()
  const at = (i: number) => i * 3
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!
    const i1 = indices[t + 1]!
    const i2 = indices[t + 2]!
    const a0 = at(i0)
    const b0 = at(i1)
    const c0 = at(i2)
    const bx = positions[b0]! - positions[a0]!
    const by = positions[b0 + 1]! - positions[a0 + 1]!
    const bz = positions[b0 + 2]! - positions[a0 + 2]!
    const cx = positions[c0]! - positions[a0]!
    const cy = positions[c0 + 1]! - positions[a0 + 1]!
    const cz = positions[c0 + 2]! - positions[a0 + 2]!
    const nx = by * cz - bz * cy
    const ny = bz * cx - bx * cz
    const nz = bx * cy - by * cx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-8) continue
    const normal: [number, number, number] = [nx / len, ny / len, nz / len]
    const tri = [i0, i1, i2]
    for (let e = 0; e < 3; e++) {
      const i = tri[e]!
      const j = tri[(e + 1) % 3]!
      const ka = `${quantCoord(positions[at(i)]!)},${quantCoord(positions[at(i) + 1]!)},${quantCoord(positions[at(i) + 2]!)}`
      const kb = `${quantCoord(positions[at(j)]!)},${quantCoord(positions[at(j) + 1]!)},${quantCoord(positions[at(j) + 2]!)}`
      const swap = ka > kb
      const key = swap ? `${kb}|${ka}` : `${ka}|${kb}`
      let acc = map.get(key)
      if (!acc) {
        acc = { a: swap ? j : i, b: swap ? i : j, n0: null, n1: null }
        map.set(key, acc)
      }
      if (!acc.n0) acc.n0 = normal
      else if (!acc.n1) acc.n1 = normal
    }
  }
  const edges: MeshEdge[] = []
  for (const acc of map.values()) {
    if (!acc.n0) continue
    const n1 = acc.n1
    const dotN = n1 ? acc.n0[0] * n1[0] + acc.n0[1] * n1[1] + acc.n0[2] * n1[2] : -1
    edges.push({ a: acc.a, b: acc.b, n0: acc.n0, n1, crease: dotN < CREASE_DOT })
  }
  return edges
}

function meshLineFields(
  node: MeshLayoutNode,
  opacity: number,
  positions: Float32Array,
  indices: Uint32Array,
  owner: number,
): Pick<Batch, 'edges' | 'lines' | 'outline' | 'owner'> {
  const lines = lineStyleOf(node, opacity)
  if (!lines) return { edges: NO_EDGES, lines: null, outline: null, owner }
  return {
    edges: extractEdges(positions, indices),
    lines,
    outline: sphereOutlineOf(node),
    owner,
  }
}

function facesCamera(
  normal: [number, number, number],
  toLayer: Mat4,
  mid: { x: number; y: number; z: number },
  vx: number,
  vy: number,
  perspective: number,
) {
  const n = transformNormal(toLayer, normal[0], normal[1], normal[2])
  return n.x * (vx - mid.x) + n.y * (vy - mid.y) + n.z * (perspective - mid.z) > 1e-4
}

function isSilhouette(edge: MeshEdge, verts: Vert[], batch: Batch, vx: number, vy: number, perspective: number) {
  const a = verts[edge.a]
  const b = verts[edge.b]
  if (!a || !b) return false
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
  const front0 = facesCamera(edge.n0, batch.toLayer, mid, vx, vy, perspective)
  if (!edge.n1) return front0
  return front0 !== facesCamera(edge.n1, batch.toLayer, mid, vx, vy, perspective)
}

function projectLayer(
  v: Vert,
  perspective: number,
  vx: number,
  vy: number,
  padL: number,
  padT: number,
  scaleX: number,
  scaleY: number,
) {
  const w = 1 - v.z / perspective
  if (w <= 1e-4) return null
  return {
    x: (vx + (v.x - vx) / w + padL) * scaleX,
    y: (vy + (v.y - vy) / w + padT) * scaleY,
    z: v.z,
  }
}

function classifySample(
  depth: Float32Array,
  owners: Int16Array,
  pw: number,
  ph: number,
  mapX: number,
  mapY: number,
  x: number,
  y: number,
  z: number,
  owner: number,
  outline: boolean,
): 'visible' | 'hidden' | 'skip' {
  const ix = Math.round(x * mapX)
  const iy = Math.round(y * mapY)
  if (ix < 0 || iy < 0 || ix >= pw || iy >= ph) return 'skip'
  const di = iy * pw + ix
  const stored = depth[di]!
  if (stored < -1e20 || stored <= z + 1.5) return 'visible'
  if (owners[di] !== owner) return 'skip'
  // 轮廓贴着自己的表面，深度会略近于这条线，不能当成隐藏线。
  return outline ? 'visible' : 'hidden'
}

type ScreenSample = { x: number; y: number; z: number; kind: 'visible' | 'hidden' | 'skip' }

function sampleSegment(
  a: Vert,
  b: Vert,
  perspective: number,
  vx: number,
  vy: number,
  padL: number,
  padT: number,
  scaleX: number,
  scaleY: number,
  depth: Float32Array,
  owners: Int16Array,
  pw: number,
  ph: number,
  mapX: number,
  mapY: number,
  owner: number,
  outline: boolean,
): ScreenSample[] {
  const near = perspective * (1 - 1e-3)
  let p0 = a
  let p1 = b
  const in0 = p0.z < near
  const in1 = p1.z < near
  if (!in0 && !in1) return []
  if (in0 && !in1) p1 = lerpVert(p0, p1, near)
  else if (!in0 && in1) p0 = lerpVert(p0, p1, near)
  const s0 = projectLayer(p0, perspective, vx, vy, padL, padT, scaleX, scaleY)
  const s1 = projectLayer(p1, perspective, vx, vy, padL, padT, scaleX, scaleY)
  if (!s0 || !s1) return []
  const steps = Math.max(1, Math.ceil(Math.hypot(s1.x - s0.x, s1.y - s0.y)))
  const out: ScreenSample[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const v: Vert = {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      z: p0.z + (p1.z - p0.z) * t,
      nx: 0,
      ny: 0,
      nz: 1,
      u: 0,
      v: 0,
    }
    const s = projectLayer(v, perspective, vx, vy, padL, padT, scaleX, scaleY)
    if (!s) continue
    out.push({
      x: s.x,
      y: s.y,
      z: s.z,
      kind: classifySample(depth, owners, pw, ph, mapX, mapY, s.x, s.y, s.z, owner, outline),
    })
  }
  return out
}

function paintRun(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  hidden: boolean,
  css: string,
  width: number,
  scale: number,
  dashOffset = 0,
) {
  if (points.length < 2 || !(width > 0)) return
  ctx.beginPath()
  ctx.moveTo(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y)
  ctx.setLineDash(hidden ? [6 * scale, 4 * scale] : [])
  ctx.lineDashOffset = hidden ? dashOffset : 0
  ctx.lineCap = hidden ? 'butt' : 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = width * scale
  ctx.strokeStyle = css
  ctx.stroke()
}

type ChainPoint = { x: number; y: number; z: number; edge: number; cut?: boolean }
type PointRun = { points: ChainPoint[] }

function collectRuns(samples: ScreenSample[]): Array<{ points: Array<{ x: number; y: number; z: number }>; hidden: boolean }> {
  const out: Array<{ points: Array<{ x: number; y: number; z: number }>; hidden: boolean }> = []
  let run: ScreenSample[] = []
  let mode: ScreenSample['kind'] | null = null
  const flush = () => {
    if (run.length >= 2 && (mode === 'visible' || mode === 'hidden')) {
      out.push({ points: run.map((p) => ({ x: p.x, y: p.y, z: p.z })), hidden: mode === 'hidden' })
    }
    run = []
  }
  for (const sample of samples) {
    if (sample.kind !== mode) {
      if (run.length > 0 && sample.kind !== 'skip' && mode !== 'skip' && mode != null) {
        run.push(sample)
        flush()
        run = [sample]
      } else {
        flush()
      }
      mode = sample.kind
    }
    if (mode !== 'skip') run.push(sample)
  }
  flush()
  return out
}

/** 端点重合的隐藏段合成一条折线，虚线相位才能沿圆弧走下去。 */
function chainHidden(runs: PointRun[]): ChainPoint[][] {
  const n = runs.length
  if (n === 0) return []
  const used = new Array<boolean>(n).fill(false)
  const keyOf = (p: { x: number; y: number }) => `${Math.round(p.x * 4)}|${Math.round(p.y * 4)}`
  const at = new Map<string, number[]>()
  const pushAt = (p: { x: number; y: number }, i: number) => {
    const k = keyOf(p)
    const list = at.get(k)
    if (list) list.push(i)
    else at.set(k, [i])
  }
  for (let i = 0; i < n; i++) {
    const pts = runs[i]!.points
    pushAt(pts[0]!, i)
    const last = pts[pts.length - 1]!
    if (keyOf(last) !== keyOf(pts[0]!)) pushAt(last, i)
  }
  const orient = (points: ChainPoint[], tip: { x: number; y: number }) =>
    keyOf(points[0]!) === keyOf(tip) ? points : [...points].reverse()
  const out: ChainPoint[][] = []
  for (let seed = 0; seed < n; seed++) {
    if (used[seed]) continue
    used[seed] = true
    let points = runs[seed]!.points.slice()
    const grow = (forward: boolean) => {
      for (;;) {
        const tip = forward ? points[points.length - 1]! : points[0]!
        const prev = forward ? points[Math.max(0, points.length - 2)]! : points[Math.min(1, points.length - 1)]!
        const cands = (at.get(keyOf(tip)) ?? []).filter((i) => !used[i])
        if (cands.length === 0) return
        let best = cands[0]!
        let bestDot = -Infinity
        for (const i of cands) {
          const seq = orient(runs[i]!.points, tip)
          const next = seq[Math.min(1, seq.length - 1)]!
          const dot = (tip.x - prev.x) * (next.x - tip.x) + (tip.y - prev.y) * (next.y - tip.y)
          if (dot > bestDot) {
            bestDot = dot
            best = i
          }
        }
        used[best] = true
        const seq = orient(runs[best]!.points, tip)
        if (forward) points = points.concat(seq.slice(1))
        else points = seq.slice(0, -1).reverse().concat(points)
      }
    }
    grow(true)
    grow(false)
    out.push(points)
  }
  return out
}

function sphereRing(center: { x: number; y: number; z: number }, radius: number, vx: number, vy: number, perspective: number): Vert[] | null {
  const dx = center.x - vx
  const dy = center.y - vy
  const dz = center.z - perspective
  const dist = Math.hypot(dx, dy, dz)
  if (dist <= radius + 1e-3) return null
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist }
  const along = (radius * radius) / dist
  const pc = { x: center.x - dir.x * along, y: center.y - dir.y * along, z: center.z - dir.z * along }
  const rad = radius * Math.sqrt(Math.max(0, 1 - (radius * radius) / (dist * dist)))
  const hint = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const side = cross(hint, dir)
  const u = unit(side.x, side.y, side.z)
  const v = cross(dir, u)
  const count = 72
  const ring: Vert[] = []
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    ring.push({
      x: pc.x + rad * (c * u.x + s * v.x),
      y: pc.y + rad * (c * u.y + s * v.y),
      z: pc.z + rad * (c * u.z + s * v.z),
      nx: 0,
      ny: 0,
      nz: 1,
      u: 0,
      v: 0,
    })
  }
  return ring
}

function roundSphere(batch: Batch): { x: number; y: number; z: number; radius: number } | null {
  const outline = batch.outline
  if (!outline) return null
  const c = transformPoint(batch.toLayer, batch.originX, batch.originY, outline.x, outline.y, outline.z)
  const px = transformPoint(batch.toLayer, batch.originX, batch.originY, outline.x + outline.r, outline.y, outline.z)
  const py = transformPoint(batch.toLayer, batch.originX, batch.originY, outline.x, outline.y + outline.r, outline.z)
  const pz = transformPoint(batch.toLayer, batch.originX, batch.originY, outline.x, outline.y, outline.z + outline.r)
  const rx = Math.hypot(px.x - c.x, px.y - c.y, px.z - c.z)
  const ry = Math.hypot(py.x - c.x, py.y - c.y, py.z - c.z)
  const rz = Math.hypot(pz.x - c.x, pz.y - c.y, pz.z - c.z)
  const mean = (rx + ry + rz) / 3
  if (!(mean > 1e-3)) return null
  if (Math.abs(rx - mean) > mean * 0.02 || Math.abs(ry - mean) > mean * 0.02 || Math.abs(rz - mean) > mean * 0.02) return null
  return { x: c.x, y: c.y, z: c.z, radius: mean }
}

type InkRun = { points: ChainPoint[]; hidden: boolean; kind: 0 | 1 | 2; style: LineStyle }
type EdgeEnds = { a: string; b: string }

function edgeKey(v: { x: number; y: number; z: number }) {
  return `${quantCoord(v.x)},${quantCoord(v.y)},${quantCoord(v.z)}`
}

function shareEnds(a: EdgeEnds, b: EdgeEnds) {
  return a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b
}

/** 从折线起点走到 index 的屏幕长度，断口也算，虚线相位才能接上。 */
function prefixLength(points: ChainPoint[], index: number) {
  let length = 0
  for (let i = 1; i <= index; i++) {
    length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  }
  return length
}

function paintSplit(ctx: CanvasRenderingContext2D, run: InkRun, scale: number) {
  const width = run.style.widths[run.kind]
  const css = run.hidden ? run.style.hiddenCss : run.style.css
  if (!css || !(width > 0)) return
  const points = run.points
  let i = 0
  while (i < points.length) {
    while (i < points.length && points[i]!.cut) i++
    const start = i
    while (i < points.length && !points[i]!.cut) i++
    const slice = points.slice(start, i)
    if (slice.length >= 2) paintRun(ctx, slice, run.hidden, css, width, scale, run.hidden ? prefixLength(points, start) : 0)
  }
}

/**
 * 可见线按 (线宽 / 2 + halo) 盖住更远的线。共用端点的棱不切开，角上仍连着。
 * 深度差不到 2 个像素的不算压在前面。
 */
function cutCrossings(runs: InkRun[], edges: EdgeEnds[], width: number, height: number, scale: number) {
  if (!runs.some((run) => !run.hidden && run.style.halo > 0)) return
  const zBuf = new Float32Array(width * height)
  const edgeBuf = new Int32Array(width * height)
  zBuf.fill(-1e30)
  edgeBuf.fill(-1)
  const stamp = (x: number, y: number, z: number, edge: number, radius: number) => {
    const r = Math.ceil(radius)
    const x0 = Math.max(0, Math.floor(x - r))
    const y0 = Math.max(0, Math.floor(y - r))
    const x1 = Math.min(width - 1, Math.ceil(x + r))
    const y1 = Math.min(height - 1, Math.ceil(y + r))
    const r2 = radius * radius
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy - y
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - x
        if (dx * dx + dy * dy > r2) continue
        const i = yy * width + xx
        if (z > zBuf[i]!) {
          zBuf[i] = z
          edgeBuf[i] = edge
        }
      }
    }
  }
  for (const run of runs) {
    if (run.hidden || !(run.style.halo > 0)) continue
    const radius = (run.style.widths[run.kind] / 2 + run.style.halo) * scale
    if (!(radius > 0)) continue
    for (const point of run.points) stamp(point.x, point.y, point.z, point.edge, radius)
  }
  for (const run of runs) {
    for (const point of run.points) {
      const ix = Math.round(point.x)
      const iy = Math.round(point.y)
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue
      const i = iy * width + ix
      const other = edgeBuf[i]!
      if (other < 0 || !(zBuf[i]! > point.z + 2)) continue
      if (shareEnds(edges[other]!, edges[point.edge]!)) continue
      point.cut = true
    }
  }
}

function paintMeshLines(
  canvas: Canvas,
  batches: Batch[],
  authored: Vert[][],
  depth: Float32Array,
  owners: Int16Array,
  pw: number,
  ph: number,
  layer: LayerLayoutNode,
  perspective: number,
  padL: number,
  padT: number,
  viewW: number,
  viewH: number,
) {
  if (!batches.some((batch) => batch.lines)) return
  const ctx = canvas.getContext('2d')
  const scaleX = canvas.width / Math.max(viewW, 1e-3)
  const scaleY = canvas.height / Math.max(viewH, 1e-3)
  const scale = (scaleX + scaleY) / 2
  const vx = layer.width / 2
  const vy = layer.height / 2
  const mapX = pw / canvas.width
  const mapY = ph / canvas.height
  const edges: EdgeEnds[] = []
  const runs: InkRun[] = []
  const addEdge = (a: Vert, b: Vert) => {
    const id = edges.length
    edges.push({ a: edgeKey(a), b: edgeKey(b) })
    return id
  }
  const consume = (a: Vert, b: Vert, style: LineStyle, owner: number, outline: boolean, kind: 0 | 1, hiddenRuns: PointRun[]) => {
    const edge = addEdge(a, b)
    for (const run of collectRuns(
      sampleSegment(a, b, perspective, vx, vy, padL, padT, scaleX, scaleY, depth, owners, pw, ph, mapX, mapY, owner, outline),
    )) {
      const points = run.points.map((point) => ({ ...point, edge }))
      if (run.hidden) {
        if (style.hiddenCss) hiddenRuns.push({ points })
      } else runs.push({ points, hidden: false, kind, style })
    }
  }
  batches.forEach((batch, index) => {
    const style = batch.lines
    if (!style) return
    const verts = authored[index]
    if (!verts) return
    const hiddenRuns: PointRun[] = []
    const round = roundSphere(batch)
    if (batch.outline && round) {
      const ring = sphereRing(round, round.radius, vx, vy, perspective)
      if (!ring) return
      for (let i = 0; i < ring.length; i++) consume(ring[i]!, ring[(i + 1) % ring.length]!, style, batch.owner, true, 0, hiddenRuns)
    } else {
      for (const edge of batch.edges) {
        const silhouette = isSilhouette(edge, verts, batch, vx, vy, perspective)
        if (!edge.crease && !silhouette) continue
        const a = verts[edge.a]
        const b = verts[edge.b]
        if (!a || !b) continue
        consume(a, b, style, batch.owner, !edge.crease && silhouette, silhouette ? 0 : 1, hiddenRuns)
      }
    }
    if (style.hiddenCss) {
      for (const chain of chainHidden(hiddenRuns)) runs.push({ points: chain, hidden: true, kind: 2, style })
    }
  })
  cutCrossings(runs, edges, canvas.width, canvas.height, scale)
  for (const run of runs) paintSplit(ctx, run, scale)
  ctx.setLineDash([])
}

function uniformBytes(data: Uint8ClampedArray): { r: number; g: number; b: number; a: number } | null {
  const count = data.length
  if (count < 4) return null
  const r = data[0]!
  const g = data[1]!
  const b = data[2]!
  const a = data[3]!
  for (let i = 4; i < count; i += 4) {
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== a) return null
  }
  return { r, g, b, a }
}

function planeBatch(plane: SoftwareMeshInput['planes'][number], raster: SoftwareMeshInput['raster']): Batch | null {
  const painted = raster(plane.peeled)
  if (painted.logicalWidth <= 0 || painted.logicalHeight <= 0) return null
  const pixels = painted.canvas.getContext('2d').getImageData(0, 0, painted.canvas.width, painted.canvas.height)
  const solid = uniformBytes(pixels.data)
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
    r: solid?.r ?? 255,
    g: solid?.g ?? 255,
    b: solid?.b ?? 255,
    a: solid?.a ?? 255,
    doubleSided: true,
    shaded: false,
    depthWrite: true,
    material: 'lambert',
    roughness: 1,
    texture: solid ? null : pixels.data,
    tw: solid ? 0 : painted.canvas.width,
    th: solid ? 0 : painted.canvas.height,
    toLayer: plane.toLayer,
    originX: o.x,
    originY: o.y,
    owner: 0,
    edges: NO_EDGES,
    lines: null,
    outline: null,
  }
}

/** 磨砂和没写 material 走同一套明暗。平面也用这套。 */
function shadeMaterial(kind: NonNullable<MeshLayoutNode['material']>['kind'] | undefined): Batch['material'] {
  if (!kind || kind === 'matte') return 'lambert'
  return kind
}

export function renderMeshSoftware(input: SoftwareMeshInput): MeshFrame {
  const { layer, perspective, meshes, planes, scale, raster } = input
  const batches: Batch[] = []
  let nextOwner = 1
  for (const instance of meshes) {
    const node = instance.node
    if (node.width <= 0 && node.mesh.type !== 'extrude') continue
    const o = originOffset(node.origin, node.width, node.height)
    if (applyPoseMatrix(instance.toLayer, o.x, o.y, 0).z >= perspective) continue
    const owner = nextOwner++
    const opacity = (instance.opacity ?? 1) * node.opacity
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
          a: byte(prim.color[3] * (instance.opacity ?? 1)),
          doubleSided: prim.doubleSided,
          shaded: true,
          depthWrite: node.material?.kind === 'glass' && prim.color[3] < 255 ? false : prim.color[3] >= 255,
          material: shadeMaterial(node.material?.kind),
          roughness: node.material?.roughness ?? 1,
          texture: null,
          tw: 0,
          th: 0,
          toLayer: instance.toLayer,
          originX: o.x,
          originY: o.y,
          ...meshLineFields(node, opacity, prim.positions, prim.indices, owner),
        })
      }
      continue
    }
    const geometry = geometryOf(node)
    if (!geometry) continue
    const glass = node.material?.kind === 'glass'
    const clear = node.fill === 'none' || node.fill === 'transparent'
    const fillNone = clear && !glass
    const [r, g, b, a] = fillNone ? [0, 0, 0, 0] : clear ? [255, 255, 255, 0] : fillBytes(node.fill, opacity)
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
      shaded: !fillNone,
      depthWrite: glass && a < 255 ? false : fillNone || a >= 255,
      material: shadeMaterial(node.material?.kind),
      roughness: node.material?.roughness ?? 1,
      texture: null,
      tw: 0,
      th: 0,
      toLayer: instance.toLayer,
      originX: o.x,
      originY: o.y,
      ...meshLineFields(node, opacity, geometry.positions, geometry.indices, owner),
    })
  }
  for (const plane of planes) {
    const batch = planeBatch(plane, raster)
    if (!batch) continue
    batch.owner = nextOwner++
    batches.push(batch)
  }
  return rasterize(batches, layer, perspective, scale)
}
