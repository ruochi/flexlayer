import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { solidPaint } from './gradient.js'
import { parseGlb, type GlbPrimitive } from './glb.js'
import { originOffset } from './matrix.js'
import { applyPoseMatrix, PERSPECTIVE_AA, planeDepth, poseMatrix, project, resolveSamples } from './perspective.js'
import { tessellateSvgPath } from './path.js'
import type { LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'

/** 网格和透视平面用同一套超采样：高分辨率绘制，再平均缩回。二维绘制不经过这里。 */
const MESH_AA = PERSPECTIVE_AA
const MAX_RASTER_SIDE = 8192

type Mat4 = number[]
type Headless = {
  THREE: any
  render: (opts: Record<string, unknown>) => Promise<Buffer>
  loadTexture: (input: unknown) => Promise<any>
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

let headlessPromise: Promise<Headless> | null = null

async function getHeadless(): Promise<Headless> {
  if (!headlessPromise) {
    headlessPromise = (async () => {
      const canvas = await import('@napi-rs/canvas')
      const getTHREE = (await import('headless-three')).default
      return getTHREE({ Canvas: canvas.createCanvas, Image: canvas.Image, ImageData: canvas.ImageData })
    })()
  }
  return headlessPromise
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
    }
  }
  return o
}

function translation(x: number, y: number, z = 0): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

/** 这一层自己的 perspective 里有网格，且网格不在更内层的 perspective 中。 */
export function ownsMeshScene(layer: LayerLayoutNode): boolean {
  if (layer.perspective == null || layer.perspective <= 0) return false
  const visit = (node: LayoutNode, blocked: boolean): boolean => {
    if (blocked) return false
    if (node.kind === 'mesh') return true
    if (node.kind !== 'layer' && node.kind !== 'flex') return false
    const nested = node !== layer && node.kind === 'layer' && node.perspective != null && node.perspective > 0
    return node.children.some((child) => visit(child, nested))
  }
  return visit(layer, false)
}

function paintable(node: LayoutNode): boolean {
  if (node.kind === 'mesh') return false
  if (node.kind === 'layer' || node.kind === 'flex') {
    const chrome = (node.background != null && node.background !== 'transparent') || (node.border != null && node.border.width > 0)
    return chrome || node.draw != null || node.children.some(paintable)
  }
  return node.width > 0 || node.height > 0
}

/** 嵌套的网格场景保持原对象，好按引用取已经画好的图。其余网格从位图里拿掉。 */
function stripMeshes(node: LayoutNode): LayoutNode | null {
  if (node.kind === 'mesh') return null
  if (node.kind === 'layer' && ownsMeshScene(node)) return node
  if (node.kind === 'layer' || node.kind === 'flex') {
    const children = node.children.map(stripMeshes).filter((child): child is LayoutNode => child != null)
    const next = { ...node, children }
    return paintable(next) ? next : null
  }
  return paintable(node) ? node : null
}

type MeshInstance = { node: MeshLayoutNode; toLayer: Mat4 }
type PlaneInstance = { node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }

function collectMeshes(node: LayoutNode, toParent: Mat4, out: MeshInstance[]) {
  if (node.kind === 'layer' && ownsMeshScene(node)) return
  const toLayer = mul(toParent, poseMatrix(node))
  if (node.kind === 'mesh') {
    out.push({ node, toLayer })
    return
  }
  if (node.kind === 'layer' || node.kind === 'flex') {
    const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
    const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
    const content = mul(toLayer, translation(insetX, insetY))
    for (const child of node.children) collectMeshes(child, content, out)
  }
}

function authorToThree(layerW: number, layerH: number, p: { x: number; y: number; z: number }) {
  return { x: p.x - layerW / 2, y: layerH / 2 - p.y, z: p.z }
}

/** 几何局部是 y 向上、支点为原点。矩阵把它变到和父 layer 同一台相机。 */
function matrixFor(THREE: any, layerW: number, layerH: number, toLayer: Mat4, originX: number, originY: number) {
  const at = (gx: number, gy: number, gz: number) =>
    authorToThree(layerW, layerH, applyPoseMatrix(toLayer, gx + originX, originY - gy, gz))
  const o = at(0, 0, 0)
  const x = at(1, 0, 0)
  const y = at(0, 1, 0)
  const z = at(0, 0, 1)
  const m = new THREE.Matrix4()
  m.set(
    x.x - o.x, y.x - o.x, z.x - o.x, o.x,
    x.y - o.y, y.y - o.y, z.y - o.y, o.y,
    x.z - o.z, y.z - o.z, z.z - o.z, o.z,
    0, 0, 0, 1,
  )
  return m
}

function place(mesh: any, matrix: any) {
  mesh.matrixAutoUpdate = false
  mesh.matrix.copy(matrix)
  mesh.updateMatrixWorld(true)
}

function parseFill(fill: string, opacity: number): { hex: string; alpha: number } {
  const solid = solidPaint(fill, '#808080')
  const hex8 = /^#([0-9a-f]{8})$/i.exec(solid)
  if (hex8) return { hex: `#${hex8[1]!.slice(0, 6)}`, alpha: (Number.parseInt(hex8[1]!.slice(6), 16) / 255) * opacity }
  const hex4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(solid)
  if (hex4) return { hex: `#${hex4[1]}${hex4[1]}${hex4[2]}${hex4[2]}${hex4[3]}${hex4[3]}`, alpha: (Number.parseInt(hex4[4]! + hex4[4], 16) / 255) * opacity }
  const rgba = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,\s/]+([0-9.]+))?\s*\)$/i.exec(solid)
  if (rgba) {
    const n = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v))))
    const hex = `#${n(rgba[1]!).toString(16).padStart(2, '0')}${n(rgba[2]!).toString(16).padStart(2, '0')}${n(rgba[3]!).toString(16).padStart(2, '0')}`
    return { hex, alpha: (rgba[4] != null ? Number(rgba[4]) : 1) * opacity }
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(solid) ? solid : '#808080'
  return { hex, alpha: opacity }
}

function srgbChannels(hex: string): [number, number, number] {
  const body = hex.replace('#', '')
  const full = body.length === 3 ? body.split('').map((ch) => ch + ch).join('') : body
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255
  return [n(0), n(2), n(4)]
}

/**
 * 正对镜头的面等于 fill，其余面更暗。
 * MeshStandard 的能量守恒会把纯白压到 #aaa 左右，浅色发灰。
 */
function fillMaterial(THREE: any, fill: string, opacity: number, side: any) {
  const color = parseFill(fill, opacity)
  const [r, g, b] = srgbChannels(color.hex)
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(r, g, b) },
      uOpacity: { value: color.alpha },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      float lit(vec3 n) {
        vec3 key = normalize(vec3(-0.6, 0.85, 1.0));
        vec3 fillL = normalize(vec3(0.75, -0.2, 0.45));
        return 0.5 + 0.85 * max(dot(n, key), 0.0) + 0.3 * max(dot(n, fillL), 0.0);
      }
      void main() {
        vec3 N = normalize(vNormal);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWorldPos);
        float shade = min(1.0, lit(N) / max(lit(V), 1.0e-3));
        gl_FragColor = vec4(uColor * shade, uOpacity);
      }
    `,
    transparent: color.alpha < 0.999,
    depthWrite: color.alpha >= 0.999,
    toneMapped: false,
    side,
  })
}

function centerOnBox(geometry: any, node: LayoutNode) {
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

function addRing(path: any, points: Array<{ x: number; y: number }>) {
  const first = points[0]
  if (!first) return
  path.moveTo(first.x, first.y)
  for (let i = 1; i < points.length; i++) path.lineTo(points[i]!.x, points[i]!.y)
  path.closePath()
}

function pointInRing(x: number, y: number, ring: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    const hit = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x
    if (hit) inside = !inside
  }
  return inside
}

function ringCenter(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / points.length, y: y / points.length }
}

/** 偶数层是实体，奇数层是包含它的那一圈实体上的洞。并排的形状不再被当成第一个的洞。 */
function shapesFromRings(THREE: any, rings: Array<Array<{ x: number; y: number }>>) {
  const items = rings
    .map((points) => ({ points, area: Math.abs(ringArea(points)), parent: -1 }))
    .filter((item) => item.points.length >= 3 && item.area > 1e-4)
  for (let i = 0; i < items.length; i++) {
    const sample = ringCenter(items[i]!.points)
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
  const shapes = new Map<number, any>()
  for (let i = 0; i < items.length; i++) {
    if (depthOf(i) % 2 !== 0) continue
    const shape = new THREE.Shape()
    const area = ringArea(items[i]!.points)
    addRing(shape, area < 0 ? items[i]!.points.slice().reverse() : items[i]!.points)
    shapes.set(i, shape)
  }
  for (let i = 0; i < items.length; i++) {
    if (depthOf(i) % 2 !== 1) continue
    let parent = items[i]!.parent
    const seen = new Set<number>()
    while (parent >= 0 && !seen.has(parent) && !shapes.has(parent)) {
      seen.add(parent)
      parent = items[parent]!.parent
    }
    const shape = parent >= 0 ? shapes.get(parent) : undefined
    if (!shape) continue
    const hole = new THREE.Path()
    const area = ringArea(items[i]!.points)
    addRing(hole, area > 0 ? items[i]!.points.slice().reverse() : items[i]!.points)
    shape.holes.push(hole)
  }
  return [...shapes.values()]
}

function extrudeGeometry(THREE: any, node: MeshLayoutNode) {
  if (node.mesh.type !== 'extrude') return null
  const o = originOffset(node.origin, node.width, node.height)
  const rings = tessellateSvgPath(node.mesh.d, 16, Math.PI / 24)
    .map((ring) => ring.points.map((p) => ({ x: p.x - o.x, y: -(p.y - o.y) })))
    .filter((points) => points.length >= 3)
  const shapes = shapesFromRings(THREE, rings)
  if (shapes.length === 0) return null
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: node.mesh.depth, bevelEnabled: false, curveSegments: 1 })
  geometry.translate(0, 0, -node.mesh.depth / 2)
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

/** 多个图元共用一个包围盒，避免每个零件各自撑满盒子。 */
function fitModel(THREE: any, node: MeshLayoutNode, prims: GlbPrimitive[]) {
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
  const geometries: any[] = []
  for (const prim of prims) {
    const src = prim.positions
    const positions = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      positions[i] = (src[i]! - cx) * s + shiftX
      positions[i + 1] = (src[i + 1]! - cy) * s + shiftY
      positions[i + 2] = (src[i + 2]! - cz) * s
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    if (prim.normals && prim.normals.length === src.length) geometry.setAttribute('normal', new THREE.BufferAttribute(prim.normals, 3))
    if (prim.indices) geometry.setIndex(new THREE.BufferAttribute(prim.indices, 1))
    if (!prim.normals) geometry.computeVertexNormals()
    geometries.push({ geometry, prim })
  }
  return geometries
}

function solidGeometry(THREE: any, node: MeshLayoutNode) {
  if (node.mesh.type === 'sphere') {
    const geometry = new THREE.SphereGeometry(node.mesh.r, 48, 32)
    centerOnBox(geometry, node)
    return geometry
  }
  if (node.mesh.type === 'box') {
    const geometry = new THREE.BoxGeometry(node.width, node.height, node.mesh.depth)
    centerOnBox(geometry, node)
    return geometry
  }
  if (node.mesh.type === 'extrude') return extrudeGeometry(THREE, node)
  return null
}

export type MeshRaster = {
  canvas: Canvas
  pad: number
  logicalWidth: number
  logicalHeight: number
  /** 位图 (0, 0) 在平面局部的位置。效果留白是负的。 */
  localX: number
  localY: number
}

/** 画进父层的网格画面。x、y 可以是负的，这样物体能溢出所在 layer。 */
export type MeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

async function renderOnce(api: Headless, scene: any, camera: any, width: number, height: number): Promise<Buffer> {
  const opts = {
    scene,
    camera,
    width,
    height,
    background: [0, 0, 0, 0],
    colorSpace: api.THREE.SRGBColorSpace,
  }
  try {
    return await api.render(opts)
  } catch (error) {
    if (process.env.USE_SWIFTSHADER === '1') throw error
    process.env.USE_SWIFTSHADER = '1'
    return await api.render(opts)
  }
}

/**
 * 把这一层的网格和兄弟平面画进同一台相机。返回的画布盖住整个 layer，背景透明。
 * 没有可画的东西时返回 null，调用方继续走原来的二维透视。
 */
export async function renderMeshLayer(
  layer: LayerLayoutNode,
  scale: number,
  raster: (node: LayoutNode) => MeshRaster,
): Promise<MeshFrame | null> {
  const perspective = layer.perspective
  if (perspective == null || perspective <= 0 || layer.width <= 0 || layer.height <= 0) return null
  const meshes: MeshInstance[] = []
  const planes: PlaneInstance[] = []
  for (const child of layer.children) {
    if (planeDepth(child) >= perspective) continue
    collectMeshes(child, IDENTITY, meshes)
    if (child.kind === 'mesh') continue
    const peeled = stripMeshes(child)
    if (peeled && paintable(peeled)) planes.push({ node: child, peeled, toLayer: poseMatrix(child) })
  }
  if (meshes.length === 0 && planes.length === 0) return null

  return renderMeshWebgl({ layer, perspective, meshes, planes, scale, raster })
}

async function renderMeshWebgl(sceneInput: {
  layer: LayerLayoutNode
  perspective: number
  meshes: MeshInstance[]
  planes: PlaneInstance[]
  scale: number
  raster: (node: LayoutNode) => MeshRaster
}): Promise<MeshFrame> {
  const { layer, perspective, meshes, planes, scale, raster } = sceneInput
  const api = await getHeadless()
  const THREE = api.THREE
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 0.85)
  key.position.set(-0.6, 0.85, 1)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.3)
  fill.position.set(0.75, -0.2, 0.45)
  scene.add(fill)

  const add = (object: any) => {
    scene.add(object)
  }

  for (const instance of meshes) {
    const node = instance.node
    if (node.width <= 0 && node.mesh.type !== 'extrude') continue
    const o = originOffset(node.origin, node.width, node.height)
    if (applyPoseMatrix(instance.toLayer, o.x, o.y, 0).z >= perspective) continue
    const matrix = matrixFor(THREE, layer.width, layer.height, instance.toLayer, o.x, o.y)
    if (node.mesh.type === 'model') {
      const fitted = fitModel(THREE, node, modelPrimitives(node))
      for (const item of fitted) {
        const color = item.prim.color
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace),
          roughness: item.prim.roughness,
          metalness: item.prim.metalness,
          transparent: color[3] < 0.999 || node.opacity < 0.999,
          opacity: color[3] * node.opacity,
          side: item.prim.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        })
        const mesh = new THREE.Mesh(item.geometry, material)
        place(mesh, matrix)
        add(mesh)
      }
      continue
    }
    const geometry = solidGeometry(THREE, node)
    if (!geometry) continue
    const material = fillMaterial(THREE, node.fill, node.opacity, node.mesh.type === 'extrude' ? THREE.DoubleSide : THREE.FrontSide)
    const mesh = new THREE.Mesh(geometry, material)
    place(mesh, matrix)
    add(mesh)
  }

  for (const plane of planes) {
    const painted = raster(plane.peeled)
    if (painted.logicalWidth <= 0 || painted.logicalHeight <= 0) continue
    const pixels = painted.canvas.getContext('2d').getImageData(0, 0, painted.canvas.width, painted.canvas.height)
    const texture = new THREE.DataTexture(new Uint8Array(pixels.data), painted.canvas.width, painted.canvas.height, THREE.RGBAFormat)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = true
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    const o = originOffset(plane.node.origin, plane.node.width, plane.node.height)
    const { localX, localY } = painted
    const corners: Array<[number, number]> = [
      [localX, localY],
      [localX + painted.logicalWidth, localY],
      [localX + painted.logicalWidth, localY + painted.logicalHeight],
      [localX, localY + painted.logicalHeight],
    ]
    const order = [0, 1, 2, 0, 2, 3]
    const positions = new Float32Array(order.length * 3)
    const uvs = new Float32Array(order.length * 2)
    order.forEach((corner, slot) => {
      const [u, v] = corners[corner]!
      positions[slot * 3] = u - o.x
      positions[slot * 3 + 1] = -(v - o.y)
      positions[slot * 3 + 2] = 0
      uvs[slot * 2] = (u - localX) / painted.logicalWidth
      uvs[slot * 2 + 1] = 1 - (v - localY) / painted.logicalHeight
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: true })
    const mesh = new THREE.Mesh(geometry, material)
    place(mesh, matrixFor(THREE, layer.width, layer.height, plane.toLayer, o.x, o.y))
    add(mesh)
  }

  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(scene)
  let minX = 0
  let minY = 0
  let maxX = layer.width
  let maxY = layer.height
  if (!bounds.isEmpty()) {
    const xs = [bounds.min.x, bounds.max.x]
    const ys = [bounds.min.y, bounds.max.y]
    const zs = [bounds.min.z, bounds.max.z]
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          const q = project(layer.width / 2, layer.height / 2, perspective, {
            x: x + layer.width / 2,
            y: layer.height / 2 - y,
            z,
          })
          if (!q) continue
          minX = Math.min(minX, q.x)
          minY = Math.min(minY, q.y)
          maxX = Math.max(maxX, q.x)
          maxY = Math.max(maxY, q.y)
        }
      }
    }
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
  const camX = (padR - padL) / 2
  const camY = (padT - padB) / 2
  const fov = (2 * Math.atan(viewH / 2 / perspective) * 180) / Math.PI
  const camera = new THREE.PerspectiveCamera(fov, viewW / viewH, 0.1, perspective + 20000)
  camera.position.set(camX, camY, perspective)
  camera.up.set(0, 1, 0)
  camera.lookAt(camX, camY, 0)
  camera.updateProjectionMatrix()

  let samples = MESH_AA
  while (samples > 1 && (viewW * base * samples > MAX_RASTER_SIDE || viewH * base * samples > MAX_RASTER_SIDE)) samples /= 2
  const pw = Math.max(1, Math.round(viewW * base * samples))
  const ph = Math.max(1, Math.round(viewH * base * samples))
  const png = await renderOnce(api, scene, camera, pw, ph)
  const image = await loadImage(png)
  const outW = Math.max(1, Math.round(viewW * base))
  const outH = Math.max(1, Math.round(viewH * base))
  const hi = createCanvas(image.width, image.height)
  hi.getContext('2d').drawImage(image as unknown as Canvas, 0, 0)
  let out: Canvas
  if (image.width >= outW && image.height >= outH) {
    out = resolveSamples(hi, outW, outH)
  } else {
    out = createCanvas(outW, outH)
    const ctx = out.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(hi, 0, 0, outW, outH)
  }
  return { canvas: out, x: -padL, y: -padT, width: viewW, height: viewH }
}
