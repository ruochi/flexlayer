import type { DrawFn } from './types.js'
import type { FvgChild, FvgNode } from './parse.js'
import { canonicalTag } from './tags.js'

export type FvgProps = Record<string, unknown> & {
  draw?: DrawFn
  style?: string
  children?: FvgChild | FvgChild[]
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

function flattenChildren(parts: unknown[]): FvgChild[] {
  const out: FvgChild[] = []
  for (const part of parts) {
    if (Array.isArray(part)) out.push(...flattenChildren(part))
    else if (typeof part === 'string') out.push(part)
    else if (part != null && typeof part === 'object' && 'tag' in part) out.push(part as FvgNode)
  }
  return out
}

function isPlainData(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value != null)
}

/** 构建 Flex Layer 节点；`draw` 和 `data` 挂在节点上，不进 `attrs`。 */
export function h(tag: string, props: FvgProps | null, ...children: unknown[]): FvgNode {
  const attrs: Record<string, string> = {}
  let draw: DrawFn | undefined
  let data: unknown
  let hasData = false
  let camera: unknown
  let hasCamera = false
  const badAttrs: string[] = []
  const p = props ?? {}

  for (const [key, value] of Object.entries(p)) {
    if (key === 'draw') {
      draw = value as DrawFn
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
  const merged =
    fromProps == null
      ? flattenChildren(children)
      : flattenChildren(Array.isArray(fromProps) ? fromProps : [fromProps])

  const name = canonicalTag(tag)
  const node: FvgNode = { tag: name, attrs, children: merged, draw }
  if (hasData) node.data = data
  if (hasCamera) node.camera = camera
  if (badAttrs.length > 0) node.badAttrs = badAttrs
  if (tag !== name) node.writtenTag = tag
  return node
}
