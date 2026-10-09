import { createRequire } from 'node:module'
import type { FvgChild, FvgNode } from './parse.js'
import { applyCanvasFont } from './fonts.js'
import { readIcon, type IconIssue } from './icons.js'
import { getMeasureCtx } from './measureCtx.js'
import { parseFontWeight, parseLetterSpacing, parsePx } from './style.js'
import { emptyBox, translateBox, unionBoxes, type Box, type InlineOwner, type TextLayoutResult, type TextRunStyle, type TextSegment } from './types.js'

const require = createRequire(import.meta.url)
const LineBreaker = require('linebreak') as new (text: string) => {
  nextBreak(): { position: number; required: boolean } | null
}

const INLINE_TAGS = new Set(['span', 'strong', 'b', 'em', 'i', 'u', 'br', 'icon'])
const TEXT_BOX_TAGS = new Set(['h1', 'h2', 'h3', 'p', 'div', 'span', 'strong', 'b', 'em', 'i', 'u'])

const LINE_HEAD_FORBIDDEN = new Set('，。、；：？！）」』》】…'.split(''))
const LINE_TAIL_FORBIDDEN = new Set('（「『《【'.split(''))

const measureCache = new Map<string, number>()

function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0)!
  return (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x3000 && c <= 0x303f) ||
    (c >= 0xff00 && c <= 0xffef)
  )
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch)
}

export type TextBoxDefaults = {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  letterSpacing: number
  lineHeightRatio: number
}

export function defaultFontSizeForTag(tag: string): number {
  switch (tag) {
    case 'h1':
      return 88
    case 'h2':
      return 64
    case 'h3':
      return 48
    default:
      return 40
  }
}

export function defaultFontWeightForTag(tag: string): number {
  return tag === 'h1' || tag === 'h2' || tag === 'h3' ? 700 : 400
}

function mergeStyle(base: TextRunStyle, styleMap: Record<string, string>): TextRunStyle {
  const next = { ...base }
  const fs = parsePx(styleMap['font-size'])
  if (fs != null) next.fontSize = fs
  const fw = parseFontWeight(styleMap['font-weight'])
  if (fw != null) next.fontWeight = fw
  if (styleMap['font-family']) next.fontFamily = styleMap['font-family'].trim()
  if (styleMap.color) next.color = styleMap.color.trim()
  const ls = parseLetterSpacing(styleMap['letter-spacing'], next.fontSize)
  if (ls != null) next.letterSpacing = ls
  return next
}

function parseStyleAttr(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const decl of raw.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const k = decl.slice(0, i).trim().toLowerCase()
    const v = decl.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

const COLLAPSIBLE_WS = /[ \t\n\r\f\v]+/g

function isCollapsibleSpaceChar(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

function hasVisibleText(text: string): boolean {
  for (const ch of text) {
    if (!isCollapsibleSpaceChar(ch)) return true
  }
  return false
}

/**
 * 换行和连续空格折成一个空格。标签交界处的空格留下。
 * 整段行首行尾，以及硬换行两侧的空格去掉。U+00A0 不折叠、不去掉。
 */
function normalizeInlineSegments(segs: TextSegment[]): TextSegment[] {
  const next = segs.map((seg) => ({ ...seg, text: seg.text.replace(COLLAPSIBLE_WS, ' ') }))
  for (let i = 0; i < next.length; i++) {
    const seg = next[i]!
    if (!seg.hardBreakBefore) continue
    seg.text = seg.text.replace(/^[ \t\n\r\f\v]+/, '')
    const prev = next[i - 1]
    if (prev) prev.text = prev.text.replace(/[ \t\n\r\f\v]+$/, '')
  }
  if (next.length > 0) {
    next[0]!.text = next[0]!.text.replace(/^[ \t\n\r\f\v]+/, '')
    const last = next[next.length - 1]!
    last.text = last.text.replace(/[ \t\n\r\f\v]+$/, '')
  }
  return next.filter((seg) => seg.text.length > 0)
}

function walkInline(
  nodes: FvgChild[],
  style: TextRunStyle,
  out: TextSegment[],
  hardBreakNext: boolean,
  parentPath: string,
  inherited: InlineOwner | undefined,
  imageSize?: (node: FvgNode, path: string) => TextSegment['atom'],
  onIcon?: (issues: IconIssue[], path: string) => void,
): void {
  let breakNext = hardBreakNext
  let elementIndex = 0
  for (const child of nodes) {
    if (typeof child === 'string') {
      if (child) out.push({ text: child, style, hardBreakBefore: breakNext, owner: inherited })
      breakNext = false
      continue
    }
    const tag = child.tag.toLowerCase()
    const path = `${parentPath}/${tag}[${elementIndex}]`
    elementIndex += 1
    if (tag === 'br') {
      breakNext = true
      continue
    }
    if (tag === 'img' || tag === 'image') {
      const atom = imageSize?.(child, path)
      if (atom) {
        out.push({ text: '\uFFFC', style, hardBreakBefore: breakNext, owner: inherited, atom })
      }
      breakNext = false
      continue
    }
    if (tag === 'icon') {
      const icon = readIcon(child, style)
      if (icon.issues.length > 0) onIcon?.(icon.issues, path)
      if (icon.text) out.push({ text: icon.text, style: icon.style, hardBreakBefore: breakNext, owner: inherited })
      breakNext = false
      continue
    }
    if (!INLINE_TAGS.has(tag)) continue
    let segStyle = style
    if (tag === 'strong' || tag === 'b') segStyle = { ...style, fontWeight: 700 }
    if (tag === 'em' || tag === 'i') segStyle = { ...segStyle, fontStyle: 'italic' }
    if (tag === 'u') segStyle = { ...segStyle, underline: true }
    segStyle = mergeStyle(segStyle, parseStyleAttr(child.attrs.style))
    const id = child.attrs.id?.trim()
    const owner = id ? { id, path, tag } : inherited
    walkInline(child.children, segStyle, out, breakNext, path, owner, imageSize, onIcon)
    breakNext = false
  }
}

export function extractTextSegments(
  node: FvgNode,
  defaults: TextBoxDefaults,
  parentPath = '',
  imageSize?: (node: FvgNode, path: string) => TextSegment['atom'],
  onIcon?: (issues: IconIssue[], path: string) => void,
): TextSegment[] {
  const base: TextRunStyle = {
    fontFamily: defaults.fontFamily,
    fontSize: defaults.fontSize,
    fontWeight: defaults.fontWeight,
    color: defaults.color,
    letterSpacing: defaults.letterSpacing,
  }
  const tag = node.tag.toLowerCase()
  let style = mergeStyle(base, parseStyleAttr(node.attrs.style))
  if (tag === 'strong' || tag === 'b') style = { ...style, fontWeight: 700 }
  if (tag === 'em' || tag === 'i') style = { ...style, fontStyle: 'italic' }
  if (tag === 'u') style = { ...style, underline: true }
  const segs: TextSegment[] = []
  walkInline(node.children, style, segs, false, parentPath, undefined, imageSize, onIcon)
  return normalizeInlineSegments(segs)
}

type Unit = {
  text: string
  style: TextRunStyle
  width: number
  glueLeft: boolean
  glueRight: boolean
  isSpace: boolean
  owner?: InlineOwner
  atom?: NonNullable<TextSegment['atom']>
  /** 这一单元可以放到新行的行首。避头尾和换行机会都写在这里。 */
  canBreakBefore: boolean
}

function sameOwner(a: InlineOwner | undefined, b: InlineOwner | undefined): boolean {
  return a?.path === b?.path
}

function measureTextWidth(text: string, style: TextRunStyle): number {
  if (!text) return 0
  const key = `${style.fontFamily}|${style.fontWeight}|${style.fontStyle ?? ''}|${style.fontSize}|${style.letterSpacing}|${text}`
  const cached = measureCache.get(key)
  if (cached != null) return cached
  const ctx = getMeasureCtx()
  applyCanvasFont(ctx, style.fontFamily, style.fontWeight, style.fontSize, style.fontStyle)
  ctx.letterSpacing = `${style.letterSpacing}px`
  const m = ctx.measureText(text)
  const w = m.width
  measureCache.set(key, w)
  return w
}

/**
 * 按码位拆开一段文字的笔位。前缀宽度和排版用同一次测量，字偶距和字距都在里面。
 * 最后一笔补上差额，加起来等于这一段的排版宽度。
 */
export function splitAdvances(text: string, style: TextRunStyle, total: number): Array<{ text: string; width: number }> {
  const chars = Array.from(text)
  if (chars.length === 0) return []
  if (chars.length === 1) return [{ text: chars[0]!, width: total }]
  const widths: number[] = []
  let prev = 0
  for (let i = 0; i < chars.length - 1; i++) {
    const w = measureTextWidth(chars.slice(0, i + 1).join(''), style)
    widths.push(w - prev)
    prev = w
  }
  widths.push(total - prev)
  return chars.map((ch, i) => ({ text: ch, width: widths[i]! }))
}

type InkMetrics = {
  width: number
  /** 对齐点到墨迹左边的距离。墨迹在起点右侧时为负。 */
  left: number
  right: number
  ascent: number
  descent: number
}

function measureInk(text: string, style: TextRunStyle): InkMetrics {
  const ctx = getMeasureCtx()
  applyCanvasFont(ctx, style.fontFamily, style.fontWeight, style.fontSize, style.fontStyle)
  ctx.letterSpacing = `${style.letterSpacing}px`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const m = ctx.measureText(text)
  return {
    width: m.width,
    left: m.actualBoundingBoxLeft ?? 0,
    right: m.actualBoundingBoxRight ?? m.width,
    ascent: m.actualBoundingBoxAscent ?? style.fontSize * 0.85,
    descent: m.actualBoundingBoxDescent ?? style.fontSize * 0.15,
  }
}

/** 字形着墨。起点 (x, baselineY) 是 fillText 的绘制位置。 */
function glyphInk(x: number, baselineY: number, m: InkMetrics): Box {
  return {
    x: x - m.left,
    y: baselineY - m.ascent,
    width: m.left + m.right,
    height: m.ascent + m.descent,
  }
}

function addInk(union: Box | null, box: Box): Box | null {
  if (box.width <= 1e-3 || box.height <= 1e-3) return union
  return union ? unionBoxes(union, box) : box
}

export function alignLineOffset(align: string, innerWidth: number, lineWidth: number): number {
  if (align === 'center') return (innerWidth - lineWidth) / 2
  if (align === 'right') return innerWidth - lineWidth
  return 0
}

/** 各行着墨按 text-align 平移后的并集，再加上内容区相对盒子的偏移。 */
export function alignedTextInk(
  lines: TextLayoutResult['lines'],
  align: string,
  innerWidth: number,
  offsetX: number,
  offsetY: number,
): Box {
  let ink: Box | null = null
  for (const line of lines) {
    const dx = alignLineOffset(align, innerWidth, line.width) + offsetX
    ink = addInk(ink, translateBox(line.ink, dx, offsetY))
  }
  return ink ?? emptyBox()
}

function segmentsToUnits(segments: TextSegment[]): Unit[] {
  const units: Unit[] = []
  for (const seg of segments) {
    if (seg.hardBreakBefore && units.length > 0) {
      units.push({
        text: '\u0000',
        style: seg.style,
        width: 0,
        glueLeft: false,
        glueRight: false,
        isSpace: false,
        canBreakBefore: false,
      })
    } else if (seg.hardBreakBefore && units.length === 0) {
      // 段首硬换行忽略
    }
    if (seg.atom) {
      units.push({
        text: '\uFFFC',
        style: seg.style,
        width: seg.atom.width,
        glueLeft: false,
        glueRight: false,
        isSpace: false,
        owner: seg.owner,
        atom: seg.atom,
        canBreakBefore: false,
      })
      continue
    }
    const push = (text: string, width: number, glueLeft: boolean, glueRight: boolean, isSpace: boolean) => {
      units.push({ text, style: seg.style, width, glueLeft, glueRight, isSpace, owner: seg.owner, canBreakBefore: false })
    }
    let i = 0
    const s = seg.text
    while (i < s.length) {
      const ch = String.fromCodePoint(s.codePointAt(i)!)
      if (isCollapsibleSpaceChar(ch)) {
        push(' ', measureTextWidth(' ', seg.style), true, true, true)
        i += ch.length
        continue
      }
      if (isCjk(ch)) {
        push(ch, measureTextWidth(ch, seg.style), false, false, false)
        i += ch.length
        continue
      }
      if (isWordChar(ch)) {
        let j = i + 1
        while (j < s.length && isWordChar(s[j]!)) j++
        const word = s.slice(i, j)
        push(word, measureTextWidth(word, seg.style), false, false, false)
        i = j
        continue
      }
      push(ch, measureTextWidth(ch, seg.style), false, false, false)
      i += ch.length
    }
  }
  return units.filter((u) => u.text !== '\u0000' || u.width === 0)
}

function bindLineBreakUnits(units: Unit[]): Unit[][] {
  const groups: Unit[][] = []
  let cur: Unit[] = []
  for (const u of units) {
    if (u.text === '\u0000') {
      if (cur.length) groups.push(cur)
      cur = []
      continue
    }
    cur.push(u)
  }
  if (cur.length) groups.push(cur)
  return groups
}

/** 去掉行首行尾的空格，行内连续空格只留一个。标点和图片不并进相邻单元，断行时已经避开行首行尾。 */
function glueUnits(lineUnits: Unit[]): Unit[] {
  let start = 0
  let end = lineUnits.length
  while (start < end && lineUnits[start]!.isSpace) start++
  while (end > start && lineUnits[end - 1]!.isSpace) end--
  const out: Unit[] = []
  for (let i = start; i < end; i++) {
    const u = lineUnits[i]!
    if (u.isSpace) {
      if (!out[out.length - 1]?.isSpace) out.push(u)
      continue
    }
    let text = u.text
    let style = u.style
    if (!u.atom && i + 1 < end) {
      const next = lineUnits[i + 1]!
      if (!next.atom && LINE_TAIL_FORBIDDEN.has(u.text.slice(-1)!) && !next.isSpace && sameOwner(u.owner, next.owner)) {
        text += next.text
        i++
      }
    }
    if (!u.atom && out.length > 0) {
      const prev = out[out.length - 1]!
      if (!prev.atom && LINE_HEAD_FORBIDDEN.has(text[0]!) && !prev.isSpace && sameOwner(prev.owner, u.owner)) {
        out[out.length - 1] = {
          ...prev,
          text: prev.text + text,
          width: measureTextWidth(prev.text + text, prev.style),
        }
        continue
      }
    }
    const width = u.atom ? u.width : measureTextWidth(text, style)
    out.push({ ...u, text, width })
  }
  return out
}

/**
 * 单元边界上的断行机会。
 * `linebreak` 给出 Unicode 换行点；规范里的避头尾即使库允许，也不放到行首或行尾。
 */
function markOpportunities(units: Unit[]): void {
  let text = ''
  const starts: number[] = []
  for (const unit of units) {
    if (unit.text === '\u0000') {
      starts.push(-1)
      continue
    }
    starts.push(text.length)
    text += unit.text
  }
  const opportunity = new Set<number>()
  if (text.length > 0) {
    const breaker = new LineBreaker(text)
    let point = breaker.nextBreak()
    while (point) {
      opportunity.add(point.position)
      point = breaker.nextBreak()
    }
  }
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!
    const start = starts[i]!
    if (start <= 0) {
      unit.canBreakBefore = false
      continue
    }
    const prev = units[i - 1]!
    const head = unit.text[0] ?? ''
    const tail = prev.text.slice(-1)
    const sticks =
      (LINE_HEAD_FORBIDDEN.has(head) && !prev.isSpace && sameOwner(prev.owner, unit.owner)) ||
      (LINE_TAIL_FORBIDDEN.has(tail) && !unit.isSpace && !prev.isSpace && sameOwner(prev.owner, unit.owner))
    unit.canBreakBefore = !sticks && (opportunity.has(start) || prev.isSpace || Boolean(unit.atom) || Boolean(prev.atom))
  }
}

function lineWidth(units: Unit[]): number {
  let w = 0
  for (let i = 0; i < units.length; i++) {
    w += units[i]!.width
    if (i > 0 && !units[i - 1]!.isSpace && !units[i]!.isSpace) {
      // letter spacing between non-space handled in measureText for whole tokens
    }
  }
  return w
}

function wrapParagraph(units: Unit[], maxWidth: number): Unit[][] {
  markOpportunities(units)
  const lines: Unit[][] = []
  let line: Unit[] = []
  let curW = 0

  const flush = () => {
    if (line.length) {
      lines.push(glueUnits(line))
      line = []
      curW = 0
    }
  }

  const pushUnit = (u: Unit) => {
    line.push(u)
    curW += u.width
  }

  for (const u of units) {
    if (u.text === '\u0000') {
      flush()
      continue
    }
    if (u.isSpace && line.length === 0) continue
    const w = u.width
    if (line.length > 0 && curW + w > maxWidth + 1e-3) {
      if (u.isSpace || u.canBreakBefore) {
        flush()
        if (u.isSpace) continue
      } else {
        let split = line.length - 1
        while (split > 0 && !line[split]!.canBreakBefore) split--
        if (split > 0 && line[split]!.canBreakBefore) {
          const carry = line.splice(split)
          flush()
          for (const carried of carry) pushUnit(carried)
        }
      }
    }
    if (!u.isSpace && w > maxWidth + 1e-3 && line.length === 0) {
      lines.push([u])
      continue
    }
    if (u.isSpace && line.length === 0) continue
    pushUnit(u)
  }
  flush()
  return lines.length ? lines : [[]]
}

function balanceWrap(units: Unit[], maxWidth: number): Unit[][] {
  const greedy = wrapParagraph(units, maxWidth)
  const n = greedy.length
  if (n <= 1) return greedy
  let lo = 0
  let hi = maxWidth
  let best = maxWidth
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2
    const lines = wrapParagraph(units, mid)
    if (lines.length <= n) {
      best = mid
      hi = mid
    } else {
      lo = mid
    }
  }
  return wrapParagraph(units, best)
}

export type LayoutTextOptions = {
  segments: TextSegment[]
  maxWidth?: number
  maxHeight?: number
  fixedWidth?: number
  fixedHeight?: number
  nowrap?: boolean
  textWrap?: 'balance' | 'wrap'
  lineHeightRatio: number
  /** 绝对行高。写了就不再乘字号。 */
  lineHeightPx?: number
  fontSize: number
  writingMode?: 'horizontal-tb' | 'vertical-rl'
}

function emptyTextLayout(fontSize: number): TextLayoutResult {
  return {
    lines: [],
    contentWidth: 0,
    contentHeight: 0,
    minWidth: 0,
    ink: { x: 0, y: 0, width: 0, height: 0 },
    fontSize,
    autoWrap: false,
    overflowFixed: false,
  }
}

/** 竖排：字从上到下，列从右到左。字距加在字与字之间。 */
function layoutVertical(opts: LayoutTextOptions): TextLayoutResult {
  type Glyph = {
    text: string
    drawStyle: TextRunStyle
    letterSpacing: number
    width: number
    left: number
    right: number
    ascent: number
    descent: number
    breakBefore: boolean
    owner?: InlineOwner
  }
  const glyphs: Glyph[] = []
  for (const segment of opts.segments) {
    const chars = Array.from(segment.text)
    chars.forEach((ch, index) => {
      const drawStyle = { ...segment.style, letterSpacing: 0 }
      const measured = measureInk(ch, drawStyle)
      glyphs.push({
        text: ch,
        drawStyle,
        letterSpacing: segment.style.letterSpacing,
        width: measured.width,
        left: measured.left,
        right: measured.right,
        ascent: measured.ascent,
        descent: measured.descent,
        breakBefore: index === 0 && Boolean(segment.hardBreakBefore),
        owner: segment.owner,
      })
    })
  }
  if (glyphs.length === 0) return emptyTextLayout(opts.fontSize)

  const lineH = opts.lineHeightPx ?? opts.lineHeightRatio * opts.fontSize
  const columnGap = opts.fontSize
  const limit = opts.fixedHeight ?? opts.maxHeight ?? Number.POSITIVE_INFINITY
  const columns: Glyph[][] = []
  let column: Glyph[] = []
  let columnHeight = 0
  const flush = () => {
    if (column.length === 0) return
    columns.push(column)
    column = []
    columnHeight = 0
  }
  for (const glyph of glyphs) {
    if (glyph.breakBefore) flush()
    const gap = column.length === 0 ? 0 : glyph.letterSpacing
    const nextHeight = columnHeight + gap + lineH
    if (column.length > 0 && nextHeight > limit + 1e-3) flush()
    column.push(glyph)
    columnHeight += (column.length === 1 ? 0 : glyph.letterSpacing) + lineH
  }
  flush()

  const columnWidth = Math.max(1, ...glyphs.map((glyph) => glyph.width))
  const contentWidth = columns.length * columnWidth + Math.max(0, columns.length - 1) * columnGap
  let contentHeight = 0
  const laidLines: TextLayoutResult['lines'] = []
  let ink: Box | null = null
  columns.forEach((glyphsInColumn, index) => {
    const x0 = contentWidth - columnWidth - index * (columnWidth + columnGap)
    let y = 0
    glyphsInColumn.forEach((glyph, glyphIndex) => {
      if (glyphIndex > 0) y += glyph.letterSpacing
      const baselineY = y + glyph.ascent + (lineH - (glyph.ascent + glyph.descent)) / 2
      const glyphX = x0 + (columnWidth - glyph.width) / 2
      const lineInk = /\s/.test(glyph.text)
        ? { x: glyphX, y: baselineY, width: 0, height: 0 }
        : glyphInk(glyphX, baselineY, glyph)
      ink = addInk(ink, lineInk)
      laidLines.push({
        segments: [{ text: glyph.text, style: glyph.drawStyle, x: glyphX, width: glyph.width, owner: glyph.owner }],
        width: contentWidth,
        height: lineH,
        baselineY,
        ink: lineInk,
      })
      y += lineH
    })
    contentHeight = Math.max(contentHeight, y)
  })

  let overflowFixed = false
  if (opts.fixedWidth != null && contentWidth > opts.fixedWidth + 1e-3) overflowFixed = true
  if (opts.fixedHeight != null && contentHeight > opts.fixedHeight + 1e-3) overflowFixed = true
  return {
    lines: laidLines,
    contentWidth,
    contentHeight,
    minWidth: columnWidth,
    ink: ink ?? emptyBox(),
    fontSize: opts.fontSize,
    autoWrap: opts.fixedHeight == null && opts.maxHeight != null && columns.length > 1,
    overflowFixed,
  }
}

export function layoutText(opts: LayoutTextOptions): TextLayoutResult {
  if (!opts.segments.some((segment) => hasVisibleText(segment.text))) return emptyTextLayout(opts.fontSize)
  if (opts.writingMode === 'vertical-rl') return layoutVertical(opts)
  const unitsRaw = segmentsToUnits(opts.segments)
  const paragraphGroups = bindLineBreakUnits(unitsRaw)
  const allLines: Unit[][] = []

  let minUnit = 0
  for (const u of unitsRaw) {
    if (!u.isSpace && u.text !== '\u0000') minUnit = Math.max(minUnit, u.width)
  }

  const effectiveMax =
    opts.fixedWidth ??
    opts.maxWidth ??
    (opts.nowrap ? Infinity : paragraphGroups.reduce((m, g) => m + lineWidth(g), 0))

  let autoWrap = false
  for (const group of paragraphGroups) {
    const natural = lineWidth(glueUnits(group))
    if (!opts.fixedWidth && !opts.nowrap && opts.maxWidth != null && natural > opts.maxWidth + 1e-3) {
      autoWrap = true
    }
    if (opts.nowrap || effectiveMax === Infinity) {
      allLines.push(glueUnits(group))
    } else if (opts.textWrap === 'wrap') {
      allLines.push(...wrapParagraph(group, effectiveMax))
    } else {
      allLines.push(...balanceWrap(group, effectiveMax))
    }
  }

  if (allLines.length === 0) allLines.push([])

  let contentWidth = 0
  let contentHeight = 0
  const laidLines: TextLayoutResult['lines'] = []
  let ink: Box | null = null
  let y = 0

  for (const lineUnits of allLines) {
    let lineW = 0
    let maxAsc = 0
    let maxDesc = 0
    const segOut: TextLayoutResult['lines'][0]['segments'] = []
    const measured: Array<{ unit: Unit; metrics: InkMetrics; x: number }> = []
    let x = 0
    for (const u of lineUnits) {
      const inkM = u.atom
        ? { width: u.width, left: 0, right: u.width, ascent: 0, descent: 0 }
        : measureInk(u.text, u.style)
      if (!u.atom) {
        maxAsc = Math.max(maxAsc, inkM.ascent)
        maxDesc = Math.max(maxDesc, inkM.descent)
      }
      measured.push({ unit: u, metrics: inkM, x })
      segOut.push({ text: u.text, style: u.style, x, width: u.width, owner: u.owner })
      x += u.width
      lineW = x
    }
    const lh = opts.lineHeightPx ?? opts.lineHeightRatio * opts.fontSize
    let atomAbove = 0
    for (const item of measured) {
      if (item.unit.atom) atomAbove = Math.max(atomAbove, item.unit.atom.height)
    }
    const above = Math.max(maxAsc, atomAbove)
    const below = maxDesc
    const textH = allLines.length === 1 ? Math.max(lh, above + below) : lh
    const lineH = Math.max(textH, above + below)
    const baselineY = y + above + (lineH - (above + below)) / 2
    let lineInk: Box | null = null
    const atoms: NonNullable<TextLayoutResult['lines'][0]['atoms']> = []
    for (const item of measured) {
      if (item.unit.atom) {
        const top = baselineY - item.unit.atom.height
        atoms.push({ x: item.x, y: top, width: item.unit.atom.width, height: item.unit.atom.height, key: item.unit.atom.key })
        lineInk = addInk(lineInk, { x: item.x, y: top, width: item.unit.atom.width, height: item.unit.atom.height })
        continue
      }
      if (item.unit.isSpace || item.unit.text === '\uFFFC') continue
      lineInk = addInk(lineInk, glyphInk(item.x, baselineY, item.metrics))
    }
    const resolvedInk = lineInk ?? { x: 0, y: baselineY, width: 0, height: 0 }
    ink = addInk(ink, resolvedInk)
    laidLines.push({
      segments: segOut.filter((seg) => seg.text !== '\uFFFC'),
      width: lineW,
      height: lineH,
      baselineY,
      ink: resolvedInk,
      ...(atoms.length ? { atoms } : {}),
    })
    contentWidth = Math.max(contentWidth, lineW)
    y += lineH
  }
  contentHeight = y

  let overflowFixed = false
  if (opts.fixedWidth != null && contentWidth > opts.fixedWidth + 1e-3) overflowFixed = true
  if (opts.fixedHeight != null && contentHeight > opts.fixedHeight + 1e-3) overflowFixed = true

  return {
    lines: laidLines,
    contentWidth,
    contentHeight,
    minWidth: minUnit,
    ink: ink ?? emptyBox(),
    fontSize: opts.fontSize,
    autoWrap,
    overflowFixed,
  }
}

export function isInlineTag(tag: string): boolean {
  return INLINE_TAGS.has(tag.toLowerCase())
}

export function isTextBoxTag(tag: string): boolean {
  return TEXT_BOX_TAGS.has(tag.toLowerCase())
}
