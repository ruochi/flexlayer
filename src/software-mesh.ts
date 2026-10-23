import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { MESH_SAMPLES, resolveGrid } from './tri-raster.mjs'
import { readFileSync, statSync } from 'node:fs'
import { solidPaint } from './gradient.js'
import { parseGlb, type GlbPrimitive } from './glb.js'
import { heldModelPrims } from './three.js'
import { bevelFewFaces, bevelRadius } from './mesh-bevel.js'
import { originOffset } from './matrix.js'
import type { MeshClip } from './mesh-cache.js'
import { applyDepthOfField } from './dof.js'
import { applyPoseMatrix, behindCamera, type Perspective } from './perspective.js'
import { tessellateSvgPath } from './path.js'
import type { GroundLayoutNode, LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'
import { buildBoxMesh, buildCylinderMesh, buildExtrudeMesh, buildSphereMesh, buildTorusMesh, buildTubeMesh, coverStrokesNative, downsampleSurfaceNative, meshExtractEdges, meshStrokeRuns, rasterizeNative, sphereRingPoints, transformNormalNative, transformPointNative, uniformSphereNative } from './rasterize-native.js'

type MeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

/**
 * 网格的三角形光栅。
 * 投影用 `project` 的同一套公式（这里直接算），深度大的像素盖住深度小的。
 * `camera="parallel"` 时不除视距，屏幕坐标就是层坐标。
 * 正对镜头的面是 fill，侧面按内置主光和补光变暗。
 * 主光沿固定方向打一张正交深度图：不透明三角形互相挡住这盏光时，主光不计。
 * `shadows="none"` 不建这张图。`cast-shadow="false"` 的批次不写入，`receive-shadow="false"` 的表面不变暗。
 * glb 和内存网格用图元上的底色乘这套明暗。不写 material 时，金属度不小于 0.5 走 metal，否则走 plastic，粗糙度用图元自己的值。
 * 写了 stroke 时，在超采样缓冲上按屏幕像素描折棱和轮廓，再和填充一起平均缩回。
 * 两只都写了 stroke 的网格相互穿过时，交界线算折棱，颜色和宽度跟后写的那只。
 * hidden 只画被这只网格自己挡住的棱，虚线是 6 实 4 空。交界线被这两只中任意一只挡住时同样算隐藏线。
 * 不写 material 时是磨砂：主光乘 fill。plastic 和 metal 用同一套磨砂明暗，再叠摄影棚环境，没有缩成一点的高光。glass 是假玻璃，后画：反射留着主灯，折射再按位置扫这张环境。
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
  /** 内容坐标。给出时按这个多边形画，不再用位图四角。 */
  polygon?: Array<{ u: number; v: number }>
}

export type GroundDraw = { node: GroundLayoutNode; toLayer: Mat4; opacity?: number }

export type SoftwareMeshInput = {
  layer: LayerLayoutNode
  perspective: Perspective
  meshes: Array<{ node: MeshLayoutNode; toLayer: Mat4; opacity?: number }>
  grounds?: GroundDraw[]
  planes: Array<{ node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }>
  scale: number
  raster: (node: LayoutNode, toLayer?: number[]) => RasterBitmap
  /** 1、2 或 4。缺省跟画布 WebGL 一样，是 MESH_SAMPLES，不再因为视口伸出画面而降档。 */
  samples?: number
  /** 这一层坐标里要画的范围。和投影外框求交后再分配缓冲区。 */
  clip?: MeshClip
}

export type MeshEdge = {
  a: number
  b: number
  n0: [number, number, number]
  n1: [number, number, number] | null
  crease: boolean
}

type LineStyle = {
  css: string
  hiddenCss: string | null
  /** 卡通折痕跟本色加深。不写时折痕和轮廓同一色。 */
  creaseCss?: string | null
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
  /** 不透明时写入主光阴影图。 */
  castShadow: boolean
  /** 被挡住时按主光变暗。 */
  receiveShadow: boolean
  /** lambert 是默认磨砂（matte）和平面的明暗。glass 不写主光阴影，半透明时不写深度。 */
  material: 'lambert' | 'plastic' | 'metal' | 'glass' | 'lamp' | 'neon'
  roughness: number
  metalness?: number
  clearcoat?: number
  clearcoatRoughness?: number
  sheen?: number
  anisotropy?: number
  /** 预烘材质球的名字。空则走原来的明暗。 */
  matcap?: string | null
  texture: Uint8ClampedArray | null
  tw: number
  th: number
  /** 底色贴图。取样后乘进明暗，不像平面贴图那样直接当像素。 */
  albedoMap?: GlbPrimitive['map']
  /** 每个顶点的底色，0–255。 */
  colors?: Float32Array
  emissiveR?: number
  emissiveG?: number
  emissiveB?: number
  toLayer: Mat4
  originX: number
  originY: number
  /** 同一只网格的图元共用，用来区分「自己挡住」和「别的物体挡住」。 */
  owner: number
  edges: MeshEdge[]
  lines: LineStyle | null
  outline: SphereOutline | null
  /** 卡通和漫画跟这条曲线走。不写是平面。 */
  form?: 'sphere' | 'cylinder' | 'flat'
  /** 线段下标对。和三角形分开，避免线框被当成面去填，也避免投出错误的影子三角。 */
  segmentIndices?: Uint32Array | null
  /** 屏幕像素。线段粗细，不写是 1。 */
  linePx?: number
  /** 点的顶点下标。和三角形、线段分开。 */
  pointIndices?: Uint32Array | null
  /** 屏幕像素。点的直径，不写是 1。 */
  pointPx?: number
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
  cr?: number
  cg?: number
  cb?: number
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
  roughness: number
  metalness: number
  doubleSided: boolean
  shade?: 'matte' | 'plastic' | 'metal' | 'glass'
  uvs?: Float32Array
  colors?: Float32Array
  map?: GlbPrimitive['map']
  emissive?: [number, number, number]
  clearcoat?: number
  clearcoatRoughness?: number
  transmission?: number
  ior?: number
  sheen?: number
  anisotropy?: number
  /** 下标是线段对，不光栅三角形。 */
  lines?: boolean
  linePx?: number
  /** 下标是顶点，画成屏幕像素的圆点。 */
  points?: boolean
  pointPx?: number
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
  const bevel = node.stroke === 'none' ? '|b' : ''
  const head = `${mesh.type}|${quantGeometry(node.width)}|${quantGeometry(node.height)}|${originKey(node)}${bevel}`
  if (mesh.type === 'sphere') return `${head}|${quantGeometry(mesh.r)}`
  if (mesh.type === 'box') return `${head}|${quantGeometry(mesh.depth)}|${quantGeometry(mesh.rx)}|${mesh.edges.join(',')}`
  if (mesh.type === 'extrude') return `${head}|${quantGeometry(mesh.depth)}|${mesh.fillRule}|${mesh.d}`
  if (mesh.type === 'cylinder') return `${head}|${mesh.axis ?? 'y'}|${quantGeometry(mesh.r)}|${quantGeometry(mesh.height)}|${quantGeometry(mesh.rx)}|${mesh.rims.join(',')}`
  if (mesh.type === 'torus') return `${head}|${quantGeometry(mesh.r)}|${quantGeometry(mesh.tube)}`
  if (mesh.type === 'tube') return `${head}|${quantGeometry(mesh.r)}|${mesh.d}`
  return null
}

function modelCacheKey(node: MeshLayoutNode): string | null {
  if (node.mesh.type !== 'model') return null
  const mesh = node.mesh
  const bevel = node.stroke === 'none' ? '|b' : ''
  const unit = mesh.unit != null && mesh.unit > 0 ? `|u${quantGeometry(mesh.unit)}` : ''
  const tail = `${quantGeometry(node.width)}|${quantGeometry(node.height)}|${quantGeometry(node.opacity)}|${originKey(node)}${bevel}${unit}`
  if (mesh.revision) return `mem|${mesh.revision}|${tail}`
  if (!mesh.file) return null
  let stamp = 'missing'
  try {
    const st = statSync(mesh.file)
    stamp = `${st.mtimeMs}:${st.size}`
  } catch {
    stamp = 'missing'
  }
  return `${mesh.file}|${stamp}|${tail}`
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

export function transformPoint(toLayer: Mat4, ox: number, oy: number, gx: number, gy: number, gz: number) {
  return transformPointNative(toLayer, ox, oy, gx, gy, gz)
}

export function transformNormal(toLayer: Mat4, nx: number, ny: number, nz: number) {
  return transformNormalNative(toLayer, nx, ny, nz)
}

function place(node: MeshLayoutNode) {
  const o = originOffset(node.origin, node.width, node.height)
  return { tx: node.width / 2 - o.x, ty: -(node.height / 2 - o.y) }
}

function packRings(rings: Array<{ closed: boolean; points: Array<{ x: number; y: number }> }>) {
  return rings.map((ring) => ({
    closed: ring.closed,
    xy: ring.points.flatMap((p) => [p.x, p.y]),
  }))
}

function buildSphere(node: MeshLayoutNode) {
  if (node.mesh.type !== 'sphere') return null
  const { tx, ty } = place(node)
  return buildSphereMesh(node.mesh.r, tx, ty)
}

function buildBox(node: MeshLayoutNode) {
  if (node.mesh.type !== 'box') return null
  const { tx, ty } = place(node)
  return buildBoxMesh(node.width / 2, node.height / 2, node.mesh.depth / 2, node.mesh.rx, node.mesh.edges, tx, ty)
}

function buildCylinder(node: MeshLayoutNode) {
  if (node.mesh.type !== 'cylinder') return null
  const { tx, ty } = place(node)
  return buildCylinderMesh(node.mesh.axis === 'z', node.mesh.r, node.mesh.height, node.mesh.rx, node.mesh.rims, tx, ty)
}

function buildTorus(node: MeshLayoutNode) {
  if (node.mesh.type !== 'torus') return null
  const { tx, ty } = place(node)
  return buildTorusMesh(node.mesh.r, node.mesh.tube, tx, ty)
}

function buildTube(node: MeshLayoutNode) {
  if (node.mesh.type !== 'tube') return null
  const o = originOffset(node.origin, node.width, node.height)
  return buildTubeMesh(node.mesh.r, o.x, o.y, packRings(tessellateSvgPath(node.mesh.d, 12, Math.PI / 20)))
}

function buildExtrude(node: MeshLayoutNode) {
  if (node.mesh.type !== 'extrude') return null
  const o = originOffset(node.origin, node.width, node.height)
  return buildExtrudeMesh(node.mesh.depth, node.mesh.fillRule, o.x, o.y, packRings(tessellateSvgPath(node.mesh.d, 16, Math.PI / 24)))
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
  if (node.mesh.type !== 'model') return []
  const mesh = node.mesh
  let prims = heldModelPrims(mesh)
  if (!prims) {
    if (!mesh.file) return []
    try {
      prims = parseGlb(readFileSync(mesh.file))
    } catch {
      return []
    }
  }
  const useUnit = mesh.unit != null && mesh.unit > 0
  let cx = 0
  let cy = 0
  let cz = 0
  let s = useUnit ? mesh.unit! : 1
  let shiftX = 0
  let shiftY = 0
  if (useUnit && mesh.bounds) {
    const o = originOffset(node.origin, node.width, node.height)
    const localX = -mesh.bounds.minX * s
    const localY = mesh.bounds.maxY * s
    shiftX = localX - o.x
    shiftY = o.y - localY
  } else if (!useUnit) {
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
    s = Math.min(sx, sy)
    if (!Number.isFinite(s) || s <= 0) return []
    cx = (minX + maxX) / 2
    cy = (minY + maxY) / 2
    cz = (minZ + maxZ) / 2
    const o = originOffset(node.origin, node.width, node.height)
    shiftX = node.width / 2 - o.x
    shiftY = -(node.height / 2 - o.y)
  }
  const out: ModelPrim[] = []
  for (const prim of prims) {
    const src = prim.positions
    const positions = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      positions[i] = (src[i]! - cx) * s + shiftX
      positions[i + 1] = (src[i + 1]! - cy) * s + shiftY
      positions[i + 2] = (src[i + 2]! - cz) * s
    }
    const count = Math.floor(positions.length / 3)
    if (prim.lines) {
      const pairs = prim.indices
      if (!pairs || pairs.length < 2) continue
      const ink = prim.color
      out.push({
        positions,
        normals: new Float32Array(positions.length),
        indices: pairs,
        color: [
          byte(ink[0] * 255),
          byte(ink[1] * 255),
          byte(ink[2] * 255),
          byte(ink[3] * node.opacity * 255),
        ],
        roughness: 1,
        metalness: 0,
        doubleSided: true,
        lines: true,
        linePx: prim.linePx && prim.linePx > 0 ? prim.linePx : 1,
      })
      continue
    }
    if (prim.points) {
      const ids = prim.indices
      if (!ids || ids.length < 1) continue
      const ink = prim.color
      out.push({
        positions,
        normals: new Float32Array(positions.length),
        indices: ids,
        color: [
          byte(ink[0] * 255),
          byte(ink[1] * 255),
          byte(ink[2] * 255),
          byte(ink[3] * node.opacity * 255),
        ],
        roughness: 1,
        metalness: 0,
        doubleSided: true,
        points: true,
        pointPx: prim.pointPx && prim.pointPx > 0 ? prim.pointPx : 1,
      })
      continue
    }
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
      roughness: Math.min(1, Math.max(0, prim.roughness)),
      metalness: Math.min(1, Math.max(0, prim.metalness)),
      doubleSided: prim.doubleSided,
      shade: prim.shade,
      uvs: prim.uvs,
      colors: prim.colors ? scaleVertexColors(prim.colors) : undefined,
      map: prim.map,
      emissive: prim.emissive,
      clearcoat: prim.clearcoat,
      clearcoatRoughness: prim.clearcoatRoughness,
      transmission: prim.transmission,
      ior: prim.ior,
      sheen: prim.sheen,
      anisotropy: prim.anisotropy,
    })
  }
  return out
}

function geometryOfFresh(node: MeshLayoutNode): MeshGeometry | null {
  let geo: MeshGeometry | null = null
  if (node.mesh.type === 'sphere') geo = buildSphere(node)
  else if (node.mesh.type === 'box') geo = buildBox(node)
  else if (node.mesh.type === 'cylinder') geo = buildCylinder(node)
  else if (node.mesh.type === 'torus') geo = buildTorus(node)
  else if (node.mesh.type === 'tube') geo = buildTube(node)
  else if (node.mesh.type === 'extrude') geo = buildExtrude(node)
  return geo
}

/** 沿厚度收棱。盒子和挤出用 depth，圆柱用轴向长度，其余用 z 向跨度。 */
function bevelDepth(node: MeshLayoutNode, positions: Float32Array): number {
  const mesh = node.mesh
  if (mesh.type === 'box' || mesh.type === 'extrude') return mesh.depth
  if (mesh.type === 'cylinder') return mesh.height
  if (mesh.type === 'sphere') return mesh.r * 2
  if (mesh.type === 'torus') return mesh.tube * 2
  if (mesh.type === 'tube') return mesh.r * 2
  let min = Infinity
  let max = -Infinity
  for (let i = 2; i < positions.length; i += 3) {
    const z = positions[i]!
    if (z < min) min = z
    if (z > max) max = z
  }
  return Number.isFinite(min) ? max - min : 0
}

/** 窄圆角只进光栅。投影仍用原来的折点，避免圆角把正面的角标成挡住。 */
function paintGeometry(node: MeshLayoutNode, positions: Float32Array, normals: Float32Array, indices: Uint32Array, shading?: string) {
  if (node.stroke !== 'none' || (lookDrawsLines(shading) && !node.strokeOff)) return { positions, normals, indices }
  const mesh = node.mesh
  if (mesh.type === 'tube') return { positions, normals, indices }
  if ((mesh.type === 'box' || mesh.type === 'cylinder') && mesh.rx > 0) return { positions, normals, indices }
  return bevelFewFaces(positions, indices, bevelRadius(bevelDepth(node, positions))) ?? { positions, normals, indices }
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

export type MeshPrim = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** 0–255。几何体是不透明，模型图元用文件里的透明度。 */
  alpha: number
  doubleSided: boolean
}

/** 一只网格的图元。模型和几何体都从这里拿。投影用这些折点；窄圆角在绘制时另加。 */
export function meshPrims(node: MeshLayoutNode): MeshPrim[] {
  if (node.mesh.type === 'model') {
      return buildModel(node).map((prim) => ({
      positions: prim.positions,
      normals: prim.normals,
      indices: prim.lines || prim.points ? new Uint32Array(0) : prim.indices,
      alpha: prim.color[3],
      doubleSided: prim.doubleSided,
    }))
  }
  const geometry = geometryOf(node)
  if (!geometry) return []
  return [
    {
      positions: geometry.positions,
      normals: geometry.normals,
      indices: geometry.indices,
      alpha: 255,
      doubleSided: node.mesh.type === 'extrude',
    },
  ]
}

/** 和绘制同一套：不写深度的表面不挡住后面的棱。 */
export function meshWritesDepth(node: MeshLayoutNode, opacity: number, primAlpha = 255): boolean {
  const glass = node.material?.kind === 'glass'
  if (node.mesh.type === 'model') return glass && primAlpha < 255 ? false : primAlpha >= 255
  const clear = node.fill === 'none' || node.fill === 'transparent'
  const fillNone = clear && !glass
  const a = fillNone || clear ? 0 : fillBytes(node.fill, opacity)[3]
  return glass && a < 255 ? false : fillNone || a >= 255
}

function scaleVertexColors(colors: Float32Array): Float32Array {
  const out = new Float32Array(colors.length)
  for (let i = 0; i < colors.length; i++) out[i] = byte(colors[i]! * 255)
  return out
}


type RasterRect = { x: number; y: number; width: number; height: number }

let emptyCanvas: Canvas | null = null

function emptyMeshFrame(): MeshFrame {
  if (!emptyCanvas) emptyCanvas = createCanvas(1, 1)
  return { canvas: emptyCanvas, x: 0, y: 0, width: 0, height: 0 }
}


/** 采样格刚好铺满时，交给和画布 WebGL 同一份 resolveGrid。 */
function resolveExact(color: Uint8ClampedArray, sw: number, dw: number, dh: number, samples: number): Canvas | null {
  if (color.byteOffset % 4 !== 0) return null
  const out = createCanvas(dw, dh)
  const octx = out.getContext('2d')
  const image = octx.createImageData(dw, dh)
  const dst = image.data
  if (dst.byteOffset % 4 !== 0) return null
  if (!resolveGrid(color, sw, dw, dh, samples, dst)) return null
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

function authoredVerts(batch: Batch): Vert[] {
  const count = batch.positions.length / 3
  const verts: Vert[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const p = transformPoint(
      batch.toLayer,
      batch.originX,
      batch.originY,
      batch.positions[i * 3]!,
      batch.positions[i * 3 + 1]!,
      batch.positions[i * 3 + 2]!,
    )
    const n = transformNormal(
      batch.toLayer,
      batch.normals[i * 3] ?? 0,
      batch.normals[i * 3 + 1] ?? 0,
      batch.normals[i * 3 + 2] ?? 0,
    )
    const u = batch.uvs ? batch.uvs[i * 2]! : 0
    const v = batch.uvs ? batch.uvs[i * 2 + 1]! : 0
    verts[i] = { x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z, u, v }
  }
  return verts
}

/** Fill is native. Stroke geometry still uses paintMeshLines so canvas dashes match. */
function paintNativeLines(
  batches: Batch[],
  layer: LayerLayoutNode,
  perspective: Perspective,
  scale: number,
  samplesRequested: number,
  clip: RasterRect,
  grounds: Parameters<typeof rasterizeNative>[6],
): MeshFrame {
  const frame = rasterizeNative(batches, layer, perspective, scale, samplesRequested, clip, grounds, true)
  const pw = frame.hiWidth ?? 0
  const ph = frame.hiHeight ?? 0
  if (!(pw > 0) || !(ph > 0) || !frame.pixels || !frame.depth || !frame.owners) return emptyMeshFrame()
  const originX = frame.x
  const originY = frame.y
  const viewW = frame.viewW ?? frame.width
  const viewH = frame.viewH ?? frame.height
  const samples = frame.samples ?? samplesRequested
  const base = Math.max(scale, 1e-3)
  const outW = Math.max(1, Math.round(viewW * base))
  const outH = Math.max(1, Math.round(viewH * base))
  const authored = batches.map(authoredVerts)
  const color = frame.pixels instanceof Uint8ClampedArray ? frame.pixels : new Uint8ClampedArray(frame.pixels)
  const depth = frame.depth instanceof Float32Array ? frame.depth : new Float32Array(frame.depth)
  const owners = frame.owners instanceof Int16Array ? frame.owners : new Int16Array(frame.owners)
  const stroked = batches.some((batch) => batch.lines)
  let canvas: Canvas
  let hiColor: Uint8ClampedArray
  if (stroked && samples > 1 && pw > outW && ph > outH) {
    const hi = createCanvas(pw, ph)
    const hctx = hi.getContext('2d')
    const image = hctx.createImageData(pw, ph)
    image.data.set(color)
    hctx.putImageData(image, 0, 0)
    paintMeshLines(hi, batches, authored, depth, owners, pw, ph, layer, perspective, originX, originY, viewW, viewH)
    hiColor = hctx.getImageData(0, 0, pw, ph).data
    canvas = resolveColor(hiColor, pw, ph, outW, outH)
  } else {
    hiColor = color
    canvas = pw >= outW && ph >= outH ? resolveColor(color, pw, ph, outW, outH) : resolveColor(color, pw, ph, pw, ph)
    paintMeshLines(canvas, batches, authored, depth, owners, pw, ph, layer, perspective, originX, originY, canvas.width / base, canvas.height / base)
  }
  const plain: MeshFrame = { canvas, x: originX, y: originY, width: canvas.width / base, height: canvas.height / base }
  const dof = layer.dof
  if (!dof || typeof perspective !== 'number') return plain
  const dw = canvas.width
  const dh = canvas.height
  const sampled = downsampleSurface(hiColor, depth, owners, pw, ph, dw, dh)
  const ctx = canvas.getContext('2d')
  const painted = ctx.getImageData(0, 0, dw, dh)
  coverStrokes(painted.data, sampled.depth, sampled.sharp, dw, dh)
  const blurred = applyDepthOfField({
    pixels: painted.data,
    width: dw,
    height: dh,
    depth: sampled.depth,
    sharp: sampled.sharp,
    focal: perspective,
    dof,
    pixelScale: base,
  })
  if (blurred.pad === 0) return plain
  const out = createCanvas(blurred.width, blurred.height)
  const octx = out.getContext('2d')
  const image = octx.createImageData(blurred.width, blurred.height)
  image.data.set(blurred.pixels)
  octx.putImageData(image, 0, 0)
  const pad = blurred.pad / base
  return { canvas: out, x: originX - pad, y: originY - pad, width: out.width / base, height: out.height / base }
}

function rasterize(
  batches: Batch[],
  layer: LayerLayoutNode,
  perspective: Perspective,
  scale: number,
  samplesRequested: number,
  clip: RasterRect,
  grounds: GroundDraw[] = [],
): MeshFrame {
  const stroked = batches.some((batch) => batch.lines)
  const nativeGrounds = grounds.map((ground) => {
    const opacity = (ground.opacity ?? 1) * ground.node.opacity
    const fill = ground.node.fill ? fillBytes(ground.node.fill, opacity) : null
    const ink = fillBytes(ground.node.shadowColor, opacity * ground.node.shadowOpacity)
    return {
      toLayer: ground.toLayer,
      opacity,
      hasFill: fill != null,
      fillR: fill ? fill[0] : 0,
      fillG: fill ? fill[1] : 0,
      fillB: fill ? fill[2] : 0,
      fillA: fill ? fill[3] : 0,
      inkR: ink[0],
      inkG: ink[1],
      inkB: ink[2],
      inkA: ink[3],
      shadowBlur: ground.node.shadowBlur,
      receiveShadow: ground.node.receiveShadow !== false,
    }
  })
  if (!stroked && !layer.dof) return rasterizeNative(batches, layer, perspective, scale, samplesRequested, clip, nativeGrounds)
  return paintNativeLines(batches, layer, perspective, scale, samplesRequested, clip, nativeGrounds)
}

function downsampleSurface(
  color: Uint8ClampedArray,
  depth: Float32Array,
  owners: Int16Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): { depth: Float32Array; sharp: Uint8Array } {
  return downsampleSurfaceNative(color, depth, owners, sw, sh, dw, dh)
}

/** 描边画在填充外面时，把旁边表面的深度借过来，否则这些像素没有景深。 */
function coverStrokes(color: Uint8ClampedArray, depth: Float32Array, sharp: Uint8Array, w: number, h: number) {
  const next = coverStrokesNative(color, depth, sharp, w, h)
  depth.set(next.depth)
  sharp.set(next.sharp)
}

function rgbaCss(r: number, g: number, b: number, a: number) {
  return `rgba(${r},${g},${b},${(a / 255).toFixed(4)})`
}

const LOOK_INK = [28, 25, 21] as const
const LOOK_HIDDEN = [154, 143, 128] as const

function lookDrawsLines(shading: string | undefined): boolean {
  return shading === 'toon' || shading === 'technical' || shading === 'manga'
}

/** 零件投影半径大约是布局短边的一半。卡通和漫画按这个收线宽。 */
function lineScale(node: MeshLayoutNode): number {
  const r = Math.min(node.width, node.height) / 2
  if (!(r > 0)) return 1
  return Math.min(1, Math.max(0.55, Math.sqrt(r / 90)))
}

function formOf(node: MeshLayoutNode): 'sphere' | 'cylinder' | 'flat' {
  if (node.mesh.type === 'sphere') return 'sphere'
  if (node.mesh.type === 'cylinder' && node.mesh.axis !== 'z') return 'cylinder'
  return 'flat'
}

function lineStyleOf(node: MeshLayoutNode, opacity: number, shading?: string): LineStyle | null {
  if (node.stroke !== 'none') {
    const widths = node.strokeWidths
    if (!(Math.max(widths[0], widths[1], widths[2]) > 0)) return null
    const [r, g, b, a] = fillBytes(node.stroke, opacity)
    if (a <= 0) return null
    let hiddenCss: string | null = null
    if (node.hidden !== 'none') {
      const [hr, hg, hb, ha] = fillBytes(node.hidden, opacity)
      if (ha > 0) hiddenCss = rgbaCss(hr, hg, hb, ha)
    }
    return { css: rgbaCss(r, g, b, a), hiddenCss, widths, halo: node.halo }
  }
  if (node.strokeOff || !lookDrawsLines(shading)) return null
  const a = byte(opacity * 255)
  if (a <= 0) return null
  const scale = shading === 'technical' ? 1 : lineScale(node)
  const widths: [number, number, number] = shading === 'technical' ? [3, 2, 1] : [4 * scale, 2 * scale, 0]
  const css = rgbaCss(LOOK_INK[0], LOOK_INK[1], LOOK_INK[2], a)
  const hiddenCss = shading === 'technical' ? rgbaCss(LOOK_HIDDEN[0], LOOK_HIDDEN[1], LOOK_HIDDEN[2], a) : null
  let creaseCss: string | null = null
  if (shading === 'toon') {
    const [fr, fg, fb] = fillBytes(node.fill, 1)
    creaseCss = rgbaCss(byte(fr * 0.45), byte(fg * 0.45), byte(fb * 0.45), a)
  }
  return { css, hiddenCss, creaseCss, widths, halo: 0 }
}

function sphereOutlineOf(node: MeshLayoutNode): SphereOutline | null {
  if (node.mesh.type !== 'sphere') return null
  const o = originOffset(node.origin, node.width, node.height)
  return { x: node.width / 2 - o.x, y: -(node.height / 2 - o.y), z: 0, r: node.mesh.r }
}

/** 按位置焊顶点，丢掉共面三角的对角线，留下折棱和边界。 */
function extractEdges(positions: Float32Array, indices: Uint32Array): MeshEdge[] {
  return meshExtractEdges(positions, indices)
}

const edgeCache = new Map<string, MeshEdge[]>()

/** 同一只网格的局部几何不变时，折棱表可以接着用。姿态变了也不用重算。 */
function geomKey(positions: Float32Array, indices: Uint32Array): string {
  let hash = 2166136261
  const pos = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)
  const idx = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength)
  for (let i = 0; i < pos.length; i++) hash = Math.imul(hash ^ pos[i]!, 16777619)
  for (let i = 0; i < idx.length; i++) hash = Math.imul(hash ^ idx[i]!, 16777619)
  return `${positions.length}:${indices.length}:${hash >>> 0}`
}

export function meshEdges(positions: Float32Array, indices: Uint32Array): MeshEdge[] {
  if (indices.length < 3) return NO_EDGES
  const key = geomKey(positions, indices)
  const hit = edgeCache.get(key)
  if (hit) return hit
  const edges = extractEdges(positions, indices)
  if (edgeCache.size > 128) edgeCache.clear()
  edgeCache.set(key, edges)
  return edges
}

function meshLineFields(
  node: MeshLayoutNode,
  opacity: number,
  positions: Float32Array,
  indices: Uint32Array,
  owner: number,
  shading?: string,
): Pick<Batch, 'edges' | 'lines' | 'outline' | 'owner' | 'form'> {
  const lines = lineStyleOf(node, opacity, shading)
  const outline = sphereOutlineOf(node)
  if (!lines) return { edges: NO_EDGES, lines: null, outline, owner, form: formOf(node) }
  return {
    edges: meshEdges(positions, indices),
    lines,
    outline,
    owner,
    form: formOf(node),
  }
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


export function sphereRing(center: { x: number; y: number; z: number }, radius: number, vx: number, vy: number, perspective: Perspective): Vert[] | null {
  const parallel = perspective === 'parallel'
  const ring = sphereRingPoints(center.x, center.y, center.z, radius, vx, vy, parallel, parallel ? 0 : perspective)
  if (!ring) return null
  return ring.map((point: { x: number; y: number; z: number }) => ({ x: point.x, y: point.y, z: point.z, nx: 0, ny: 0, nz: 1, u: 0, v: 0 }))
}

function roundSphere(batch: Batch): { x: number; y: number; z: number; radius: number } | null {
  const outline = batch.outline
  if (!outline) return null
  return uniformSphere(
    batch.toLayer,
    batch.originX,
    batch.originY,
    outline.x,
    outline.y,
    outline.z,
    outline.r,
  )
}

/** 三轴半径差不多时，轮廓用这个球，不再把细分三角的边当成折点。 */
export function layerSphere(node: MeshLayoutNode, toLayer: Mat4): { x: number; y: number; z: number; radius: number } | null {
  const outline = sphereOutlineOf(node)
  if (!outline) return null
  const origin = originOffset(node.origin, node.width, node.height)
  return uniformSphere(toLayer, origin.x, origin.y, outline.x, outline.y, outline.z, outline.r)
}

function uniformSphere(
  toLayer: Mat4,
  originX: number,
  originY: number,
  x: number,
  y: number,
  z: number,
  radius: number,
): { x: number; y: number; z: number; radius: number } | null {
  return uniformSphereNative(toLayer, originX, originY, x, y, z, radius)
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
  const px = vx + (layer.vanishX ?? 0)
  const py = vy + (layer.vanishY ?? 0)
  const mapX = pw / canvas.width
  const mapY = ph / canvas.height
  const parallel = perspective === 'parallel'
  const strokeBatches: any[] = []
  batches.forEach((batch, index) => {
    const style = batch.lines
    const verts = authored[index]
    if (!style || !verts) return
    const round = roundSphere(batch)
    const packed = new Float64Array(verts.length * 3)
    for (let i = 0; i < verts.length; i++) {
      const vert = verts[i]!
      packed[i * 3] = vert.x
      packed[i * 3 + 1] = vert.y
      packed[i * 3 + 2] = vert.z
    }
    strokeBatches.push({
      verts: packed,
      indices: batch.indices,
      edges: batch.edges.map((edge) => ({
        a: edge.a,
        b: edge.b,
        n0X: edge.n0[0],
        n0Y: edge.n0[1],
        n0Z: edge.n0[2],
        hasN1: edge.n1 != null,
        n1X: edge.n1 ? edge.n1[0] : 0,
        n1Y: edge.n1 ? edge.n1[1] : 0,
        n1Z: edge.n1 ? edge.n1[2] : 0,
        crease: edge.crease,
      })),
      toLayer: Array.from(batch.toLayer),
      owner: batch.owner,
      width0: style.widths[0],
      width1: style.widths[1],
      width2: style.widths[2],
      halo: style.halo,
      css: style.css,
      hiddenCss: style.hiddenCss ?? '',
      ...(style.creaseCss ? { creaseCss: style.creaseCss } : {}),
      hasHidden: style.hiddenCss != null && style.hiddenCss !== '',
      hasOutline: batch.outline != null,
      hasRound: round != null,
      roundX: round?.x ?? 0,
      roundY: round?.y ?? 0,
      roundZ: round?.z ?? 0,
      roundR: round?.radius ?? 0,
    })
  })
  const runs = meshStrokeRuns(
    strokeBatches,
    depth,
    owners,
    pw,
    ph,
    parallel,
    parallel ? 0 : perspective,
    vx,
    vy,
    px,
    py,
    originX,
    originY,
    scaleX,
    scaleY,
    scale,
    mapX,
    mapY,
    canvas.width,
    canvas.height,
  )
  for (const run of runs) paintRun(ctx, run.points, run.hidden, run.css, run.width, scale, run.dashOffset)
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
  const painted = raster(plane.peeled, plane.toLayer)
  if (painted.logicalWidth <= 0 || painted.logicalHeight <= 0) return null
  const pixels = painted.canvas.getContext('2d').getImageData(0, 0, painted.canvas.width, painted.canvas.height)
  const solid = uniformBytes(pixels.data)
  const o = originOffset(plane.node.origin, plane.node.width, plane.node.height)
  const { localX, localY } = painted
  const corners: Array<[number, number]> = painted.polygon
    ? painted.polygon.map((point) => [point.u, point.v])
    : [
        [localX, localY],
        [localX + painted.logicalWidth, localY],
        [localX + painted.logicalWidth, localY + painted.logicalHeight],
        [localX, localY + painted.logicalHeight],
      ]
  if (corners.length < 3) return null
  // 四角沿用原来的绕序，正面朝镜头。裁过的多边形按同一绕序扇形切开，法线才不会翻到背面。
  const order = painted.polygon
    ? Array.from({ length: (corners.length - 2) * 3 }, (_, slot) => {
        const tri = Math.floor(slot / 3)
        const vert = slot % 3
        if (vert === 0) return 0
        return tri + (vert === 1 ? 2 : 1)
      })
    : [0, 2, 1, 0, 3, 2]
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
    castShadow: plane.node.castShadow !== false,
    receiveShadow: false,
    material: 'lambert',
    roughness: 1,
    matcap: null,
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

/** 磨砂和没写 material 走同一套明暗。平面也用这套。材质球名字在 matcap 上，这里仍给一个能画的退路。 */
function shadeMaterial(kind: NonNullable<MeshLayoutNode['material']>['kind'] | undefined): Batch['material'] {
  if (!kind || kind === 'matte' || kind === 'clay' || kind === 'mirror' || kind === 'brushed') return 'lambert'
  return kind
}

/** A written metalness, coat, sheen, or anisotropy leaves the matte Lambert path. */
function surfaceMaterial(material: MeshLayoutNode['material'] | undefined): Batch['material'] {
  const base = shadeMaterial(material?.kind)
  if (base !== 'lambert' || !material) return base
  const metal = material.metalness
  if (metal == null && material.clearcoat == null && material.sheen == null && material.anisotropy == null && material.transmission == null) return base
  if ((material.transmission ?? 0) >= 0.5) return 'glass'
  return (metal ?? 0) >= 0.5 ? 'metal' : 'plastic'
}

function surfaceScalars(material: MeshLayoutNode['material'] | undefined, prim?: ModelPrim) {
  return {
    metalness: material?.metalness ?? prim?.metalness,
    clearcoat: material?.clearcoat ?? prim?.clearcoat,
    clearcoatRoughness: prim?.clearcoatRoughness,
    sheen: material?.sheen ?? prim?.sheen,
    anisotropy: material?.anisotropy ?? prim?.anisotropy ?? (material?.kind === 'brushed' ? 0.8 : undefined),
  }
}

function groupDepth(group: Batch[]): number {
  let sum = 0
  let n = 0
  for (const batch of group) {
    const count = batch.positions.length / 3
    for (let i = 0; i < count; i++) {
      const p = transformPoint(
        batch.toLayer,
        batch.originX,
        batch.originY,
        batch.positions[i * 3]!,
        batch.positions[i * 3 + 1]!,
        batch.positions[i * 3 + 2]!,
      )
      sum += p.z
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

/** 景深按物体分开糊。合成进同一张图之后，被挡住的颜色已经没了，糊边会漏出底。 */
function rasterizeDofObjects(
  batches: Batch[],
  layer: LayerLayoutNode,
  perspective: Perspective,
  scale: number,
  samples: number,
  clip: RasterRect,
): MeshFrame {
  const groups: Array<{ batches: Batch[]; index: number; z: number }> = []
  const byOwner = new Map<number, Batch[]>()
  batches.forEach((batch, index) => {
    let list = byOwner.get(batch.owner)
    if (!list) {
      list = []
      byOwner.set(batch.owner, list)
      groups.push({ batches: list, index, z: 0 })
    }
    list.push(batch)
  })
  for (const group of groups) group.z = groupDepth(group.batches)
  groups.sort((a, b) => a.z - b.z || a.index - b.index)
  const sprites: MeshFrame[] = []
  for (const group of groups) {
    const frame = rasterize(group.batches, layer, perspective, scale, samples, clip)
    if (frame.width > 0 && frame.height > 0) sprites.push(frame)
  }
  return compositeSprites(sprites)
}

function compositeSprites(sprites: MeshFrame[]): MeshFrame {
  if (sprites.length === 0) return emptyMeshFrame()
  if (sprites.length === 1) return sprites[0]!
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const sprite of sprites) {
    minX = Math.min(minX, sprite.x)
    minY = Math.min(minY, sprite.y)
    maxX = Math.max(maxX, sprite.x + sprite.width)
    maxY = Math.max(maxY, sprite.y + sprite.height)
  }
  const base = sprites[0]!.canvas.width / sprites[0]!.width
  const pw = Math.max(1, Math.round((maxX - minX) * base))
  const ph = Math.max(1, Math.round((maxY - minY) * base))
  const canvas = createCanvas(pw, ph)
  const ctx = canvas.getContext('2d')
  for (const sprite of sprites) {
    ctx.drawImage(sprite.canvas, (sprite.x - minX) * base, (sprite.y - minY) * base)
  }
  return { canvas, x: minX, y: minY, width: pw / base, height: ph / base }
}

export function renderMeshSoftware(input: SoftwareMeshInput): MeshFrame {
  const { layer, perspective, meshes, planes, scale, raster } = input
  const grounds = input.grounds ?? []
  const samples = input.samples === 1 || input.samples === 2 || input.samples === MESH_SAMPLES ? input.samples : MESH_SAMPLES
  const clip = input.clip ?? { x: 0, y: 0, width: layer.width, height: layer.height }
  const batches: Batch[] = []
  let nextOwner = 1
  for (const instance of meshes) {
    const node = instance.node
    if (node.width <= 0 && node.mesh.type !== 'extrude') continue
    const o = originOffset(node.origin, node.width, node.height)
    if (behindCamera(applyPoseMatrix(instance.toLayer, o.x, o.y, 0).z, perspective)) continue
    const ownerId = nextOwner++
    const owner = node.sharp ? -(ownerId + 1) : ownerId
    const opacity = (instance.opacity ?? 1) * node.opacity
    if (node.mesh.type === 'model') {
      for (const prim of buildModel(node)) {
        if (prim.lines) {
          batches.push({
            positions: prim.positions,
            normals: prim.normals,
            uvs: null,
            indices: new Uint32Array(0),
            r: prim.color[0],
            g: prim.color[1],
            b: prim.color[2],
            a: byte(prim.color[3] * (instance.opacity ?? 1)),
            doubleSided: true,
            shaded: false,
            depthWrite: prim.color[3] >= 255,
            castShadow: false,
            receiveShadow: false,
            material: 'lambert',
            roughness: 1,
            matcap: null,
            texture: null,
            tw: 0,
            th: 0,
            toLayer: instance.toLayer,
            originX: o.x,
            originY: o.y,
            owner,
            edges: NO_EDGES,
            lines: null,
            outline: null,
            segmentIndices: prim.indices,
            linePx: prim.linePx ?? 1,
          })
          continue
        }
        if (prim.points) {
          batches.push({
            positions: prim.positions,
            normals: prim.normals,
            uvs: null,
            indices: new Uint32Array(0),
            r: prim.color[0],
            g: prim.color[1],
            b: prim.color[2],
            a: byte(prim.color[3] * (instance.opacity ?? 1)),
            doubleSided: true,
            shaded: false,
            depthWrite: prim.color[3] >= 255,
            castShadow: false,
            receiveShadow: false,
            material: 'lambert',
            roughness: 1,
            matcap: null,
            texture: null,
            tw: 0,
            th: 0,
            toLayer: instance.toLayer,
            originX: o.x,
            originY: o.y,
            owner,
            edges: NO_EDGES,
            lines: null,
            outline: null,
            pointIndices: prim.indices,
            pointPx: prim.pointPx ?? 1,
          })
          continue
        }
        const painted = prim.map || prim.colors ? { positions: prim.positions, normals: prim.normals, indices: prim.indices } : paintGeometry(node, prim.positions, prim.normals, prim.indices, layer.shading)
        const authored = node.material
        const material = authored ? surfaceMaterial(authored) : prim.shade ? shadeMaterial(prim.shade) : prim.metalness >= 0.5 ? 'metal' : 'plastic'
        const roughness = authored ? authored.roughness : prim.roughness
        const scalars = surfaceScalars(authored, prim)
        const glass = (authored?.kind ?? prim.shade) === 'glass'
        batches.push({
          positions: painted.positions,
          normals: painted.normals,
          uvs: prim.uvs && prim.uvs.length >= (prim.positions.length / 3) * 2 ? prim.uvs : null,
          indices: painted.indices,
          r: prim.color[0],
          g: prim.color[1],
          b: prim.color[2],
          a: byte(prim.color[3] * (instance.opacity ?? 1)),
          doubleSided: prim.doubleSided,
          shaded: true,
          depthWrite: glass && prim.color[3] < 255 ? false : prim.color[3] >= 255,
          castShadow: node.castShadow !== false,
          receiveShadow: false,
          material,
          roughness,
          ...scalars,
          matcap: authored?.matcap ?? null,
          texture: null,
          tw: 0,
          th: 0,
          albedoMap: prim.map,
          colors: prim.colors,
          emissiveR: prim.emissive ? byte(prim.emissive[0] * 255) : 0,
          emissiveG: prim.emissive ? byte(prim.emissive[1] * 255) : 0,
          emissiveB: prim.emissive ? byte(prim.emissive[2] * 255) : 0,
          toLayer: instance.toLayer,
          originX: o.x,
          originY: o.y,
          ...meshLineFields(node, opacity, painted.positions, painted.indices, owner, layer.shading),
        })
      }
      continue
    }
    const geometry = geometryOf(node)
    if (!geometry) continue
    const painted = paintGeometry(node, geometry.positions, geometry.normals, geometry.indices, layer.shading)
    const glass = node.material?.kind === 'glass'
    const clear = node.fill === 'none' || node.fill === 'transparent'
    const fillNone = clear && !glass
    const [r, g, b, a] = fillNone ? [0, 0, 0, 0] : clear ? [255, 255, 255, 0] : fillBytes(node.fill, opacity)
    batches.push({
      positions: painted.positions,
      normals: painted.normals,
      uvs: null,
      indices: painted.indices,
      r,
      g,
      b,
      a,
      doubleSided: node.mesh.type === 'extrude',
      shaded: !fillNone,
      depthWrite: glass && a < 255 ? false : fillNone || a >= 255,
      castShadow: node.castShadow !== false,
      receiveShadow: false,
      material: surfaceMaterial(node.material),
      roughness: node.material?.roughness ?? 1,
      ...surfaceScalars(node.material),
      matcap: node.material?.matcap ?? null,
      texture: null,
      tw: 0,
      th: 0,
      toLayer: instance.toLayer,
      originX: o.x,
      originY: o.y,
      ...meshLineFields(node, opacity, painted.positions, painted.indices, owner, layer.shading),
    })
  }
  for (const plane of planes) {
    const batch = planeBatch(plane, raster)
    if (!batch) continue
    const ownerId = nextOwner++
    batch.owner = plane.node.sharp ? -(ownerId + 1) : ownerId
    batches.push(batch)
  }
  if (layer.dof && perspective !== 'parallel' && grounds.length === 0) {
    return rasterizeDofObjects(batches, layer, perspective, scale, samples, clip)
  }
  return rasterize(batches, layer, perspective, scale, samples, clip, grounds)
}
