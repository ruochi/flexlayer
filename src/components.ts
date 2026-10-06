import { h } from './h.js'
import type { FvgChild, FvgNode } from './parse.js'

export type ComponentProps = {
  children?: FvgChild[]
  [key: string]: string | FvgChild[] | undefined
}

export type ComponentFn = (props: ComponentProps) => FvgNode | FvgChild[] | null | undefined

const REGISTRY_KEY = '__flexlayerComponents'

type GlobalRegistry = typeof globalThis & { __flexlayerComponents?: Map<string, ComponentFn> }

/** 注册表挂在 globalThis 上。tsx 会被打成另一份模块，进程里仍是同一张表。 */
function registry(): Map<string, ComponentFn> {
  const g = globalThis as GlobalRegistry
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map()
  return g[REGISTRY_KEY]
}

export function registerComponent(name: string, render: ComponentFn) {
  const key = name.trim().toLowerCase()
  if (!key) throw new Error('组件名不能为空')
  registry().set(key, render)
}

export function componentOf(name: string): ComponentFn | undefined {
  return registry().get(name.trim().toLowerCase())
}

function attr(props: ComponentProps, name: string): string | undefined {
  const value = props[name]
  return typeof value === 'string' ? value : undefined
}

/** 内置箭头。展开成线加一个张角 30° 的三角。head 缺省是 max(12, stroke-width * 4)。 */
export function arrowComponent(props: ComponentProps): FvgNode {
  const x1 = Number(attr(props, 'x1') ?? 0)
  const y1 = Number(attr(props, 'y1') ?? 0)
  const x2 = Number(attr(props, 'x2') ?? 0)
  const y2 = Number(attr(props, 'y2') ?? 0)
  const sw = Number(attr(props, 'stroke-width') ?? 4)
  const headRaw = attr(props, 'head')
  const head = headRaw != null && headRaw !== '' ? Number(headRaw) : Math.max(12, (Number.isFinite(sw) ? sw : 4) * 4)
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const wing = (turn: number) => {
    const a = ang + turn
    return `${x2 - head * Math.cos(a)},${y2 - head * Math.sin(a)}`
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const reach = (Number.isFinite(head) ? head : 12) * Math.cos(Math.PI / 6)
  const back = Math.min(Math.max(0, reach), Math.max(0, len - 0.5))
  const ux = len > 1e-6 ? dx / len : 1
  const uy = len > 1e-6 ? dy / len : 0
  const lineAttrs: Record<string, string> = {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2 - ux * back),
    y2: String(y2 - uy * back),
    'stroke-width': String(Number.isFinite(sw) ? sw : 4),
    'stroke-linecap': 'butt',
  }
  const stroke = attr(props, 'stroke')
  if (stroke) lineAttrs.stroke = stroke
  const linecap = attr(props, 'stroke-linecap')
  if (linecap) lineAttrs['stroke-linecap'] = linecap
  const linejoin = attr(props, 'stroke-linejoin')
  if (linejoin) lineAttrs['stroke-linejoin'] = linejoin
  const dash = attr(props, 'stroke-dasharray')
  if (dash) lineAttrs['stroke-dasharray'] = dash
  const opacity = attr(props, 'opacity')
  if (opacity) lineAttrs.opacity = opacity
  const poly: Record<string, string> = {
    points: `${x2},${y2} ${wing(-Math.PI / 6)} ${wing(Math.PI / 6)}`,
    // 没写 stroke 时，排版把 inherit 换成线条的默认颜色
    fill: stroke || 'inherit',
    stroke: 'none',
  }
  return h('g', {}, h('line', lineAttrs), h('polygon', poly))
}

registerComponent('arrow', arrowComponent)

function asNode(rendered: FvgNode | FvgChild[] | null | undefined): FvgNode | null {
  if (rendered == null) return null
  if (Array.isArray(rendered)) return h('g', {}, ...rendered)
  if (typeof rendered === 'string') return h('g', {}, rendered)
  return rendered
}

/** 只展开这一层标签。普通节点原样返回，好让量过的 layer 还是同一个对象。 */
export function materialize(node: FvgNode, stack: string[] = []): FvgNode {
  const name = node.tag.toLowerCase()
  const render = registry().get(name)
  if (!render || stack.includes(name) || stack.length > 8) return node
  const rendered = asNode(render({ ...node.attrs, children: node.children }))
  if (!rendered) return node
  if (node.loc && !rendered.loc) rendered.loc = node.loc
  return materialize(rendered, [...stack, name])
}
