import type { GlbPrimitive } from './glb.js'

/**
 * 把 three.js 的 Object3D 收成和 glb 一样的图元。
 * 不 import three：用 isMesh / isBufferGeometry 认类型，避免同一包的两份构建对不上 instanceof。
 * 坐标保持 three 的 y 向上。翻到作者空间的 y 向下发生在投影，这里再翻会把绕序翻两次。
 * 负行列式（镜像缩放）会把三角形绕序翻一次，这里换回正面。
 * 不读灯光、法线贴图和骨骼；SkinnedMesh 只用绑定姿态。着色器不执行。
 * Lambert、Toon 走磨砂。Phong 的 shininess 收成粗糙度，100 是光滑。透射不小于 0.5 走玻璃。
 * 其余按金属度：不小于 0.5 是金属，否则是塑料。粗糙度越低，环境越清楚。
 * 内存里的 map 按 uv 给底色染色，再走同一套明暗。顶点色乘上材质色。emissive 加在明暗之后。
 * ShaderMaterial 只从 uniforms 里取一个颜色当底色。
 * Line、LineSegments、LineLoop 收成线段。材质 wireframe 为真时只留三角形的边。
 * Points 收成屏幕像素的圆点，和线段共用深度。`PointsMaterial.size` 是像素，缺省 1。
 */

type Mat4 = number[]

type Obj = {
  parent?: unknown
  children?: unknown
  visible?: boolean
  isMesh?: boolean
  isLine?: boolean
  isLineSegments?: boolean
  isLineLoop?: boolean
  isPoints?: boolean
  isInstancedMesh?: boolean
  isBufferGeometry?: boolean
  matrixWorld?: { elements?: ArrayLike<number> }
  updateMatrixWorld?: (force?: boolean) => void
  geometry?: unknown
  material?: unknown
  instanceMatrix?: unknown
  count?: number
  attributes?: { position?: unknown; normal?: unknown; uv?: unknown; color?: unknown }
  index?: unknown
  groups?: unknown
  drawRange?: { start?: number; count?: number }
  getAttribute?: (name: string) => unknown
  array?: ArrayLike<number>
  itemSize?: number
  data?: { array?: ArrayLike<number>; stride?: number }
  offset?: number
  getX?: (index: number) => number
  getY?: (index: number) => number
  getZ?: (index: number) => number
  color?: { r?: number; g?: number; b?: number }
  r?: number
  g?: number
  b?: number
  x?: number
  y?: number
  opacity?: number
  roughness?: number
  metalness?: number
  shininess?: number
  transmission?: number
  side?: number
  isMeshLambertMaterial?: boolean
  isMeshToonMaterial?: boolean
  isMeshPhongMaterial?: boolean
  isMeshPhysicalMaterial?: boolean
  isShaderMaterial?: boolean
  isRawShaderMaterial?: boolean
  isDirectionalLight?: boolean
  isSpotLight?: boolean
  isPointLight?: boolean
  isHemisphereLight?: boolean
  isAmbientLight?: boolean
  intensity?: number
  z?: number
  clearcoat?: number
  clearcoatRoughness?: number
  thickness?: number
  ior?: number
  sheen?: number
  anisotropy?: number
  position?: { x?: number; y?: number; z?: number }
  target?: { position?: { x?: number; y?: number; z?: number } }
  isColor?: boolean
  vertexColors?: boolean | number
  emissive?: { r?: number; g?: number; b?: number }
  emissiveIntensity?: number
  map?: unknown
  image?: unknown
  width?: number
  height?: number
  flipY?: boolean
  wrapS?: number
  wrapT?: number
  repeat?: { x?: number; y?: number }
  uniforms?: unknown
  value?: unknown
  format?: number
  start?: number
  materialIndex?: number
  wireframe?: boolean
  wireframeLinewidth?: number
  linewidth?: number
  size?: number
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

const held = new WeakMap<object, GlbPrimitive[]>()

/** 布局把图元搁在网格规格上，渲染再取。规格对象本身不放数组，避免场景缓存顺着对象图走。 */
export function holdModelPrims(spec: object, prims: GlbPrimitive[]): void {
  held.set(spec, prims)
}

export function heldModelPrims(spec: object): GlbPrimitive[] | undefined {
  return held.get(spec)
}

/** 内容变了键就变。给内存网格用，文件模型仍按修改时间。 */
export function modelRevision(prims: GlbPrimitive[]): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5 ^ 0x9e3779b9
  const word = (value: number) => {
    h1 = Math.imul(h1 ^ value, 0x01000193)
    h2 = Math.imul(h2 ^ value, 0x01000193)
  }
  word(prims.length)
  for (const prim of prims) {
    hashFloats(prim.positions, word)
    if (prim.normals) hashFloats(prim.normals, word)
    if (prim.indices) {
      for (let i = 0; i < prim.indices.length; i++) word(prim.indices[i]!)
    }
    for (const channel of prim.color) word(Math.round(channel * 1000))
    word(Math.round(prim.roughness * 1000))
    word(Math.round(prim.metalness * 1000))
    word(prim.doubleSided ? 1 : 0)
    word(prim.shade === 'matte' ? 1 : prim.shade === 'plastic' ? 2 : prim.shade === 'metal' ? 3 : prim.shade === 'glass' ? 4 : 0)
    if (prim.uvs) hashFloats(prim.uvs, word)
    if (prim.colors) hashFloats(prim.colors, word)
    if (prim.emissive) for (const channel of prim.emissive) word(Math.round(channel * 1000))
    if (prim.clearcoat != null) word(Math.round(prim.clearcoat * 1000))
    if (prim.transmission != null) word(Math.round(prim.transmission * 1000))
    if (prim.ior != null) word(Math.round(prim.ior * 1000))
    if (prim.map) {
      word(prim.map.w)
      word(prim.map.h)
      word(prim.map.flipY ? 1 : 0)
      word(Math.round(prim.map.repeatU * 1000))
      word(Math.round(prim.map.repeatV * 1000))
      word(Math.round(prim.map.offsetU * 1000))
      word(Math.round(prim.map.offsetV * 1000))
      word(prim.map.wrapS)
      word(prim.map.wrapT)
      const pixels = prim.map.rgba
      for (let i = 0; i < pixels.length; i += 4) {
        word((pixels[i]! | (pixels[i + 1]! << 8) | (pixels[i + 2]! << 16) | ((pixels[i + 3] ?? 0) << 24)) >>> 0)
      }
    }
    word(prim.lines ? 1 : 0)
    word(Math.round((prim.linePx ?? 1) * 1000))
    word(prim.points ? 1 : 0)
    word(Math.round((prim.pointPx ?? 1) * 1000))
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

export function fromThree(root: unknown): GlbPrimitive[] {
  const node = asObj(root)
  if (!node) return []
  refreshWorld(node)
  const out: GlbPrimitive[] = []
  walk(node, out)
  return out
}

function hashFloats(values: Float32Array, word: (value: number) => void) {
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length)
  for (let i = 0; i < bits.length; i++) word(bits[i]!)
}

function asObj(value: unknown): Obj | null {
  if (value == null || typeof value !== 'object') return null
  return value as Obj
}

function refreshWorld(node: Obj) {
  let top = node
  const seen = new Set<Obj>()
  while (true) {
    const parent = asObj(top.parent)
    if (!parent || seen.has(top)) break
    seen.add(top)
    top = parent
  }
  if (typeof top.updateMatrixWorld === 'function') top.updateMatrixWorld(true)
}

function walk(node: Obj, out: GlbPrimitive[]) {
  if (node.visible === false) return
  if (node.isMesh === true) emitMesh(node, out)
  else if (node.isLine === true) emitLines(node, out)
  else if (node.isPoints === true) emitPoints(node, out)
  if (!Array.isArray(node.children)) return
  for (const child of node.children) {
    const next = asObj(child)
    if (next) walk(next, out)
  }
}

function emitMesh(mesh: Obj, out: GlbPrimitive[]) {
  const geometry = asObj(mesh.geometry)
  if (!geometry || geometry.isBufferGeometry === false) return
  const position = asObj(geometry.attributes?.position) ?? asObj(geometry.getAttribute?.('position'))
  if (!position) return
  const count = attrCount(position)
  if (count < 3) return
  const normalAttr = asObj(geometry.attributes?.normal) ?? asObj(geometry.getAttribute?.('normal'))
  const uvAttr = asObj(geometry.attributes?.uv) ?? asObj(geometry.getAttribute?.('uv'))
  const colorAttr = asObj(geometry.attributes?.color) ?? asObj(geometry.getAttribute?.('color'))
  const uvs = uvAttr && attrCount(uvAttr) >= count ? readVec2Array(uvAttr, count) : undefined
  const rawColors = colorAttr && attrCount(colorAttr) >= count ? readVec3Array(colorAttr, count) : undefined
  const indexAttr = asObj(geometry.index)
  const indexCount = indexAttr ? attrCount(indexAttr) : count
  const ranges = rangesOf(geometry, indexCount)
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const meshWorld = elementsOf(mesh.matrixWorld) ?? IDENTITY
  for (const instance of instanceMatrices(mesh)) {
    const world = mul(meshWorld, instance)
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const p = readVec3(position, i)
      const w = applyPoint(world, p[0], p[1], p[2])
      positions[i * 3] = w[0]
      positions[i * 3 + 1] = w[1]
      positions[i * 3 + 2] = w[2]
    }
    let normals: Float32Array | undefined
    if (normalAttr && attrCount(normalAttr) >= count) {
      const nmat = normalMat(world)
      normals = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const n = readVec3(normalAttr, i)
        const w = applyNormal(nmat, n[0], n[1], n[2])
        normals[i * 3] = w[0]
        normals[i * 3 + 1] = w[1]
        normals[i * 3 + 2] = w[2]
      }
    }
    const mirrored = det3(world) < 0
    for (const range of ranges) {
      const material = materials[range.materialIndex] ?? materials[0]
      const pbr = readPbr(material)
      if (asObj(material)?.wireframe === true) {
        const pairs = triangleEdges(indexAttr, range.start, range.count, count)
        if (pairs.length >= 2) {
          out.push(linePrim(positions, pairs, pbr.color, linePx(material, true)))
        }
        continue
      }
      const flip = mirrored !== pbr.back
      const indices = new Uint32Array(Math.floor(range.count / 3) * 3)
      let written = 0
      const end = range.start + range.count
      for (let i = range.start; i + 2 < end; i += 3) {
        const a = readIndex(indexAttr, i)
        const b = readIndex(indexAttr, i + 1)
        const c = readIndex(indexAttr, i + 2)
        if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) continue
        indices[written++] = a
        indices[written++] = flip ? c : b
        indices[written++] = flip ? b : c
      }
      if (written < 3) continue
      let colors: Float32Array | undefined
      if (pbr.vertexColors && rawColors) {
        colors = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          colors[i * 3] = clamp01(rawColors[i * 3]! * pbr.color[0])
          colors[i * 3 + 1] = clamp01(rawColors[i * 3 + 1]! * pbr.color[1])
          colors[i * 3 + 2] = clamp01(rawColors[i * 3 + 2]! * pbr.color[2])
        }
      }
      out.push({
        positions,
        normals,
        indices: written === indices.length ? indices : indices.slice(0, written),
        color: pbr.color,
        roughness: pbr.roughness,
        metalness: pbr.metalness,
        doubleSided: pbr.doubleSided,
        shade: pbr.shade,
        uvs,
        colors,
        map: pbr.map,
        emissive: pbr.emissive,
        ...(pbr.clearcoat != null ? { clearcoat: pbr.clearcoat } : {}),
        ...(pbr.clearcoatRoughness != null ? { clearcoatRoughness: pbr.clearcoatRoughness } : {}),
        ...(pbr.transmission != null ? { transmission: pbr.transmission } : {}),
        ...(pbr.thickness != null ? { thickness: pbr.thickness } : {}),
        ...(pbr.ior != null ? { ior: pbr.ior } : {}),
        ...(pbr.sheen != null ? { sheen: pbr.sheen } : {}),
        ...(pbr.anisotropy != null ? { anisotropy: pbr.anisotropy } : {}),
      })
    }
  }
}

function emitLines(node: Obj, out: GlbPrimitive[]) {
  const geometry = asObj(node.geometry)
  if (!geometry || geometry.isBufferGeometry === false) return
  const position = asObj(geometry.attributes?.position) ?? asObj(geometry.getAttribute?.('position'))
  if (!position) return
  const count = attrCount(position)
  if (count < 2) return
  const indexAttr = asObj(geometry.index)
  const indexCount = indexAttr ? attrCount(indexAttr) : count
  const drawStart = finite(geometry.drawRange?.start, 0)
  const drawCount = finite(geometry.drawRange?.count, Number.POSITIVE_INFINITY)
  const start = Math.max(0, drawStart)
  const end = Math.min(indexCount, start + drawCount)
  if (end - start < 2) return
  const world = elementsOf(node.matrixWorld) ?? IDENTITY
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const p = readVec3(position, i)
    const w = applyPoint(world, p[0], p[1], p[2])
    positions[i * 3] = w[0]
    positions[i * 3 + 1] = w[1]
    positions[i * 3 + 2] = w[2]
  }
  const pairs: number[] = []
  const segments = node.isLineSegments === true
  if (segments) {
    for (let i = start; i + 1 < end; i += 2) {
      const a = readIndex(indexAttr, i)
      const b = readIndex(indexAttr, i + 1)
      if (a < 0 || b < 0 || a >= count || b >= count || a === b) continue
      pairs.push(a, b)
    }
  } else {
    let prev = -1
    for (let i = start; i < end; i++) {
      const a = readIndex(indexAttr, i)
      if (a < 0 || a >= count) {
        prev = -1
        continue
      }
      if (prev >= 0 && prev !== a) pairs.push(prev, a)
      prev = a
    }
    if (node.isLineLoop === true && end - start >= 2) {
      const first = readIndex(indexAttr, start)
      const last = readIndex(indexAttr, end - 1)
      if (first >= 0 && last >= 0 && first < count && last < count && first !== last) pairs.push(last, first)
    }
  }
  if (pairs.length < 2) return
  const pbr = readPbr(Array.isArray(node.material) ? node.material[0] : node.material)
  out.push(linePrim(positions, Uint32Array.from(pairs), pbr.color, linePx(node.material, false)))
}

function emitPoints(node: Obj, out: GlbPrimitive[]) {
  const geometry = asObj(node.geometry)
  if (!geometry || geometry.isBufferGeometry === false) return
  const position = asObj(geometry.attributes?.position) ?? asObj(geometry.getAttribute?.('position'))
  if (!position) return
  const count = attrCount(position)
  if (count < 1) return
  const indexAttr = asObj(geometry.index)
  const indexCount = indexAttr ? attrCount(indexAttr) : count
  const drawStart = finite(geometry.drawRange?.start, 0)
  const drawCount = finite(geometry.drawRange?.count, Number.POSITIVE_INFINITY)
  const start = Math.max(0, drawStart)
  const end = Math.min(indexCount, start + drawCount)
  if (end - start < 1) return
  const world = elementsOf(node.matrixWorld) ?? IDENTITY
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const p = readVec3(position, i)
    const w = applyPoint(world, p[0], p[1], p[2])
    positions[i * 3] = w[0]
    positions[i * 3 + 1] = w[1]
    positions[i * 3 + 2] = w[2]
  }
  const ids: number[] = []
  for (let i = start; i < end; i++) {
    const a = readIndex(indexAttr, i)
    if (a < 0 || a >= count) continue
    ids.push(a)
  }
  if (ids.length === 0) return
  const material = Array.isArray(node.material) ? node.material[0] : node.material
  const pbr = readPbr(material)
  out.push({
    positions,
    indices: Uint32Array.from(ids),
    color: pbr.color,
    roughness: 1,
    metalness: 0,
    doubleSided: true,
    points: true,
    pointPx: pointPx(material),
  })
}

/** 屏幕像素。`PointsMaterial.size` 缺省 1。衰减按世界单位的算法这里不用。 */
function pointPx(material: unknown): number {
  const mat = asObj(material)
  const raw = finite(mat?.size, 1)
  if (!(raw > 0) || raw > 64) return 1
  return raw
}

function linePrim(positions: Float32Array, indices: Uint32Array, color: [number, number, number, number], width: number): GlbPrimitive {
  return {
    positions,
    indices,
    color,
    roughness: 1,
    metalness: 0,
    doubleSided: true,
    lines: true,
    linePx: width,
  }
}

/** 屏幕像素。three 的 linewidth 在 WebGL 里常常被忽略，这里按作者写的值画，缺省 1。 */
function linePx(material: unknown, wire: boolean): number {
  const mat = asObj(material)
  const raw = wire ? finite(mat?.wireframeLinewidth, finite(mat?.linewidth, 1)) : finite(mat?.linewidth, 1)
  if (!(raw > 0) || raw > 32) return 1
  return raw
}

function triangleEdges(index: Obj | null, start: number, count: number, vertexCount: number): Uint32Array {
  const seen = new Set<string>()
  const pairs: number[] = []
  const end = start + count
  const add = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= vertexCount || b >= vertexCount || a === b) return
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push(a, b)
  }
  for (let i = start; i + 2 < end; i += 3) {
    const a = readIndex(index, i)
    const b = readIndex(index, i + 1)
    const c = readIndex(index, i + 2)
    add(a, b)
    add(b, c)
    add(c, a)
  }
  return Uint32Array.from(pairs)
}

function rangesOf(geometry: Obj, indexCount: number): Array<{ start: number; count: number; materialIndex: number }> {
  const drawStart = finite(geometry.drawRange?.start, 0)
  const drawCount = finite(geometry.drawRange?.count, Number.POSITIVE_INFINITY)
  const drawEnd = drawStart + drawCount
  const groups = Array.isArray(geometry.groups) ? geometry.groups : []
  const source = groups.length
    ? groups.map((group) => {
        const item = asObj(group)
        return {
          start: finite(item?.start, 0),
          count: finite(item?.count, indexCount),
          materialIndex: finite(item?.materialIndex, 0),
        }
      })
    : [{ start: 0, count: indexCount, materialIndex: 0 }]
  const out: Array<{ start: number; count: number; materialIndex: number }> = []
  for (const range of source) {
    const start = Math.max(range.start, drawStart)
    const end = Math.min(range.start + range.count, drawEnd, indexCount)
    if (end - start >= 3) out.push({ start, count: end - start, materialIndex: range.materialIndex })
  }
  return out
}

function instanceMatrices(mesh: Obj): Mat4[] {
  if (mesh.isInstancedMesh !== true) return [IDENTITY]
  const attr = asObj(mesh.instanceMatrix)
  if (!attr) return []
  const count = typeof mesh.count === 'number' ? mesh.count : attrCount(attr)
  const out: Mat4[] = []
  for (let i = 0; i < count; i++) {
    const m = new Array<number>(16)
    for (let k = 0; k < 16; k++) m[k] = readComponent(attr, i, k)
    out.push(m)
  }
  return out
}

function readPbr(material: unknown): {
  color: [number, number, number, number]
  roughness: number
  metalness: number
  doubleSided: boolean
  back: boolean
  shade: 'matte' | 'plastic' | 'metal' | 'glass'
  vertexColors: boolean
  map?: GlbPrimitive['map']
  emissive?: [number, number, number]
  clearcoat?: number
  clearcoatRoughness?: number
  transmission?: number
  thickness?: number
  ior?: number
  sheen?: number
  anisotropy?: number
} {
  const mat = asObj(material)
  const color = mat?.color
  const opacity = clamp01(finite(mat?.opacity, 1))
  let r = 1
  let g = 1
  let b = 1
  if (color && typeof color.r === 'number') {
    r = linearToSrgb(color.r)
    g = linearToSrgb(finite(color.g, 0))
    b = linearToSrgb(finite(color.b, 0))
  }
  if (mat?.isShaderMaterial === true || mat?.isRawShaderMaterial === true) {
    const picked = shaderColor(mat)
    if (picked) {
      r = linearToSrgb(picked.r)
      g = linearToSrgb(picked.g)
      b = linearToSrgb(picked.b)
    }
  }
  const side = finite(mat?.side, 0)
  const metalness = clamp01(finite(mat?.metalness, 0))
  const classified = classifyShade(mat, metalness)
  return {
    color: [r, g, b, opacity],
    roughness: classified.roughness,
    metalness,
    doubleSided: side === 2,
    back: side === 1,
    shade: classified.shade,
    vertexColors: mat?.vertexColors === true || mat?.vertexColors === 2,
    map: readMap(mat),
    emissive: readEmissive(mat),
    ...(typeof mat?.clearcoat === 'number' ? { clearcoat: clamp01(mat.clearcoat) } : {}),
    ...(typeof mat?.clearcoatRoughness === 'number' ? { clearcoatRoughness: clamp01(mat.clearcoatRoughness) } : {}),
    ...(typeof mat?.transmission === 'number' ? { transmission: clamp01(mat.transmission) } : {}),
    ...(typeof mat?.thickness === 'number' ? { thickness: mat.thickness } : {}),
    ...(typeof mat?.ior === 'number' ? { ior: mat.ior } : {}),
    ...(typeof mat?.sheen === 'number' ? { sheen: clamp01(mat.sheen) } : {}),
    ...(typeof mat?.anisotropy === 'number' ? { anisotropy: mat.anisotropy } : {}),
  }
}

const SHADER_COLOR_NAMES = ['color', 'uColor', 'diffuse', 'uDiffuse', 'baseColor', 'uBaseColor']

/** 着色器不跑。优先同名 uniform，其次名字里带 color 的，再其次任意 Color。 */
function shaderColor(mat: Obj): { r: number; g: number; b: number } | null {
  const uniforms = asObj(mat.uniforms)
  if (!uniforms) return null
  const entries = Object.entries(uniforms)
  for (const name of SHADER_COLOR_NAMES) {
    const found = entries.find(([key]) => key === name)
    const color = found ? colorOf(asObj(found[1])?.value, true) : null
    if (color) return color
  }
  for (const [key, uniform] of entries) {
    if (!/color|diffuse|tint/i.test(key)) continue
    const color = colorOf(asObj(uniform)?.value, true)
    if (color) return color
  }
  for (const [, uniform] of entries) {
    const color = colorOf(asObj(uniform)?.value, false)
    if (color) return color
  }
  return null
}

function colorOf(value: unknown, named: boolean): { r: number; g: number; b: number } | null {
  const obj = asObj(value)
  if (!obj || typeof obj.r !== 'number' || typeof obj.g !== 'number' || typeof obj.b !== 'number') return null
  if (!named && obj.isColor !== true) return null
  return { r: obj.r, g: obj.g, b: obj.b }
}

function readEmissive(mat: Obj | null): [number, number, number] | undefined {
  const color = mat?.emissive
  if (!color || typeof color.r !== 'number') return undefined
  const intensity = finite(mat?.emissiveIntensity, 1)
  const r = clamp01(linearToSrgb(color.r) * intensity)
  const g = clamp01(linearToSrgb(finite(color.g, 0)) * intensity)
  const b = clamp01(linearToSrgb(finite(color.b, 0)) * intensity)
  if (r <= 1e-4 && g <= 1e-4 && b <= 1e-4) return undefined
  return [r, g, b]
}

/** 只读已经在内存里的像素。网址贴图还没解码时当没有。 */
function readMap(mat: Obj | null): GlbPrimitive['map'] {
  const map = asObj(mat?.map)
  if (!map) return undefined
  const image = asObj(map.image)
  const rgba = image ? rgbaOf(image) : null
  if (!rgba) return undefined
  const repeat = asObj(map.repeat)
  const offset = asObj(map.offset)
  return {
    rgba: rgba.rgba,
    w: rgba.w,
    h: rgba.h,
    flipY: map.flipY !== false,
    repeatU: finite(repeat?.x, 1),
    repeatV: finite(repeat?.y, 1),
    offsetU: finite(offset?.x, 0),
    offsetV: finite(offset?.y, 0),
    wrapS: finite(map.wrapS, 1001),
    wrapT: finite(map.wrapT, 1001),
  }
}

function rgbaOf(image: Obj): { rgba: Uint8ClampedArray; w: number; h: number } | null {
  const w = finite(image.width, 0)
  const h = finite(image.height, 0)
  const data = image.data
  if (w > 0 && h > 0 && data && typeof (data as ArrayLike<number>).length === 'number') {
    const src = data as ArrayLike<number>
    const rgba = new Uint8ClampedArray(w * h * 4)
    if (src.length >= w * h * 4) {
      for (let i = 0; i < rgba.length; i++) rgba[i] = src[i] ?? 0
      return { rgba, w, h }
    }
    if (src.length >= w * h * 3) {
      for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
        rgba[j] = src[i] ?? 0
        rgba[j + 1] = src[i + 1] ?? 0
        rgba[j + 2] = src[i + 2] ?? 0
        rgba[j + 3] = 255
      }
      return { rgba, w, h }
    }
  }
  const getContext = (image as { getContext?: (kind: string) => { getImageData?: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } } | null }).getContext
  if (w > 0 && h > 0 && typeof getContext === 'function') {
    try {
      const ctx = getContext.call(image, '2d')
      const pixels = ctx?.getImageData?.(0, 0, w, h)
      if (pixels && pixels.data.length >= w * h * 4) return { rgba: pixels.data, w, h }
    } catch {
      return null
    }
  }
  return null
}

function readVec2Array(attr: Obj, count: number): Float32Array {
  const out = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const v = readVec2(attr, i)
    out[i * 2] = v[0]
    out[i * 2 + 1] = v[1]
  }
  return out
}

function readVec3Array(attr: Obj, count: number): Float32Array {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = readVec3(attr, i)
    out[i * 3] = v[0]
    out[i * 3 + 1] = v[1]
    out[i * 3 + 2] = v[2]
  }
  return out
}

function readVec2(attr: Obj, index: number): [number, number] {
  if (typeof attr.getX === 'function' && typeof attr.getY === 'function') {
    return [finite(attr.getX(index), 0), finite(attr.getY(index), 0)]
  }
  return [readComponent(attr, index, 0), readComponent(attr, index, 1)]
}

/** Lambert / Toon 只有明暗。Phong 的 shininess 100 收成粗糙度 0，环境最清楚。透射过半才用假玻璃。 */
function classifyShade(mat: Obj | null, metalness: number): { shade: 'matte' | 'plastic' | 'metal' | 'glass'; roughness: number } {
  if (mat?.isMeshLambertMaterial === true || mat?.isMeshToonMaterial === true) {
    return { shade: 'matte', roughness: 1 }
  }
  if (mat?.isMeshPhongMaterial === true) {
    return { shade: 'plastic', roughness: clamp01(1 - finite(mat.shininess, 30) / 100) }
  }
  const roughness = clamp01(finite(mat?.roughness, 0.65))
  if (mat?.isMeshPhysicalMaterial === true && finite(mat.transmission, 0) >= 0.5) {
    return { shade: 'glass', roughness }
  }
  return { shade: metalness >= 0.5 ? 'metal' : 'plastic', roughness }
}

/** three 默认把作者写的 sRGB 存成线性值。图元颜色按显示用的 sRGB 字节走。 */
function linearToSrgb(channel: number): number {
  const c = clamp01(channel)
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

function attrCount(attr: Obj): number {
  if (typeof attr.count === 'number') return attr.count
  if (attr.array && typeof attr.itemSize === 'number' && attr.itemSize > 0) return Math.floor(attr.array.length / attr.itemSize)
  return 0
}

function readVec3(attr: Obj, index: number): [number, number, number] {
  if (typeof attr.getX === 'function' && typeof attr.getY === 'function' && typeof attr.getZ === 'function') {
    return [finite(attr.getX(index), 0), finite(attr.getY(index), 0), finite(attr.getZ(index), 0)]
  }
  return [readComponent(attr, index, 0), readComponent(attr, index, 1), readComponent(attr, index, 2)]
}

function readIndex(index: Obj | null, at: number): number {
  if (!index) return at
  if (typeof index.getX === 'function') return index.getX(at) | 0
  return readComponent(index, at, 0) | 0
}

function readComponent(attr: Obj, index: number, component: number): number {
  const data = attr.data
  if (data && typeof data.stride === 'number' && data.array) {
    const offset = typeof attr.offset === 'number' ? attr.offset : 0
    return finite(data.array[index * data.stride + offset + component], 0)
  }
  if (attr.array && typeof attr.itemSize === 'number') return finite(attr.array[index * attr.itemSize + component], 0)
  return 0
}

function elementsOf(matrix: { elements?: ArrayLike<number> } | undefined): Mat4 | null {
  const elements = matrix?.elements
  if (!elements || elements.length < 16) return null
  const out = new Array<number>(16)
  for (let i = 0; i < 16; i++) out[i] = finite(elements[i], 0)
  return out
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
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

function applyPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ]
}

function det3(m: Mat4): number {
  const a = m[0]!
  const b = m[1]!
  const c = m[2]!
  const d = m[4]!
  const e = m[5]!
  const f = m[6]!
  const g = m[8]!
  const h = m[9]!
  const i = m[10]!
  return a * (e * i - f * h) + b * (f * g - d * i) + c * (d * h - e * g)
}

function normalMat(m: Mat4): number[] {
  const a = m[0]!
  const b = m[1]!
  const c = m[2]!
  const d = m[4]!
  const e = m[5]!
  const f = m[6]!
  const g = m[8]!
  const h = m[9]!
  const i = m[10]!
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const D = c * h - b * i
  const E = a * i - c * g
  const F = b * g - a * h
  const G = b * f - c * e
  const H = c * d - a * f
  const I = a * e - b * d
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det]
}

function applyNormal(n: number[], x: number, y: number, z: number): [number, number, number] {
  const ox = n[0]! * x + n[3]! * y + n[6]! * z
  const oy = n[1]! * x + n[4]! * y + n[7]! * z
  const oz = n[2]! * x + n[5]! * y + n[8]! * z
  const len = Math.hypot(ox, oy, oz) || 1
  return [ox / len, oy / len, oz / len]
}

export type ThreeLight = {
  type: 'directional' | 'point' | 'spot' | 'hemisphere' | 'ambient'
  color: [number, number, number]
  intensity: number
  x: number
  y: number
  z: number
}

/** 读 three.js 场景里的灯。颜色保持线性，和 three.js 的 Color 一致。 */
export function lightsFromThree(root: unknown): ThreeLight[] {
  const out: ThreeLight[] = []
  const visit = (node: unknown) => {
    const obj = asObj(node)
    if (!obj) return
    const type = obj.isDirectionalLight
      ? 'directional'
      : obj.isSpotLight
        ? 'spot'
        : obj.isPointLight
          ? 'point'
          : obj.isHemisphereLight
            ? 'hemisphere'
            : obj.isAmbientLight
              ? 'ambient'
              : ''
    if (type) {
      const color = obj.color
      out.push({
        type,
        color: [finite(color?.r, 1), finite(color?.g, 1), finite(color?.b, 1)],
        intensity: finite(obj.intensity, 1),
        x: finite(obj.position?.x, 0),
        y: finite(obj.position?.y, 0),
        z: finite(obj.position?.z, 0),
      })
    }
    if (Array.isArray(obj.children)) for (const child of obj.children) visit(child)
  }
  visit(root)
  return out
}
