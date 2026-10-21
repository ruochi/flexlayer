import type { LayerChild, LayerNode } from './parse.js'

export type LayerProps = Record<string, unknown> & {
  style?: string
  children?: LayerChild | LayerChild[]
}

function styleToString(style: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(style)) {
    if (value == null || value === false) continue
    const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    parts.push(`${name}:${typeof value === 'number' ? String(value) : String(value)}`)
  }
  return parts.join('; ')
}

function flattenChildren(parts: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const part of parts) {
    if (Array.isArray(part)) out.push(...flattenChildren(part))
    else if (typeof part === 'string' || typeof part === 'function') out.push(part)
    else if (part != null && typeof part === 'object' && 'tag' in part) out.push(part)
  }
  return out
}

function isPlainData(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value != null)
}

/** 构建 Flex Layer 节点。`data` 挂在节点上，不进 `attrs`。`<script>` 的函数子节点记在 `scriptFns`。 */
export function h(tag: string, props: LayerProps | null, ...children: unknown[]): LayerNode {
  const attrs: Record<string, string> = {}
  let data: unknown
  let hasData = false
  let camera: unknown
  let hasCamera = false
  let modelObject: unknown
  let hasModelObject = false
  let draw = false
  const badAttrs: string[] = []
  const p = props ?? {}

  for (const [key, value] of Object.entries(p)) {
    if (key === 'draw') {
      draw = value != null
      continue
    }
    if (key === 'data') {
      if (value !== undefined) {
        data = value
        hasData = true
      }
      continue
    }
    if (key === 'camera' && isPlainData(value)) {
      camera = value
      hasCamera = true
      continue
    }
    if (key === 'object' && isPlainData(value)) {
      modelObject = value
      hasModelObject = true
      continue
    }
    if (key === 'children' || key === 'key' || key === 'ref') continue
    if (typeof value === 'function') continue
    if (value == null || value === false) continue
    if (key === 'style' && typeof value === 'object') {
      attrs.style = styleToString(value as Record<string, unknown>)
      continue
    }
    if (isPlainData(value)) {
      badAttrs.push(key)
      continue
    }
    attrs[key] = String(value)
  }

  const fromProps = p.children
  const merged = flattenChildren(fromProps == null ? children : Array.isArray(fromProps) ? fromProps : [fromProps])
  const scriptFns: Array<() => void> = []
  const kept: LayerChild[] = []
  for (const part of merged) {
    if (typeof part === 'function') {
      if (tag === 'script') scriptFns.push(part as () => void)
      continue
    }
    kept.push(part as LayerChild)
  }

  const node: LayerNode = { tag, attrs, children: kept }
  if (hasData) node.data = data
  if (hasCamera) node.camera = camera
  if (hasModelObject) node.modelObject = modelObject
  if (badAttrs.length > 0) node.badAttrs = badAttrs
  if (scriptFns.length > 0) node.scriptFns = scriptFns
  if (draw) node.legacyDraw = true
  return node
}
