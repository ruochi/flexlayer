import type { GlbPrimitive } from './glb.js'

/**
 * 把 three.js 的 Object3D 收成和 glb 一样的图元。
 * 不 import three：用 isMesh / isBufferGeometry 认类型，避免同一包的两份构建对不上 instanceof。
 * 坐标保持 three 的 y 向上。翻到作者空间的 y 向下发生在投影，这里再翻会把绕序翻两次。
 * 负行列式（镜像缩放）会把三角形绕序翻一次，这里换回正面。
 * 不读着色器、灯光、贴图、顶点色和骨骼；SkinnedMesh 只用绑定姿态。
 */

type Mat4 = number[]

type Obj = {
  parent?: unknown
  children?: unknown
  visible?: boolean
  isMesh?: boolean
  isInstancedMesh?: boolean
  isBufferGeometry?: boolean
  matrixWorld?: { elements?: ArrayLike<number> }
  updateMatrixWorld?: (force?: boolean) => void
  geometry?: unknown
  material?: unknown
  instanceMatrix?: unknown
  count?: number
  attributes?: { position?: unknown; normal?: unknown }
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
  opacity?: number
  roughness?: number
  metalness?: number
  side?: number
  start?: number
  materialIndex?: number
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
      const pbr = readPbr(materials[range.materialIndex] ?? materials[0])
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
      out.push({
        positions,
        normals,
        indices: written === indices.length ? indices : indices.slice(0, written),
        color: pbr.color,
        roughness: pbr.roughness,
        metalness: pbr.metalness,
        doubleSided: pbr.doubleSided,
      })
    }
  }
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
  const side = finite(mat?.side, 0)
  return {
    color: [r, g, b, opacity],
    roughness: clamp01(finite(mat?.roughness, 0.65)),
    metalness: clamp01(finite(mat?.metalness, 0)),
    doubleSided: side === 2,
    back: side === 1,
  }
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
