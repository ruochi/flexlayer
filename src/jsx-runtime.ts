import { h, type FvgProps } from './h.js'
import type { FvgChild, FvgNode, SourceLoc } from './parse.js'

export type { JSX } from './jsx-intrinsics.js'

export const Fragment: unique symbol = Symbol.for('flexlayer.Fragment')

export type JsxSource = {
  fileName: string
  lineNumber: number
  columnNumber: number
}

type JsxType = string | ((props: Record<string, unknown>) => unknown) | symbol

function locFrom(source: JsxSource | undefined): SourceLoc | undefined {
  if (!source || typeof source.fileName !== 'string') return undefined
  return {
    file: source.fileName,
    line: source.lineNumber,
    column: source.columnNumber,
  }
}

function normalizeChildren(children: unknown): FvgChild[] {
  if (children == null || typeof children === 'boolean') return []
  if (Array.isArray(children)) {
    const out: FvgChild[] = []
    for (const child of children) out.push(...normalizeChildren(child))
    return out
  }
  if (typeof children === 'string') return [children]
  if (typeof children === 'number') return [String(children)]
  if (typeof children === 'object') return [children as FvgChild]
  return []
}

function createElement(type: JsxType, props: FvgProps | null, source?: JsxSource): FvgNode | FvgChild[] | null {
  const raw = props ?? {}
  if (type === Fragment) return normalizeChildren(raw.children)
  if (typeof type === 'function') {
    const rendered = type({ ...raw })
    if (rendered == null || typeof rendered === 'boolean') return null
    if (Array.isArray(rendered)) return normalizeChildren(rendered)
    if (typeof rendered === 'string' || typeof rendered === 'number') return [String(rendered)]
    if (typeof rendered === 'object' && rendered && 'tag' in rendered) return rendered as FvgNode
    const name = type.name || 'Anonymous'
    throw new Error(`组件 ${name} 必须返回一个 Flex Layer 元素`)
  }
  if (typeof type !== 'string') throw new Error('不支持的 JSX 标签')

  const { children, ...rest } = raw
  const node = h(type, rest, ...normalizeChildren(children))
  const loc = locFrom(source)
  if (loc) node.loc = loc
  return node
}

export function jsx(type: JsxType, props: FvgProps | null, _key?: string): FvgNode | FvgChild[] | null {
  return createElement(type, props)
}

export function jsxs(type: JsxType, props: FvgProps | null, key?: string): FvgNode | FvgChild[] | null {
  return jsx(type, props, key)
}

export function jsxDEV(
  type: JsxType,
  props: FvgProps | null,
  _key: string | undefined,
  _isStatic: boolean,
  source?: JsxSource,
  _self?: unknown,
): FvgNode | FvgChild[] | null {
  return createElement(type, props, source)
}

export { h }
