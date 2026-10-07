import { h, type FvgProps } from './h.js'
import { JSX as JsxTypes } from './jsx-intrinsics.js'
import type { FvgChild, FvgNode, SourceLoc } from './parse.js'

/**
 * 自定义标签往这个接口上加。`jsxImportSource` 看的是本模块，不是包根。
 *
 * declare module 'flexlayer/jsx-runtime' {
 *   namespace JSX {
 *     interface IntrinsicElements {
 *       badge: { r: number; fill?: string }
 *     }
 *   }
 * }
 *
 * canvas.component('badge', (a) => ...) 的参数就是这份类型。a.r 是 number。
 * render 可以返回一个元素，或元素数组。
 */
export namespace JSX {
  export type Element = JsxTypes.Element
  export interface ElementChildrenAttribute extends JsxTypes.ElementChildrenAttribute {}
  export interface IntrinsicAttributes extends JsxTypes.IntrinsicAttributes {}
  export interface IntrinsicElements extends JsxTypes.IntrinsicElements {}
}

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

type RenderFn<P> = (props: P) => FvgNode | FvgChild[] | null | undefined

export function jsx(type: string, props: FvgProps | null, key?: string): FvgNode
export function jsx(type: typeof Fragment, props: FvgProps | null, key?: string): FvgChild[]
export function jsx<P>(type: RenderFn<P>, props: P | null, key?: string): FvgNode | FvgChild[] | null
export function jsx(type: JsxType, props: FvgProps | null, _key?: string): FvgNode | FvgChild[] | null {
  return createElement(type, props)
}

export function jsxs(type: string, props: FvgProps | null, key?: string): FvgNode
export function jsxs(type: typeof Fragment, props: FvgProps | null, key?: string): FvgChild[]
export function jsxs<P>(type: RenderFn<P>, props: P | null, key?: string): FvgNode | FvgChild[] | null
export function jsxs(type: JsxType, props: FvgProps | null, _key?: string): FvgNode | FvgChild[] | null {
  return createElement(type, props)
}

export function jsxDEV(type: string, props: FvgProps | null, key: string | undefined, isStatic: boolean, source?: JsxSource, self?: unknown): FvgNode
export function jsxDEV(type: typeof Fragment, props: FvgProps | null, key: string | undefined, isStatic: boolean, source?: JsxSource, self?: unknown): FvgChild[]
export function jsxDEV<P>(type: RenderFn<P>, props: P | null, key: string | undefined, isStatic: boolean, source?: JsxSource, self?: unknown): FvgNode | FvgChild[] | null
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
