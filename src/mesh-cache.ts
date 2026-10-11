import { statSync } from 'node:fs'
import type { Canvas } from '@napi-rs/canvas'
import type { LayerLayoutNode, LayoutNode, MeshLayoutNode } from './types.js'
import type { Perspective } from './perspective.js'

/** 画进父层的网格画面。和 mesh.ts 的 MeshFrame 同一形状，避免两个模块互相引用。 */
export type CachedMeshFrame = { canvas: Canvas; x: number; y: number; width: number; height: number }

export type MeshClip = { x: number; y: number; width: number; height: number }

type Mat4 = number[]

export type MeshCacheScene = {
  layer: LayerLayoutNode
  perspective: Perspective
  meshes: Array<{ node: MeshLayoutNode; toLayer: Mat4; opacity?: number }>
  planes: Array<{ node: LayoutNode; peeled: LayoutNode; toLayer: Mat4 }>
  scale: number
  samples: number
  clip: MeshClip
}

const DEFAULT_CACHE_BYTES = 256 * 1024 * 1024

/** 1、2、4 以外都回到默认的 4 倍超采样。 */
export function meshSampleCount(value: number | undefined): 1 | 2 | 4 {
  if (value === 1 || value === 2 || value === 4) return value
  return 4
}

/** 渲染选项优先，其次是环境变量 FLEXLAYER_MESH_CACHE。0 / off / false 关闭。 */
export function meshCacheLimit(option: number | false | undefined): number {
  if (option === false) return 0
  if (typeof option === 'number' && Number.isFinite(option)) return Math.max(0, Math.floor(option))
  const env = process.env.FLEXLAYER_MESH_CACHE
  if (env != null && env.trim() !== '') {
    const text = env.trim().toLowerCase()
    if (text === '0' || text === 'off' || text === 'false') return 0
    const n = Number(text)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return DEFAULT_CACHE_BYTES
}

function qnum(n: number): number {
  if (!Number.isFinite(n)) return n
  return Math.round(n * 1e4) / 1e4
}

/** 稳定字符串。遇到函数就返回 null，调用方据此不缓存。 */
function stable(value: unknown): string | null {
  if (value == null) return ''
  const kind = typeof value
  if (kind === 'number') return String(qnum(value as number))
  if (kind === 'string') return JSON.stringify(value)
  if (kind === 'boolean') return value ? '1' : '0'
  if (kind === 'function') return null
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      const part = stable(item)
      if (part == null) return null
      parts.push(part)
    }
    return `[${parts.join(',')}]`
  }
  if (kind === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const key of keys) {
      const part = stable(obj[key])
      if (part == null) return null
      parts.push(`${JSON.stringify(key)}:${part}`)
    }
    return `{${parts.join(',')}}`
  }
  return null
}

function modelStamp(file: string): string {
  try {
    const st = statSync(file)
    return `${qnum(st.mtimeMs)}:${st.size}`
  } catch {
    return 'missing'
  }
}

/** 子树里有画不出来的、或会跟着时间走的东西时返回 null。 */
function hashNode(node: LayoutNode): string | null {
  if (node.draw) return null
  if (node.glass || node.backdropBlur != null) return null
  if (node.blend && node.blend !== 'source-over') return null
  if (node.grade) return null
  if (node.filters?.some((filter) => filter.includeBackdrop || filter.name === 'grade')) return null
  const common = stable({
    tag: node.tag,
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
    opacity: node.opacity,
    rotate: node.rotate,
    rotateX: node.rotateX ?? 0,
    rotateY: node.rotateY ?? 0,
    z: node.z ?? 0,
    scaleX: node.scaleX,
    scaleY: node.scaleY,
    origin: node.origin ?? null,
    background: node.background ?? '',
    border: node.border ?? null,
    borderRadius: node.borderRadius ?? 0,
    padding: node.padding,
    text: node.text,
    shadow: node.shadow ?? null,
    glow: node.glow ?? null,
    innerShadow: node.innerShadow ?? null,
    innerGlow: node.innerGlow ?? null,
    inkStroke: node.inkStroke ?? null,
    blur: node.blur ?? 0,
    noise: node.noise ?? null,
    overlay: node.overlay ?? null,
    colorFilter: node.colorFilter ?? null,
    gradeMask: node.gradeMask ?? '',
    filters: (node.filters ?? []).filter((filter) => !filter.includeBackdrop).map((filter) => ({
      name: filter.name,
      kind: filter.kind,
      spec: filter.spec,
      mask: filter.mask ?? '',
    })),
    attr: node.attr,
  })
  if (common == null) return null
  const extra = hashKind(node)
  if (extra == null) return null
  return `${node.kind}|${common}|${extra}`
}

function hashKids(nodes: LayoutNode[]): string | null {
  const parts: string[] = []
  for (const child of nodes) {
    const part = hashNode(child)
    if (part == null) return null
    parts.push(part)
  }
  return parts.join(';')
}

function hashKind(node: LayoutNode): string | null {
  if (node.kind === 'layer') {
    const kids = hashKids(node.children)
    if (kids == null) return null
    const masks = node.mask ? hashKids(node.mask) : ''
    if (masks == null) return null
    const head = stable({
      overflow: node.overflow ?? 'visible',
      perspective: node.perspective ?? '',
      view: node.view ?? null,
      feather: node.maskFeather ?? 0,
      invert: node.maskInvert ?? false,
    })
    if (head == null) return null
    return `${head}|${kids}|${masks}`
  }
  if (node.kind === 'flex') {
    const kids = hashKids(node.children)
    if (kids == null) return null
    return `${node.direction}|${kids}`
  }
  if (node.kind === 'group') {
    const kids = hashKids(node.children)
    if (kids == null) return null
    const svg = stable(node.svg)
    if (svg == null) return null
    return `${svg}|${kids}`
  }
  if (node.kind === 'text') {
    return stable({
      align: node.textAlign,
      lines: node.textLayout.lines.map((line) => ({
        x: line.segments.map((segment) => segment.x),
        y: line.y,
        w: line.width,
        text: line.segments.map((segment) => segment.text).join(''),
        style: line.segments.map((segment) => segment.style),
      })),
    })
  }
  if (node.kind === 'image') {
    const bitmap = node.bitmap
    return stable({
      fit: node.objectFit,
      pos: node.objectPosition,
      bitmap: bitmap ? `${bitmap.width}x${bitmap.height}` : '',
      channel: node.maskChannel ?? '',
      pick: node.maskPick ?? null,
    })
  }
  if (node.kind === 'shape') {
    return stable({
      shape: node.shape,
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      rx: node.rx ?? 0,
      r: node.r ?? 0,
      rxEllipse: node.rxEllipse ?? 0,
      ry: node.ry ?? 0,
      dash: node.dash ?? null,
    })
  }
  if (node.kind === 'line') {
    return stable({
      geometry: node.geometry,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      fill: node.fill,
      cap: node.strokeLinecap ?? '',
      join: node.strokeLinejoin ?? '',
      dash: node.dash ?? null,
    })
  }
  if (node.kind === 'mesh') {
    const mesh = node.mesh
    const stamp = mesh.type === 'model' && mesh.file ? modelStamp(mesh.file) : ''
    return stable({
      mesh,
      stamp,
      fill: node.fill,
      material: node.material ?? null,
      stroke: node.stroke,
      strokeWidths: node.strokeWidths,
      halo: node.halo,
      hidden: node.hidden,
    })
  }
  return ''
}

/**
 * 按内容而不是对象引用。浮点数量化到 1e-4。
 * 子树无法哈希（draw、玻璃、跟着时间走的效果）时返回 null。
 */
export function meshSceneCacheKey(scene: MeshCacheScene): string | null {
  const parts: string[] = [
    'mesh-scene-v1',
    String(qnum(scene.layer.width)),
    String(qnum(scene.layer.height)),
    String(scene.perspective),
    String(qnum(scene.scale)),
    String(scene.samples),
    stable(scene.clip) ?? '',
  ]
  for (const instance of scene.meshes) {
    const node = instance.node
    const mesh = node.mesh
    const stamp = mesh.type === 'model' && mesh.file ? modelStamp(mesh.file) : ''
    const body = stable({
      mesh,
      stamp,
      w: node.width,
      h: node.height,
      origin: node.origin ?? null,
      opacity: node.opacity,
      instOpacity: instance.opacity ?? 1,
      fill: node.fill,
      material: node.material ?? null,
      stroke: node.stroke,
      strokeWidths: node.strokeWidths,
      halo: node.halo,
      hidden: node.hidden,
      toLayer: instance.toLayer,
    })
    if (body == null) return null
    parts.push(body)
  }
  for (const plane of scene.planes) {
    const peeled = hashNode(plane.peeled)
    if (peeled == null) return null
    const pose = stable({
      w: plane.node.width,
      h: plane.node.height,
      origin: plane.node.origin ?? null,
      toLayer: plane.toLayer,
    })
    if (pose == null) return null
    parts.push(`plane|${pose}|${peeled}`)
  }
  return parts.join('\n')
}

type Entry = { frame: CachedMeshFrame; bytes: number }

const entries = new Map<string, Entry>()
let totalBytes = 0

export function readMeshCache(key: string): CachedMeshFrame | null {
  const hit = entries.get(key)
  if (!hit) return null
  entries.delete(key)
  entries.set(key, hit)
  return hit.frame
}

export function writeMeshCache(key: string, frame: CachedMeshFrame, limit: number) {
  if (!(limit > 0)) return
  const bytes = Math.max(1, frame.canvas.width * frame.canvas.height * 4)
  if (bytes > limit) return
  const prev = entries.get(key)
  if (prev) {
    totalBytes -= prev.bytes
    entries.delete(key)
  }
  entries.set(key, { frame, bytes })
  totalBytes += bytes
  while (totalBytes > limit && entries.size > 1) {
    const oldest = entries.keys().next().value
    if (oldest === undefined || oldest === key) break
    const old = entries.get(oldest)
    entries.delete(oldest)
    if (old) totalBytes -= old.bytes
  }
}

export function clearMeshCache() {
  entries.clear()
  totalBytes = 0
}
