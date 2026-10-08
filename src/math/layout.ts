import type { FvgNode } from '../parse.js'
import { parseBorder, parseEdges, parseNumber, parsePx, parseScale, parseStyle, ZERO_EDGES } from '../style.js'
import { layoutText } from '../text.js'
import type {
  Box,
  DrawComputedStyle,
  FlexLayoutNode,
  Issue,
  LayoutNode,
  LayoutNodeBase,
  LineLayoutNode,
  ShapeLayoutNode,
  TextLayoutNode,
  TextRunStyle,
} from '../types.js'
import { translateBox, unionBoxes } from '../types.js'
import {
  displayOperator,
  glyphShape,
  hasMathGlyph,
  italicCorrectionOf,
  MATH_FONT_FAMILY,
  mathConstant,
  mathFont,
  naturalHorizontalSize,
  naturalVerticalSize,
  stretchHorizontal,
  stretchVertical,
  type GlyphShape,
} from './font.js'
import {
  accentGlyph,
  atomSpacingMu,
  autoItalic,
  isBarChar,
  isMovableWord,
  isPrime,
  isOverAccent,
  isUnderAccent,
  MATH_BASELINE_BELOW_CENTER_EM,
  MATH_STRUT_ASCENT_EM,
  MATH_STRUT_DESCENT_EM,
  MATH_TAGS,
  mapMathVariant,
  MFRAC_RULE_OVERHANG_EM,
  MFRAC_SCRIPT_SCALE,
  MTABLE_COLUMN_GAP_EM,
  MTABLE_ROW_GAP_EM,
  MTABLE_STRUT_ASCENT_EM,
  MTABLE_STRUT_DESCENT_EM,
  normalizeOperator,
  operatorInfo,
  SCRIPT_MIN_RATIO,
  type Atom,
} from './rules.js'

export type MathLayoutHost = {
  color: string
  fontFamily: string
  pathPrefix: string
  issues: Issue[]
}

type Ctx = {
  size: number
  color: string
  /** 公式字母、数字和运算符用的字体。 */
  family: string
  /** `mtext` 用的字体，跟外面的文字一样。 */
  textFamily: string
  /** 字体是数学字体，斜体等字母换成 Unicode 数学字母。 */
  mathAlphabet: boolean
  display: boolean
  level: number
  cramped: boolean
  rootSize: number
  warnings: string[]
}

/** 排好的一块。`node` 的盒子高 ascent + descent，基线在盒子顶下 ascent 处。 */
type MBox = {
  node: LayoutNode
  width: number
  ascent: number
  descent: number
  italic: number
  atom: Atom
  /** 单个文字记号。上下标按 TeX 的规矩不看它的高度。 */
  token: boolean
  /** 基座是（或包着）一个运算符时，记下它的字和性质。 */
  op?: { text: string; largeop: boolean; movableLimits: boolean; integral: boolean }
  lspace?: number
  rspace?: number
}

function computedOf(ctx: Ctx, opacity = 1): DrawComputedStyle {
  return { color: ctx.color, fontFamily: ctx.family, fontSize: ctx.size, fontWeight: 400, opacity }
}

function base(path: string, tag: string, width: number, height: number, ctx: Ctx): LayoutNodeBase {
  return {
    path,
    tag,
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
    computed: computedOf(ctx),
    text: '',
  }
}

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

function lengthOf(raw: string | undefined, ctx: Ctx, fallback = 0): number {
  if (!raw) return fallback
  const t = raw.trim().split(/\s+/)[0]!
  const named: Record<string, number> = {
    veryverythinmathspace: 1,
    verythinmathspace: 2,
    thinmathspace: 3,
    mediummathspace: 4,
    thickmathspace: 5,
    verythickmathspace: 6,
    veryverythickmathspace: 7,
  }
  if (named[t] != null) return (named[t]! * ctx.size) / 18
  const m = t.match(/^(-?[\d.]+)(em|ex|px|mu)?$/)
  if (!m) return fallback
  const n = Number(m[1])
  if (!Number.isFinite(n)) return fallback
  if (m[2] === 'em') return n * ctx.size
  if (m[2] === 'ex') return n * ctx.size * 0.45
  if (m[2] === 'mu') return (n * ctx.size) / 18
  return n
}

function styled(node: FvgNode, ctx: Ctx): Ctx {
  const style = parseStyle(node.attrs.style)
  const size = parsePx(style['font-size'])
  const family = style['font-family']?.trim()
  const color = style.color ?? node.attrs.mathcolor
  if (size == null && !family && !color) return ctx
  return {
    ...ctx,
    size: size ?? ctx.size,
    color: color ?? ctx.color,
    family: family || ctx.family,
    mathAlphabet: family ? isMathFamily(family) : ctx.mathAlphabet,
  }
}

function isMathFamily(family: string): boolean {
  const name = family.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
  return ['stixtwomath', 'stix two math', 'stixmath', 'stix'].includes(name)
}

function clampSize(size: number, ctx: Ctx): number {
  return Math.max(size, ctx.rootSize * SCRIPT_MIN_RATIO)
}

function scriptCtx(ctx: Ctx, cramped = ctx.cramped): Ctx {
  const c = mathFont().constants
  const scale = ctx.level === 0 ? c.ScriptPercentScaleDown / 100 : ctx.level === 1 ? c.ScriptScriptPercentScaleDown / c.ScriptPercentScaleDown : 1
  return { ...ctx, size: clampSize(ctx.size * scale, ctx), level: ctx.level + 1, display: false, cramped }
}

function childPaths(parent: string, children: FvgNode[]): string[] {
  const counts = new Map<string, number>()
  return children.map((ch) => {
    const tag = ch.tag.toLowerCase()
    const i = counts.get(tag) ?? 0
    counts.set(tag, i + 1)
    return `${parent}/${tag}[${i}]`
  })
}

/** 把几块按基线摆进一个容器。`shift` 向上为正。x 可以是负的，整体会挪回来。 */
function compose(
  tag: string,
  path: string,
  ctx: Ctx,
  items: Array<{ box: MBox; x: number; shift: number }>,
  extra: { width?: number; ascent?: number; descent?: number } = {},
): { node: FlexLayoutNode; width: number; ascent: number; descent: number } {
  const minX = Math.min(0, ...items.map((i) => i.x))
  let ascent = extra.ascent ?? 0
  let descent = extra.descent ?? 0
  let width = extra.width ?? 0
  for (const item of items) {
    ascent = Math.max(ascent, item.box.ascent + item.shift)
    descent = Math.max(descent, item.box.descent - item.shift)
    width = Math.max(width, item.x - minX + item.box.width)
  }
  let ink: Box | null = null
  const children: LayoutNode[] = []
  for (const item of items) {
    const n = item.box.node
    n.x = item.x - minX
    n.y = ascent - item.shift - item.box.ascent
    children.push(n)
    if (n.ink.width > 0 || n.ink.height > 0) {
      const b = translateBox(n.ink, n.x, n.y)
      ink = ink ? unionBoxes(ink, b) : b
    }
  }
  const node: FlexLayoutNode = {
    ...base(path, tag, width, ascent + descent, ctx),
    kind: 'flex',
    direction: 'row',
    children,
    ink: ink ?? { x: 0, y: 0, width: 0, height: 0 },
  }
  return { node, width, ascent, descent }
}

function boxOf(
  composed: { node: FlexLayoutNode; width: number; ascent: number; descent: number },
  atom: Atom,
  more: Partial<MBox> = {},
): MBox {
  return { node: composed.node, width: composed.width, ascent: composed.ascent, descent: composed.descent, italic: 0, atom, token: false, ...more }
}

function textBox(text: string, tag: string, path: string, ctx: Ctx, run: Partial<TextRunStyle> = {}): MBox {
  const style: TextRunStyle = {
    fontFamily: ctx.family,
    fontSize: ctx.size,
    fontWeight: 400,
    color: ctx.color,
    letterSpacing: 0,
    ...run,
  }
  const textLayout = layoutText({
    segments: text ? [{ text, style }] : [],
    nowrap: true,
    lineHeightRatio: 0,
    fontSize: style.fontSize,
  })
  const ascent = textLayout.lines[0]?.baselineY ?? 0
  const height = textLayout.contentHeight
  const width = textLayout.contentWidth
  const node: TextLayoutNode = {
    ...base(path, tag, width, height, ctx),
    kind: 'text',
    ink: textLayout.ink,
    style: {
      'font-size': `${style.fontSize}px`,
      color: style.color,
      'font-family': style.fontFamily,
      'white-space': 'nowrap',
    },
    computed: { ...computedOf(ctx), fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight },
    text,
    textLayout,
    textAlign: 'left',
  }
  let italic = 0
  if (style.fontFamily === MATH_FONT_FAMILY) italic = italicCorrectionOf(text, style.fontSize)
  else if (style.fontStyle === 'italic') italic = Math.max(0, textLayout.ink.x + textLayout.ink.width - width)
  return { node, width, ascent, descent: height - ascent, italic, atom: 'ord', token: true }
}

function glyphBox(shape: GlyphShape, tag: string, path: string, ctx: Ctx): MBox {
  const height = shape.ascent + shape.descent
  const node: LineLayoutNode = {
    ...base(path, tag, shape.width, height, ctx),
    kind: 'line',
    ink: shape.ink,
    geometry: { kind: 'path', d: shape.d },
    stroke: 'none',
    strokeWidth: 0,
    fill: ctx.color,
  }
  return { node, width: shape.width, ascent: shape.ascent, descent: shape.descent, italic: shape.italic, atom: 'ord', token: true }
}

function ruleBox(width: number, thickness: number, path: string, ctx: Ctx, tag = 'rule'): MBox {
  const node: ShapeLayoutNode = {
    ...base(path, tag, width, thickness, ctx),
    kind: 'shape',
    shape: 'rect',
    fill: ctx.color,
    stroke: 'none',
    strokeWidth: 0,
  }
  return { node, width, ascent: thickness, descent: 0, italic: 0, atom: 'ord', token: false }
}

function emptyBox(tag: string, path: string, ctx: Ctx, width = 0, ascent = 0, descent = 0): MBox {
  const node: FlexLayoutNode = {
    ...base(path, tag, width, ascent + descent, ctx),
    kind: 'flex',
    direction: 'row',
    children: [],
    ink: { x: 0, y: 0, width: 0, height: 0 },
  }
  return { node, width, ascent, descent, italic: 0, atom: 'none', token: false }
}

/** 运算符本体：直接是 `mo`，或只包着一个 `mo` 的 `mrow`。 */
function coreOperator(node: FvgNode | undefined): FvgNode | null {
  if (!node) return null
  const tag = node.tag.toLowerCase()
  if (tag === 'mo') return node
  if (tag === 'mrow' || tag === 'mstyle') {
    const kids = elements(node)
    if (kids.length === 1) return coreOperator(kids[0])
  }
  return null
}

function coreText(node: FvgNode | undefined): string {
  if (!node) return ''
  const tag = node.tag.toLowerCase()
  if (tag === 'mo' || tag === 'mi' || tag === 'mn' || tag === 'mtext') return directText(node)
  if (tag === 'mrow' || tag === 'mstyle') {
    const kids = elements(node)
    if (kids.length === 1) return coreText(kids[0])
  }
  return ''
}

function layoutToken(node: FvgNode, tag: string, path: string, ctx0: Ctx, position: 'first' | 'last' | 'middle' | 'only'): MBox {
  const ctx = styled(node, ctx0)
  let text = directText(node)
  if (tag === 'mtext') {
    const own = parseStyle(node.attrs.style)['font-family']?.trim()
    return textBox(text, tag, path, { ...ctx, family: own || ctx.textFamily })
  }
  if (tag === 'mo') text = normalizeOperator(text)
  const variant = node.attrs.mathvariant?.trim().toLowerCase() ?? (tag === 'mi' && autoItalic(text) ? 'italic' : 'normal')
  let run: Partial<TextRunStyle> = {}
  if (variant !== 'normal') {
    const mapped = mapMathVariant(text, variant)
    if (ctx.mathAlphabet && mapped !== text && hasMathGlyph(mapped)) text = mapped
    else {
      if (variant.includes('italic')) run = { ...run, fontStyle: 'italic' }
      if (variant.includes('bold')) run = { ...run, fontWeight: 700 }
    }
  }
  if (tag === 'mi') {
    const box = textBox(text, tag, path, ctx, run)
    if (Array.from(text).length > 1) box.atom = 'op'
    if (isMovableWord(text)) box.op = { text, largeop: false, movableLimits: true, integral: false }
    return box
  }
  if (tag === 'mn') return textBox(text, tag, path, ctx, run)

  const info = operatorInfo(text, position)
  let box: MBox
  const display = ctx.display && info.largeop ? displayOperator(text, ctx.size) : null
  if (display) box = glyphBox(display, tag, path, ctx)
  else box = textBox(text, tag, path, ctx, run)
  if (info.largeop) box = centerOnAxis(box, ctx)
  box.atom = node.attrs.form === 'prefix' && info.atom === 'bin' ? 'ord' : info.atom
  box.op = { text, largeop: info.largeop, movableLimits: info.movableLimits, integral: info.integral }
  if (node.attrs.lspace != null) box.lspace = lengthOf(node.attrs.lspace, ctx)
  if (node.attrs.rspace != null) box.rspace = lengthOf(node.attrs.rspace, ctx)
  return box
}

/** 大运算符和伸长的括号竖直方向按数学轴居中。盒子紧贴着墨，挪基线只改上下两段的分配。 */
function centerOnAxis(box: MBox, ctx: Ctx): MBox {
  const axis = mathConstant('AxisHeight', ctx.size)
  const shift = axis - (box.ascent - box.descent) / 2
  return { ...box, ascent: box.ascent + shift, descent: box.descent - shift }
}

function stretchedFence(node: FvgNode, path: string, ctx0: Ctx, target: number, atom: Atom): MBox {
  const ctx = styled(node, ctx0)
  const text = normalizeOperator(directText(node))
  const natural = naturalVerticalSize(text, ctx.size)
  const shape = target > natural * 1.02 ? stretchVertical(text, target, ctx.size) : null
  let box = shape ? glyphBox(shape, 'mo', path, ctx) : textBox(text, 'mo', path, ctx)
  box = centerOnAxis(box, ctx)
  box.atom = atom
  box.token = false
  return box
}

function isStretchyFence(node: FvgNode): boolean {
  if (node.tag.toLowerCase() !== 'mo') return false
  if (node.attrs.stretchy === 'false') return false
  return operatorInfo(normalizeOperator(directText(node)), 'middle').stretchy
}

function layoutRow(nodes: FvgNode[], tag: string, path: string, ctx: Ctx): MBox {
  const paths = childPaths(path, nodes)
  const kids = nodes.filter((n) => n.tag.toLowerCase() !== 'annotation' && n.tag.toLowerCase() !== 'annotation-xml')
  const position = (i: number): 'first' | 'last' | 'middle' | 'only' =>
    kids.length === 1 ? 'only' : i === 0 ? 'first' : i === kids.length - 1 ? 'last' : 'middle'
  const slots: Array<MBox | null> = []
  const pending: number[] = []
  kids.forEach((child, i) => {
    const p = paths[nodes.indexOf(child)]!
    const childTag = child.tag.toLowerCase()
    if (!MATH_TAGS.has(childTag) || childTag === 'math') {
      ctx.warnings.push(`未知标签 ${child.tag}`)
      slots.push(null)
      return
    }
    if (isStretchyFence(child) && kids.length > 1) {
      slots.push(null)
      pending.push(i)
      return
    }
    slots.push(lowerNode(child, p, ctx, position(i)))
  })
  if (pending.length) {
    const axis = mathConstant('AxisHeight', ctx.size)
    const targetOf = (from: number, to: number) => {
      let up = 0
      let down = 0
      for (let k = from; k < to; k++) {
        const box = slots[k]
        if (!box) continue
        up = Math.max(up, box.ascent - axis)
        down = Math.max(down, box.descent + axis)
      }
      return 2 * Math.max(up, down)
    }
    const fencePath = (i: number) => paths[nodes.indexOf(kids[i]!)]!
    const place = (i: number, target: number, atom: Atom) => {
      slots[i] = stretchedFence(kids[i]!, fencePath(i), ctx, target, atom)
    }
    const stack: Array<{ i: number; text: string; ambiguous: boolean }> = []
    const loose: number[] = []
    for (const i of pending) {
      const text = normalizeOperator(directText(kids[i]!))
      const atom = operatorInfo(text, 'middle').atom
      const ambiguous = atom === 'ord'
      if (ambiguous) {
        const top = stack[stack.length - 1]
        if (top && top.ambiguous && top.text === text) {
          stack.pop()
          const target = targetOf(top.i + 1, i)
          place(top.i, target, 'open')
          place(i, target, 'close')
        } else stack.push({ i, text, ambiguous: true })
        continue
      }
      if (atom === 'open') {
        stack.push({ i, text, ambiguous: false })
        continue
      }
      let at = stack.length - 1
      while (at >= 0 && stack[at]!.ambiguous) at--
      if (at < 0) {
        const top = stack.pop()
        if (!top) {
          loose.push(i)
          continue
        }
        const target = targetOf(top.i + 1, i)
        place(top.i, target, 'open')
        place(i, target, 'close')
        continue
      }
      const open = stack[at]!
      const middles = stack.splice(at)
      const target = targetOf(open.i + 1, i)
      place(open.i, target, 'open')
      for (const m of middles.slice(1)) place(m.i, target, 'ord')
      place(i, target, 'close')
    }
    for (const left of [...stack.map((e) => e.i), ...loose]) {
      const text = normalizeOperator(directText(kids[left]!))
      place(left, targetOf(0, slots.length), operatorInfo(text, position(left)).atom)
    }
  }
  const boxes = slots.filter((s): s is MBox => s != null)
  if (boxes.length === 1 && tag !== 'math') {
    const only = boxes[0]!
    const wrapped = compose(tag, path, ctx, [{ box: only, x: 0, shift: 0 }])
    return boxOf(wrapped, only.atom, { italic: only.italic, op: only.op, lspace: only.lspace, rspace: only.rspace })
  }

  const atoms = boxes.map((b) => b.atom)
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i] !== 'bin') continue
    const prev = atoms.slice(0, i).reverse().find((a) => a !== 'none')
    if (!prev || prev === 'bin' || prev === 'op' || prev === 'rel' || prev === 'open' || prev === 'punct') atoms[i] = 'ord'
  }
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i] !== 'bin') continue
    const next = atoms.slice(i + 1).find((a) => a !== 'none')
    if (!next || next === 'rel' || next === 'close' || next === 'punct') atoms[i] = 'ord'
  }

  const mu = ctx.size / 18
  const script = ctx.level > 0
  const items: Array<{ box: MBox; x: number; shift: number }> = []
  let x = 0
  let sawIntegral = false
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!
    if (i > 0) {
      const a = boxes[i - 1]!
      let gap = atomSpacingMu(atoms[i - 1]!, atoms[i]!, script) * mu
      if (a.rspace != null || b.lspace != null) gap = (a.rspace ?? 0) + (b.lspace ?? 0)
      if (sawIntegral && isDifferential(boxes, i)) gap = Math.max(gap, 3 * mu)
      x += gap
    }
    if (b.op?.integral) sawIntegral = true
    items.push({ box: b, x, shift: 0 })
    x += b.width
  }
  const composed = compose(tag, path, ctx, items, { width: x })
  return boxOf(composed, 'ord')
}

/** 积分后面的 d x：在 d 前面补一个细空。 */
function isDifferential(boxes: MBox[], i: number): boolean {
  const b = boxes[i]!
  if (b.node.tag !== 'mi') return false
  const t = b.node.text
  if (t !== 'd' && t !== 'ⅆ' && t !== '𝑑') return false
  return boxes[i + 1]?.node.tag === 'mi'
}

function layoutFrac(node: FvgNode, path: string, ctx: Ctx): MBox {
  const kids = elements(node)
  const paths = childPaths(path, kids)
  const childSize = ctx.display ? ctx.size : clampSize(ctx.size * MFRAC_SCRIPT_SCALE, ctx)
  const numCtx: Ctx = { ...ctx, size: childSize, display: false }
  const denCtx: Ctx = { ...numCtx, cramped: true }
  const num = kids[0] ? lowerNode(kids[0], paths[0]!, numCtx, 'only') : emptyBox('mrow', `${path}/mrow[0]`, numCtx)
  const den = kids[1] ? lowerNode(kids[1], paths[1]!, denCtx, 'only') : emptyBox('mrow', `${path}/mrow[1]`, denCtx)
  const d = ctx.display
  const axis = mathConstant('AxisHeight', ctx.size)
  const raw = node.attrs.linethickness?.trim()
  const defaultT = mathConstant('FractionRuleThickness', ctx.size)
  let t = defaultT
  if (raw === 'thin') t = defaultT / 2
  else if (raw === 'medium') t = defaultT
  else if (raw === 'thick') t = defaultT * 2
  else if (raw != null && raw !== '') {
    const pct = raw.match(/^([\d.]+)%$/)
    t = pct ? (defaultT * Number(pct[1])) / 100 : /^[\d.]+$/.test(raw) ? defaultT * Number(raw) : lengthOf(raw, ctx, defaultT)
  }
  const overhang = ctx.size * MFRAC_RULE_OVERHANG_EM
  const width = Math.max(num.width, den.width) + overhang * 2
  let numShift: number
  let denShift: number
  if (t > 0) {
    numShift = mathConstant(d ? 'FractionNumeratorDisplayStyleShiftUp' : 'FractionNumeratorShiftUp', ctx.size)
    denShift = mathConstant(d ? 'FractionDenominatorDisplayStyleShiftDown' : 'FractionDenominatorShiftDown', ctx.size)
    const numGap = mathConstant(d ? 'FractionNumDisplayStyleGapMin' : 'FractionNumeratorGapMin', ctx.size)
    const denGap = mathConstant(d ? 'FractionDenomDisplayStyleGapMin' : 'FractionDenominatorGapMin', ctx.size)
    numShift = Math.max(numShift, numGap + axis + t / 2 + num.descent)
    denShift = Math.max(denShift, denGap + den.ascent - axis + t / 2)
  } else {
    numShift = mathConstant(d ? 'StackTopDisplayStyleShiftUp' : 'StackTopShiftUp', ctx.size)
    denShift = mathConstant(d ? 'StackBottomDisplayStyleShiftDown' : 'StackBottomShiftDown', ctx.size)
    const gapMin = mathConstant(d ? 'StackDisplayStyleGapMin' : 'StackGapMin', ctx.size)
    const gap = numShift - num.descent - (den.ascent - denShift)
    if (gap < gapMin) {
      numShift += (gapMin - gap) / 2
      denShift += (gapMin - gap) / 2
    }
  }
  const items: Array<{ box: MBox; x: number; shift: number }> = [{ box: num, x: (width - num.width) / 2, shift: numShift }]
  if (t > 0) items.push({ box: ruleBox(width, t, `${path}/rule[0]`, ctx), x: 0, shift: axis + t / 2 - t })
  items.push({ box: den, x: (width - den.width) / 2, shift: -denShift })
  return boxOf(compose('mfrac', path, ctx, items, { width }), 'inner')
}

function radical(baseBox: MBox, path: string, ctx: Ctx): { items: Array<{ box: MBox; x: number; shift: number }>; width: number; ascent: number; descent: number } {
  const gap = mathConstant(ctx.display ? 'RadicalDisplayStyleVerticalGap' : 'RadicalVerticalGap', ctx.size)
  const t = mathConstant('RadicalRuleThickness', ctx.size)
  const extra = mathConstant('RadicalExtraAscender', ctx.size)
  const target = baseBox.ascent + baseBox.descent + gap + t
  const shape = stretchVertical('√', target, ctx.size)
  const items: Array<{ box: MBox; x: number; shift: number }> = []
  const top = baseBox.ascent + gap + t
  let surdWidth = 0
  let descent = baseBox.descent
  if (shape) {
    const surd = glyphBox(shape, 'surd', `${path}/surd[0]`, ctx)
    const shift = top - shape.ascent
    items.push({ box: surd, x: 0, shift })
    surdWidth = shape.width
    descent = Math.max(descent, shape.descent - shift)
  }
  items.push({ box: ruleBox(baseBox.width, t, `${path}/rule[0]`, ctx), x: surdWidth, shift: top - t })
  items.push({ box: baseBox, x: surdWidth, shift: 0 })
  return { items, width: surdWidth + baseBox.width, ascent: top + extra, descent }
}

function layoutSqrt(node: FvgNode, path: string, ctx: Ctx): MBox {
  const inner = layoutRow(elements(node), 'mrow', `${path}/mrow[0]`, { ...ctx, cramped: true })
  const r = radical(inner, path, ctx)
  return boxOf(compose('msqrt', path, ctx, r.items, { width: r.width, ascent: r.ascent, descent: r.descent }), 'ord')
}

function layoutRoot(node: FvgNode, path: string, ctx: Ctx): MBox {
  const kids = elements(node)
  const paths = childPaths(path, kids)
  const baseBox = kids[0]
    ? layoutRow([kids[0]], 'mrow', `${path}/mrow[0]`, { ...ctx, cramped: true })
    : emptyBox('mrow', `${path}/mrow[0]`, ctx)
  const indexCtx = scriptCtx(scriptCtx(ctx))
  const index = kids[1] ? lowerNode(kids[1], paths[1]!, indexCtx, 'only') : emptyBox('mrow', `${path}/mrow[1]`, indexCtx)
  const r = radical(baseBox, path, ctx)
  const before = mathConstant('RadicalKernBeforeDegree', ctx.size)
  const after = mathConstant('RadicalKernAfterDegree', ctx.size)
  const raise = (mathFont().constants.RadicalDegreeBottomRaisePercent / 100) * (r.ascent + r.descent)
  const indexShift = raise - r.descent + index.descent
  const radicalX = Math.max(0, before + index.width + after)
  const items = [{ box: index, x: radicalX - after - index.width, shift: indexShift }, ...r.items.map((i) => ({ ...i, x: i.x + radicalX }))]
  return boxOf(compose('mroot', path, ctx, items, { width: radicalX + r.width, ascent: r.ascent, descent: r.descent }), 'ord')
}

/** `∑`、`lim` 这类算符的上下限：display 时放在上下方，行内放到右侧。 */
function hasMovableLimits(base: FvgNode | undefined): boolean {
  const op = coreOperator(base)
  const word = coreText(base)
  if (op?.attrs.movablelimits === 'false') return false
  if (!op && !isMovableWord(word)) return false
  const text = normalizeOperator(word)
  return operatorInfo(text, 'only').movableLimits || isMovableWord(text)
}

function layoutScripts(
  node: FvgNode,
  tag: 'msub' | 'msup' | 'msubsup',
  path: string,
  ctx: Ctx,
  outTag: string = tag,
): MBox {
  const kids = elements(node)
  const paths = childPaths(path, kids)
  if (outTag === tag && ctx.display && hasMovableLimits(kids[0])) {
    const under = tag === 'msup' ? undefined : kids[1]
    const over = tag === 'msub' ? undefined : tag === 'msup' ? kids[1] : kids[2]
    return limits(kids[0]!, under, over, paths, path, tag, ctx, false, false)
  }
  const b = kids[0] ? lowerNode(kids[0], paths[0]!, ctx, 'only') : emptyBox('mrow', `${path}/mrow[0]`, ctx)
  const subNode = tag === 'msup' ? undefined : kids[1]
  const supNode = tag === 'msub' ? undefined : tag === 'msup' ? kids[1] : kids[2]
  const subPath = tag === 'msup' ? undefined : paths[1]
  const supPath = tag === 'msub' ? undefined : tag === 'msup' ? paths[1] : paths[2]
  const sub = subNode ? lowerNode(subNode, subPath!, scriptCtx(ctx, true), 'only') : null
  const prime = supNode != null && coreOperator(supNode) != null && isPrime(normalizeOperator(coreText(supNode)))
  const sup = supNode ? lowerNode(supNode, supPath!, prime ? ctx : scriptCtx(ctx), 'only') : null
  const ignoreBase = b.token && !b.op?.largeop
  const baseAscent = ignoreBase ? 0 : b.ascent
  const baseDescent = ignoreBase ? 0 : b.descent
  let subShift = 0
  let supShift = 0
  if (sub) {
    subShift = Math.max(
      mathConstant('SubscriptShiftDown', ctx.size),
      baseDescent + mathConstant('SubscriptBaselineDropMin', ctx.size),
      sub.ascent - mathConstant('SubscriptTopMax', ctx.size),
    )
  }
  if (sup && !prime) {
    supShift = Math.max(
      mathConstant(ctx.cramped ? 'SuperscriptShiftUpCramped' : 'SuperscriptShiftUp', ctx.size),
      baseAscent - mathConstant('SuperscriptBaselineDropMax', ctx.size),
      mathConstant('SuperscriptBottomMin', ctx.size) + sup.descent,
    )
  }
  if (sub && sup && !prime) {
    const gapMin = mathConstant('SubSuperscriptGapMin', ctx.size)
    const gap = supShift - sup.descent - (sub.ascent - subShift)
    if (gap < gapMin) {
      subShift += gapMin - gap
      const bottomMax = mathConstant('SuperscriptBottomMaxWithSubscript', ctx.size)
      const delta = bottomMax - (supShift - sup.descent)
      if (delta > 0) {
        supShift += delta
        subShift -= delta
      }
      const again = supShift - sup.descent - (sub.ascent - subShift)
      if (again < gapMin) subShift += gapMin - again
    }
  }
  const large = Boolean(b.op?.largeop)
  const supX = large ? b.width : b.width + b.italic
  const subX = large ? b.width - b.italic : b.width
  const items: Array<{ box: MBox; x: number; shift: number }> = [{ box: b, x: 0, shift: 0 }]
  let width = b.width
  if (sup) {
    items.push({ box: sup, x: supX, shift: supShift })
    width = Math.max(width, supX + sup.width)
  }
  if (sub) {
    items.push({ box: sub, x: subX, shift: -subShift })
    width = Math.max(width, subX + sub.width)
  }
  width += mathConstant('SpaceAfterScript', ctx.size)
  return boxOf(compose(outTag, path, ctx, items, { width }), b.atom, { op: b.op })
}

function layoutUnderOver(node: FvgNode, tag: 'munder' | 'mover' | 'munderover', path: string, ctx: Ctx): MBox {
  const kids = elements(node)
  const paths = childPaths(path, kids)
  const under = tag === 'mover' ? undefined : kids[1]
  const over = tag === 'munder' ? undefined : tag === 'mover' ? kids[1] : kids[2]
  const accent = over ? (node.attrs.accent != null ? node.attrs.accent === 'true' : isOverAccent(coreText(over))) : false
  const accentUnder = under
    ? node.attrs.accentunder != null
      ? node.attrs.accentunder === 'true'
      : isUnderAccent(coreText(under))
    : false
  if (!ctx.display && !accent && !accentUnder && hasMovableLimits(kids[0])) {
    const as = tag === 'munder' ? 'msub' : tag === 'mover' ? 'msup' : 'msubsup'
    return layoutScripts(node, as, path, ctx, tag)
  }
  return limits(kids[0]!, under, over, paths, path, tag, ctx, accent, accentUnder)
}

/** 上下限和上下方的标记。`paths` 按 kids 顺序。 */
function limits(
  baseNode: FvgNode | undefined,
  underNode: FvgNode | undefined,
  overNode: FvgNode | undefined,
  paths: string[],
  path: string,
  tag: string,
  ctx: Ctx,
  accent: boolean,
  accentUnder: boolean,
): MBox {
  const b = baseNode ? lowerNode(baseNode, paths[0]!, ctx, 'only') : emptyBox('mrow', `${path}/mrow[0]`, ctx)
  const underPath = paths[1]
  const overPath = underNode ? paths[2] : paths[1]
  const limitOp = Boolean(b.op?.largeop || b.op?.movableLimits)
  const scriptStyle = scriptCtx(ctx)
  const lowerScript = (n: FvgNode, p: string, isAccent: boolean, cramped: boolean): MBox => {
    const sctx = isAccent ? { ...ctx, display: false } : { ...scriptStyle, cramped: cramped || scriptStyle.cramped }
    const text = normalizeOperator(coreText(n))
    if (coreOperator(n) && n.attrs.stretchy !== 'false') {
      if (isBarChar(text)) {
        const t = mathConstant(cramped ? 'UnderbarRuleThickness' : 'OverbarRuleThickness', ctx.size)
        return ruleBox(b.width, t, p, ctx, 'mo')
      }
      if (isAccent && !cramped) {
        const mark = accentGlyph(text)
        const wide = !(b.token && Array.from(b.node.text).length === 1)
        const shape = stretchHorizontal(mark, wide ? b.width : 0, sctx.size) ?? glyphShape(mark, sctx.size)
        if (shape) return glyphBox(shape, 'mo', p, sctx)
      }
      if (naturalHorizontalSize(text, sctx.size) < b.width) {
        const shape = stretchHorizontal(text, b.width, sctx.size)
        if (shape) return glyphBox(shape, 'mo', p, sctx)
      }
    }
    return lowerNode(n, p, sctx, 'only')
  }
  const over = overNode ? lowerScript(overNode, overPath!, accent, false) : null
  const under = underNode ? lowerScript(underNode, underPath!, accentUnder, true) : null
  const width = Math.max(b.width, over?.width ?? 0, under?.width ?? 0)
  const items: Array<{ box: MBox; x: number; shift: number }> = [{ box: b, x: (width - b.width) / 2, shift: 0 }]
  let ascentExtra = 0
  let descentExtra = 0
  if (over) {
    let shift: number
    const isBar = over.node.kind === 'shape'
    if (isBar) {
      shift = b.ascent + mathConstant('OverbarVerticalGap', ctx.size)
      ascentExtra = shift + over.ascent + mathConstant('OverbarExtraAscender', ctx.size)
    } else if (accent) {
      shift = Math.max(0, b.ascent - mathConstant('AccentBaseHeight', ctx.size))
      const clear = b.ascent + ctx.size * 0.04
      const bottom = shift + inkBottomAboveBaseline(over)
      if (bottom < clear) shift += clear - bottom
    } else if (limitOp) {
      shift = b.ascent + Math.max(mathConstant('UpperLimitBaselineRiseMin', ctx.size), mathConstant('UpperLimitGapMin', ctx.size) + over.descent)
    } else {
      shift = b.ascent + mathConstant('UpperLimitGapMin', ctx.size) + over.descent
    }
    const dx = accent && !isBar ? b.italic / 2 : limitOp ? b.italic / 2 : 0
    items.push({ box: over, x: centeredX(over, width, accent) + dx, shift })
  }
  if (under) {
    let shift: number
    const isBar = under.node.kind === 'shape'
    if (isBar) {
      shift = -(b.descent + mathConstant('UnderbarVerticalGap', ctx.size) + under.ascent)
      descentExtra = -shift + mathConstant('UnderbarExtraDescender', ctx.size)
    } else if (accentUnder) {
      shift = -(b.descent + under.ascent)
    } else if (limitOp) {
      shift = -(b.descent + Math.max(mathConstant('LowerLimitBaselineDropMin', ctx.size), mathConstant('LowerLimitGapMin', ctx.size) + under.ascent))
    } else {
      shift = -(b.descent + mathConstant('LowerLimitGapMin', ctx.size) + under.ascent)
    }
    const dx = limitOp ? -b.italic / 2 : 0
    items.push({ box: under, x: centeredX(under, width, accentUnder) + dx, shift })
  }
  const composed = compose(tag, path, ctx, items, { width, ascent: ascentExtra, descent: descentExtra })
  return boxOf(composed, b.atom, { op: b.op })
}

function inkBottomAboveBaseline(box: MBox): number {
  const ink = box.node.ink
  if (ink.height <= 0) return 0
  return box.ascent - (ink.y + ink.height)
}

/** 记号按着墨居中，组合附加符号的笔位宽是 0，按盒子居中会偏到左边。 */
function centeredX(box: MBox, width: number, byInk: boolean): number {
  const ink = box.node.ink
  if ((byInk || box.width < 1e-3) && ink.width > 0) return width / 2 - (ink.x + ink.width / 2)
  return (width - box.width) / 2
}

function alignList(raw: string | undefined): string[] {
  return (raw ?? '').trim().split(/\s+/).filter(Boolean)
}

function layoutTable(node: FvgNode, path: string, ctx0: Ctx): MBox {
  const ctx: Ctx = { ...ctx0, display: false }
  const rowsSrc = elements(node)
  const rowPaths = childPaths(path, rowsSrc)
  const rowGap = lengthOf(node.attrs.rowspacing, ctx, ctx.size * MTABLE_ROW_GAP_EM)
  const colGap = lengthOf(node.attrs.columnspacing, ctx, ctx.size * MTABLE_COLUMN_GAP_EM)
  const tableAlign = alignList(node.attrs.columnalign)
  type Cell = { box: MBox; align: string; node: FvgNode }
  const rows: Array<{ cells: Cell[]; path: string; tag: string; src: FvgNode }> = []
  rowsSrc.forEach((tr, r) => {
    const trTag = tr.tag.toLowerCase()
    const rowAlign = alignList(tr.attrs.columnalign)
    const cells: Cell[] = []
    if (trTag !== 'mtr') {
      cells.push({ box: lowerNode(tr, rowPaths[r]!, ctx, 'only'), align: 'center', node: tr })
      rows.push({ cells, path: `${path}/mtr[${r}]`, tag: 'mtr', src: tr })
      return
    }
    const tds = elements(tr)
    const tdPaths = childPaths(rowPaths[r]!, tds)
    tds.forEach((td, c) => {
      const align = td.attrs.columnalign ?? rowAlign[c] ?? rowAlign[rowAlign.length - 1] ?? tableAlign[c] ?? tableAlign[tableAlign.length - 1] ?? 'center'
      const box =
        td.tag.toLowerCase() === 'mtd'
          ? layoutRow(elements(td), 'mtd', tdPaths[c]!, styled(td, ctx))
          : lowerNode(td, tdPaths[c]!, ctx, 'only')
      cells.push({ box, align, node: td })
    })
    rows.push({ cells, path: rowPaths[r]!, tag: 'mtr', src: tr })
  })
  const columns = Math.max(0, ...rows.map((r) => r.cells.length))
  const colWidths = Array.from({ length: columns }, (_, c) => Math.max(0, ...rows.map((r) => r.cells[c]?.box.width ?? 0)))
  const colX: number[] = []
  let cx = 0
  for (let c = 0; c < columns; c++) {
    colX.push(cx)
    cx += colWidths[c]! + (c < columns - 1 ? colGap : 0)
  }
  const tableWidth = cx
  const strutA = ctx.size * MTABLE_STRUT_ASCENT_EM
  const strutD = ctx.size * MTABLE_STRUT_DESCENT_EM
  const rowBoxes: Array<{ box: MBox; ascent: number; descent: number }> = []
  for (const row of rows) {
    const items = row.cells.map((cell, c) => {
      const w = colWidths[c]!
      const offset = cell.align === 'left' ? 0 : cell.align === 'right' ? w - cell.box.width : (w - cell.box.width) / 2
      return { box: cell.box, x: colX[c]! + offset, shift: 0 }
    })
    const composed = compose(row.tag, row.path, ctx, items, { width: tableWidth, ascent: strutA, descent: strutD })
    rowBoxes.push({ box: boxOf(composed, 'ord'), ascent: composed.ascent, descent: composed.descent })
  }
  const total = rowBoxes.reduce((sum, r) => sum + r.ascent + r.descent, 0) + Math.max(0, rowBoxes.length - 1) * rowGap
  const axis = mathConstant('AxisHeight', ctx.size)
  let top = total / 2 + axis
  const items: Array<{ box: MBox; x: number; shift: number }> = []
  for (const r of rowBoxes) {
    items.push({ box: r.box, x: 0, shift: top - r.ascent })
    top -= r.ascent + r.descent + rowGap
  }
  return boxOf(compose('mtable', path, ctx, items, { width: tableWidth }), 'ord')
}

function lowerNode(node: FvgNode, path: string, ctx0: Ctx, position: 'first' | 'last' | 'middle' | 'only'): MBox {
  const tag = node.tag.toLowerCase()
  if (!MATH_TAGS.has(tag) || tag === 'math') {
    ctx0.warnings.push(`未知标签 ${node.tag}`)
    return emptyBox(tag, path, ctx0)
  }
  if (tag === 'mi' || tag === 'mn' || tag === 'mo' || tag === 'mtext') return layoutToken(node, tag, path, ctx0, position)
  const ctx = styled(node, ctx0)
  if (tag === 'mrow' || tag === 'mtd') return layoutRow(elements(node), tag, path, ctx)
  if (tag === 'mstyle') {
    const display = node.attrs.displaystyle
    const next: Ctx = display === 'true' ? { ...ctx, display: true } : display === 'false' ? { ...ctx, display: false } : ctx
    const level = parseNumber(node.attrs.scriptlevel)
    const leveled = level != null && level > next.level ? Array.from({ length: Math.min(2, level - next.level) }).reduce<Ctx>((c) => scriptCtx(c), next) : next
    return layoutRow(elements(node), tag, path, leveled)
  }
  if (tag === 'mphantom') {
    const box = layoutRow(elements(node), tag, path, ctx)
    box.node.opacity = 0
    return box
  }
  if (tag === 'semantics') {
    const first = elements(node).find((n) => !n.tag.toLowerCase().startsWith('annotation'))
    return first ? layoutRow([first], 'semantics', path, ctx) : emptyBox(tag, path, ctx)
  }
  if (tag === 'annotation' || tag === 'annotation-xml') return emptyBox(tag, path, ctx)
  if (tag === 'mspace') {
    return emptyBox(tag, path, ctx, lengthOf(node.attrs.width, ctx), lengthOf(node.attrs.height, ctx), lengthOf(node.attrs.depth, ctx))
  }
  if (tag === 'mfrac') return layoutFrac(node, path, ctx)
  if (tag === 'msqrt') return layoutSqrt(node, path, ctx)
  if (tag === 'mroot') return layoutRoot(node, path, ctx)
  if (tag === 'msub' || tag === 'msup' || tag === 'msubsup') return layoutScripts(node, tag, path, ctx)
  if (tag === 'munder' || tag === 'mover' || tag === 'munderover') return layoutUnderOver(node, tag, path, ctx)
  if (tag === 'mtable') return layoutTable(node, path, ctx)
  return layoutRow(elements(node), tag, path, ctx)
}

/**
 * `rowAlign` 是外面横排 flex 的交叉轴对齐。居中时上下补白，让基线落在盒子中心下方 0.35em，
 * 和居中放着的同字号文字基线对齐；顶端、底端对齐时只补到一行文字的高度。
 */
export function layoutMath(node: FvgNode, host: MathLayoutHost, rowAlign?: string): FlexLayoutNode {
  const style = parseStyle(node.attrs.style)
  const fontSize = parsePx(style['font-size']) ?? 40
  const color = style.color ?? node.attrs.mathcolor ?? host.color
  const own = style['font-family']?.trim()
  const family = own || MATH_FONT_FAMILY
  const display = node.attrs.display === 'block' || node.attrs.displaystyle === 'true'
  const ctx: Ctx = {
    size: fontSize,
    color,
    family,
    textFamily: host.fontFamily,
    mathAlphabet: own ? isMathFamily(own) : true,
    display,
    level: 0,
    cramped: false,
    rootSize: fontSize,
    warnings: [],
  }
  const row = layoutRow(elements(node), 'math', host.pathPrefix, ctx)
  for (const message of ctx.warnings) {
    host.issues.push({ level: 'warn', code: 'unknown-tag', path: host.pathPrefix, message })
  }

  let ascent = Math.max(row.ascent, fontSize * MATH_STRUT_ASCENT_EM)
  let descent = Math.max(row.descent, fontSize * MATH_STRUT_DESCENT_EM)
  if (rowAlign?.trim() === 'center') {
    const c = fontSize * MATH_BASELINE_BELOW_CENTER_EM
    if ((ascent - descent) / 2 > c) descent = ascent - 2 * c
    else ascent = descent + 2 * c
  }
  const laid = compose('math', host.pathPrefix, ctx, [{ box: row, x: 0, shift: 0 }], { width: row.width, ascent, descent }).node
  const inner = laid.children[0]!
  if (inner.kind === 'flex') {
    laid.children = inner.children.map((ch) => {
      ch.x += inner.x
      ch.y += inner.y
      return ch
    })
  }

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
  laid.computed = { color, fontFamily: family, fontSize, fontWeight: 400, opacity }
  laid.draw = node.draw
  laid.data = node.data
  laid.text = ''
  return laid
}
