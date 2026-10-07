import type { FvgNode } from '../parse.js'
import { parseBorder, parseEdges, parseNumber, parsePx, parseScale, parseStyle, ZERO_EDGES } from '../style.js'
import { layoutText } from '../text.js'
import type {
  DrawComputedStyle,
  FlexLayoutNode,
  Issue,
  LayoutNode,
  ShapeLayoutNode,
  SqrtLayoutNode,
  TextLayoutNode,
} from '../types.js'
import { translateBox, unionBoxes } from '../types.js'
import { mapMath, type MathAlign, type MathNode, type MathStyle } from './map.js'
import { MSQRT_GAP_EM, mathRuleThicknessPx, surdWidthPx } from './rules.js'

export type MathLayoutHost = {
  color: string
  fontFamily: string
  pathPrefix: string
  issues: Issue[]
}

function computedOf(style: MathStyle, opacity = 1): DrawComputedStyle {
  return {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: 400,
    opacity,
  }
}

function childPath(parent: string, children: MathNode[]): string[] {
  const counts = new Map<string, number>()
  return children.map((ch) => {
    const i = counts.get(ch.tag) ?? 0
    counts.set(ch.tag, i + 1)
    return `${parent}/${ch.tag}[${i}]`
  })
}

function crossPos(align: MathAlign, cross: number, size: number): number {
  if (align === 'end') return cross - size
  if (align === 'center') return (cross - size) / 2
  return 0
}

function pack(
  direction: 'row' | 'column',
  align: MathAlign,
  gap: number,
  children: LayoutNode[],
  tag: string,
  path: string,
  style: MathStyle,
): FlexLayoutNode {
  const cross = children.reduce((m, ch) => Math.max(m, direction === 'row' ? ch.height : ch.width), 0)
  let cursor = 0
  for (let i = 0; i < children.length; i++) {
    const ch = children[i]!
    const mainSize = direction === 'row' ? ch.width : ch.height
    const crossSize = direction === 'row' ? ch.height : ch.width
    const at = crossPos(align, cross, crossSize)
    if (direction === 'row') {
      ch.x = cursor
      ch.y = at
    } else {
      ch.x = at
      ch.y = cursor
    }
    cursor += mainSize
    if (i < children.length - 1) cursor += gap
  }
  const main = cursor
  let ink = { x: 0, y: 0, width: 0, height: 0 }
  for (let i = 0; i < children.length; i++) {
    const ch = children[i]!
    const box = translateBox(ch.ink, ch.x, ch.y)
    ink = i === 0 ? box : unionBoxes(ink, box)
  }
  return {
    kind: 'flex',
    direction,
    children,
    path,
    tag,
    id: undefined,
    x: 0,
    y: 0,
    width: direction === 'row' ? main : cross,
    height: direction === 'row' ? cross : main,
    ink: children.length ? ink : { x: 0, y: 0, width: 0, height: 0 },
    opacity: 1,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    padding: ZERO_EDGES,
    attr: {},
    style: {},
    computed: computedOf(style),
    text: '',
  }
}

function lowerText(node: Extract<MathNode, { type: 'text' }>, path: string): TextLayoutNode {
  const run = {
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: 400,
    color: node.color,
    letterSpacing: 0,
  }
  const textLayout = layoutText({
    segments: node.text ? [{ text: node.text, style: run }] : [],
    nowrap: true,
    lineHeightRatio: 1.2,
    fontSize: node.fontSize,
  })
  const padding = { top: 0, right: node.padRight, bottom: 0, left: node.padLeft }
  return {
    kind: 'text',
    path,
    tag: node.tag,
    id: undefined,
    x: 0,
    y: 0,
    width: textLayout.contentWidth + padding.left + padding.right,
    height: textLayout.contentHeight,
    ink: translateBox(textLayout.ink, padding.left, 0),
    opacity: 1,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    padding,
    attr: {},
    style: {
      'font-size': `${node.fontSize}px`,
      color: node.color,
      'font-family': node.fontFamily,
      'white-space': 'nowrap',
    },
    computed: computedOf(node),
    text: node.text,
    textLayout,
    textAlign: 'left',
  }
}

function lowerRule(node: Extract<MathNode, { type: 'rule' }>, path: string, width: number): ShapeLayoutNode {
  const height = node.thickness
  return {
    kind: 'shape',
    path,
    tag: node.tag,
    id: undefined,
    x: 0,
    y: 0,
    width,
    height,
    ink: { x: 0, y: 0, width, height },
    opacity: 1,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    padding: ZERO_EDGES,
    attr: {},
    style: {},
    computed: computedOf(node),
    text: '',
    shape: 'rect',
    fill: node.color,
    stroke: 'none',
    strokeWidth: 0,
  }
}

function lowerSqrt(node: Extract<MathNode, { type: 'sqrt' }>, path: string): SqrtLayoutNode {
  const child = lowerNode(node.child, `${path}/${node.child.tag}[0]`)
  const thickness = mathRuleThicknessPx(node.fontSize)
  const gap = node.fontSize * MSQRT_GAP_EM
  const surdWidth = surdWidthPx(node.fontSize, child.height)
  child.x = surdWidth
  child.y = thickness + gap
  const width = surdWidth + child.width
  const height = thickness + gap + child.height
  const ink = unionBoxes(
    { x: 0, y: 0, width: surdWidth, height },
    translateBox(child.ink, child.x, child.y),
  )
  return {
    kind: 'sqrt',
    path,
    tag: node.tag,
    id: undefined,
    x: 0,
    y: 0,
    width,
    height,
    ink: unionBoxes(ink, { x: 0, y: 0, width, height: thickness }),
    opacity: 1,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    padding: ZERO_EDGES,
    attr: {},
    style: {},
    computed: computedOf(node),
    text: '',
    surdWidth,
    color: node.color,
    thickness,
    child,
  }
}

function lowerFixed(node: MathNode, path: string): LayoutNode | null {
  if (node.type === 'rule') return null
  return lowerNode(node, path)
}

function lowerFlow(node: Extract<MathNode, { type: 'row' | 'column' }>, path: string): FlexLayoutNode {
  const paths = childPath(path, node.children)
  const prepared: Array<{ stretch: Extract<MathNode, { type: 'rule' }>; path: string } | { node: LayoutNode }> = []
  for (let i = 0; i < node.children.length; i++) {
    const ch = node.children[i]!
    const p = paths[i]!
    if (ch.type === 'rule') prepared.push({ stretch: ch, path: p })
    else {
      const laid = lowerFixed(ch, p)
      if (laid) prepared.push({ node: laid })
    }
  }
  const fixed = prepared.flatMap((item) => ('node' in item ? [item.node] : []))
  const stretchW = fixed.reduce((m, n) => Math.max(m, node.type === 'column' ? n.width : n.height), 0)
  const children = prepared.map((item) =>
    'node' in item ? item.node : lowerRule(item.stretch, item.path, node.type === 'column' ? stretchW : item.stretch.thickness),
  )
  return pack(node.type, node.align, node.gap, children, node.tag, path, node)
}

function lowerNode(node: MathNode, path: string): LayoutNode {
  if (node.type === 'text') return lowerText(node, path)
  if (node.type === 'sqrt') return lowerSqrt(node, path)
  if (node.type === 'rule') return lowerRule(node, path, 0)
  return lowerFlow(node, path)
}

export function layoutMath(node: FvgNode, host: MathLayoutHost): FlexLayoutNode {
  const style = parseStyle(node.attrs.style)
  const fontSize = parsePx(style['font-size']) ?? 40
  const color = style.color ?? host.color
  const fontFamily = style['font-family']?.trim() || host.fontFamily
  const { tree, warnings } = mapMath(node, { fontSize, color, fontFamily })
  for (const message of warnings) {
    host.issues.push({ level: 'warn', code: 'unknown-tag', path: host.pathPrefix, message })
  }
  const laid = lowerFlow(tree, host.pathPrefix)
  const opacity = parseNumber(node.attrs.opacity) ?? parseNumber(style.opacity) ?? 1
  const padding = parseEdges(style.padding) ?? ZERO_EDGES
  const border = parseBorder(style.border)
  const bw = border?.width ?? 0
  const ox = padding.left + bw
  const oy = padding.top + bw
  // 子元素坐标相对内容区。flex 的绘制和报告会再加上 padding，这里只把着墨挪进盒子。
  if (ox || oy) laid.ink = translateBox(laid.ink, ox, oy)
  laid.width += padding.left + padding.right + bw * 2
  laid.height += padding.top + padding.bottom + bw * 2
  laid.id = node.attrs.id
  laid.opacity = opacity
  laid.rotate = parseNumber(node.attrs.rotate) ?? parseNumber(style.rotate) ?? 0
  const scale = parseScale(node.attrs.scale ?? style.scale)
  laid.scaleX = scale.x
  laid.scaleY = scale.y
  laid.padding = padding
  laid.border = border
  laid.background = style.background ?? style['background-color']
  laid.borderRadius = parsePx(style['border-radius']) ?? 0
  laid.attr = { ...node.attrs }
  laid.style = style
  laid.computed = { color, fontFamily, fontSize, fontWeight: 400, opacity }
  laid.draw = node.draw
  laid.data = node.data
  laid.text = ''
  return laid
}
