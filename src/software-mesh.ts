import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { readFileSync, statSync } from 'node:fs'
import { studioAt } from './env-map.js'
import { solidPaint } from './gradient.js'
import { parseGlb } from './glb.js'
import { originOffset } from './matrix.js'
import type { MeshClip } from './mesh-cache.js'
import { applyPoseMatrix, behindCamera, type Perspective } from './perspective.js'
import { meshIntersections } from './mesh-intersect.js'
import { roundedBoxGeometry, roundedCylinderGeometry } from './mesh-round.js'
import { tessellateSvgPath } from './path.js'
import type { LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'

type MeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

/**
 * 网格的三角形光栅。
 * 投影用 `project` 的同一套公式（这里直接算），深度大的像素盖住深度小的。
 * `perspective="parallel"` 时不除视距，屏幕坐标就是层坐标。
 * 正对镜头的面是 fill，侧面按内置主光和补光变暗。
 * 主光沿固定方向打一张正交深度图：不透明三角形互相挡住这盏光时，主光不计。
 * glb 用文件里的底色乘这套明暗。
 * 写了 stroke 时，缩小抗锯齿之后再按屏幕像素描折棱和轮廓。
 * 两只都写了 stroke 的网格相互穿过时，交界线算折棱，颜色和宽度跟后写的那只。
 * hidden 只画被这只网格自己挡住的棱，虚线是 6 实 4 空。交界线被这两只中任意一只挡住时同样算隐藏线。
 * 不写 material 时是磨砂：主光乘 fill。plastic 加高光，metal 和 glass 映一张竖向的工作室环境，glass 后画叠色。
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
  perspective: Perspective
  meshes: Array<{ node: MeshLayoutNode; toLayer: Mat4; opacity?: number }>
  planes: Array<{ node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }>
  scale: number
  raster: (node: LayoutNode) => RasterBitmap
  /** 1、2 或 4。缺省 4，不再因为视口伸出画面而降档。 */
  samples?: number
  /** 这一层坐标里要画的范围。和投影外框求交后再分配缓冲区。 */
  clip?: MeshClip
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

const SCREEN_SCRATCH: [ScreenVert, ScreenVert, ScreenVert] = [
  { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, u: 0, v: 0, sx: 0, sy: 0, invW: 1 },
  { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, u: 0, v: 0, sx: 0, sy: 0, invW: 1 },
  { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, u: 0, v: 0, sx: 0, sy: 0, invW: 1 },
]

let colorPool = new Uint8ClampedArray(0)
let depthPool = new Float32Array(0)
let ownerPool = new Int16Array(0)
let shadowPool = new Float32Array(0)
let colorWords: Uint32Array | null = null

const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

function takeRasterBuffers(pixels: number, fillOwners: boolean) {
  const colors = pixels * 4
  if (colorPool.length < colors) {
    colorPool = new Uint8ClampedArray(colors)
    colorWords = null
  } else colorPool.fill(0, 0, colors)
  if (depthPool.length < pixels) depthPool = new Float32Array(pixels)
  depthPool.fill(-1e30, 0, pixels)
  if (fillOwners) {
    if (ownerPool.length < pixels) ownerPool = new Int16Array(pixels)
    ownerPool.fill(-1, 0, pixels)
  }
  return { color: colorPool, depth: depthPool, owners: ownerPool }
}

function takeShadowDepth(texels: number) {
  if (shadowPool.length < texels) shadowPool = new Float32Array(texels)
  shadowPool.fill(-1e30, 0, texels)
  return shadowPool
}

function colorWordView(color: Uint8ClampedArray): Uint32Array | null {
  if (!LITTLE_ENDIAN || color.byteOffset % 4 !== 0) return null
  const words = color.byteLength >>> 2
  if (colorWords && colorWords.buffer === color.buffer && colorWords.byteOffset === color.byteOffset && colorWords.length === words) {
    return colorWords
  }
  colorWords = new Uint32Array(color.buffer, color.byteOffset, words)
  return colorWords
}

function quantGeometry(n: number) {
  return Math.round(n * 1e4) / 1e4
}

type MeshGeometry = { positions: Float32Array; normals: Float32Array; indices: Uint32Array }
type ModelPrim = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  color: [number, number, number, number]
  doubleSided: boolean
}

const geometryCache = new Map<string, MeshGeometry | null>()
const modelCache = new Map<string, ModelPrim[]>()
const GEOMETRY_CAP = 64

function originKey(node: MeshLayoutNode) {
  const origin = node.origin
  if (!origin) return ''
  return `${origin.x.unit}:${quantGeometry(origin.x.value)}:${origin.y.unit}:${quantGeometry(origin.y.value)}`
}

function geometryCacheKey(node: MeshLayoutNode): string | null {
  const mesh = node.mesh
  if (mesh.type === 'model') return null
  const head = `${mesh.type}|${quantGeometry(node.width)}|${quantGeometry(node.height)}|${originKey(node)}`
  if (mesh.type === 'sphere') return `${head}|${quantGeometry(mesh.r)}`
  if (mesh.type === 'box') return `${head}|${quantGeometry(mesh.depth)}|${quantGeometry(mesh.rx)}|${mesh.edges.join(',')}`
  if (mesh.type === 'extrude') return `${head}|${quantGeometry(mesh.depth)}|${mesh.d}`
  if (mesh.type === 'cylinder') return `${head}|${quantGeometry(mesh.r)}|${quantGeometry(mesh.height)}|${quantGeometry(mesh.rx)}|${mesh.rims.join(',')}`
  if (mesh.type === 'torus') return `${head}|${quantGeometry(mesh.r)}|${quantGeometry(mesh.tube)}`
  if (mesh.type === 'tube') return `${head}|${quantGeometry(mesh.r)}|${mesh.d}`
  return null
}

function modelCacheKey(node: MeshLayoutNode): string | null {
  if (node.mesh.type !== 'model' || !node.mesh.file) return null
  let stamp = 'missing'
  try {
    const st = statSync(node.mesh.file)
    stamp = `${st.mtimeMs}:${st.size}`
  } catch {
    stamp = 'missing'
  }
  return `${node.mesh.file}|${stamp}|${quantGeometry(node.width)}|${quantGeometry(node.height)}|${quantGeometry(node.opacity)}|${originKey(node)}`
}

function touchCache<T>(map: Map<string, T>, key: string, value: T, cap: number) {
  map.delete(key)
  map.set(key, value)
  while (map.size > cap) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

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

type ShadeCamera = { x: number; y: number; z: number; parallel?: boolean }

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
  const v = camera.parallel ? { x: 0, y: 0, z: 1 } : unit(camera.x - x, y - camera.y, camera.z - z)
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
      const envLum = (envR + envG + envB) / 3
      // 暗部只留一点 fill，避免掠射处掉成纯黑的一像素。竖向黑旗要保持黑，不再把整条水平暗反射补亮。
      const fillKeep = 0.08 + (envLum < 28 && ndotv < 0.18 ? 0.12 : 0)
      const tint = (channel: number, envC: number) => {
        const f = channel / 255
        return Math.min(255, (f + (1 - f) * fres) * envC * exposure + channel * fillKeep + specAdd * (0.25 + 0.75 * f))
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

function buildModelFresh(node: MeshLayoutNode): ModelPrim[] {
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

function geometryOfFresh(node: MeshLayoutNode): MeshGeometry | null {
  if (node.mesh.type === 'sphere') return buildSphere(node)
  if (node.mesh.type === 'box') return buildBox(node)
  if (node.mesh.type === 'cylinder') return buildCylinder(node)
  if (node.mesh.type === 'torus') return buildTorus(node)
  if (node.mesh.type === 'tube') return buildTube(node)
  if (node.mesh.type === 'extrude') return buildExtrude(node)
  return null
}

function geometryOf(node: MeshLayoutNode): MeshGeometry | null {
  const key = geometryCacheKey(node)
  if (key && geometryCache.has(key)) {
    const hit = geometryCache.get(key) ?? null
    touchCache(geometryCache, key, hit, GEOMETRY_CAP)
    return hit
  }
  const geo = geometryOfFresh(node)
  if (key) touchCache(geometryCache, key, geo, GEOMETRY_CAP)
  return geo
}

function buildModel(node: MeshLayoutNode): ModelPrim[] {
  const key = modelCacheKey(node)
  if (key && modelCache.has(key)) {
    const hit = modelCache.get(key) ?? []
    touchCache(modelCache, key, hit, GEOMETRY_CAP)
    return hit
  }
  const built = buildModelFresh(node)
  if (key) touchCache(modelCache, key, built, GEOMETRY_CAP)
  return built
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
  const depth = takeShadowDepth(width * height)
  const scaleU = width / spanU
  const scaleV = height / spanV
  const light = authored.map((verts) => {
    const buf = new Float32Array(verts.length * 3)
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]!
      const o = i * 3
      buf[o] = (v.x * right.x + v.y * right.y + v.z * right.z - minU) * scaleU
      buf[o + 1] = (v.x * up.x + v.y * up.y + v.z * up.z - minV) * scaleV
      buf[o + 2] = v.x * toward.x + v.y * toward.y + v.z * toward.z
    }
    return buf
  })
  const loadLight = (into: ScreenVert, source: Vert, buf: Float32Array, index: number) => {
    const o = index * 3
    into.x = source.x
    into.y = source.y
    into.z = buf[o + 2]!
    into.nx = source.nx
    into.ny = source.ny
    into.nz = source.nz
    into.u = source.u
    into.v = source.v
    into.sx = buf[o]!
    into.sy = buf[o + 1]!
    into.invW = 1
    return into
  }
  const [la, lb, lc] = SCREEN_SCRATCH
  batches.forEach((batch, batchIndex) => {
    if (batch.material === 'glass') return
    if (!batch.texture && batch.a < 128) return
    const verts = authored[batchIndex]!
    const buf = light[batchIndex]!
    const indices = batch.indices
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i]!
      const i1 = indices[i + 1]!
      const i2 = indices[i + 2]!
      drawShadowTriangle(
        depth,
        width,
        height,
        loadLight(la, verts[i0]!, buf, i0),
        loadLight(lb, verts[i1]!, buf, i1),
        loadLight(lc, verts[i2]!, buf, i2),
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

const spanBox = { min: 0, max: 0 }

function accumEdge(x0: number, y0: number, x1: number, y1: number, y: number) {
  const dy = y1 - y0
  if (Math.abs(dy) < 1e-8) {
    if (Math.abs(y - y0) > 1.5) return
    const lo = x0 < x1 ? x0 : x1
    const hi = x0 < x1 ? x1 : x0
    if (lo < spanBox.min) spanBox.min = lo
    if (hi > spanBox.max) spanBox.max = hi
    return
  }
  const t = (y - y0) / dy
  if (t < -0.05 || t > 1.05) return
  const tc = t < 0 ? 0 : t > 1 ? 1 : t
  const x = x0 + (x1 - x0) * tc
  if (x < spanBox.min) spanBox.min = x
  if (x > spanBox.max) spanBox.max = x
}

/** 扫描线可能盖住的 x。左右各多留一像素，内外仍由重心坐标判断。 */
function scanBounds(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, y: number) {
  spanBox.min = Infinity
  spanBox.max = -Infinity
  accumEdge(ax, ay, bx, by, y)
  accumEdge(bx, by, cx, cy, y)
  accumEdge(cx, cy, ax, ay, y)
  return spanBox.min <= spanBox.max
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
  const e0x = (b.sy - c.sy) / area
  const e0y = (c.sx - b.sx) / area
  const e1x = (c.sy - a.sy) / area
  const e1y = (a.sx - c.sx) / area
  const texture = batch.texture
  for (let iy = minY; iy <= maxY; iy++) {
    const py = iy + 0.5
    if (!scanBounds(a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, py)) continue
    const left = Math.max(minX, Math.floor(spanBox.min) - 1)
    const right = Math.min(maxX, Math.ceil(spanBox.max) + 1)
    let w0 = e0x * (left + 0.5 - c.sx) + e0y * (py - c.sy)
    let w1 = e1x * (left + 0.5 - c.sx) + e1y * (py - c.sy)
    const row = iy * width
    if (texture) {
      for (let ix = left; ix <= right; ix++) {
        const w2 = 1 - w0 - w1
        if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
          const u = w0 * a.u + w1 * b.u + w2 * c.u
          const v = w0 * a.v + w1 * b.v + w2 * c.v
          if (sampleTexture(texture, batch.tw, batch.th, u, v).a >= 128) {
            const d = w0 * a.z + w1 * b.z + w2 * c.z
            const di = row + ix
            if (d > map[di]!) map[di] = d
          }
        }
        w0 += e0x
        w1 += e1x
      }
    } else {
      for (let ix = left; ix <= right; ix++) {
        const w2 = 1 - w0 - w1
        if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
          const d = w0 * a.z + w1 * b.z + w2 * c.z
          const di = row + ix
          if (d > map[di]!) map[di] = d
        }
        w0 += e0x
        w1 += e1x
      }
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

function packOpaque(r: number, g: number, b: number) {
  return (r + g * 256 + b * 65536 + 255 * 16777216) >>> 0
}

let fitL = 0
let fitR = 0

/** 把扫描线收成重心坐标里真正盖住的区间。三角形是凸的，两端在内则中间都在内。 */
function fitCover(
  left: number,
  right: number,
  e0x: number,
  e1x: number,
  e0y: number,
  e1y: number,
  csx: number,
  csy: number,
  py: number,
) {
  const y0 = e0y * (py - csy)
  const y1 = e1y * (py - csy)
  const x0 = 0.5 - csx
  let L = left
  while (L <= right) {
    const w0 = e0x * (L + x0) + y0
    const w1 = e1x * (L + x0) + y1
    if (w0 >= -1e-4 && w1 >= -1e-4 && 1 - w0 - w1 >= -1e-4) break
    L++
  }
  if (L > right) return false
  let R = right
  while (R >= L) {
    const w0 = e0x * (R + x0) + y0
    const w1 = e1x * (R + x0) + y1
    if (w0 >= -1e-4 && w1 >= -1e-4 && 1 - w0 - w1 >= -1e-4) break
    R--
  }
  if (R < L) return false
  fitL = L
  fitR = R
  return true
}

function paintFlatShadowRow(
  depth: Float32Array,
  owners: Int16Array,
  words: Uint32Array,
  smap: Float32Array,
  row: number,
  from: number,
  to: number,
  nz: number,
  nw: number,
  nR: number,
  nU: number,
  nT: number,
  dnz: number,
  dnw: number,
  dnR: number,
  dnU: number,
  dnT: number,
  mapW: number,
  mapH: number,
  minU: number,
  minV: number,
  scaleU: number,
  scaleV: number,
  bias: number,
  openPix: number,
  shutPix: number,
  owner: number,
  writeOwner: boolean,
) {
  for (let ix = from; ix <= to; ix++) {
    if (nw > 1e-8) {
      const inv = 1 / nw
      const z = nz * inv
      const di = row + ix
      if (z >= depth[di]! - 1e-4) {
        const sx = (nR * inv - minU) * scaleU
        const sy = (nU * inv - minV) * scaleV
        let blocked = false
        if (sx >= 0 && sy >= 0 && sx < mapW && sy < mapH) {
          const stored = smap[(sy | 0) * mapW + (sx | 0)]!
          if (stored >= -1e20) blocked = stored > nT * inv + bias
        }
        depth[di] = z
        if (writeOwner) owners[di] = owner
        words[di] = blocked ? shutPix : openPix
      }
    }
    nz += dnz
    nw += dnw
    nR += dnR
    nU += dnU
    nT += dnT
  }
}

function paintFlatPlainRow(
  depth: Float32Array,
  owners: Int16Array,
  words: Uint32Array,
  row: number,
  from: number,
  to: number,
  nz: number,
  nw: number,
  dnz: number,
  dnw: number,
  openPix: number,
  owner: number,
) {
  for (let ix = from; ix <= to; ix++) {
    if (nw > 1e-8) {
      const z = nz / nw
      const di = row + ix
      if (z >= depth[di]! - 1e-4) {
        depth[di] = z
        owners[di] = owner
        words[di] = openPix
      }
    }
    nz += dnz
    nw += dnw
  }
}

/**
 * 不透明、平面、Lambert、写深度的三角。颜色只取决于朝向和阴影，内循环不走贴图和材质分支。
 * 重心和透视插值与 drawTriangle 相同。返回 false 时调用方改走通用路径。
 */
function drawFlatLambert(
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
  writeOwner: boolean,
): boolean {
  if (batch.material !== 'lambert' || !batch.shaded || batch.a < 255 || !batch.depthWrite || batch.texture || batch.outline) return false
  const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx)
  if (Math.abs(area) < 1e-8) return true
  const back = area > 0
  if (back && !batch.doubleSided) return true
  if (a.nx !== b.nx || a.ny !== b.ny || a.nz !== b.nz || a.nx !== c.nx || a.ny !== c.ny || a.nz !== c.nz) return false
  let minX = Math.floor(Math.min(a.sx, b.sx, c.sx))
  let maxX = Math.ceil(Math.max(a.sx, b.sx, c.sx))
  let minY = Math.floor(Math.min(a.sy, b.sy, c.sy))
  let maxY = Math.ceil(Math.max(a.sy, b.sy, c.sy))
  if (maxX < 0 || maxY < 0 || minX >= width || minY >= height) return true
  if (minX < 0) minX = 0
  if (minY < 0) minY = 0
  if (maxX >= width) maxX = width - 1
  if (maxY >= height) maxY = height - 1
  const e0x = (b.sy - c.sy) / area
  const e0y = (c.sx - b.sx) / area
  const e1x = (c.sy - a.sy) / area
  const e1y = (a.sx - c.sx) / area
  const openShade = shadeOf(a.nx, a.ny, a.nz, back, false)
  const shutShade = shadeOf(a.nx, a.ny, a.nz, back, true)
  const openR = byte(batch.r * openShade)
  const openG = byte(batch.g * openShade)
  const openB = byte(batch.b * openShade)
  const shutR = byte(batch.r * shutShade)
  const shutG = byte(batch.g * shutShade)
  const shutB = byte(batch.b * shutShade)
  const words = colorWordView(color)
  if (!words || a.invW <= 1e-4 || b.invW <= 1e-4 || c.invW <= 1e-4) return false
  const openPix = packOpaque(openR, openG, openB)
  const shutPix = packOpaque(shutR, shutG, shutB)
  const ai = a.invW
  const bi = b.invW
  const ci = c.invW
  const azw = a.z * ai
  const bzw = b.z * bi
  const czw = c.z * ci
  const e2x = -e0x - e1x
  const dnz = e0x * azw + e1x * bzw + e2x * czw
  const dnw = e0x * ai + e1x * bi + e2x * ci
  const owner = batch.owner
  const csx = c.sx
  const csy = c.sy
  if (!shadow) {
    for (let iy = minY; iy <= maxY; iy++) {
      const py = iy + 0.5
      if (!scanBounds(a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, py)) continue
      const left = Math.max(minX, Math.floor(spanBox.min) - 1)
      const right = Math.min(maxX, Math.ceil(spanBox.max) + 1)
      if (!fitCover(left, right, e0x, e1x, e0y, e1y, csx, csy, py)) continue
      const w0 = e0x * (fitL + 0.5 - csx) + e0y * (py - csy)
      const w1 = e1x * (fitL + 0.5 - csx) + e1y * (py - csy)
      const w2 = 1 - w0 - w1
      paintFlatPlainRow(
        depth,
        owners,
        words,
        iy * width,
        fitL,
        fitR,
        w0 * azw + w1 * bzw + w2 * czw,
        w0 * ai + w1 * bi + w2 * ci,
        dnz,
        dnw,
        openPix,
        owner,
      )
    }
    return true
  }
  const srx = shadow.right.x
  const sry = shadow.right.y
  const srz = shadow.right.z
  const sux = shadow.up.x
  const suy = shadow.up.y
  const suz = shadow.up.z
  const stx = shadow.toward.x
  const sty = shadow.toward.y
  const stz = shadow.toward.z
  const aR = ai * (a.x * srx + a.y * sry + a.z * srz)
  const bR = bi * (b.x * srx + b.y * sry + b.z * srz)
  const cR = ci * (c.x * srx + c.y * sry + c.z * srz)
  const aU = ai * (a.x * sux + a.y * suy + a.z * suz)
  const bU = bi * (b.x * sux + b.y * suy + b.z * suz)
  const cU = ci * (c.x * sux + c.y * suy + c.z * suz)
  const aT = ai * (a.x * stx + a.y * sty + a.z * stz)
  const bT = bi * (b.x * stx + b.y * sty + b.z * stz)
  const cT = ci * (c.x * stx + c.y * sty + c.z * stz)
  const dnR = e0x * aR + e1x * bR + e2x * cR
  const dnU = e0x * aU + e1x * bU + e2x * cU
  const dnT = e0x * aT + e1x * bT + e2x * cT
  const smap = shadow.depth
  const mapW = shadow.width
  const mapH = shadow.height
  const minU = shadow.minU
  const minV = shadow.minV
  const scaleU = shadow.scaleU
  const scaleV = shadow.scaleV
  const bias = shadowBias(shadow, a.nx, a.ny, a.nz)
  for (let iy = minY; iy <= maxY; iy++) {
    const py = iy + 0.5
    if (!scanBounds(a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, py)) continue
    const left = Math.max(minX, Math.floor(spanBox.min) - 1)
    const right = Math.min(maxX, Math.ceil(spanBox.max) + 1)
    if (!fitCover(left, right, e0x, e1x, e0y, e1y, csx, csy, py)) continue
    const w0 = e0x * (fitL + 0.5 - csx) + e0y * (py - csy)
    const w1 = e1x * (fitL + 0.5 - csx) + e1y * (py - csy)
    const w2 = 1 - w0 - w1
    paintFlatShadowRow(
      depth,
      owners,
      words,
      smap,
      iy * width,
      fitL,
      fitR,
      w0 * azw + w1 * bzw + w2 * czw,
      w0 * ai + w1 * bi + w2 * ci,
      w0 * aR + w1 * bR + w2 * cR,
      w0 * aU + w1 * bU + w2 * cU,
      w0 * aT + w1 * bT + w2 * cT,
      dnz,
      dnw,
      dnR,
      dnU,
      dnT,
      mapW,
      mapH,
      minU,
      minV,
      scaleU,
      scaleV,
      bias,
      openPix,
      shutPix,
      owner,
      writeOwner,
    )
  }
  return true
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
  const round = roundSphere(batch)
  const texture = batch.texture
  for (let iy = minY; iy <= maxY; iy++) {
    const py = iy + 0.5
    if (!scanBounds(a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, py)) continue
    const left = Math.max(minX, Math.floor(spanBox.min) - 1)
    const right = Math.min(maxX, Math.ceil(spanBox.max) + 1)
    let w0 = e0x * (left + 0.5 - c.sx) + e0y * (py - c.sy)
    let w1 = e1x * (left + 0.5 - c.sx) + e1y * (py - c.sy)
    for (let ix = left; ix <= right; ix++) {
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
      let nx = flat ? a.nx : (w0 * a.nx * a.invW + w1 * b.nx * b.invW + w2 * c.nx * c.invW) / iw
      let ny = flat ? a.ny : (w0 * a.ny * a.invW + w1 * b.ny * b.invW + w2 * c.ny * c.invW) / iw
      let nz = flat ? a.nz : (w0 * a.nz * a.invW + w1 * b.nz * b.invW + w2 * c.nz * c.invW) / iw
      let px = x
      let py = y
      let pz = z
      if (round) {
        const hit = sphereSurface(camera, round, x, y, z)
        nx = hit.nx
        ny = hit.ny
        nz = hit.nz
        px = hit.x
        py = hit.y
        pz = hit.z
      }
      const blocked = shadow !== null && occluded(shadow, px, py, pz, nx, ny, nz, flat ? flatBias : undefined)
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
        const painted = materialBytes(batch, nx, ny, nz, back, shade, blocked, px, py, pz, camera)
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

type RasterRect = { x: number; y: number; width: number; height: number }

let emptyCanvas: Canvas | null = null

function emptyMeshFrame(): MeshFrame {
  if (!emptyCanvas) emptyCanvas = createCanvas(1, 1)
  return { canvas: emptyCanvas, x: 0, y: 0, width: 0, height: 0 }
}

function intersectRect(a: RasterRect, b: RasterRect): RasterRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right - x <= 1e-4 || bottom - y <= 1e-4) return null
  return { x, y, width: right - x, height: bottom - y }
}

function snapDown(value: number, step: number) {
  return Math.floor(value / step + 1e-6) * step
}

function snapUp(value: number, step: number) {
  return Math.ceil(value / step - 1e-6) * step
}

function layerProject(p: { x: number; y: number; z: number }, perspective: Perspective, vx: number, vy: number) {
  if (perspective === 'parallel') return { lx: p.x, ly: p.y, invW: 1 }
  if (!(p.z < perspective * (1 - 1e-3))) return null
  const w = 1 - p.z / perspective
  if (w <= 1e-8) return null
  return { lx: vx + (p.x - vx) / w, ly: vy + (p.y - vy) / w, invW: 1 / w }
}

function loadScreen(into: ScreenVert, v: Vert, screen: Float32Array, index: number) {
  const o = index * 3
  into.x = v.x
  into.y = v.y
  into.z = v.z
  into.nx = v.nx
  into.ny = v.ny
  into.nz = v.nz
  into.u = v.u
  into.v = v.v
  into.sx = screen[o]!
  into.sy = screen[o + 1]!
  into.invW = screen[o + 2]!
  return into
}

function projectClipped(v: Vert, perspective: Perspective, vx: number, vy: number, originX: number, originY: number, pixelScale: number): ScreenVert {
  const into: ScreenVert = { x: v.x, y: v.y, z: v.z, nx: v.nx, ny: v.ny, nz: v.nz, u: v.u, v: v.v, sx: 0, sy: 0, invW: 1 }
  if (perspective === 'parallel') {
    into.sx = (v.x - originX) * pixelScale
    into.sy = (v.y - originY) * pixelScale
    return into
  }
  const w = 1 - v.z / perspective
  into.sx = (vx + (v.x - vx) / w - originX) * pixelScale
  into.sy = (vy + (v.y - vy) / w - originY) * pixelScale
  into.invW = 1 / w
  return into
}

/** 采样格刚好铺满时，整块颜色相同就直接拷贝，边缘才做预乘平均。 */
function resolveExact(color: Uint8ClampedArray, sw: number, dw: number, dh: number, samples: number): Canvas | null {
  if (color.byteOffset % 4 !== 0) return null
  const out = createCanvas(dw, dh)
  const octx = out.getContext('2d')
  const image = octx.createImageData(dw, dh)
  const dst = image.data
  if (dst.byteOffset % 4 !== 0) return null
  if (samples === 1) {
    dst.set(color.subarray(0, dw * dh * 4))
    octx.putImageData(image, 0, 0)
    return out
  }
  const srcWords = new Uint32Array(color.buffer, color.byteOffset, color.byteLength >>> 2)
  const dstWords = new Uint32Array(dst.buffer, dst.byteOffset, dw * dh)
  const step = samples
  for (let y = 0; y < dh; y++) {
    const rows: number[] = []
    for (let k = 0; k < step; k++) rows.push((y * step + k) * sw)
    const drow = y * dw
    for (let x = 0; x < dw; x++) {
      const x0 = x * step
      const p0 = srcWords[rows[0]! + x0]!
      let uniform = true
      for (let k = 0; k < step && uniform; k++) {
        const row = rows[k]!
        for (let i = 0; i < step; i++) {
          if (srcWords[row + x0 + i] !== p0) {
            uniform = false
            break
          }
        }
      }
      if (uniform) {
        dstWords[drow + x] = p0 === 0 ? 0 : p0
        if (p0 !== 0 && (p0 >>> 24) === 0) dstWords[drow + x] = 0
        continue
      }
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      const n = step * step
      for (let k = 0; k < step; k++) {
        let si = (rows[k]! + x0) * 4
        for (let i = 0; i < step; i++) {
          const ai = color[si + 3]!
          r += color[si]! * ai
          g += color[si + 1]! * ai
          b += color[si + 2]! * ai
          a += ai
          si += 4
        }
      }
      const di = (drow + x) * 4
      dst[di + 3] = Math.round(a / n)
      if (a > 0) {
        dst[di] = Math.round(r / a)
        dst[di + 1] = Math.round(g / a)
        dst[di + 2] = Math.round(b / a)
      }
    }
  }
  octx.putImageData(image, 0, 0)
  return out
}

/** 把超采样缓冲区平均缩回目标像素。算法和 resolveSamples 相同，只读这块矩形。 */
function resolveColor(color: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Canvas {
  if (dw > 0 && dh > 0 && sw % dw === 0 && sh % dh === 0) {
    const sx = sw / dw
    const sy = sh / dh
    if (sx === sy && (sx === 1 || sx === 2 || sx === 4)) {
      const exact = resolveExact(color, sw, dw, dh, sx)
      if (exact) return exact
    }
  }
  const out = createCanvas(dw, dh)
  const octx = out.getContext('2d')
  const image = octx.createImageData(dw, dh)
  const dst = image.data
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh)
    const y1 = Math.floor(((y + 1) * sh) / dh)
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw)
      const x1 = Math.floor(((x + 1) * sw) / dw)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let iy = y0; iy < y1; iy++) {
        let si = (iy * sw + x0) * 4
        for (let ix = x0; ix < x1; ix++) {
          const ai = color[si + 3]!
          r += color[si]! * ai
          g += color[si + 1]! * ai
          b += color[si + 2]! * ai
          a += ai
          n++
          si += 4
        }
      }
      const di = (y * dw + x) * 4
      dst[di + 3] = n > 0 ? Math.round(a / n) : 0
      if (a > 0) {
        dst[di] = Math.round(r / a)
        dst[di + 1] = Math.round(g / a)
        dst[di + 2] = Math.round(b / a)
      }
    }
  }
  octx.putImageData(image, 0, 0)
  return out
}

function rasterize(
  batches: Batch[],
  layer: LayerLayoutNode,
  perspective: Perspective,
  scale: number,
  samplesRequested: number,
  clip: RasterRect,
): MeshFrame {
  const vx = layer.width / 2
  const vy = layer.height / 2
  const authored: Vert[][] = []
  const projected: Float32Array[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let margin = 1
  for (const batch of batches) {
    if (batch.lines) {
      margin = Math.max(margin, batch.lines.widths[0], batch.lines.widths[1], batch.lines.widths[2], batch.lines.halo)
    }
    const count = batch.positions.length / 3
    const verts: Vert[] = new Array(count)
    const proj = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const p = transformPoint(batch.toLayer, batch.originX, batch.originY, batch.positions[i * 3]!, batch.positions[i * 3 + 1]!, batch.positions[i * 3 + 2]!)
      const n = transformNormal(batch.toLayer, batch.normals[i * 3]!, batch.normals[i * 3 + 1]!, batch.normals[i * 3 + 2]!)
      const u = batch.uvs ? batch.uvs[i * 2]! : 0
      const v = batch.uvs ? batch.uvs[i * 2 + 1]! : 0
      verts[i] = { x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z, u, v }
      const front = layerProject(p, perspective, vx, vy)
      const o = i * 3
      if (front) {
        proj[o] = front.lx
        proj[o + 1] = front.ly
        proj[o + 2] = front.invW
        if (front.lx < minX) minX = front.lx
        if (front.ly < minY) minY = front.ly
        if (front.lx > maxX) maxX = front.lx
        if (front.ly > maxY) maxY = front.ly
      }
    }
    authored.push(verts)
    projected.push(proj)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return emptyMeshFrame()
  const bounds = intersectRect(
    { x: minX - margin, y: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 },
    clip,
  )
  if (!bounds) return emptyMeshFrame()
  const base = Math.max(scale, 1e-3)
  const step = 1 / base
  const originX = snapDown(bounds.x, step)
  const originY = snapDown(bounds.y, step)
  const viewW = snapUp(bounds.x + bounds.width, step) - originX
  const viewH = snapUp(bounds.y + bounds.height, step) - originY
  if (!(viewW > 1e-4) || !(viewH > 1e-4)) return emptyMeshFrame()
  let samples = samplesRequested === 1 || samplesRequested === 2 || samplesRequested === 4 ? samplesRequested : 4
  while (samples > 1 && (viewW * base * samples > MAX_RASTER_SIDE || viewH * base * samples > MAX_RASTER_SIDE)) samples /= 2
  const pixelScale = base * samples
  const pw = Math.max(1, Math.round(viewW * pixelScale))
  const ph = Math.max(1, Math.round(viewH * pixelScale))
  for (const proj of projected) {
    for (let i = 0; i < proj.length; i += 3) {
      if (proj[i + 2] === 0) continue
      proj[i] = (proj[i]! - originX) * pixelScale
      proj[i + 1] = (proj[i + 1]! - originY) * pixelScale
    }
  }
  const writeOwner = batches.some((batch) => batch.lines !== null)
  const buffers = takeRasterBuffers(pw * ph, writeOwner)
  const color = buffers.color
  const depth = buffers.depth
  const owners = buffers.owners
  const shadow = buildShadowMap(batches, authored, Math.max(layer.width, layer.height) * base * 2)
  const near = perspective === 'parallel' ? Number.POSITIVE_INFINITY : perspective * (1 - 1e-3)
  const camera: ShadeCamera =
    perspective === 'parallel' ? { x: 0, y: 0, z: 0, parallel: true } : { x: vx, y: vy, z: perspective }
  const [sa, sb, sc] = SCREEN_SCRATCH
  const paintBatch = (batchIndex: number) => {
    const batch = batches[batchIndex]!
    const verts = authored[batchIndex]!
    const screen = projected[batchIndex]!
    const indices = batch.indices
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i]!
      const i1 = indices[i + 1]!
      const i2 = indices[i + 2]!
      const a = verts[i0]!
      const b = verts[i1]!
      const c = verts[i2]!
      const in0 = a.z < near
      const in1 = b.z < near
      const in2 = c.z < near
      if (in0 && in1 && in2) {
        if (
          !drawFlatLambert(
            color,
            depth,
            owners,
            pw,
            ph,
            loadScreen(sa, a, screen, i0),
            loadScreen(sb, b, screen, i1),
            loadScreen(sc, c, screen, i2),
            batch,
            shadow,
            writeOwner,
          )
        ) {
          drawTriangle(
            color,
            depth,
            owners,
            pw,
            ph,
            sa,
            sb,
            sc,
            batch,
            shadow,
            camera,
          )
        }
        continue
      }
      if (!in0 && !in1 && !in2) continue
      const clipped = clipNear([a, b, c], near)
      for (let k = 1; k < clipped.length - 1; k++) {
        drawTriangle(
          color,
          depth,
          owners,
          pw,
          ph,
          projectClipped(clipped[0]!, perspective, vx, vy, originX, originY, pixelScale),
          projectClipped(clipped[k]!, perspective, vx, vy, originX, originY, pixelScale),
          projectClipped(clipped[k + 1]!, perspective, vx, vy, originX, originY, pixelScale),
          batch,
          shadow,
          camera,
        )
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
  const outW = Math.max(1, Math.round(viewW * base))
  const outH = Math.max(1, Math.round(viewH * base))
  const out = pw >= outW && ph >= outH ? resolveColor(color, pw, ph, outW, outH) : resolveColor(color, pw, ph, pw, ph)
  paintMeshLines(out, batches, authored, depth, owners, pw, ph, layer, perspective, originX, originY, out.width / base, out.height / base)
  return { canvas: out, x: originX, y: originY, width: out.width / base, height: out.height / base }
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
  const outline = sphereOutlineOf(node)
  if (!lines) return { edges: NO_EDGES, lines: null, outline, owner }
  return {
    edges: extractEdges(positions, indices),
    lines,
    outline,
    owner,
  }
}

function facesCamera(
  normal: [number, number, number],
  toLayer: Mat4,
  mid: { x: number; y: number; z: number },
  vx: number,
  vy: number,
  perspective: Perspective,
) {
  const n = transformNormal(toLayer, normal[0], normal[1], normal[2])
  if (perspective === 'parallel') return n.z > 1e-4
  return n.x * (vx - mid.x) + n.y * (vy - mid.y) + n.z * (perspective - mid.z) > 1e-4
}

function isSilhouette(edge: MeshEdge, verts: Vert[], batch: Batch, vx: number, vy: number, perspective: Perspective) {
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
  perspective: Perspective,
  vx: number,
  vy: number,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number,
) {
  if (perspective === 'parallel') {
    return { x: (v.x - originX) * scaleX, y: (v.y - originY) * scaleY, z: v.z }
  }
  const w = 1 - v.z / perspective
  if (w <= 1e-4) return null
  return {
    x: (vx + (v.x - vx) / w - originX) * scaleX,
    y: (vy + (v.y - vy) / w - originY) * scaleY,
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
  owner2 = 0,
): 'visible' | 'hidden' | 'skip' {
  const ix = Math.round(x * mapX)
  const iy = Math.round(y * mapY)
  if (ix < 0 || iy < 0 || ix >= pw || iy >= ph) return 'skip'
  const di = iy * pw + ix
  const stored = depth[di]!
  if (stored < -1e20 || stored <= z + 1.5) return 'visible'
  if (owners[di] !== owner && !(owner2 && owners[di] === owner2)) return 'skip'
  // 轮廓贴着自己的表面，深度会略近于这条线，不能当成隐藏线。
  return outline ? 'visible' : 'hidden'
}

type ScreenSample = { x: number; y: number; z: number; kind: 'visible' | 'hidden' | 'skip' }

function sampleSegment(
  a: Vert,
  b: Vert,
  perspective: Perspective,
  vx: number,
  vy: number,
  originX: number,
  originY: number,
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
  owner2 = 0,
): ScreenSample[] {
  const near = perspective === 'parallel' ? Number.POSITIVE_INFINITY : perspective * (1 - 1e-3)
  let p0 = a
  let p1 = b
  const in0 = p0.z < near
  const in1 = p1.z < near
  if (!in0 && !in1) return []
  if (in0 && !in1) p1 = lerpVert(p0, p1, near)
  else if (!in0 && in1) p0 = lerpVert(p0, p1, near)
  const s0 = projectLayer(p0, perspective, vx, vy, originX, originY, scaleX, scaleY)
  const s1 = projectLayer(p1, perspective, vx, vy, originX, originY, scaleX, scaleY)
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
    const s = projectLayer(v, perspective, vx, vy, originX, originY, scaleX, scaleY)
    if (!s) continue
    out.push({
      x: s.x,
      y: s.y,
      z: s.z,
      kind: classifySample(depth, owners, pw, ph, mapX, mapY, s.x, s.y, s.z, owner, outline, owner2),
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

function sphereRing(center: { x: number; y: number; z: number }, radius: number, vx: number, vy: number, perspective: Perspective): Vert[] | null {
  if (perspective === 'parallel') {
    const count = 72
    const ring: Vert[] = []
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2
      ring.push({
        x: center.x + radius * Math.cos(ang),
        y: center.y + radius * Math.sin(ang),
        z: center.z,
        nx: 0,
        ny: 0,
        nz: 1,
        u: 0,
        v: 0,
      })
    }
    return ring
  }
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

/** 三角形在球里面。沿视线打到球面，法线和阴影都用这个交点，避免背光轮廓被自己的阴影图吃掉。 */
function sphereSurface(
  camera: ShadeCamera,
  round: { x: number; y: number; z: number; radius: number },
  x: number,
  y: number,
  z: number,
) {
  if (camera.parallel) {
    const dx = x - round.x
    const dy = y - round.y
    const rad2 = round.radius * round.radius - dx * dx - dy * dy
    if (rad2 >= 0) {
      const span = round.radius
      return { x, y, z: round.z + Math.sqrt(rad2), nx: dx / span, ny: dy / span, nz: Math.sqrt(rad2) / span }
    }
    const fx = x - round.x
    const fy = y - round.y
    const fz = z - round.z
    const flen = Math.hypot(fx, fy, fz) || 1
    return { x, y, z, nx: fx / flen, ny: fy / flen, nz: fz / flen }
  }
  const ocx = camera.x - round.x
  const ocy = camera.y - round.y
  const ocz = camera.z - round.z
  let dx = x - camera.x
  let dy = y - camera.y
  let dz = z - camera.z
  const len = Math.hypot(dx, dy, dz) || 1
  dx /= len
  dy /= len
  dz /= len
  const b = ocx * dx + ocy * dy + ocz * dz
  const c = ocx * ocx + ocy * ocy + ocz * ocz - round.radius * round.radius
  const disc = b * b - c
  if (disc >= 0) {
    const s = Math.sqrt(disc)
    let t = -b - s
    if (t < 1e-4) t = -b + s
    if (t > 1e-4) {
      const hx = camera.x + dx * t
      const hy = camera.y + dy * t
      const hz = camera.z + dz * t
      const nx = hx - round.x
      const ny = hy - round.y
      const nz = hz - round.z
      const hlen = Math.hypot(nx, ny, nz)
      if (hlen > 1e-4) return { x: hx, y: hy, z: hz, nx: nx / hlen, ny: ny / hlen, nz: nz / hlen }
    }
  }
  const fx = x - round.x
  const fy = y - round.y
  const fz = z - round.z
  const flen = Math.hypot(fx, fy, fz) || 1
  return { x, y, z, nx: fx / flen, ny: fy / flen, nz: fz / flen }
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
type EdgeEnds = { a: string; b: string; owners: readonly number[] }

/** 交界线和参与相交的那两只网格自己的棱接在一起，不互相切开。 */
function joinsParticipant(a: EdgeEnds, b: EdgeEnds) {
  const seam = a.owners.length > 1 ? a : b.owners.length > 1 ? b : null
  if (!seam) return false
  const other = seam === a ? b : a
  return other.owners.some((id) => seam.owners.includes(id))
}

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

/** 折线上离 (x, y) 最近的点，沿折线到两端的距离。 */
function closestAlong(points: ChainPoint[], x: number, y: number) {
  let best = Infinity
  let along = 0
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const vx = b.x - a.x
    const vy = b.y - a.y
    const len2 = vx * vx + vy * vy
    const seg = Math.sqrt(len2)
    let t = 0
    if (len2 > 1e-8) t = Math.min(1, Math.max(0, ((x - a.x) * vx + (y - a.y) * vy) / len2))
    const cx = a.x + vx * t
    const cy = a.y + vy * t
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy)
    if (d2 < best) {
      best = d2
      along = walked + seg * t
    }
    walked += seg
  }
  return { dist2: best, along, total: walked }
}

/**
 * 可见线按 (线宽 / 2 + halo) 盖住更远的线。共用端点的棱不切开，角上仍连着。
 * 盖住的位置贴着这条线自己的端点时也不切开：线管端面和轮廓只在端点相接。
 * 深度差不到 2 个像素的不算压在前面。
 */
function cutCrossings(runs: InkRun[], edges: EdgeEnds[], width: number, height: number, scale: number) {
  if (!runs.some((run) => !run.hidden && run.style.halo > 0)) return
  const zBuf = new Float32Array(width * height)
  const edgeBuf = new Int32Array(width * height)
  zBuf.fill(-1e30)
  edgeBuf.fill(-1)
  const byEdge = new Map<number, ChainPoint[]>()
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
    for (const point of run.points) {
      const list = byEdge.get(point.edge)
      if (list) list.push(point)
      else byEdge.set(point.edge, [point])
      stamp(point.x, point.y, point.z, point.edge, radius)
    }
  }
  for (const run of runs) {
    for (const point of run.points) {
      const ix = Math.round(point.x)
      const iy = Math.round(point.y)
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue
      const i = iy * width + ix
      const other = edgeBuf[i]!
      if (other < 0 || !(zBuf[i]! > point.z + 2)) continue
      const nearEdge = edges[other]
      const farEdge = edges[point.edge]
      if (nearEdge && farEdge && (shareEnds(nearEdge, farEdge) || joinsParticipant(nearEdge, farEdge))) continue
      const nearPts = byEdge.get(other)
      if (!nearPts || nearPts.length < 2) continue
      const hit = closestAlong(nearPts, point.x, point.y)
      if (hit.along < 3 || hit.total - hit.along < 3) continue
      point.cut = true
    }
  }
}

function seamVert(point: { x: number; y: number; z: number }): Vert {
  return { x: point.x, y: point.y, z: point.z, nx: 0, ny: 0, nz: 1, u: 0, v: 0 }
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
  perspective: Perspective,
  originX: number,
  originY: number,
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
  const addEdge = (a: Vert, b: Vert, edgeOwners: readonly number[]) => {
    const id = edges.length
    edges.push({ a: edgeKey(a), b: edgeKey(b), owners: edgeOwners })
    return id
  }
  const consume = (
    a: Vert,
    b: Vert,
    style: LineStyle,
    owner: number,
    outline: boolean,
    kind: 0 | 1,
    hiddenRuns: PointRun[],
    owner2 = 0,
  ) => {
    const edge = addEdge(a, b, owner2 ? [owner, owner2] : [owner])
    for (const run of collectRuns(
      sampleSegment(
        a,
        b,
        perspective,
        vx,
        vy,
        originX,
        originY,
        scaleX,
        scaleY,
        depth,
        owners,
        pw,
        ph,
        mapX,
        mapY,
        owner,
        outline,
        owner2,
      ),
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
  const groups: Array<{ owner: number; style: LineStyle; parts: Array<{ verts: Vert[]; indices: Uint32Array }> }> = []
  const byOwner = new Map<number, (typeof groups)[number]>()
  batches.forEach((batch, index) => {
    const style = batch.lines
    const verts = authored[index]
    if (!style || !verts) return
    let group = byOwner.get(batch.owner)
    if (!group) {
      group = { owner: batch.owner, style, parts: [] }
      byOwner.set(batch.owner, group)
      groups.push(group)
    }
    group.style = style
    group.parts.push({ verts, indices: batch.indices })
  })
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const earlier = groups[i]!
      const later = groups[j]!
      const hiddenRuns: PointRun[] = []
      for (const left of earlier.parts) {
        for (const right of later.parts) {
          for (const segment of meshIntersections(left.verts, left.indices, right.verts, right.indices)) {
            consume(seamVert(segment.a), seamVert(segment.b), later.style, later.owner, false, 1, hiddenRuns, earlier.owner)
          }
        }
      }
      if (later.style.hiddenCss) {
        for (const chain of chainHidden(hiddenRuns)) runs.push({ points: chain, hidden: true, kind: 2, style: later.style })
      }
    }
  }
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
  const samples = input.samples === 1 || input.samples === 2 || input.samples === 4 ? input.samples : 4
  const clip = input.clip ?? { x: 0, y: 0, width: layer.width, height: layer.height }
  const batches: Batch[] = []
  let nextOwner = 1
  for (const instance of meshes) {
    const node = instance.node
    if (node.width <= 0 && node.mesh.type !== 'extrude') continue
    const o = originOffset(node.origin, node.width, node.height)
    if (behindCamera(applyPoseMatrix(instance.toLayer, o.x, o.y, 0).z, perspective)) continue
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
  return rasterize(batches, layer, perspective, scale, samples, clip)
}
