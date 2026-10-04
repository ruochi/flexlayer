import { isAbsolute, resolve } from 'node:path'
import { readFileSync, statSync } from 'node:fs'

export type GlbPrimitive = {
  positions: Float32Array
  normals?: Float32Array
  indices?: Uint32Array
  color: [number, number, number, number]
  roughness: number
  metalness: number
  doubleSided: boolean
}

type Mat4 = number[]

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

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

function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

function scaleMat(x: number, y: number, z: number): Mat4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
}

function quatMat(x: number, y: number, z: number, w: number): Mat4 {
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ]
}

function nodeLocal(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat4 {
  if (node.matrix && node.matrix.length === 16) return node.matrix
  const t = node.translation ?? [0, 0, 0]
  const r = node.rotation ?? [0, 0, 0, 1]
  const s = node.scale ?? [1, 1, 1]
  return mul(translation(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0), mul(quatMat(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 1), scaleMat(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1)))
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

const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }

function readComponent(view: DataView, offset: number, type: number): number {
  switch (type) {
    case 5120:
      return view.getInt8(offset)
    case 5121:
      return view.getUint8(offset)
    case 5122:
      return view.getInt16(offset, true)
    case 5123:
      return view.getUint16(offset, true)
    case 5125:
      return view.getUint32(offset, true)
    case 5126:
      return view.getFloat32(offset, true)
    default:
      return 0
  }
}

type GltfJson = {
  scene?: number
  scenes?: Array<{ nodes?: number[] }>
  nodes?: Array<{ mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>
  meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number; NORMAL?: number }; indices?: number; material?: number; mode?: number }> }>
  materials?: Array<{ doubleSided?: boolean; pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number } }>
  accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }>
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>
}

function readAccessor(json: GltfJson, bin: Buffer, index: number): number[] | null {
  const acc = json.accessors?.[index]
  if (!acc || acc.bufferView == null) return null
  const view = json.bufferViews?.[acc.bufferView]
  if (!view) return null
  const itemSize = TYPE_SIZE[acc.type]
  const comp = COMP_SIZE[acc.componentType]
  if (!itemSize || !comp) return null
  const stride = view.byteStride ?? itemSize * comp
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const out: number[] = []
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < itemSize; k++) out.push(readComponent(data, start + i * stride + k * comp, acc.componentType))
  }
  return out
}

function chunk(primitives: GlbPrimitive[], json: GltfJson, bin: Buffer) {
  const scenes = json.scenes ?? []
  const scene = scenes[json.scene ?? 0] ?? scenes[0]
  const roots = scene?.nodes ?? []
  const nodes = json.nodes ?? []
  const walk = (index: number, parent: Mat4) => {
    const node = nodes[index]
    if (!node) return
    const world = mul(parent, nodeLocal(node))
    if (node.mesh != null) emitMesh(json, bin, node.mesh, world, primitives)
    for (const child of node.children ?? []) walk(child, world)
  }
  for (const index of roots) walk(index, IDENTITY)
  return primitives
}

function emitMesh(json: GltfJson, bin: Buffer, meshIndex: number, world: Mat4, out: GlbPrimitive[]) {
  const mesh = json.meshes?.[meshIndex]
  if (!mesh?.primitives) return
  const normalsOf = normalMat(world)
  for (const prim of mesh.primitives) {
    if (prim.mode != null && prim.mode !== 4) continue
    const posIndex = prim.attributes?.POSITION
    if (posIndex == null) continue
    const rawPos = readAccessor(json, bin, posIndex)
    if (!rawPos) continue
    const positions = new Float32Array(rawPos.length)
    for (let i = 0; i < rawPos.length; i += 3) {
      const p = applyPoint(world, rawPos[i] ?? 0, rawPos[i + 1] ?? 0, rawPos[i + 2] ?? 0)
      positions[i] = p[0]
      positions[i + 1] = p[1]
      positions[i + 2] = p[2]
    }
    let normals: Float32Array | undefined
    const normalIndex = prim.attributes?.NORMAL
    if (normalIndex != null) {
      const rawN = readAccessor(json, bin, normalIndex)
      if (rawN && rawN.length === rawPos.length) {
        normals = new Float32Array(rawN.length)
        for (let i = 0; i < rawN.length; i += 3) {
          const n = applyNormal(normalsOf, rawN[i] ?? 0, rawN[i + 1] ?? 0, rawN[i + 2] ?? 0)
          normals[i] = n[0]
          normals[i + 1] = n[1]
          normals[i + 2] = n[2]
        }
      }
    }
    let indices: Uint32Array | undefined
    if (prim.indices != null) {
      const raw = readAccessor(json, bin, prim.indices)
      if (raw) indices = Uint32Array.from(raw)
    }
    const material = json.materials?.[prim.material ?? -1]
    const pbr = material?.pbrMetallicRoughness
    const factor = pbr?.baseColorFactor ?? [1, 1, 1, 1]
    out.push({
      positions,
      normals,
      indices,
      color: [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, factor[3] ?? 1],
      roughness: pbr?.roughnessFactor ?? 0.65,
      metalness: pbr?.metallicFactor ?? 0,
      doubleSided: material?.doubleSided ?? false,
    })
  }
}

/** 读 glTF 二进制。忽略文件里的相机。坐标保持文件原来的 y 向上。 */
export function parseGlb(buf: Buffer): GlbPrimitive[] {
  if (buf.length < 20 || buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('不是 glb')
  const jsonLength = buf.readUInt32LE(12)
  const jsonType = buf.readUInt32LE(16)
  if (jsonType !== 0x4e4f534a) throw new Error('glb 缺少 JSON')
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength)) as GltfJson
  const binHeader = 20 + jsonLength
  if (buf.length < binHeader + 8) return []
  const binLength = buf.readUInt32LE(binHeader)
  const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLength)
  return chunk([], json, bin)
}

export function resolveModelFile(src: string, baseDir: string): { file?: string; reason: 'empty' | 'type' | 'missing' | 'ok' } {
  const trimmed = src.trim()
  if (!trimmed) return { reason: 'empty' }
  if (!trimmed.toLowerCase().endsWith('.glb')) return { reason: 'type' }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { reason: 'type' }
  const file = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  try {
    if (!statSync(file).isFile()) return { reason: 'missing' }
  } catch {
    return { reason: 'missing' }
  }
  return { file, reason: 'ok' }
}

function pad4(buf: Buffer, fill: number): Buffer {
  const extra = (4 - (buf.length % 4)) % 4
  if (extra === 0) return buf
  return Buffer.concat([buf, Buffer.alloc(extra, fill)])
}

/** 模型在 glTF 空间里的包围盒尺寸。拟合前的原始跨度。 */
export function glbSpan(file: string): { x: number; y: number; z: number } | null {
  try {
    const prims = parseGlb(readFileSync(file))
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
    if (!Number.isFinite(minX)) return null
    return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
  } catch {
    return null
  }
}

/** 一个轴对齐的单位立方体，边长 2，中心在原点。给例子和测试用。 */
export function solidBoxGlb(color: [number, number, number, number] = [1, 0, 0, 1]): Buffer {
  const faces: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ]
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (const face of faces) {
    const base = positions.length / 3
    for (const v of face.v) {
      positions.push(v[0], v[1], v[2])
      normals.push(face.n[0], face.n[1], face.n[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const posBuf = Buffer.alloc(positions.length * 4)
  const norBuf = Buffer.alloc(normals.length * 4)
  for (let i = 0; i < positions.length; i++) posBuf.writeFloatLE(positions[i]!, i * 4)
  for (let i = 0; i < normals.length; i++) norBuf.writeFloatLE(normals[i]!, i * 4)
  const idxBuf = Buffer.alloc(indices.length * 2)
  for (let i = 0; i < indices.length; i++) idxBuf.writeUInt16LE(indices[i]!, i * 2)
  const bin = pad4(Buffer.concat([posBuf, norBuf, idxBuf]), 0)
  const posBytes = posBuf.length
  const norBytes = norBuf.length
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.65 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes },
      { buffer: 0, byteOffset: posBytes, byteLength: norBytes },
      { buffer: 0, byteOffset: posBytes + norBytes, byteLength: idxBuf.length },
    ],
    buffers: [{ byteLength: bin.length }],
  }
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json)), 0x20)
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length
  const header = Buffer.alloc(12)
  header.write('glTF', 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonBuf.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(bin.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin])
}
