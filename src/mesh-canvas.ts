import { createCanvas, ImageData, type Canvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { solidPaint } from './gradient.js'
import { parseGlb, type GlbPrimitive } from './glb.js'
import { originOffset } from './matrix.js'
import { applyPoseMatrix } from './perspective.js'
import { tessellateSvgPath } from './path.js'
import type { LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'
import type { MeshRaster } from './mesh.js'

/** 和 WebGL 路线同一档超采样。二维绘制不经过这里。 */
const MESH_AA = 2
const MAX_RASTER_SIDE = 4096
/** easel 的 DataTexture 最长边是 128，平面先缩进这个尺寸。 */
const PLANE_TEXTURE_MAX = 128

type Mat4 = number[]

export type CanvasMeshScene = {
  layer: LayerLayoutNode
  perspective: number
  meshes: Array<{ node: MeshLayoutNode; toLayer: Mat4 }>
  planes: Array<{ node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }>
  scale: number
  raster: (node: LayoutNode) => MeshRaster
}

function ensureImageData() {
  const host = globalThis as { ImageData?: unknown }
  if (host.ImageData == null) host.ImageData = ImageData
}

function fillHex(fill: string): number {
  const solid = solidPaint(fill, '#808080')
  const hex6 = /^#([0-9a-f]{6})/i.exec(solid)
  if (hex6) return Number.parseInt(hex6[1]!, 16)
  const hex3 = /^#([0-9a-f]{3})/i.exec(solid)
  if (hex3) {
    const s = hex3[1]!
    return Number.parseInt(s[0]! + s[0] + s[1]! + s[1] + s[2]! + s[2], 16)
  }
  const rgba = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/i.exec(solid)
  if (rgba) {
    const n = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v))))
    return (n(rgba[1]!) << 16) | (n(rgba[2]!) << 8) | n(rgba[3]!)
  }
  return 0x808080
}

function cameraMatrix(layerW: number, layerH: number, toLayer: Mat4, originX: number, originY: number): number[] {
  const at = (gx: number, gy: number, gz: number) => {
    const p = applyPoseMatrix(toLayer, gx + originX, originY - gy, gz)
    return { x: p.x - layerW / 2, y: layerH / 2 - p.y, z: p.z }
  }
  const o = at(0, 0, 0)
  const x = at(1, 0, 0)
  const y = at(0, 1, 0)
  const z = at(0, 0, 1)
  return [
    x.x - o.x, x.y - o.y, x.z - o.z, 0,
    y.x - o.x, y.y - o.y, y.z - o.z, 0,
    z.x - o.x, z.y - o.y, z.z - o.z, 0,
    o.x, o.y, o.z, 1,
  ]
}

function place(mesh: { matrixAutoUpdate: boolean; matrix: { fromArray(values: ArrayLike<number>): unknown }; matrixWorldNeedsUpdate: boolean }, elements: number[]) {
  mesh.matrixAutoUpdate = false
  mesh.matrix.fromArray(elements)
  mesh.matrixWorldNeedsUpdate = true
}

function centerOnBox(geometry: { translate(x: number, y: number, z: number): unknown }, node: LayoutNode) {
  const o = originOffset(node.origin, node.width, node.height)
  geometry.translate(node.width / 2 - o.x, -(node.height / 2 - o.y), 0)
}

function ringArea(points: Array<{ x: number; y: number }>): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    area += p.x * q.y - q.x * p.y
  }
  return area / 2
}

function extrudeGeometry(easel: any, node: MeshLayoutNode) {
  if (node.mesh.type !== 'extrude') return null
  const o = originOffset(node.origin, node.width, node.height)
  const rings = tessellateSvgPath(node.mesh.d)
    .map((ring) => ring.points.map((p) => ({ x: p.x - o.x, y: -(p.y - o.y) })))
    .filter((points) => points.length >= 3)
  if (rings.length === 0) return null
  const shapes: Array<{ points: Array<{ x: number; y: number }>; holes: Array<Array<{ x: number; y: number }>> }> = []
  let shape: (typeof shapes)[number] | null = null
  for (const points of rings) {
    const area = ringArea(points)
    const ordered = area < 0 ? points.slice().reverse() : points.slice()
    if (!shape) {
      shape = { points: ordered, holes: [] }
      shapes.push(shape)
      continue
    }
    const holePts = ringArea(ordered) > 0 ? ordered.slice().reverse() : ordered
    shape.holes.push(holePts)
  }
  const geometry = new easel.ExtrudeGeometry(
    shapes.map((item) => ({ extractPoints: () => ({ shape: item.points, holes: item.holes }) })),
    { depth: node.mesh.depth, bevelEnabled: false },
  )
  geometry.translate(0, 0, -node.mesh.depth / 2)
  geometry.computeBoundingSphere()
  return geometry
}

function modelPrimitives(node: MeshLayoutNode): GlbPrimitive[] {
  if (node.mesh.type !== 'model' || !node.mesh.file) return []
  try {
    return parseGlb(readFileSync(node.mesh.file))
  } catch {
    return []
  }
}

function fitModel(easel: any, node: MeshLayoutNode, prims: GlbPrimitive[]) {
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
  const geometries: Array<{ geometry: any; prim: GlbPrimitive }> = []
  for (const prim of prims) {
    const src = prim.positions
    const positions = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      positions[i] = (src[i]! - cx) * s + shiftX
      positions[i + 1] = (src[i + 1]! - cy) * s + shiftY
      positions[i + 2] = (src[i + 2]! - cz) * s
    }
    const geometry = new easel.Geometry()
    geometry.setPositions(positions)
    if (prim.normals && prim.normals.length === src.length) geometry.setNormals(prim.normals)
    if (prim.indices) geometry.index = prim.indices
    if (!prim.normals) geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    geometries.push({ geometry, prim })
  }
  return geometries
}

function solidGeometry(easel: any, node: MeshLayoutNode) {
  if (node.mesh.type === 'sphere') {
    const geometry = new easel.SphereGeometry(node.mesh.r, 32, 24)
    centerOnBox(geometry, node)
    geometry.computeBoundingSphere()
    return geometry
  }
  if (node.mesh.type === 'box') {
    const geometry = new easel.BoxGeometry(node.width, node.height, node.mesh.depth)
    centerOnBox(geometry, node)
    geometry.computeBoundingSphere()
    return geometry
  }
  if (node.mesh.type === 'extrude') return extrudeGeometry(easel, node)
  return null
}

function lambert(easel: any, color: number, side: number) {
  return new easel.LambertMaterial({ color, side, vertexColors: false })
}

function planeTexture(easel: any, painted: MeshRaster) {
  const srcW = painted.canvas.width
  const srcH = painted.canvas.height
  const fit = Math.min(1, PLANE_TEXTURE_MAX / Math.max(srcW, 1), PLANE_TEXTURE_MAX / Math.max(srcH, 1))
  const tw = Math.max(1, Math.round(srcW * fit))
  const th = Math.max(1, Math.round(srcH * fit))
  const small = tw === srcW && th === srcH ? painted.canvas : createCanvas(tw, th)
  if (small !== painted.canvas) {
    const ctx = small.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(painted.canvas, 0, 0, tw, th)
  }
  const pixels = small.getContext('2d').getImageData(0, 0, tw, th)
  const texture = new easel.DataTexture(new Uint8ClampedArray(pixels.data), tw, th)
  texture.colorSpace = easel.SRGBColorSpace
  texture.needsUpdate = true
  texture.update()
  return texture
}

/**
 * 用 @xsyetopz/easel 把网格和兄弟平面光栅进 Canvas 2D。
 * 相机、姿态和默认光与 WebGL 路线相同。背景保持透明。
 */
export async function renderMeshCanvas(input: CanvasMeshScene): Promise<Canvas> {
  ensureImageData()
  const easel = await import('@xsyetopz/easel')
  const { layer, perspective } = input
  const scene = new easel.Scene()
  const clear = new easel.DataTexture(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)
  clear.colorSpace = easel.SRGBColorSpace
  clear.needsUpdate = true
  clear.update()
  scene.background = clear
  scene.add(new easel.AmbientLight(0xffffff, 0.5))
  const key = new easel.DirectionalLight(0xffffff, 0.85)
  key.position.set(-0.6, 0.85, 1)
  scene.add(key)
  const fill = new easel.DirectionalLight(0xffffff, 0.3)
  fill.position.set(0.75, -0.2, 0.45)
  scene.add(fill)

  for (const instance of input.meshes) {
    const node = instance.node
    if (node.width <= 0 && node.mesh.type !== 'extrude') continue
    const o = originOffset(node.origin, node.width, node.height)
    if (applyPoseMatrix(instance.toLayer, o.x, o.y, 0).z >= perspective) continue
    const matrix = cameraMatrix(layer.width, layer.height, instance.toLayer, o.x, o.y)
    if (node.mesh.type === 'model') {
      for (const item of fitModel(easel, node, modelPrimitives(node))) {
        const color = item.prim.color
        const hex = (Math.round(color[0] * 255) << 16) | (Math.round(color[1] * 255) << 8) | Math.round(color[2] * 255)
        const material = lambert(easel, hex, item.prim.doubleSided ? easel.Side.Double : easel.Side.Front)
        const mesh = new easel.Mesh(item.geometry, material)
        place(mesh, matrix)
        scene.add(mesh)
      }
      continue
    }
    const geometry = solidGeometry(easel, node)
    if (!geometry) continue
    const material = lambert(easel, fillHex(node.fill), node.mesh.type === 'extrude' ? easel.Side.Double : easel.Side.Front)
    const mesh = new easel.Mesh(geometry, material)
    place(mesh, matrix)
    scene.add(mesh)
  }

  for (const plane of input.planes) {
    const painted = input.raster(plane.peeled)
    if (painted.logicalWidth <= 0 || painted.logicalHeight <= 0) continue
    const texture = planeTexture(easel, painted)
    const o = originOffset(plane.node.origin, plane.node.width, plane.node.height)
    const { pad } = painted
    const corners: Array<[number, number]> = [
      [-pad, -pad],
      [plane.node.width + pad, -pad],
      [plane.node.width + pad, plane.node.height + pad],
      [-pad, plane.node.height + pad],
    ]
    const order = [0, 1, 2, 0, 2, 3]
    const positions = new Float32Array(order.length * 3)
    const uvs = new Float32Array(order.length * 2)
    order.forEach((corner, slot) => {
      const [u, v] = corners[corner]!
      positions[slot * 3] = u - o.x
      positions[slot * 3 + 1] = -(v - o.y)
      positions[slot * 3 + 2] = 0
      uvs[slot * 2] = (u + pad) / painted.logicalWidth
      uvs[slot * 2 + 1] = (v + pad) / painted.logicalHeight
    })
    const geometry = new easel.Geometry()
    geometry.setPositions(positions)
    geometry.setUVs(uvs)
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    const material = new easel.BasicMaterial({ color: 0xffffff, map: texture, side: easel.Side.Double, vertexColors: false })
    const mesh = new easel.Mesh(geometry, material)
    place(mesh, cameraMatrix(layer.width, layer.height, plane.toLayer, o.x, o.y))
    scene.add(mesh)
  }

  const fov = (2 * Math.atan(layer.height / 2 / perspective) * 180) / Math.PI
  const camera = new easel.PerspectiveCamera({
    fov,
    aspect: layer.width / layer.height,
    near: 1,
    far: perspective + 20000,
  })
  camera.position.set(0, 0, perspective)
  camera.up.set(0, 1, 0)
  camera.lookAt(0, 0, 0)

  let samples = MESH_AA
  const base = Math.max(input.scale, 1e-3)
  while (samples > 1 && (layer.width * base * samples > MAX_RASTER_SIDE || layer.height * base * samples > MAX_RASTER_SIDE)) samples /= 2
  const pw = Math.max(1, Math.round(layer.width * base * samples))
  const ph = Math.max(1, Math.round(layer.height * base * samples))
  const target = createCanvas(pw, ph)
  const renderer = new easel.Renderer({ canvas: target as never, width: pw, height: ph })
  renderer.prepare(scene, camera)
  renderer.render(scene, camera)

  const outW = Math.max(1, Math.round(layer.width * base))
  const outH = Math.max(1, Math.round(layer.height * base))
  if (pw === outW && ph === outH) return target
  const out = createCanvas(outW, outH)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(target, 0, 0, outW, outH)
  return out
}
