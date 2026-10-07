import type { FvgNode } from '../parse.js'
import { parsePx, parseStyle } from '../style.js'
import {
  INTEGRAL_SIZE_RATIO,
  MATH_TAGS,
  MFRAC_GAP_EM,
  MFRAC_SCRIPT_SCALE,
  MTABLE_CELL_GAP_EM,
  MTABLE_ROW_GAP_EM,
  SUP_SUB_SIZE_RATIO,
  isIntegralOp,
  isMovableLimitsOp,
  mathRuleThicknessPx,
  moSpacingEm,
} from './rules.js'

export type MathAlign = 'start' | 'center' | 'end'

export type MathStyle = {
  fontSize: number
  color: string
  fontFamily: string
}

export type MathNode =
  | ({
      type: 'row'
      align: MathAlign
      gap: number
      children: MathNode[]
      tag: string
    } & MathStyle)
  | ({
      type: 'column'
      align: MathAlign
      gap: number
      children: MathNode[]
      tag: string
    } & MathStyle)
  | ({
      type: 'text'
      text: string
      padLeft: number
      padRight: number
      tag: string
    } & MathStyle)
  | ({
      type: 'rule'
      thickness: number
      stretch: true
      tag: string
    } & MathStyle)
  | ({
      type: 'sqrt'
      child: MathNode
      tag: string
    } & MathStyle)

export type MapCtx = MathStyle

const TOKEN_TAGS = new Set(['mi', 'mn', 'mo', 'mtext'])

function elements(node: FvgNode): FvgNode[] {
  return node.children.filter((c): c is FvgNode => typeof c !== 'string')
}

function directText(node: FvgNode): string {
  return node.children
    .filter((c): c is string => typeof c === 'string')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function baseText(node: FvgNode | undefined): string {
  if (!node) return ''
  const tag = node.tag.toLowerCase()
  if (TOKEN_TAGS.has(tag)) return directText(node)
  if (tag === 'mrow') {
    const kids = elements(node)
    if (kids.length === 1) return baseText(kids[0])
  }
  return ''
}

function styleOf(node: FvgNode, ctx: MapCtx): MathStyle {
  const style = parseStyle(node.attrs.style)
  return {
    fontSize: parsePx(style['font-size']) ?? ctx.fontSize,
    color: style.color ?? ctx.color,
    fontFamily: style['font-family']?.trim() || ctx.fontFamily,
  }
}

function row(tag: string, align: MathAlign, gap: number, children: MathNode[], ctx: MapCtx): Extract<MathNode, { type: 'row' }> {
  return { type: 'row', align, gap, children, tag, ...ctx }
}

function column(tag: string, align: MathAlign, gap: number, children: MathNode[], ctx: MapCtx): MathNode {
  return { type: 'column', align, gap, children, tag, ...ctx }
}

function mapSequence(nodes: FvgNode[], ctx: MapCtx, warnings: string[], tag: string): MathNode {
  const children: MathNode[] = []
  for (const n of nodes) {
    const mapped = mapChild(n, ctx, warnings)
    if (mapped) children.push(mapped)
  }
  if (children.length === 1) return children[0]!
  return row(tag, 'center', 0, children, ctx)
}

function mapToken(node: FvgNode, ctx: MapCtx): MathNode {
  const tag = node.tag.toLowerCase()
  const look = styleOf(node, ctx)
  const text = directText(node)
  let padLeft = 0
  let padRight = 0
  if (tag === 'mo') {
    const sp = moSpacingEm(text)
    padLeft = sp.left * look.fontSize
    padRight = sp.right * look.fontSize
  }
  return { type: 'text', text, padLeft, padRight, tag, ...look }
}

function mapScripts(node: FvgNode, ctx: MapCtx, warnings: string[], kind: 'msub' | 'msup' | 'msubsup'): MathNode {
  const kids = elements(node)
  const base = kids[0]
  const sub = kind === 'msup' ? undefined : kids[1]
  const sup = kind === 'msub' ? undefined : kind === 'msup' ? kids[1] : kids[2]
  const scriptCtx: MapCtx = { ...ctx, fontSize: ctx.fontSize * SUP_SUB_SIZE_RATIO }
  const op = baseText(base)

  if (base && isIntegralOp(op)) {
    const baseNode = mapChild(base, { ...ctx, fontSize: ctx.fontSize * INTEGRAL_SIZE_RATIO }, warnings)
    const scripts: MathNode[] = []
    if (sup) {
      const s = mapChild(sup, scriptCtx, warnings)
      if (s) scripts.push(s)
    }
    if (sub) {
      const s = mapChild(sub, scriptCtx, warnings)
      if (s) scripts.push(s)
    }
    const children: MathNode[] = []
    if (baseNode) children.push(baseNode)
    if (scripts.length) children.push(column('mscripts', 'center', 0, scripts, scriptCtx))
    return row(kind, 'center', 0, children, ctx)
  }

  if (base && isMovableLimitsOp(op)) {
    const children: MathNode[] = []
    if (sup) {
      const s = mapChild(sup, scriptCtx, warnings)
      if (s) children.push(s)
    }
    const baseNode = mapChild(base, ctx, warnings)
    if (baseNode) children.push(baseNode)
    if (sub) {
      const s = mapChild(sub, scriptCtx, warnings)
      if (s) children.push(s)
    }
    return column(kind, 'center', 0, children, ctx)
  }

  const baseNode = base ? mapChild(base, ctx, warnings) : null
  if (kind === 'msubsup' && sub && sup) {
    const supNode = mapChild(sup, scriptCtx, warnings)
    const subNode = mapChild(sub, scriptCtx, warnings)
    const stacked: MathNode[] = []
    if (supNode) stacked.push(supNode)
    if (subNode) stacked.push(subNode)
    const children: MathNode[] = []
    if (baseNode) children.push(baseNode)
    if (stacked.length) children.push(column('mscripts', 'start', 0, stacked, scriptCtx))
    return row(kind, 'center', 0, children, ctx)
  }
  if (kind === 'msup' && sup) {
    const supNode = mapChild(sup, scriptCtx, warnings)
    const children: MathNode[] = []
    if (baseNode) children.push(baseNode)
    if (supNode) children.push(supNode)
    return row(kind, 'start', 0, children, ctx)
  }
  if (kind === 'msub' && sub) {
    const subNode = mapChild(sub, scriptCtx, warnings)
    const children: MathNode[] = []
    if (baseNode) children.push(baseNode)
    if (subNode) children.push(subNode)
    return row(kind, 'end', 0, children, ctx)
  }
  return row(kind, 'center', 0, baseNode ? [baseNode] : [], ctx)
}

function mapUnderOver(node: FvgNode, ctx: MapCtx, warnings: string[], kind: 'munder' | 'mover' | 'munderover'): MathNode {
  const kids = elements(node)
  const base = kids[0]
  const under = kind === 'mover' ? undefined : kids[1]
  const over = kind === 'munder' ? undefined : kind === 'mover' ? kids[1] : kids[2]
  const children: MathNode[] = []
  if (over) {
    const n = mapChild(over, ctx, warnings)
    if (n) children.push(n)
  }
  if (base) {
    const n = mapChild(base, ctx, warnings)
    if (n) children.push(n)
  }
  if (under) {
    const n = mapChild(under, ctx, warnings)
    if (n) children.push(n)
  }
  return column(kind, 'center', 0, children, ctx)
}

function mapChild(node: FvgNode, ctx: MapCtx, warnings: string[]): MathNode | null {
  const tag = node.tag.toLowerCase()
  if (!MATH_TAGS.has(tag) || tag === 'math') {
    warnings.push(`未知标签 ${node.tag}`)
    return null
  }
  if (TOKEN_TAGS.has(tag)) return mapToken(node, ctx)
  if (tag === 'mrow') return row(tag, 'center', 0, mapChildren(elements(node), ctx, warnings), ctx)
  if (tag === 'mfrac') {
    const kids = elements(node)
    const script: MapCtx = { ...ctx, fontSize: ctx.fontSize * MFRAC_SCRIPT_SCALE }
    const children: MathNode[] = []
    const num = kids[0] ? mapChild(kids[0], script, warnings) : null
    const den = kids[1] ? mapChild(kids[1], script, warnings) : null
    if (num) children.push(num)
    children.push({
      type: 'rule',
      thickness: mathRuleThicknessPx(ctx.fontSize),
      stretch: true,
      tag: 'rule',
      ...ctx,
    })
    if (den) children.push(den)
    return column(tag, 'center', ctx.fontSize * MFRAC_GAP_EM, children, ctx)
  }
  if (tag === 'msub' || tag === 'msup' || tag === 'msubsup') return mapScripts(node, ctx, warnings, tag)
  if (tag === 'munder' || tag === 'mover' || tag === 'munderover') return mapUnderOver(node, ctx, warnings, tag)
  if (tag === 'msqrt') {
    return { type: 'sqrt', child: mapSequence(elements(node), ctx, warnings, 'mrow'), tag, ...ctx }
  }
  if (tag === 'mroot') {
    const kids = elements(node)
    const script: MapCtx = { ...ctx, fontSize: ctx.fontSize * SUP_SUB_SIZE_RATIO }
    const children: MathNode[] = []
    if (kids[1]) {
      const index = mapChild(kids[1], script, warnings)
      if (index) children.push(index)
    }
    children.push({
      type: 'sqrt',
      child: kids[0] ? mapSequence([kids[0]], ctx, warnings, 'mrow') : row('mrow', 'center', 0, [], ctx),
      tag: 'msqrt',
      ...ctx,
    })
    return row(tag, 'start', 0, children, ctx)
  }
  if (tag === 'mtable') {
    const rowGap = ctx.fontSize * MTABLE_ROW_GAP_EM
    const cellGap = ctx.fontSize * MTABLE_CELL_GAP_EM
    const rows: MathNode[] = []
    for (const tr of elements(node)) {
      const trTag = tr.tag.toLowerCase()
      if (trTag !== 'mtr') {
        const mapped = mapChild(tr, ctx, warnings)
        if (mapped) rows.push(mapped)
        continue
      }
      const cells: MathNode[] = []
      for (const td of elements(tr)) {
        if (td.tag.toLowerCase() !== 'mtd') {
          const mapped = mapChild(td, ctx, warnings)
          if (mapped) cells.push(mapped)
          continue
        }
        cells.push(mapSequence(elements(td), ctx, warnings, 'mtd'))
      }
      rows.push(row('mtr', 'center', cellGap, cells, ctx))
    }
    return column(tag, 'center', rowGap, rows, ctx)
  }
  if (tag === 'mtr') return row(tag, 'center', ctx.fontSize * MTABLE_CELL_GAP_EM, mapChildren(elements(node), ctx, warnings), ctx)
  if (tag === 'mtd') return mapSequence(elements(node), ctx, warnings, 'mtd')
  warnings.push(`未知标签 ${node.tag}`)
  return null
}

function mapChildren(nodes: FvgNode[], ctx: MapCtx, warnings: string[]): MathNode[] {
  const out: MathNode[] = []
  for (const n of nodes) {
    const mapped = mapChild(n, ctx, warnings)
    if (mapped) out.push(mapped)
  }
  return out
}

export function mapMath(node: FvgNode, ctx: MapCtx): { tree: Extract<MathNode, { type: 'row' }>; warnings: string[] } {
  const warnings: string[] = []
  const look = styleOf(node, ctx)
  const children = mapChildren(elements(node), look, warnings)
  return { tree: row('math', 'center', 0, children, look), warnings }
}
