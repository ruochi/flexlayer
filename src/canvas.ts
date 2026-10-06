import { registerComponent, type ComponentFn } from './components.js'
import { measureLayer, noteMeasuredSize, parseSafe, prepareAssetsSync, type MeasureEnv } from './layout.js'
import type { FvgNode } from './parse.js'
import { isDisplayFlex } from './rules.js'
import { parseNumber } from './style.js'
import { isTextBoxTag } from './text.js'
import type { Anchor, Issue } from './types.js'

const UNLIMITED = 1_000_000

const ANCHORS = new Set<Anchor>([
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
])

export type CreatedLayer = FvgNode & {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  issues: Issue[]
}

function parseAnchor(raw: string | undefined): Anchor {
  const value = (raw ?? 'top-left').trim().toLowerCase() as Anchor
  return ANCHORS.has(value) ? value : 'top-left'
}

/** (x, y) 是盒子上 anchor 那一点，返回盒子左上角。 */
function topLeft(x: number, y: number, w: number, h: number, anchor: Anchor): { x: number; y: number } {
  switch (anchor) {
    case 'top-left':
      return { x, y }
    case 'top':
      return { x: x - w / 2, y }
    case 'top-right':
      return { x: x - w, y }
    case 'left':
      return { x, y: y - h / 2 }
    case 'right':
      return { x: x - w, y: y - h / 2 }
    case 'bottom-left':
      return { x, y: y - h }
    case 'bottom':
      return { x: x - w / 2, y: y - h }
    case 'bottom-right':
      return { x: x - w, y: y - h }
    default:
      return { x: x - w / 2, y: y - h / 2 }
  }
}

function wraps(node: FvgNode): boolean {
  const flex = isDisplayFlex(node.attrs.style)
  if (isTextBoxTag(node.tag) && !flex) {
    return !/white-space\s*:\s*nowrap/.test(node.attrs.style ?? '')
  }
  return node.children.some((child) => typeof child !== 'string' && wraps(child))
}

function measure(node: FvgNode, maxContentWidth: number) {
  const env: MeasureEnv = {
    baseDir: process.cwd(),
    color: node.attrs.color ?? '#111111',
    fontFamily: node.attrs['font-family'] ?? 'ChillDuanSans',
    maxContentWidth,
  }
  return measureLayer(node, env)
}

function contentLimit(node: FvgNode, width: number | undefined, both: boolean): number {
  if (width == null) return UNLIMITED
  if (!both) return width
  const height = parseNumber(node.attrs.height) ?? width
  const safe = parseSafe(node.attrs.safe, width, height)
  return Math.max(0, width - safe.left - safe.right)
}

/**
 * 同步量一个已经写好的 `<layer>`。字体和图片在这一次调用里准备，并在进程里记住。
 * 只写了宽或只写了高、且里面没有会换行的文字时，另一边按比例放缩。
 */
export function create(node: FvgNode): CreatedLayer {
  if (!node || typeof node !== 'object' || node.tag !== 'layer') {
    throw new Error('canvas.create 只接受 <layer>')
  }
  prepareAssetsSync(node, process.cwd())
  const width = parseNumber(node.attrs.width)
  const height = parseNumber(node.attrs.height)
  const widthSet = node.attrs.width != null && node.attrs.width !== ''
  const heightSet = node.attrs.height != null && node.attrs.height !== ''
  const oneSide = widthSet !== heightSet
  if (oneSide && !wraps(node)) {
    const key = widthSet ? 'width' : 'height'
    const saved = node.attrs[key]!
    delete node.attrs.width
    delete node.attrs.height
    const natural = measure(node, UNLIMITED).laid
    node.attrs[key] = saved
    const naturalSide = key === 'width' ? natural.width : natural.height
    const target = parseNumber(saved)
    if (naturalSide > 0 && target != null) {
      const scale = target / naturalSide
      const other = key === 'width' ? 'height' : 'width'
      const otherSize = (key === 'width' ? natural.height : natural.width) * scale
      node.attrs[other] = String(otherSize)
      node.attrs.scale = String(scale)
      node.attrs.origin = 'top-left'
    }
  }
  const both = node.attrs.width != null && node.attrs.width !== '' && node.attrs.height != null && node.attrs.height !== ''
  const limit = contentLimit(node, parseNumber(node.attrs.width), both)
  const { laid, issues } = measure(node, limit)
  noteMeasuredSize(node, laid.width, laid.height)
  const anchor = parseAnchor(node.attrs.anchor)
  const origin = topLeft(parseNumber(node.attrs.x) ?? 0, parseNumber(node.attrs.y) ?? 0, laid.width, laid.height, anchor)
  return Object.assign(node, {
    left: origin.x,
    top: origin.y,
    right: origin.x + laid.width,
    bottom: origin.y + laid.height,
    width: laid.width,
    height: laid.height,
    issues,
  })
}

export const canvas = {
  create,
  component: registerComponent as (name: string, render: ComponentFn) => void,
}
