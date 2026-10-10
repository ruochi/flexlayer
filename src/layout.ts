import {
  Align,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  Wrap,
  type Node as YogaNode,
} from 'yoga-layout/load'
import { attachDrawTags } from './draw-tag.js'
import { collectFilters, mergeFilters, type FilterIssue } from './filter.js'
import { imageInk, peekLayerImage, preloadLayerImagesSync, parseObjectFit, parseObjectPosition } from './image.js'
import type { FvgNode } from './parse.js'
import { parseFvg } from './parse.js'
import { ensureBuiltinFontsSync, primaryFontFamily, registerFontsFromDocumentSync } from './fonts.js'
import { classAttr, ICON_FONT_FAMILY, symbolsClassOf } from './icons.js'
import { materialize } from './components.js'
import { catmullRomPath } from './curve.js'
import { isGradient, parseGradient, solidPaint } from './gradient.js'
import { glbSpan, resolveModelFile } from './glb.js'
import { readBoxFillet, readCylinderFillet } from './mesh-round.js'
import { openSvgPath, translateSvgPath } from './path.js'
import { perspectiveIssues } from './perspective.js'
import {
  parseBlend,
  parseBlurRadius,
  parseBorder,
  parseEdges,
  parseFontWeight,
  parseGlass,
  parseGlow,
  parseInkStroke,
  parseNoise,
  parseLineHeight,
  parseLetterSpacing,
  parseNumber,
  parseOverlay,
  parsePx,
  parseOrigin,
  parseScale,
  parseShadow,
  parseStyle,
  readAnchor,
  ZERO_EDGES,
  type Edges,
  type LineHeight,
} from './style.js'
import {
  alignLineOffset,
  alignedTextInk,
  defaultFontSizeForTag,
  defaultFontWeightForTag,
  extractTextSegments,
  isTextBoxTag,
  layoutText,
} from './text.js'
import { applyToBox, aroundPivot, IDENTITY, intersectBox, multiply, originOffset, translated } from './matrix.js'
import { layoutMath } from './math/layout.js'
import { asBlockFlow, checkChildAttrs, checkTextBoxChildren, hasTwoPoint, hiddenAttrIssues, isDisplayFlex, isHtmlTag, legacyCenterIssues, originValueIssues, rowColumnHint, styleIssues, typoAttrIssues } from './rules.js'
import { fitViewAspect, parseView, viewExceeds } from './view.js'
import { canonicalTag, FONT_TAG, isImageTag, isLineTag, isMaskContentTag, isMeshTag, isShapeTag } from './tags.js'
import { boundsOf, parseSvgTransform } from './svg-transform.js'
import type {
  Anchor,
  AppliedFilter,
  Box,
  CustomLayoutNode,
  DrawComputedStyle,
  FlexLayoutNode,
  FvgDocument,
  GroupLayoutNode,
  ImageLayoutNode,
  Issue,
  LayerLayoutNode,
  LayoutNode,
  BlendMode,
  ColorFilterSpec,
  GlassSpec,
  GlowSpec,
  InkStrokeSpec,
  GradeSpec,
  LineGeometry,
  LineLayoutNode,
  MeshLayoutNode,
  NoiseSpec,
  OverlaySpec,
  ShadowSpec,
  ShapeLayoutNode,
  TextLayoutNode,
} from './types.js'
import { emptyBox, unionBoxes } from './types.js'
import { formatSourceLoc } from './source-loc.js'
import { getYoga } from './yoga.js'

export type LayoutContext = {
  color: string
  fontFamily: string
  /** 祖先写过才有。没有时文字用标签默认字号。 */
  fontSize?: number
  fontWeight?: number
  letterSpacing?: number
  textAlign?: 'left' | 'center' | 'right'
  /** 祖先写过的行高。像素行高按像素继承，倍数按倍数继承。 */
  lineHeight?: LineHeight
  maxContentWidth: number
  issues: Issue[]
  pathPrefix: string
  symbols: Map<string, FvgNode>
  useStack: string[]
  /** 解析 img 的相对路径。 */
  baseDir: string
  /** path → `file:line:column`，给报告里的 source。 */
  sources: Map<string, string>
  /** 设了之后，省略的 fill 用这个值，省略的 stroke 为 none。mask 里用 #ffffff。 */
  fillDefault?: string
  /** `<g>` 上传下来的 fill / stroke。子元素自己写了的优先。 */
  paintFill?: string
  paintStroke?: string
}

function isClosedFlag(raw: string | undefined): boolean {
  if (raw == null) return false
  const text = raw.trim().toLowerCase()
  return text !== 'false' && text !== '0' && text !== 'no'
}

function anchorOf(raw: string | undefined, ctx: LayoutContext, tag: string): Anchor {
  const read = readAnchor(raw, 'top-left')
  if (read.invalid && !isShapeTag(tag)) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `无法解析 anchor: ${raw}`,
      hint: '九宫格：top-left（默认）、top、bottom、left、right、center、top-right、bottom-left、bottom-right',
    })
  }
  return read.anchor
}

function anchorTopLeft(cx: number, cy: number, w: number, h: number, anchor: Anchor): { x: number; y: number } {
  switch (anchor) {
    case 'top-left':
      return { x: cx, y: cy }
    case 'top':
      return { x: cx - w / 2, y: cy }
    case 'top-right':
      return { x: cx - w, y: cy }
    case 'left':
      return { x: cx, y: cy - h / 2 }
    case 'right':
      return { x: cx - w, y: cy - h / 2 }
    case 'bottom-left':
      return { x: cx, y: cy - h }
    case 'bottom':
      return { x: cx - w / 2, y: cy - h }
    case 'bottom-right':
      return { x: cx - w, y: cy - h }
    default:
      return { x: cx - w / 2, y: cy - h / 2 }
  }
}

export function parseSafe(raw: string | undefined, w: number, h: number): Edges {
  const def = Math.round(Math.min(w, h) * 0.04)
  if (!raw?.trim()) return { top: def, right: def, bottom: def, left: def }
  const parts = raw.trim().split(/\s+/).map((p) => parsePx(p) ?? def)
  if (parts.length === 1) return { top: parts[0]!, right: parts[0]!, bottom: parts[0]!, left: parts[0]! }
  if (parts.length === 2) return { top: parts[0]!, right: parts[1]!, bottom: parts[0]!, left: parts[1]! }
  if (parts.length === 3) return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[1]! }
  return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[3]! }
}

function nodePath(prefix: string, tag: string, index: number): string {
  return `${prefix}/${tag}[${index}]`
}

function track(ctx: LayoutContext, path: string, node: FvgNode) {
  if (!node.loc || ctx.sources.has(path)) return
  ctx.sources.set(path, formatSourceLoc(node.loc))
}

const DEFAULT_SHADOW_COLOR = '#00000066'

type EffectFields = {
  shadow?: ShadowSpec
  glow?: GlowSpec
  innerShadow?: ShadowSpec
  innerGlow?: GlowSpec
  inkStroke?: InkStrokeSpec[]
  blur?: number
  backdropBlur?: number
  noise?: NoiseSpec
  glass?: GlassSpec
  colorFilter?: ColorFilterSpec[]
  blend?: BlendMode
  filters?: AppliedFilter[]
}

type EffectSource = Record<string, string | undefined>

function warnInvalid(ctx: LayoutContext, label: string, raw: string, hint: string) {
  ctx.issues.push({
    level: 'warn',
    code: 'invalid-attr',
    path: ctx.pathPrefix,
    message: `无法解析 ${label}: ${raw}`,
    hint,
  })
}

function pushFilterIssues(ctx: LayoutContext, issues: FilterIssue[]) {
  for (const issue of issues) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: issue.message,
      hint: issue.hint,
    })
  }
}

function readEffects(src: EffectSource, ctx: LayoutContext, glowColor: string): EffectFields {
  const out: EffectFields = {}
  const shadowRaw = src.shadow
  const parsedShadow = parseShadow(shadowRaw)
  if (parsedShadow) out.shadow = { ...parsedShadow, color: parsedShadow.color ?? DEFAULT_SHADOW_COLOR }
  else if (shadowRaw && shadowRaw.trim() !== 'none') {
    warnInvalid(ctx, 'shadow', shadowRaw, '写成 0 8 16 #00000055，顺序是 x y blur spread color')
  }

  const glowRaw = src.glow
  const parsedGlow = parseGlow(glowRaw)
  if (parsedGlow) out.glow = { ...parsedGlow, color: parsedGlow.color ?? glowColor }
  else if (glowRaw && glowRaw.trim() !== 'none') {
    warnInvalid(ctx, 'glow', glowRaw, '写成 48 #f6f1e7，顺序是 blur spread color')
  }

  const innerShadowRaw = src['inner-shadow']
  const parsedInnerShadow = parseShadow(innerShadowRaw)
  if (parsedInnerShadow) {
    out.innerShadow = { ...parsedInnerShadow, color: parsedInnerShadow.color ?? DEFAULT_SHADOW_COLOR }
  } else if (innerShadowRaw && innerShadowRaw.trim() !== 'none') {
    warnInvalid(ctx, 'inner-shadow', innerShadowRaw, '写成 0 8 16 #00000088，顺序是 x y blur spread color')
  }

  const innerGlowRaw = src['inner-glow']
  const parsedInnerGlow = parseGlow(innerGlowRaw)
  if (parsedInnerGlow) out.innerGlow = { ...parsedInnerGlow, color: parsedInnerGlow.color ?? glowColor }
  else if (innerGlowRaw && innerGlowRaw.trim() !== 'none') {
    warnInvalid(ctx, 'inner-glow', innerGlowRaw, '写成 24 #f3ead4，顺序是 blur spread color')
  }

  const inkRaw = src['ink-stroke']
  const parsedInk = parseInkStroke(inkRaw)
  if (parsedInk) {
    const badGradient = parsedInk.some((layer) => isGradient(layer.color) && !parseGradient(layer.color))
    if (badGradient) warnInvalid(ctx, 'ink-stroke', inkRaw!, '写成 6 #000 outside')
    else out.inkStroke = parsedInk
  } else if (inkRaw && inkRaw.trim() !== 'none') {
    warnInvalid(ctx, 'ink-stroke', inkRaw, '写成 6 #000 outside')
  }

  const blurRaw = src.blur
  const parsedBlur = parseBlurRadius(blurRaw)
  if (parsedBlur !== undefined) out.blur = parsedBlur
  else if (blurRaw && blurRaw.trim() !== 'none') {
    warnInvalid(ctx, 'blur', blurRaw, '写成单个非负像素，例如 8 或 8px')
  }

  const backdropRaw = src['backdrop-blur']
  const parsedBackdrop = parseBlurRadius(backdropRaw)
  if (parsedBackdrop !== undefined) out.backdropBlur = parsedBackdrop
  else if (backdropRaw && backdropRaw.trim() !== 'none') {
    warnInvalid(ctx, 'backdrop-blur', backdropRaw, '写成单个非负像素，例如 16 或 16px')
  }

  const noiseRaw = src.noise
  const parsedNoise = parseNoise(noiseRaw)
  if (parsedNoise) out.noise = parsedNoise
  else if (noiseRaw && noiseRaw.trim() !== 'none') {
    warnInvalid(ctx, 'noise', noiseRaw, '写成 0.08 或 0.08 #ffffff，强度 0 到 1')
  }

  const shared = collectFilters(src, 'shared')
  pushFilterIssues(ctx, shared.issues)
  if (shared.applied.length) out.filters = shared.applied
  const color = shared.applied.find((item) => item.name === 'filter')
  if (color) out.colorFilter = color.spec as ColorFilterSpec[]

  const blendRaw = src.blend
  const parsedBlend = parseBlend(blendRaw)
  if (parsedBlend) out.blend = parsedBlend
  else if (blendRaw && blendRaw.trim() !== 'none') {
    warnInvalid(ctx, 'blend', blendRaw, '写成 multiply、screen、overlay、soft-light、lighten、darken 或 source-over')
  }

  const glassRaw = src.glass
  const parsedGlass = parseGlass(glassRaw)
  if (parsedGlass) out.glass = parsedGlass
  else if (glassRaw && glassRaw.trim() !== 'none') {
    warnInvalid(ctx, 'glass', glassRaw, '写成 regular、clear、thick，或 24 #ffffff33')
  }

  if (out.glass && out.backdropBlur != null) {
    ctx.issues.push({
      level: 'info',
      code: 'non-canonical',
      path: ctx.pathPrefix,
      message: '同时写了 glass 与 backdrop-blur，以 glass 为准',
      hint: '删掉 backdrop-blur，或只用 backdrop-blur 做简单毛玻璃',
    })
  }

  if (out.blur != null && out.colorFilter) {
    ctx.issues.push({
      level: 'info',
      code: 'non-canonical',
      path: ctx.pathPrefix,
      message: '同时写了 blur 与 filter，图层模糊以 blur 为准',
      hint: '色彩调整继续用 filter；模糊只用 blur 属性',
    })
  }

  return out
}

/** 仅 layer：解析 overlay，校验 paint。 */
function readLayerOverlay(attrs: Record<string, string>, ctx: LayoutContext): OverlaySpec | undefined {
  const raw = attrs.overlay
  if (raw == null || raw.trim() === '' || raw.trim() === 'none') return undefined
  const parsed = parseOverlay(raw)
  if (!parsed) {
    warnInvalid(
      ctx,
      'overlay',
      raw,
      '写成 #00000066、#ff8800 0.4 multiply，或 linear-gradient(...) soft-light。仅 layer 可用',
    )
    return undefined
  }
  if (isGradient(parsed.paint)) {
    if (!parseGradient(parsed.paint)) {
      warnInvalid(
        ctx,
        'overlay',
        raw,
        '例如 overlay="linear-gradient(to bottom, #fff0, #0008) multiply"',
      )
      return undefined
    }
  }
  return parsed
}

/** 仅 layer：解析 grade 以及 registerFilter 登记的像素滤镜。 */
function readLayerFilters(
  attrs: Record<string, string>,
  ctx: LayoutContext,
): { grade?: GradeSpec; gradeMask?: string; filters?: AppliedFilter[] } {
  const { applied, issues } = collectFilters(attrs, 'layer')
  pushFilterIssues(ctx, issues)
  const grade = applied.find((item) => item.name === 'grade')
  return {
    ...(applied.length ? { filters: applied } : {}),
    ...(grade ? { grade: grade.spec as GradeSpec, ...(grade.mask ? { gradeMask: grade.mask } : {}) } : {}),
  }
}

/** SVG 虚线。奇数段会再重复一遍，和描边相位对齐。非法值警告并当成实线。 */
function readDash(raw: string | undefined, ctx: LayoutContext): number[] | undefined {
  if (raw == null) return undefined
  const text = raw.trim()
  if (text === '' || text === 'none') return undefined
  const parts = text.split(/[\s,]+/).filter((part) => part.length > 0)
  const nums: number[] = []
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isFinite(n) || n < 0) {
      warnInvalid(ctx, 'stroke-dasharray', raw, '写成像素长度，例如 8 8 或 12,4,2,4')
      return undefined
    }
    nums.push(n)
  }
  if (nums.length === 0 || nums.every((n) => n === 0)) {
    warnInvalid(ctx, 'stroke-dasharray', raw, '写成像素长度，例如 8 8 或 12,4,2,4')
    return undefined
  }
  if (nums.length % 2 === 1) nums.push(...nums)
  return nums
}

function readPaint(raw: string, fallback: string, ctx: LayoutContext, label: string): string {
  if (!isGradient(raw)) return raw
  if (parseGradient(raw)) return raw
  ctx.issues.push({
    level: 'warn',
    code: 'invalid-attr',
    path: ctx.pathPrefix,
    message: `无法解析 ${label}: ${raw}`,
    hint: '例如 gradient(#112233, #ff8800)、linear-gradient(to bottom, #0b1026, #d5ddd4) 或 radial-gradient(at 35% 30%, #fff, #fff0)',
  })
  return fallback
}

function scalePair(raw: string | undefined): { scaleX: number; scaleY: number } {
  const scale = parseScale(raw)
  return { scaleX: scale.x, scaleY: scale.y }
}

function readHtmlAppearance(style: Record<string, string>) {
  return {
    padding: parseEdges(style.padding) ?? ZERO_EDGES,
    border: parseBorder(style.border),
    borderRadius: parsePx(style['border-radius']) ?? 0,
    background: style.background ?? style['background-color'],
    opacity: parseNumber(style.opacity) ?? 1,
    rotate: parseNumber(style.rotate) ?? 0,
    rotateX: parseNumber(style.rotateX) ?? 0,
    rotateY: parseNumber(style.rotateY) ?? 0,
    z: parseNumber(style.z) ?? 0,
    ...scalePair(style.scale),
    origin: parseOrigin(style.origin),
  }
}

function readAttrAppearance(attrs: Record<string, string>) {
  return {
    padding: ZERO_EDGES,
    border: parseBorder(attrs.border),
    borderRadius: parsePx(attrs['border-radius']) ?? 0,
    background: attrs.background as string | undefined,
    opacity: parseNumber(attrs.opacity) ?? 1,
    rotate: parseNumber(attrs.rotate) ?? 0,
    rotateX: parseNumber(attrs.rotateX) ?? 0,
    rotateY: parseNumber(attrs.rotateY) ?? 0,
    z: parseNumber(attrs.z) ?? 0,
    ...scalePair(attrs.scale),
    origin: parseOrigin(attrs.origin),
  }
}

function flexDirectionOf(style: Record<string, string>): 'row' | 'column' {
  return style['flex-direction']?.trim().toLowerCase() === 'column' ? 'column' : 'row'
}

function directTextContent(node: FvgNode): string {
  const parts: string[] = []
  for (const c of node.children) {
    if (typeof c === 'string') {
      const t = c.replace(/\s+/g, ' ').trim()
      if (t) parts.push(t)
    }
  }
  return parts.join(' ')
}

function isHeadingTag(tag: string): boolean {
  return tag === 'h1' || tag === 'h2' || tag === 'h3'
}

function textAlignOf(raw: string | undefined, fallback: 'left' | 'center' | 'right'): 'left' | 'center' | 'right' {
  const value = raw?.trim()
  if (value === 'center' || value === 'right' || value === 'left') return value
  if (value === 'start') return 'left'
  if (value === 'end') return 'right'
  return fallback
}

/** 容器上写了的文字样式传给子元素。标题自己的默认字号和字重不往下盖。 */
function inheritTextContext(ctx: LayoutContext, tag: string, style: Record<string, string>): LayoutContext {
  const next: LayoutContext = { ...ctx }
  const family = style['font-family']?.trim()
  if (family) next.fontFamily = family
  if (style.color?.trim()) next.color = style.color.trim()
  const fontSize = parsePx(style['font-size'])
  if (fontSize != null) next.fontSize = fontSize
  else if (isHeadingTag(tag)) next.fontSize = defaultFontSizeForTag(tag)
  const fontWeight = parseFontWeight(style['font-weight'])
  if (fontWeight != null) next.fontWeight = fontWeight
  else if (isHeadingTag(tag)) next.fontWeight = defaultFontWeightForTag(tag)
  const letterSpacing = parseLetterSpacing(style['letter-spacing'], next.fontSize ?? 40)
  if (letterSpacing != null) next.letterSpacing = letterSpacing
  if (style['text-align']) next.textAlign = textAlignOf(style['text-align'], ctx.textAlign ?? 'left')
  const lineHeight = parseLineHeight(style['line-height'])
  if (lineHeight) next.lineHeight = lineHeight
  return next
}

/** 嵌套 layer 上的颜色和字体，和根上的写法同一条继承路径。 */
function withLayerText(ctx: LayoutContext, node: FvgNode): LayoutContext {
  const next: LayoutContext = { ...ctx }
  const family = node.attrs['font-family']?.trim()
  if (family) next.fontFamily = family
  const color = node.attrs.color?.trim()
  if (color) next.color = color
  const fontSize = parsePx(node.attrs['font-size'])
  if (fontSize != null) next.fontSize = fontSize
  const fontWeight = parseFontWeight(node.attrs['font-weight'])
  if (fontWeight != null) next.fontWeight = fontWeight
  const letterSpacing = parseLetterSpacing(node.attrs['letter-spacing'], next.fontSize ?? 40)
  if (letterSpacing != null) next.letterSpacing = letterSpacing
  const lineHeight = parseLineHeight(node.attrs['line-height'])
  if (lineHeight) next.lineHeight = lineHeight
  return next
}

function computeDrawStyle(node: FvgNode, ctx: LayoutContext, style: Record<string, string>): DrawComputedStyle {
  const tag = node.tag.toLowerCase()
  const fontSize =
    parsePx(style['font-size']) ??
    (isHeadingTag(tag) ? defaultFontSizeForTag(tag) : ctx.fontSize ?? (isTextBoxTag(node.tag) ? defaultFontSizeForTag(tag) : 40))
  const fontWeight =
    parseFontWeight(style['font-weight']) ??
    (isHeadingTag(tag) || tag === 'strong' || tag === 'b'
      ? 700
      : ctx.fontWeight ?? (isTextBoxTag(node.tag) ? defaultFontWeightForTag(tag) : 400))
  const fontFamily = style['font-family']?.trim() || ctx.fontFamily
  const color = style.color ?? ctx.color
  const opacity = isHtmlTag(node.tag) ? parseNumber(style.opacity) ?? 1 : parseNumber(node.attrs.opacity) ?? 1
  return { color, fontFamily, fontSize, fontWeight, opacity }
}

function layoutDrawMeta(node: FvgNode, ctx: LayoutContext) {
  const style = parseStyle(node.attrs.style)
  const loc = node.drawLoc ?? node.loc
  return {
    draw: node.draw,
    data: node.data,
    attr: { ...node.attrs },
    style,
    computed: computeDrawStyle(node, ctx, style),
    text: directTextContent(node),
    ...(loc ? { source: formatSourceLoc(loc) } : {}),
  }
}

function layoutCustomDraw(node: FvgNode, ctx: LayoutContext): CustomLayoutNode | null {
  if (!node.draw) return null
  let x = 0
  let y = 0
  let w = parseNumber(node.attrs.width)
  let h = parseNumber(node.attrs.height)
  if (hasTwoPoint(node.attrs)) {
    const x1 = parseNumber(node.attrs.x1) ?? 0
    const y1 = parseNumber(node.attrs.y1) ?? 0
    const x2 = parseNumber(node.attrs.x2) ?? 0
    const y2 = parseNumber(node.attrs.y2) ?? 0
    x = Math.min(x1, x2)
    y = Math.min(y1, y2)
    w = Math.abs(x2 - x1)
    h = Math.abs(y2 - y1)
  } else if (node.attrs.x != null || node.attrs.y != null) {
    x = parseNumber(node.attrs.x) ?? 0
    y = parseNumber(node.attrs.y) ?? 0
  }
  if (w == null || h == null) return null
  const appearance = readAttrAppearance(node.attrs)
  return {
    kind: 'custom',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x,
    y,
    width: w,
    height: h,
    ink: { x: 0, y: 0, width: w, height: h },
    ...appearance,
    ...readEffects(node.attrs, ctx, solidPaint(appearance.background, ctx.color)),
    ...layoutDrawMeta(node, ctx),
  }
}

function layoutUnknownOrCustom(node: FvgNode, ctx: LayoutContext): LayoutNode | null {
  warnNestedMasks(node, ctx)
  const custom = layoutCustomDraw(node, ctx)
  if (custom) return custom
  const retired = node.tag === 'Row' || node.tag === 'Column'
  ctx.issues.push({
    level: 'warn',
    code: 'unknown-tag',
    path: ctx.pathPrefix,
    message: `未知标签 ${node.tag}`,
    hint: retired ? rowColumnHint(node.tag) : undefined,
  })
  return null
}

function outerFromContent(
  contentW: number,
  contentH: number,
  padding: Edges,
  border?: { width: number; color: string },
): { width: number; height: number; contentOffsetX: number; contentOffsetY: number } {
  const bw = border?.width ?? 0
  const width = contentW + padding.left + padding.right + bw * 2
  const height = contentH + padding.top + padding.bottom + bw * 2
  return { width, height, contentOffsetX: padding.left + bw, contentOffsetY: padding.top + bw }
}

function mapJustify(v: string | undefined): Justify {
  switch ((v ?? 'start').trim()) {
    case 'center':
      return Justify.Center
    case 'end':
    case 'flex-end':
      return Justify.FlexEnd
    case 'start':
    case 'flex-start':
      return Justify.FlexStart
    case 'space-between':
      return Justify.SpaceBetween
    case 'space-around':
      return Justify.SpaceAround
    case 'space-evenly':
      return Justify.SpaceEvenly
    default:
      return Justify.FlexStart
  }
}

function mapAlign(v: string | undefined): Align {
  switch ((v ?? 'center').trim().toLowerCase()) {
    case 'start':
    case 'flex-start':
      return Align.FlexStart
    case 'end':
    case 'flex-end':
      return Align.FlexEnd
    case 'stretch':
      return Align.Stretch
    case 'baseline':
      // 竖排没有文字基线，横排也先按起点排，再在后面把基线对齐。
      return Align.FlexStart
    default:
      return Align.Center
  }
}

function isBaselineAlign(v: string | undefined): boolean {
  return (v ?? '').trim().toLowerCase() === 'baseline'
}

function mapWrap(v: string | undefined): Wrap {
  switch ((v ?? 'nowrap').trim()) {
    case 'wrap':
      return Wrap.Wrap
    case 'wrap-reverse':
      return Wrap.WrapReverse
    default:
      return Wrap.NoWrap
  }
}

/** 缺省 flex-start。和 align-items 的缺省 center 不是同一件事。 */
function mapAlignContent(v: string | undefined): Align {
  switch ((v ?? 'flex-start').trim()) {
    case 'center':
      return Align.Center
    case 'end':
    case 'flex-end':
      return Align.FlexEnd
    case 'stretch':
      return Align.Stretch
    case 'space-between':
      return Align.SpaceBetween
    case 'space-around':
      return Align.SpaceAround
    case 'space-evenly':
      return Align.SpaceEvenly
    default:
      return Align.FlexStart
  }
}

function parseFlexGrowShrink(style: Record<string, string>, isText: boolean): { grow: number; shrink: number } {
  const flex = style.flex?.trim()
  if (flex === '1') return { grow: 1, shrink: 1 }
  const grow = parseNumber(style['flex-grow']) ?? 0
  const shrink = parseNumber(style['flex-shrink']) ?? (isText ? 1 : 0)
  return { grow, shrink }
}

/** 纯几何范围，不含描边。水平或垂直线的高或宽可以是 0。 */
function lineBounds(geom: LineGeometry, ctx?: LayoutContext): Box {
  if (geom.kind === 'line') {
    const x = Math.min(geom.x1, geom.x2)
    const y = Math.min(geom.y1, geom.y2)
    return { x, y, width: Math.abs(geom.x2 - geom.x1), height: Math.abs(geom.y2 - geom.y1) }
  }
  if (geom.kind === 'polyline' || geom.kind === 'polygon') {
    if (geom.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
    const xs = geom.points.map((p) => p.x)
    const ys = geom.points.map((p) => p.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
  }
  if (geom.kind === 'path') return pathBoundsOf(geom.d, ctx)
  return { x: 0, y: 0, width: 0, height: 0 }
}

/** 相对几何盒子的着墨：半个描边。 */
function lineInk(box: Box, strokeWidth: number): Box {
  const pad = Math.max(0, strokeWidth) / 2
  return {
    x: -pad,
    y: -pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  }
}

function usesOwnCoords(node: FvgNode, kind: LayoutNode['kind']): boolean {
  if (kind === 'line' || kind === 'group') return true
  if (node.tag === 'circle' || node.tag === 'ellipse' || node.tag === 'sphere' || node.tag === 'cylinder' || node.tag === 'torus') return true
  if (node.tag === 'rect') return true
  return kind === 'custom' && hasTwoPoint(node.attrs)
}

function normalizeLineGeometry(geom: LineGeometry, box: Box): LineGeometry {
  const ox = box.x
  const oy = box.y
  if (geom.kind === 'line') {
    return { ...geom, x1: geom.x1 - ox, y1: geom.y1 - oy, x2: geom.x2 - ox, y2: geom.y2 - oy }
  }
  if (geom.kind === 'polyline' || geom.kind === 'polygon') {
    return { ...geom, points: geom.points.map((p) => ({ x: p.x - ox, y: p.y - oy })) }
  }
  if (geom.kind === 'path') return { ...geom, d: translateSvgPath(geom.d, -ox, -oy) }
  return geom
}

function layoutTextBox(node: FvgNode, ctx: LayoutContext, contentWidthLimit?: number): TextLayoutNode {
  warnNestedMasks(node, ctx)
  const style = parseStyle(node.attrs.style)
  const tag = node.tag.toLowerCase()
  const symbols = symbolsClassOf(classAttr(node.attrs))
  const fontSize =
    parsePx(style['font-size']) ?? (isHeadingTag(tag) ? defaultFontSizeForTag(tag) : ctx.fontSize ?? defaultFontSizeForTag(tag))
  const fontWeight =
    parseFontWeight(style['font-weight']) ??
    (isHeadingTag(tag) || tag === 'strong' || tag === 'b' ? 700 : ctx.fontWeight ?? defaultFontWeightForTag(tag))
  const fontFamily = style['font-family']?.trim() || (symbols ? ICON_FONT_FAMILY : ctx.fontFamily)
  const color = style.color ?? ctx.color
  const letterSpacing = parseLetterSpacing(style['letter-spacing'], fontSize) ?? ctx.letterSpacing ?? 0
  const images: ImageLayoutNode[] = []
  const segments = extractTextSegments(
    node,
    {
      fontFamily,
      fontSize,
      fontWeight,
      color,
      letterSpacing,
      lineHeightRatio: 1.2,
    },
    ctx.pathPrefix,
    (img, imgPath) => {
      const laid = layoutImage(img, { ...ctx, pathPrefix: imgPath })
      const key = images.length
      images.push(laid)
      return { width: laid.width, height: laid.height, key }
    },
    (notes, notePath) => {
      for (const note of notes) ctx.issues.push({ ...note, path: notePath })
    },
  )
  const nowrap = style['white-space'] === 'nowrap' || (symbols != null && !style['white-space'])
  const textWrap = style['text-wrap'] === 'wrap' ? 'wrap' : 'balance'
  const fixedW = parsePx(style.width)
  const fixedH = parsePx(style.height)
  const maxW = parsePx(style['max-width']) ?? contentWidthLimit
  const maxH = parsePx(style['max-height'])
  const writingMode = style['writing-mode']?.trim().toLowerCase()
  const vertical = writingMode === 'vertical-rl'
  if (writingMode && writingMode !== 'horizontal-tb' && writingMode !== 'vertical-rl') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `不支持的 writing-mode: ${writingMode}`,
      hint: '竖排用 writing-mode:vertical-rl',
    })
  }
  const specifiedLine = parseLineHeight(style['line-height']) ?? (symbols && !style['line-height'] ? { unit: 'ratio' as const, value: 1 } : ctx.lineHeight)
  const fallbackRatio = segments.length > 1 && !vertical ? 1.4 : 1.2
  const lineHeightPx = specifiedLine?.unit === 'px' ? specifiedLine.value : undefined
  const lineHeightRatio = specifiedLine == null ? fallbackRatio : specifiedLine.unit === 'ratio' ? specifiedLine.value : fontSize > 0 ? specifiedLine.value / fontSize : fallbackRatio

  const appearance = readHtmlAppearance(style)
  const innerPadX = appearance.padding.left + appearance.padding.right + (appearance.border?.width ?? 0) * 2
  const innerPadY = appearance.padding.top + appearance.padding.bottom + (appearance.border?.width ?? 0) * 2

  const textLayout = layoutText({
    segments,
    fixedWidth: fixedW != null ? Math.max(0, fixedW - innerPadX) : undefined,
    fixedHeight: fixedH != null ? Math.max(0, fixedH - innerPadY) : undefined,
    maxWidth: vertical ? undefined : maxW,
    maxHeight: maxH,
    nowrap: vertical ? false : nowrap,
    textWrap,
    lineHeightRatio,
    lineHeightPx,
    fontSize,
    writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
  })

  let contentW = textLayout.contentWidth
  let contentH = textLayout.contentHeight
  if (fixedW != null) contentW = Math.max(contentW, fixedW - appearance.padding.left - appearance.padding.right - (appearance.border?.width ?? 0) * 2)
  if (fixedH != null) contentH = Math.max(contentH, fixedH - appearance.padding.top - appearance.padding.bottom - (appearance.border?.width ?? 0) * 2)

  const outer = outerFromContent(contentW, contentH, appearance.padding, appearance.border)
  const textAlign = textAlignOf(style['text-align'], ctx.textAlign ?? 'left')
  const boxW = fixedW ?? outer.width
  const innerW = boxW - appearance.padding.left - appearance.padding.right - (appearance.border?.width ?? 0) * 2
  for (const line of textLayout.lines) {
    const shift = alignLineOffset(textAlign, innerW, line.width)
    for (const atom of line.atoms ?? []) {
      const image = images[atom.key]
      if (!image) continue
      image.x = outer.contentOffsetX + shift + atom.x
      image.y = outer.contentOffsetY + atom.y
    }
  }
  const ink = alignedTextInk(textLayout.lines, textAlign, innerW, outer.contentOffsetX, outer.contentOffsetY)
  ctx.issues.push(...checkTextBoxChildren(node, ctx.pathPrefix))

  if (textLayout.overflowFixed) {
    ctx.issues.push({
      level: 'error',
      code: 'text-overflow',
      path: ctx.pathPrefix,
      message: '文字超出写死的 width/height',
    })
  }
  if (textLayout.autoWrap) {
    ctx.issues.push({
      level: 'info',
      code: 'auto-wrap',
      path: ctx.pathPrefix,
      message: '文字超出可用宽度，已自动换行',
    })
  }

  return {
    kind: 'text',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x: 0,
    y: 0,
    width: fixedW ?? outer.width,
    height: fixedH ?? outer.height,
    ink,
    ...appearance,
    textLayout,
    textAlign,
    ...(images.length ? { inlines: images } : {}),
    ...readEffects(style, ctx, color),
    ...layoutDrawMeta(node, ctx),
  }
}

function refitImageNode(node: ImageLayoutNode, x: number, y: number, width: number, height: number): ImageLayoutNode {
  const bw = node.border?.width ?? 0
  const contentW = Math.max(0, width - node.padding.left - node.padding.right - bw * 2)
  const contentH = Math.max(0, height - node.padding.top - node.padding.bottom - bw * 2)
  const ink = imageInk(
    contentW,
    contentH,
    node.bitmap?.width ?? 0,
    node.bitmap?.height ?? 0,
    node.objectFit,
    node.objectPosition,
    node.padding.left + bw,
    node.padding.top + bw,
  )
  return { ...node, x, y, width, height, ink }
}

function displaySrc(src: string): string {
  if (/^data:/i.test(src)) return 'data URL'
  return src.length > 160 ? `${src.slice(0, 157)}…` : src
}

function layoutImage(node: FvgNode, ctx: LayoutContext): ImageLayoutNode {
  warnNestedMasks(node, ctx)
  const style = parseStyle(node.attrs.style)
  const appearance = readHtmlAppearance(style)
  if (appearance.background) appearance.background = readPaint(appearance.background, 'transparent', ctx, 'background')
  if (isDisplayFlex(node.attrs.style)) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: '图片不能当作 flex 容器',
      hint: '排布用 <div style="display:flex">，把 <img src="…"> 放进去',
    })
  }
  if (!node.attrs.src?.trim()) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: style.src ? `${node.tag} 的 src 要写成属性` : `${node.tag} 缺少 src`,
      hint: '写成 <img src="cover.png" style="width:320px; height:180px" />。src 是属性，不要写进 style',
    })
  }
  let bitmap: ImageLayoutNode['bitmap'] = null
  if (node.attrs.src?.trim()) {
    const peeked = peekLayerImage(node.attrs.src, ctx.baseDir)
    if (peeked.status === 'ok') bitmap = peeked.image
    else {
      const shown = displaySrc(node.attrs.src.trim())
      ctx.issues.push({
        level: 'warn',
        code: 'missing-image',
        path: ctx.pathPrefix,
        message: `图片无法加载: ${shown}`,
        hint:
          peeked.status === 'missing'
            ? 'src 要能在排版前读到。写在 layer 里的图会自动准备'
            : 'src 相对 .layer 所在目录，也可以写 http(s) 或 data URL',
      })
    }
  }
  const parsedFit = parseObjectFit(style['object-fit'])
  if (parsedFit.invalid) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `不支持的 object-fit: ${style['object-fit']}`,
      hint: '用 fill、contain、cover 或 none',
    })
  }
  const parsedPos = parseObjectPosition(style['object-position'])
  if (!parsedPos) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `不支持的 object-position: ${style['object-position']}`,
      hint: '用 center、top-left、left top，或 50% 0%',
    })
  }
  const objectFit = parsedFit.fit
  const objectPosition = parsedPos ?? { x: 0.5, y: 0.5 }
  const natW = bitmap?.width ?? 0
  const natH = bitmap?.height ?? 0
  const fixedW = parsePx(style.width)
  const fixedH = parsePx(style.height)
  const bw = appearance.border?.width ?? 0
  const padX = appearance.padding.left + appearance.padding.right + bw * 2
  const padY = appearance.padding.top + appearance.padding.bottom + bw * 2
  let contentW: number
  let contentH: number
  if (fixedW != null && fixedH != null) {
    contentW = Math.max(0, fixedW - padX)
    contentH = Math.max(0, fixedH - padY)
  } else if (fixedW != null) {
    contentW = Math.max(0, fixedW - padX)
    contentH = natW > 0 ? (contentW * natH) / natW : 0
  } else if (fixedH != null) {
    contentH = Math.max(0, fixedH - padY)
    contentW = natH > 0 ? (contentH * natW) / natH : 0
  } else {
    contentW = natW
    contentH = natH
  }
  const outer = outerFromContent(contentW, contentH, appearance.padding, appearance.border)
  const laid = refitImageNode(
    {
      kind: 'image',
      path: ctx.pathPrefix,
      id: node.attrs.id,
      tag: node.tag,
      x: 0,
      y: 0,
      width: fixedW ?? outer.width,
      height: fixedH ?? outer.height,
      ink: { x: 0, y: 0, width: 0, height: 0 },
      bitmap,
      objectFit,
      objectPosition,
      ...appearance,
      ...readEffects(style, ctx, ctx.color),
      ...layoutDrawMeta(node, ctx),
    },
    0,
    0,
    fixedW ?? outer.width,
    fixedH ?? outer.height,
  )
  return laid
}

function warnNestedMasks(node: FvgNode, ctx: LayoutContext) {
  node.children.forEach((child, index) => {
    if (typeof child === 'string' || child.tag !== 'mask') return
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-child',
      path: nodePath(ctx.pathPrefix, 'mask', index),
      message: 'mask 只作为 layer 的直接子元素',
      hint: '把 <mask> 写在 <layer> 里，和要裁的内容并列',
    })
  })
}

function layoutShape(node: FvgNode, ctx: LayoutContext, _defaultStroke: string): ShapeLayoutNode {
  warnNestedMasks(node, ctx)
  const appearance = readAttrAppearance(node.attrs)
  let x = 0
  let y = 0
  let w = parseNumber(node.attrs.width) ?? 0
  let h = parseNumber(node.attrs.height) ?? 0
  if (node.tag === 'circle') {
    const r = parseNumber(node.attrs.r) ?? 0
    const cx = parseNumber(node.attrs.cx) ?? 0
    const cy = parseNumber(node.attrs.cy) ?? 0
    w = h = r * 2
    x = cx - r
    y = cy - r
  } else if (node.tag === 'ellipse') {
    const rx = parseNumber(node.attrs.rx) ?? 0
    const ry = parseNumber(node.attrs.ry) ?? 0
    const cx = parseNumber(node.attrs.cx) ?? 0
    const cy = parseNumber(node.attrs.cy) ?? 0
    w = rx * 2
    h = ry * 2
    x = cx - rx
    y = cy - ry
  } else if (node.tag === 'rect') {
    x = parseNumber(node.attrs.x) ?? 0
    y = parseNumber(node.attrs.y) ?? 0
    w = parseNumber(node.attrs.width) ?? w
    h = parseNumber(node.attrs.height) ?? h
  }
  const fillFallback = ctx.fillDefault ?? ctx.paintFill ?? '#000000'
  const fill = readPaint(node.attrs.fill ?? fillFallback, fillFallback, ctx, 'fill')
  const strokeFallback = ctx.fillDefault != null ? 'none' : (node.attrs.stroke ?? ctx.paintStroke ?? 'none')
  const stroke = readPaint(node.attrs.stroke ?? strokeFallback, strokeFallback, ctx, 'stroke')
  const strokeWidth = parseNumber(node.attrs['stroke-width']) ?? 1
  const dash = readDash(node.attrs['stroke-dasharray'], ctx)
  const ink = { x: 0, y: 0, width: w, height: h }
  const rx = parseNumber(node.attrs.rx)
  const ry = parseNumber(node.attrs.ry)
  return {
    kind: 'shape',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x,
    y,
    width: w,
    height: h,
    ink,
    ...appearance,
    shape: node.tag === 'rect' ? 'rect' : node.tag === 'circle' ? 'circle' : 'ellipse',
    fill,
    stroke,
    strokeWidth,
    ...(dash ? { dash } : {}),
    rx,
    r: parseNumber(node.attrs.r),
    rxEllipse: parseNumber(node.attrs.rx),
    ry: ry ?? rx,
    ...readEffects(node.attrs, ctx, solidPaint(fill !== 'none' ? fill : stroke, ctx.color)),
    ...layoutDrawMeta(node, ctx),
  }
}

function pathBoundsOf(d: string, ctx: LayoutContext | undefined): Box {
  if (!d.trim()) return { x: 0, y: 0, width: 0, height: 0 }
  const opened = openSvgPath(d)
  if ('error' in opened) {
    ctx?.issues.push({
      level: 'error',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `无法解析路径: ${opened.error}`,
      hint: '检查 d 的 SVG 路径语法。这一笔会跳过，其余内容继续画',
    })
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const b = opened.path.getBounds?.() ?? opened.path.computeTightBounds?.()
  if (b && b.length >= 4) return { x: b[0], y: b[1], width: Math.max(0, b[2] - b[0]), height: Math.max(0, b[3] - b[1]) }
  return { x: 0, y: 0, width: 0, height: 0 }
}

function readPositiveAttr(
  raw: string | undefined,
  fallback: number,
  ctx: LayoutContext,
  tag: string,
  attr: string,
  example: string,
): number {
  const fb = fallback > 0 ? fallback : 1
  if (raw == null || raw.trim() === '') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `${tag} 缺少 ${attr}，已用 ${fb}`,
      hint: example,
    })
    return fb
  }
  const parsed = parseNumber(raw)
  if (parsed == null || !(parsed > 0)) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `无法解析 ${attr}: ${raw}`,
      hint: example,
    })
    return fb
  }
  return parsed
}

function readDepth(raw: string | undefined, fallback: number, ctx: LayoutContext, tag: string): number {
  const fb = fallback > 0 ? fallback : 1
  if (raw == null || raw.trim() === '') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `${tag} 缺少 depth，已用 ${fb}`,
      hint: '写成像素厚度，例如 depth="40"',
    })
    return fb
  }
  const parsed = parseNumber(raw)
  if (parsed == null || !(parsed > 0)) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `无法解析 depth: ${raw}`,
      hint: '写成正的像素厚度，例如 depth="40"',
    })
    return fb
  }
  return parsed
}

function readMeshLines(node: FvgNode, ctx: LayoutContext): { stroke: string; strokeWidth: number; hidden: string } {
  const rawStroke = node.attrs.stroke
  const rawHidden = node.attrs.hidden
  const rawWidth = node.attrs['stroke-width']
  const strokeWritten = rawStroke != null && rawStroke.trim() !== '' && rawStroke.trim() !== 'none'
  let stroke = 'none'
  if (strokeWritten) {
    if (isGradient(rawStroke)) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: `${node.tag} 的 stroke 不支持渐变，只使用第一个颜色`,
        hint: '改成纯色，例如 stroke="#1c1915"',
      })
    }
    stroke = solidPaint(readPaint(rawStroke, '#000000', ctx, 'stroke'), '#000000')
  }
  const hiddenWritten = rawHidden != null && rawHidden.trim() !== '' && rawHidden.trim() !== 'none'
  let hidden = 'none'
  if (hiddenWritten) {
    if (!strokeWritten) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: `${node.tag} 的 hidden 要和 stroke 一起写`,
        hint: '例如 stroke="#1c1915" hidden="#8a8175"',
      })
    } else {
      if (isGradient(rawHidden)) {
        ctx.issues.push({
          level: 'warn',
          code: 'invalid-attr',
          path: ctx.pathPrefix,
          message: `${node.tag} 的 hidden 不支持渐变，只使用第一个颜色`,
          hint: '改成纯色，例如 hidden="#8a8175"',
        })
      }
      hidden = solidPaint(readPaint(rawHidden!, '#000000', ctx, 'hidden'), '#000000')
    }
  }
  let strokeWidth = 2
  if (rawWidth != null && rawWidth.trim() !== '') {
    const parsed = parseNumber(rawWidth)
    if (parsed == null || parsed < 0) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: `${node.tag} 的 stroke-width 需要非负像素`,
        hint: '例如 stroke-width="2"',
      })
    } else {
      strokeWidth = parsed
    }
    if (!strokeWritten) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: `${node.tag} 的 stroke-width 要和 stroke 一起写`,
        hint: '例如 stroke="#1c1915" stroke-width="2"',
      })
    }
  }
  return { stroke, strokeWidth, hidden }
}

function layoutMesh(node: FvgNode, ctx: LayoutContext): MeshLayoutNode {
  warnNestedMasks(node, ctx)
  const appearance = readAttrAppearance(node.attrs)
  const fill = readPaint(node.attrs.fill ?? '#000000', '#000000', ctx, 'fill')
  let x = 0
  let y = 0
  let width = 0
  let height = 0
  let mesh: MeshLayoutNode['mesh']
  if (node.tag === 'sphere') {
    const r = parseNumber(node.attrs.r) ?? 0
    if (!(r > 0)) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'sphere 需要正的 r',
        hint: '例如 <sphere cx="220" cy="340" r="90" />',
      })
    }
    const radius = Math.max(0, r)
    const cx = parseNumber(node.attrs.cx) ?? 0
    const cy = parseNumber(node.attrs.cy) ?? 0
    width = height = radius * 2
    x = cx - radius
    y = cy - radius
    mesh = { type: 'sphere', r: radius }
  } else if (node.tag === 'box') {
    width = parseNumber(node.attrs.width) ?? 0
    height = parseNumber(node.attrs.height) ?? 0
    if (!(width > 0) || !(height > 0)) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'box 需要正的 width 和 height',
        hint: '例如 <box x="355" y="350" width="150" height="100" depth="60" />',
      })
    }
    const depth = readDepth(node.attrs.depth, Math.min(width, height), ctx, 'box')
    const fillet = readBoxFillet(node.attrs.rx, node.attrs.round, width, height, depth)
    for (const issue of fillet.issues) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: issue.message,
        hint: issue.hint,
      })
    }
    mesh = { type: 'box', depth, rx: fillet.rx, edges: fillet.edges }
  } else if (node.tag === 'extrude') {
    const d = node.attrs.d ?? ''
    if (!d.trim()) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'extrude 缺少 d',
        hint: 'd 和 path 一样，是 y 向下的 SVG 路径',
      })
    }
    const box = pathBoundsOf(d, ctx)
    width = box.width
    height = box.height
    const depth = readDepth(node.attrs.depth, Math.min(width, height), ctx, 'extrude')
    mesh = { type: 'extrude', d: translateSvgPath(d, -box.x, -box.y), depth }
  } else if (node.tag === 'cylinder') {
    const r = parseNumber(node.attrs.r) ?? 0
    if (!(r > 0)) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'cylinder 需要正的 r',
        hint: '例如 <cylinder cx="180" cy="260" r="40" height="120" />',
      })
    }
    const radius = Math.max(0, r)
    const length = readPositiveAttr(
      node.attrs.height,
      radius * 2,
      ctx,
      'cylinder',
      'height',
      '例如 <cylinder cx="180" cy="260" r="40" height="120" />',
    )
    const cx = parseNumber(node.attrs.cx) ?? 0
    const cy = parseNumber(node.attrs.cy) ?? 0
    width = radius * 2
    height = length
    x = cx - radius
    y = cy - length / 2
    const fillet = readCylinderFillet(node.attrs.rx, node.attrs.round, radius, length)
    for (const issue of fillet.issues) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: issue.message,
        hint: issue.hint,
      })
    }
    mesh = { type: 'cylinder', r: radius, height: length, rx: fillet.rx, rims: fillet.rims }
  } else if (node.tag === 'torus') {
    const r = parseNumber(node.attrs.r) ?? 0
    if (!(r > 0)) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'torus 需要正的 r',
        hint: '例如 <torus cx="200" cy="200" r="70" tube="16" />',
      })
    }
    const radius = Math.max(0, r)
    const fallback = radius > 0 ? radius / 4 : 1
    const rawTube = node.attrs.tube
    const parsedTube = rawTube == null || rawTube.trim() === '' ? null : parseNumber(rawTube)
    const missingTube = rawTube == null || rawTube.trim() === ''
    const badTube = !missingTube && (parsedTube == null || !(parsedTube > 0))
    const tooBig = parsedTube != null && parsedTube > 0 && radius > 0 && parsedTube >= radius
    let tube = parsedTube != null && parsedTube > 0 ? parsedTube : fallback
    if (missingTube || badTube || tooBig) {
      const message = tooBig
        ? 'torus 的 tube 要小于 r，否则没有孔'
        : missingTube
          ? `torus 缺少 tube，已用 ${fallback}`
          : `无法解析 tube: ${rawTube}`
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message,
        hint: 'r 是环心到管心的半径，tube 是管半径，例如 tube="16"',
      })
      tube = fallback
    }
    const outer = radius + tube
    const cx = parseNumber(node.attrs.cx) ?? 0
    const cy = parseNumber(node.attrs.cy) ?? 0
    width = height = outer * 2
    x = cx - outer
    y = cy - outer
    mesh = { type: 'torus', r: radius, tube }
  } else if (node.tag === 'tube') {
    const d = node.attrs.d ?? ''
    if (!d.trim()) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'tube 缺少 d',
        hint: 'd 是中心线，和 path 一样，例如 <tube d="M0 40 C80 40 80 120 160 80" r="8" />',
      })
    }
    const box = pathBoundsOf(d, ctx)
    if (d.trim() && box.width <= 0 && box.height <= 0) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'tube 的路径至少要有一段',
        hint: 'd 写成有长度的中心线，闭合的管子加上 Z',
      })
    }
    const radius = readPositiveAttr(node.attrs.r, 8, ctx, 'tube', 'r', '例如 <tube d="M0 0 H120" r="8" />')
    width = box.width + radius * 2
    height = box.height + radius * 2
    mesh = { type: 'tube', d: translateSvgPath(d, -box.x + radius, -box.y + radius), r: radius }
  } else {
    const src = node.attrs.src ?? ''
    const resolved = resolveModelFile(src, ctx.baseDir)
    if (resolved.reason !== 'ok') {
      const message =
        resolved.reason === 'empty' ? 'model 缺少 src' : resolved.reason === 'type' ? 'model 只接受 .glb' : `模型无法加载: ${src.trim()}`
      ctx.issues.push({
        level: 'warn',
        code: 'missing-model',
        path: ctx.pathPrefix,
        message,
        hint: 'src 相对 .layer 所在目录，例如 <model src="hero.glb" />',
      })
    }
    const span = resolved.file ? glbSpan(resolved.file) ?? undefined : undefined
    mesh = { type: 'model', src, ...(resolved.file ? { file: resolved.file } : {}), ...(span ? { span } : {}) }
  }
  const effects = readEffects(node.attrs, ctx, solidPaint(fill, ctx.color))
  if (isGradient(node.attrs.fill)) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `${node.tag} 的 fill 不支持渐变，只使用第一个颜色`,
      hint: '改成纯色，或把渐变画在平面上',
    })
  }
  if (effects.shadow) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `${node.tag} 不支持 shadow`,
      hint: 'shadow 写在平面上；网格用 fill 和 stroke',
    })
  }
  if (effects.glow) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `${node.tag} 不支持 glow`,
      hint: 'glow 写在平面上；网格用 fill 和 stroke',
    })
  }
  return {
    kind: 'mesh',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x,
    y,
    width,
    height,
    ink: { x: 0, y: 0, width, height },
    ...appearance,
    mesh,
    fill,
    ...readMeshLines(node, ctx),
    ...effects,
    ...layoutDrawMeta(node, ctx),
  }
}

function layoutLineNode(node: FvgNode, ctx: LayoutContext, defaultStroke: string): LineLayoutNode {
  warnNestedMasks(node, ctx)
  let geom: LineGeometry
  if (node.tag === 'line') {
    geom = {
      kind: 'line',
      x1: parseNumber(node.attrs.x1) ?? 0,
      y1: parseNumber(node.attrs.y1) ?? 0,
      x2: parseNumber(node.attrs.x2) ?? 0,
      y2: parseNumber(node.attrs.y2) ?? 0,
    }
  } else if (node.tag === 'polyline' || node.tag === 'polygon' || node.tag === 'curve') {
    const pts = (node.attrs.points ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [xs, ys] = pair.split(',')
        return { x: Number(xs), y: Number(ys) }
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    if (node.tag === 'curve') {
      const closed = isClosedFlag(node.attrs.closed)
      geom = { kind: 'path', d: catmullRomPath(pts, closed) }
    } else {
      geom = { kind: node.tag === 'polygon' ? 'polygon' : 'polyline', points: pts }
    }
  } else {
    geom = { kind: 'path', d: node.attrs.d ?? '' }
  }
  const strokeWidth = parseNumber(node.attrs['stroke-width']) ?? 4
  const dash = readDash(node.attrs['stroke-dasharray'], ctx)
  const strokeFallback = ctx.fillDefault != null ? 'none' : (ctx.paintStroke ?? defaultStroke)
  const stroke = readPaint(node.attrs.stroke ?? strokeFallback, strokeFallback, ctx, 'stroke')
  const fillFallback = ctx.fillDefault ?? ctx.paintFill ?? 'none'
  const fillRaw = node.attrs.fill === 'inherit' ? (node.attrs.stroke ?? strokeFallback) : (node.attrs.fill ?? fillFallback)
  let fill = readPaint(fillRaw, fillFallback, ctx, 'fill')
  const curveClosed = node.tag === 'curve' && isClosedFlag(node.attrs.closed)
  if (node.tag === 'curve' && !curveClosed && fill !== 'none') {
    ctx.issues.push({
      level: 'warn',
      code: 'open-curve-fill',
      path: ctx.pathPrefix,
      message: '开口的 Curve 不填充，避免首尾被连成一块色',
      hint: '要色块就加 closed，只要线条就去掉 fill',
    })
    fill = 'none'
  }
  const box = lineBounds(geom, ctx)
  const ink = lineInk(box, strokeWidth)
  const localGeom = normalizeLineGeometry(geom, box)
  return {
    kind: 'line',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    ink,
    opacity: parseNumber(node.attrs.opacity) ?? 1,
    rotate: parseNumber(node.attrs.rotate) ?? 0,
    ...scalePair(node.attrs.scale),
    origin: parseOrigin(node.attrs.origin),
    padding: ZERO_EDGES,
    geometry: localGeom,
    stroke,
    strokeWidth,
    fill,
    ...(dash ? { dash } : {}),
    ...readEffects(node.attrs, ctx, solidPaint(fill !== 'none' ? fill : stroke, defaultStroke)),
    ...layoutDrawMeta(node, ctx),
  }
}

type FlexMeasure = {
  node: LayoutNode
  minMain: number
  minCross: number
  preferredMain: number
  preferredCross: number
  isText: boolean
  /** 最终按分配宽度重排时用的源节点。 */
  source?: FvgNode
  /** `align-self`，没写就用这一层的 `align-items`。量的时候还没有，排进去之后才写上。 */
  crossAlign?: string
}

function fontDecl(node: FvgNode): { family: string; src: string } | null {
  if (node.tag.toLowerCase() !== FONT_TAG) return null
  return { family: node.attrs.family ?? '', src: node.attrs.src ?? '' }
}

function warnMisplacedFont(ctx: LayoutContext, path: string) {
  ctx.issues.push({
    level: 'warn',
    code: 'invalid-child',
    path,
    message: '<font> 只能写在根 Layer 下',
    hint: '写成根 <layer> 的直接子元素：<font family="…" src="…" />',
  })
}

function prepareHtmlBox(node: FvgNode): FvgNode {
  return asBlockFlow(node)
}

function measureFlexChild(raw: FvgNode, ctx: LayoutContext, direction: 'row' | 'column', crossAlign?: string): FlexMeasure | null {
  const node = prepareHtmlBox(materialize(raw))
  if (node.tag === 'symbol' || node.tag === 'draw') return null
  if (node.tag === 'g') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-child',
      path: ctx.pathPrefix,
      message: 'g 不能放在 flex 里',
      hint: '包一层 layer，例如 <layer><g>…</g></layer>',
    })
    return null
  }
  if (node.tag === 'mask') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-child',
      path: ctx.pathPrefix,
      message: 'mask 只作为 layer 的直接子元素',
      hint: '把 <mask> 写在 <layer> 里，和要裁的内容并列',
    })
    return null
  }
  if (node.tag.toLowerCase() === FONT_TAG) {
    warnMisplacedFont(ctx, ctx.pathPrefix)
    return null
  }
  ctx.issues.push(...checkChildAttrs(node, 'flex', ctx.pathPrefix))
  if (node.tag === 'use') {
    const used = layoutUse(node, ctx)
    if (!used) return null
    return {
      node: used,
      minMain: direction === 'row' ? used.width : used.height,
      minCross: direction === 'row' ? used.height : used.width,
      preferredMain: direction === 'row' ? used.width : used.height,
      preferredCross: direction === 'row' ? used.height : used.width,
      isText: false,
    }
  }
  if (isLineTag(node.tag)) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-child',
      path: ctx.pathPrefix,
      message: '线条不能放在 flex 容器内',
      hint: `包一层 layer，例如 <layer><${node.tag} …/></layer>`,
    })
    return null
  }
  if (isShapeTag(node.tag) && (hasTwoPoint(node.attrs) || (node.tag === 'circle' && node.attrs.x1 != null))) {
    return null
  }
  if (isDisplayFlex(node.attrs.style) && isTextBoxTag(node.tag)) {
    const nested = layoutFlex(node, ctx)
    return {
      node: nested,
      minMain: direction === 'row' ? nested.width : nested.height,
      minCross: direction === 'row' ? nested.height : nested.width,
      preferredMain: direction === 'row' ? nested.width : nested.height,
      preferredCross: direction === 'row' ? nested.height : nested.width,
      isText: false,
    }
  }
  if (isImageTag(node.tag)) {
    const laid = layoutImage(node, ctx)
    return {
      node: laid,
      minMain: direction === 'row' ? laid.width : laid.height,
      minCross: direction === 'row' ? laid.height : laid.width,
      preferredMain: direction === 'row' ? laid.width : laid.height,
      preferredCross: direction === 'row' ? laid.height : laid.width,
      isText: false,
    }
  }
  if (isTextBoxTag(node.tag)) {
    const laid = layoutTextBox(node, { ...ctx, issues: [] }, ctx.maxContentWidth)
    return {
      node: laid,
      minMain: direction === 'row' ? laid.textLayout.minWidth : laid.height,
      minCross: direction === 'row' ? laid.height : laid.textLayout.minWidth,
      preferredMain: direction === 'row' ? laid.width : laid.height,
      preferredCross: direction === 'row' ? laid.height : laid.width,
      isText: true,
      source: node,
    }
  }
  if (isMeshTag(node.tag)) {
    const laid = layoutMesh(node, ctx)
    if (laid.mesh.type === 'model' && laid.width <= 0) {
      ctx.issues.push({
        level: 'warn',
        code: 'missing-model',
        path: ctx.pathPrefix,
        message: 'model 没有可放入的宽高',
        hint: '外包一层有宽高的 layer，例如 <layer x="220" y="80" width="200" height="200"><model src="hero.glb" /></layer>',
      })
    }
    return {
      node: laid,
      minMain: direction === 'row' ? laid.width : laid.height,
      minCross: direction === 'row' ? laid.height : laid.width,
      preferredMain: direction === 'row' ? laid.width : laid.height,
      preferredCross: direction === 'row' ? laid.height : laid.width,
      isText: false,
    }
  }
  if (isShapeTag(node.tag)) {
    const s = layoutShape(node, ctx, ctx.color)
    return {
      node: s,
      minMain: direction === 'row' ? s.width : s.height,
      minCross: direction === 'row' ? s.height : s.width,
      preferredMain: direction === 'row' ? s.width : s.height,
      preferredCross: direction === 'row' ? s.height : s.width,
      isText: false,
    }
  }
  if (node.tag === 'math') {
    const laid = layoutMath(node, ctx, direction === 'row' ? crossAlign : undefined)
    return {
      node: laid,
      minMain: direction === 'row' ? laid.width : laid.height,
      minCross: direction === 'row' ? laid.height : laid.width,
      preferredMain: direction === 'row' ? laid.width : laid.height,
      preferredCross: direction === 'row' ? laid.height : laid.width,
      isText: false,
    }
  }
  if (node.tag === 'layer') {
    const nested = layoutLayer(node, ctx)
    return {
      node: nested,
      minMain: direction === 'row' ? nested.width : nested.height,
      minCross: direction === 'row' ? nested.height : nested.width,
      preferredMain: direction === 'row' ? nested.width : nested.height,
      preferredCross: direction === 'row' ? nested.height : nested.width,
      isText: false,
    }
  }
  const custom = layoutCustomDraw(node, ctx)
  if (custom) {
    return {
      node: custom,
      minMain: direction === 'row' ? custom.width : custom.height,
      minCross: direction === 'row' ? custom.height : custom.width,
      preferredMain: direction === 'row' ? custom.width : custom.height,
      preferredCross: direction === 'row' ? custom.height : custom.width,
      isText: false,
    }
  }
  ctx.issues.push({ level: 'warn', code: 'unknown-tag', path: ctx.pathPrefix, message: `未知标签 ${node.tag}` })
  return null
}

/** 边框盒顶部到对齐用的基线。文字用第一行，公式用自己的基线，其余用下边缘。 */
function contentBaseline(node: LayoutNode): number {
  if (node.kind === 'flex' && node.baseline != null) return node.baseline
  const edge = node.padding.top + (node.border?.width ?? 0)
  if (node.kind === 'text') {
    const line = node.textLayout.lines[0]
    return line ? edge + line.baselineY : node.height
  }
  if (node.kind === 'flex' && node.children.length > 0) {
    const first = node.children[0]!
    return edge + first.y + contentBaseline(first)
  }
  return node.height
}

/**
 * 横排里写了 baseline 的子项，按第一行基线对齐。
 * Yoga 先把它们排在行的起点，这里再挪。行被撑高时，后面的行一起下移。
 */
function alignFlexBaselines(children: LayoutNode[], baseline: boolean[]) {
  const originY = children.map((child) => child.y)
  const groups: number[][] = []
  for (let i = 0; i < children.length; i++) {
    if (!baseline[i]) continue
    const y = originY[i]!
    const group = groups.find((indices) => Math.abs(originY[indices[0]!]! - y) < 1)
    if (group) group.push(i)
    else groups.push([i])
  }
  groups.sort((a, b) => originY[a[0]!]! - originY[b[0]!]!)

  const growths: Array<{ bottom: number; extra: number }> = []
  let carried = 0
  for (const group of groups) {
    const top = Math.min(...group.map((i) => originY[i]!)) + carried
    const lineAscent = Math.max(...group.map((i) => contentBaseline(children[i]!)))
    const originBottom = Math.max(...group.map((i) => originY[i]! + children[i]!.height))
    for (const i of group) {
      const ascent = contentBaseline(children[i]!)
      children[i]!.y = top + (lineAscent - ascent)
    }
    const newBottom = Math.max(...group.map((i) => children[i]!.y + children[i]!.height))
    const extra = Math.max(0, newBottom - (originBottom + carried))
    growths.push({ bottom: originBottom, extra })
    carried += extra
  }

  for (let i = 0; i < children.length; i++) {
    if (baseline[i]) continue
    let push = 0
    for (const growth of growths) {
      if (originY[i]! >= growth.bottom - 1) push += growth.extra
    }
    children[i]!.y = originY[i]! + push
  }
}

function layoutFlex(node: FvgNode, ctx: LayoutContext): FlexLayoutNode {
  const style = parseStyle(node.attrs.style)
  const childCtx = inheritTextContext(ctx, node.tag, style)
  const direction = flexDirectionOf(style)
  const appearance = readHtmlAppearance(style)
  if (appearance.background) appearance.background = readPaint(appearance.background, 'transparent', ctx, 'background')
  const gap = parsePx(style.gap)
  const columnGap = parsePx(style['column-gap']) ?? gap ?? 0
  const rowGap = parsePx(style['row-gap']) ?? gap ?? 0
  const justify = mapJustify(style['justify-content'])
  const alignItems = mapAlign(style['align-items'])
  const wrapMode = mapWrap(style['flex-wrap'])
  const wrapping = wrapMode !== Wrap.NoWrap

  const fixedW = parsePx(style.width)
  const fixedH = parsePx(style.height)
  const childNodes = node.children.filter((c) => typeof c !== 'string') as FvgNode[]
  const measures: FlexMeasure[] = []
  for (let i = 0; i < childNodes.length; i++) {
    const ch = childNodes[i]!
    const path = nodePath(ctx.pathPrefix, ch.tag, i)
    track(ctx, path, ch)
    const selfAlign = parseStyle(ch.attrs.style)['align-self']?.trim().toLowerCase()
    const crossAlign = !selfAlign || selfAlign === 'auto' ? (style['align-items'] ?? 'center') : selfAlign
    const m = measureFlexChild(ch, { ...childCtx, pathPrefix: path }, direction, crossAlign)
    if (m) measures.push({ ...m, crossAlign })
  }

  let crossAvailable =
    direction === 'row'
      ? fixedH != null
        ? fixedH - appearance.padding.top - appearance.padding.bottom - (appearance.border?.width ?? 0) * 2
        : Math.max(0, ...measures.map((m) => m.preferredCross))
      : fixedW != null
        ? fixedW - appearance.padding.left - appearance.padding.right - (appearance.border?.width ?? 0) * 2
        : Math.min(
            ctx.maxContentWidth,
            Math.max(0, ...measures.map((m) => (Number.isFinite(m.preferredCross) ? m.preferredCross : 0))),
          )

  const Yoga = getYoga()
  const config = Yoga.Config.create()
  config.setUseWebDefaults(true)
  // Text children are re-laid out at their Yoga width; pixel rounding could shave off a fraction and force a wrap.
  config.setPointScaleFactor(0)
  const root = Yoga.Node.createWithConfig(config)
  root.setFlexDirection(direction === 'row' ? FlexDirection.Row : FlexDirection.Column)
  root.setFlexWrap(wrapMode)
  root.setJustifyContent(justify)
  root.setAlignItems(alignItems)
  root.setAlignContent(mapAlignContent(style['align-content']))
  if (columnGap > 0) root.setGap(Gutter.Column, columnGap)
  if (rowGap > 0) root.setGap(Gutter.Row, rowGap)

  const mainAvailable =
    direction === 'row'
      ? fixedW != null
        ? fixedW - appearance.padding.left - appearance.padding.right - (appearance.border?.width ?? 0) * 2
        : ctx.maxContentWidth
      : fixedH ?? 1e6

  if (direction === 'row') {
    root.setWidth(Math.max(0, mainAvailable))
    if (fixedH != null) root.setHeight(Math.max(0, crossAvailable))
    else if (!wrapping) root.setHeight(Math.max(0, crossAvailable === Infinity ? 0 : crossAvailable))
  } else {
    if (!wrapping || fixedW != null) root.setWidth(Math.max(0, crossAvailable))
    root.setHeight(Math.max(0, mainAvailable))
  }

  const yogaChildren: YogaNode[] = []
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i]!
    const childFvg = m.source ?? childNodes[i]!
    const chParsed = parseStyle(childFvg.attrs.style)
    const { grow, shrink } = parseFlexGrowShrink(chParsed, m.isText)
    const yn = Yoga.Node.createWithConfig(config)
    yn.setFlexGrow(grow)
    yn.setFlexShrink(shrink)
    yn.setFlexBasisAuto()
    yn.setAlignSelf(mapAlign(m.crossAlign ?? 'center'))
    const textSource = m.source
    const columnText = direction === 'column' && m.isText && textSource != null && m.node.kind === 'text'
    if (columnText) {
      const padX = m.node.padding.left + m.node.padding.right + (m.node.border?.width ?? 0) * 2
      const explicitW = parsePx(chParsed.width)
      const explicitH = parsePx(chParsed.height)
      const textPath = m.node.path
      yn.setMeasureFunc((width, widthMode) => {
        const limit = widthMode === MeasureMode.Undefined ? childCtx.maxContentWidth : Math.max(0, width - padX)
        const laid = layoutTextBox(textSource, { ...childCtx, pathPrefix: textPath, issues: [] }, limit)
        return {
          width: widthMode === MeasureMode.Exactly ? width : laid.width,
          height: explicitH ?? laid.height,
        }
      })
      if (explicitW != null) yn.setWidth(explicitW)
      if (explicitH != null) yn.setHeight(explicitH)
    } else if (direction === 'row') {
      yn.setWidth(m.preferredMain)
      yn.setHeight(m.preferredCross === Infinity ? m.preferredCross : m.preferredCross)
      yn.setMinWidth(m.minMain)
    } else {
      yn.setWidth(m.preferredCross === Infinity ? crossAvailable : m.preferredCross)
      yn.setHeight(m.preferredMain)
      yn.setMinWidth(m.isText ? m.minMain : 0)
    }
    yogaChildren.push(yn)
    root.insertChild(yn, yogaChildren.length - 1)
  }

  root.calculateLayout(undefined, undefined)

  const laidChildren: LayoutNode[] = []
  const slots: Array<{ height: number }> = []
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i]!
    const yn = yogaChildren[i]!
    const layout = yn.getComputedLayout()
    let child = m.node
    if (m.isText && child.kind === 'text') {
      const assignedW = layout.width
      const textSource = m.source ?? childNodes[i]!
      const innerW = assignedW - child.padding.left - child.padding.right - (child.border?.width ?? 0) * 2
      const re = layoutTextBox(textSource, { ...childCtx, pathPrefix: child.path }, innerW)
      re.x = layout.left
      re.y = layout.top
      if (layout.width > re.width + 0.5) re.width = layout.width
      if (layout.height > re.height + 0.5) re.height = layout.height
      child = re
    } else if (child.kind === 'image') {
      child = refitImageNode(child, layout.left, layout.top, layout.width, layout.height)
    } else {
      child = { ...child, x: layout.left, y: layout.top, width: layout.width, height: layout.height }
      if (child.kind === 'layer' || child.kind === 'flex') {
        // keep internal layout; stretch box only
      }
    }
    laidChildren.push(child)
    slots.push({ height: layout.height })
  }

  for (const yn of yogaChildren) yn.free()
  root.freeRecursive()
  config.free()

  if (direction === 'column') {
    let shift = 0
    for (let i = 0; i < laidChildren.length; i++) {
      const child = laidChildren[i]!
      child.y += shift
      const extra = child.height - slots[i]!.height
      if (extra > 0.5) shift += extra
    }
  } else if (measures.some((m) => isBaselineAlign(m.crossAlign))) {
    alignFlexBaselines(
      laidChildren,
      measures.map((m) => isBaselineAlign(m.crossAlign)),
    )
  }

  let contentW = 0
  let contentH = 0
  let minX = 0
  let minY = 0
  for (const child of laidChildren) {
    minX = Math.min(minX, child.x)
    minY = Math.min(minY, child.y)
    contentW = Math.max(contentW, child.x + child.width)
    contentH = Math.max(contentH, child.y + child.height)
  }

  const outer = outerFromContent(contentW, contentH, appearance.padding, appearance.border)
  const borderW = (appearance.border?.width ?? 0) * 2
  const innerW = fixedW != null ? fixedW - appearance.padding.left - appearance.padding.right - borderW : undefined
  const innerH = fixedH != null ? fixedH - appearance.padding.top - appearance.padding.bottom - borderW : undefined
  if (innerW != null && (minX < -1e-3 || contentW > innerW + 1e-3)) {
    ctx.issues.push({ level: 'warn', code: 'flex-overflow', path: ctx.pathPrefix, message: 'flex 内容超出写死的 width' })
  }
  if (innerH != null && (minY < -1e-3 || contentH > innerH + 1e-3)) {
    ctx.issues.push({ level: 'warn', code: 'flex-overflow', path: ctx.pathPrefix, message: 'flex 内容超出写死的 height' })
  }

  return {
    kind: 'flex',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x: 0,
    y: 0,
    width: fixedW ?? outer.width,
    height: fixedH ?? outer.height,
    ink: { x: appearance.padding.left, y: appearance.padding.top, width: contentW, height: contentH },
    ...appearance,
    direction,
    children: laidChildren,
    ...readEffects(style, ctx, solidPaint(appearance.background, ctx.color)),
    ...layoutDrawMeta(node, ctx),
  }
}

function layoutUse(node: FvgNode, ctx: LayoutContext): LayerLayoutNode | null {
  warnNestedMasks(node, ctx)
  const href = (node.attrs.href || node.attrs['xlink:href'] || '').trim()
  const id = href.startsWith('#') ? href.slice(1) : href
  if (!id) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'use 缺少 href',
      hint: '写成 <use href="#petal" x="120" y="80" />',
    })
    return null
  }
  const symbol = ctx.symbols.get(id)
  if (!symbol) {
    ctx.issues.push({
      level: 'warn',
      code: 'missing-symbol',
      path: ctx.pathPrefix,
      message: `找不到 symbol #${id}`,
      hint: `在 <layer> 下写 <symbol id="${id}">…</symbol>`,
    })
    return null
  }
  if (ctx.useStack.includes(id)) {
    ctx.issues.push({
      level: 'warn',
      code: 'symbol-cycle',
      path: ctx.pathPrefix,
      message: `symbol #${id} 引用了自己`,
      hint: '去掉循环的 use',
    })
    return null
  }
  const width = parseNumber(node.attrs.width) ?? parseNumber(symbol.attrs.width)
  const height = parseNumber(node.attrs.height) ?? parseNumber(symbol.attrs.height)
  const attrs: Record<string, string> = {}
  if (width != null) attrs.width = String(width)
  if (height != null) attrs.height = String(height)
  const laid = layoutLayer(
    { tag: 'layer', attrs, children: symbol.children },
    { ...ctx, useStack: [...ctx.useStack, id] },
  )
  const appearance = readAttrAppearance(node.attrs)
  // use 与 layer 一样不填背景；色块用 rect / HTML / <draw>
  appearance.background = undefined
  const effects = readEffects(node.attrs, ctx, solidPaint(appearance.border?.color, ctx.color))
  const filters = mergeFilters(laid.filters, effects.filters)
  return {
    ...laid,
    tag: 'use',
    id: node.attrs.id,
    path: ctx.pathPrefix,
    ...appearance,
    ...effects,
    ...(filters.length ? { filters } : {}),
    ...layoutDrawMeta(node, ctx),
  }
}

function placeInLayer(node: FvgNode, laid: LayoutNode) {
  if (usesOwnCoords(node, laid.kind)) return
  const html = isHtmlTag(node.tag)
  const x = html ? 0 : (parseNumber(node.attrs.x) ?? 0)
  const y = html ? 0 : (parseNumber(node.attrs.y) ?? 0)
  const anchor = html ? 'top-left' : readAnchor(node.attrs.anchor, 'top-left').anchor
  const tl = anchorTopLeft(x, y, laid.width, laid.height, anchor)
  laid.x = tl.x
  laid.y = tl.y
}

/** 把 mask 里的形状和图片排进 layer 的局部坐标。空的或全被忽略时不生效。 */
function layoutMask(maskNode: FvgNode, ctx: LayoutContext): LayoutNode[] | undefined {
  if (maskNode.attrs.style != null && maskNode.attrs.style.trim() !== '') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'mask 不使用 style',
      hint: '形状用属性写 fill、x、y 或 cx、cy；图片的宽高写在 img 的 style 上',
    })
  }
  const children = maskNode.children.filter((c) => typeof c !== 'string') as FvgNode[]
  const laid: LayoutNode[] = []
  for (let i = 0; i < children.length; i++) {
    const ch = children[i]!
    const path = nodePath(ctx.pathPrefix, ch.tag, i)
    track(ctx, path, ch)
    const sub: LayoutContext = { ...ctx, pathPrefix: path, fillDefault: '#ffffff' }
    if (!isMaskContentTag(ch.tag)) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-child',
        path,
        message: `mask 里不收 <${ch.tag}>`,
        hint: '改成 rect、circle、ellipse、polygon、path 或 img。没画到的地方会藏起来',
      })
      continue
    }
    ctx.issues.push(...checkChildAttrs(ch, 'layer', path))
    const node = isImageTag(ch.tag)
      ? layoutImage(ch, sub)
      : isShapeTag(ch.tag)
        ? layoutShape(ch, sub, ctx.color)
        : layoutLineNode(ch, sub, ctx.color)
    placeInLayer(ch, node)
    laid.push(node)
  }
  if (laid.length === 0) {
    ctx.issues.push({
      level: 'warn',
      code: 'empty-mask',
      path: ctx.pathPrefix,
      message: 'mask 里没有可用的形状或图片，没有生效',
      hint: '在里面写 rect、circle、ellipse、polygon、path 或 img',
    })
    return undefined
  }
  return laid
}

const measuredBoxes = new WeakMap<FvgNode, { width: number; height: number }>()

/** 量过的层用自己的宽度换行，和 canvas.create 同一次计算。没量过的层继续用父级的可用宽度。 */
/** 写了宽度的 layer 用这个宽度换行。宽高都写时再减去这一层的 safe，和量尺寸时同一条规则。 */
function contentWidthFor(node: FvgNode, fixedW: number | undefined, parentMax: number): number {
  if (fixedW == null) return parentMax
  const heightSet = node.attrs.height != null && node.attrs.height !== ''
  if (!heightSet) return fixedW
  const height = parseNumber(node.attrs.height) ?? fixedW
  const safe = parseSafe(node.attrs.safe, fixedW, height)
  return Math.max(0, fixedW - safe.left - safe.right)
}

function layoutGroup(node: FvgNode, ctx: LayoutContext): GroupLayoutNode {
  warnNestedMasks(node, ctx)
  const appearance = readAttrAppearance(node.attrs)
  const parsed = parseSvgTransform(node.attrs.transform)
  if (parsed.error) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `无法解析 transform: ${parsed.error}`,
      hint: '写成 translate、rotate、scale 或 matrix，例如 transform="translate(12,8)"',
    })
  }
  const inherited: LayoutContext = {
    ...ctx,
    paintFill: node.attrs.fill ?? ctx.paintFill,
    paintStroke: node.attrs.stroke ?? ctx.paintStroke,
  }
  const children: LayoutNode[] = []
  const childFvg = node.children.filter((c) => typeof c !== 'string') as FvgNode[]
  for (let i = 0; i < childFvg.length; i++) {
    const raw = childFvg[i]!
    const concrete = materialize(raw)
    const path = nodePath(ctx.pathPrefix, concrete.tag, i)
    track(ctx, path, raw)
    const sub: LayoutContext = { ...inherited, pathPrefix: path }
    const allowed =
      concrete.tag === 'g' || isLineTag(concrete.tag) || isShapeTag(concrete.tag)
    if (!allowed) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-child',
        path,
        message: `${concrete.tag} 不能放在 g 里`,
        hint: 'g 里写 rect、circle、ellipse、line、polyline、polygon、path、curve 或 g',
      })
      continue
    }
    ctx.issues.push(...checkChildAttrs(concrete, 'layer', path))
    const laid =
      concrete.tag === 'g'
        ? layoutGroup(concrete, sub)
        : isLineTag(concrete.tag)
          ? layoutLineNode(concrete, sub, ctx.color)
          : layoutShape(concrete, sub, ctx.color)
    children.push(laid)
  }
  let box = { x: 0, y: 0, width: 0, height: 0 }
  let any = false
  for (const child of children) {
    const next = boundsOf(parsed.matrix, { x: child.x, y: child.y, width: child.width, height: child.height })
    if (!any) {
      box = next
      any = true
    } else {
      const x = Math.min(box.x, next.x)
      const y = Math.min(box.y, next.y)
      const right = Math.max(box.x + box.width, next.x + next.width)
      const bottom = Math.max(box.y + box.height, next.y + next.height)
      box = { x, y, width: right - x, height: bottom - y }
    }
  }
  return {
    kind: 'group',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: 'g',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    ink: { x: 0, y: 0, width: box.width, height: box.height },
    ...appearance,
    children,
    svg: parsed.matrix,
    ...readEffects(node.attrs, ctx, solidPaint(node.attrs.fill ?? ctx.paintFill ?? ctx.color, ctx.color)),
    ...layoutDrawMeta(node, ctx),
  }
}

const VISIBLE_OPACITY = 0.01

function hasInkArea(b: Box): boolean {
  return b.width > 1e-3 && b.height > 1e-3
}

function addLocalInk(union: Box | null, box: Box | null): Box | null {
  if (!box || !hasInkArea(box)) return union
  return union ? unionBoxes(union, box) : box
}

/**
 * 把 node 的着墨变到 matrix 所在的坐标系。
 * matrix 把 node 的局部原点（自身 rotate / scale 之前）映射过去。
 * applyOwnTransform 为 false 时，不施加 node 自己的旋转和缩放。
 */
function accumulateInk(node: LayoutNode, parentOpacity: number, matrix: typeof IDENTITY, applyOwnTransform: boolean): Box | null {
  const opacity = parentOpacity * node.opacity
  if (opacity < VISIBLE_OPACITY) return null
  const origin = originOffset(node.origin, node.width, node.height)
  const m =
    applyOwnTransform && (node.rotate !== 0 || node.scaleX !== 1 || node.scaleY !== 1)
      ? multiply(matrix, aroundPivot(origin.x, origin.y, node.rotate, node.scaleX, node.scaleY))
      : matrix

  if (node.kind === 'layer' || node.kind === 'flex') {
    let union: Box | null = null
    if ((node.background && node.background !== 'transparent') || (node.border && node.border.width > 0)) {
      union = addLocalInk(union, applyToBox(m, { x: 0, y: 0, width: node.width, height: node.height }))
    }
    const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
    const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
    const childBase = multiply(m, translated(insetX, insetY))
    for (const child of node.children) {
      union = addLocalInk(union, accumulateInk(child, opacity, multiply(childBase, translated(child.x, child.y)), true))
    }
    if (node.kind === 'layer' && node.overflow === 'hidden' && union) {
      union = intersectBox(union, applyToBox(m, { x: 0, y: 0, width: node.width, height: node.height }))
      if (!hasInkArea(union)) return null
    }
    return union
  }
  return hasInkArea(node.ink) ? applyToBox(m, node.ink) : null
}

/** 子树着墨，坐标系是 node 自身、且在 node 的 rotate / scale 之前。 */
function inkInLocal(node: LayoutNode, parentOpacity: number): Box | null {
  return accumulateInk(node, parentOpacity, IDENTITY, false)
}

function maxTextFontSize(node: LayoutNode): number {
  if (node.kind === 'text') return node.textLayout.fontSize
  if (node.kind !== 'layer' && node.kind !== 'flex') return 0
  let max = 0
  for (const child of node.children) max = Math.max(max, maxTextFontSize(child))
  return max
}

type AnchorBoxMode = 'ink' | 'box' | 'absent'

function parseAnchorBox(raw: string | undefined, issues: Issue[], path: string): AnchorBoxMode {
  if (raw == null || raw.trim() === '') return 'absent'
  const value = raw.trim().toLowerCase()
  if (value === 'ink' || value === 'box') return value
  issues.push({
    level: 'warn',
    code: 'invalid-attr',
    path,
    message: `无法解析 anchor-box: ${raw}`,
    hint: '写成 anchor-box="ink" 或 anchor-box="box"',
  })
  return 'box'
}

function anchorTouchesSide(anchor: Anchor): 'left' | 'right' | null {
  if (anchor === 'left' || anchor === 'top-left' || anchor === 'bottom-left') return 'left'
  if (anchor === 'right' || anchor === 'top-right' || anchor === 'bottom-right') return 'right'
  return null
}

function maybeInkInset(node: LayoutNode, anchor: Anchor, ctx: LayoutContext) {
  const side = anchorTouchesSide(anchor)
  if (!side || (node.kind !== 'layer' && node.kind !== 'flex')) return
  const fontSize = maxTextFontSize(node)
  if (fontSize <= 0) return
  const ink = inkInLocal(node, 1)
  if (!ink) return
  const inset = side === 'left' ? ink.x : node.width - (ink.x + ink.width)
  if (Math.round(inset) < 2 || inset < fontSize * 0.04) return
  const where = side === 'left' ? '左' : '右'
  ctx.issues.push({
    level: 'info',
    code: 'ink-inset',
    path: node.path,
    message: `字形比盒子靠里 ${Math.round(inset)}px（${where}）`,
    hint: '想让笔画贴齐 x，写 anchor-box="ink"',
  })
}

function applyInkAnchor(node: LayoutNode, x: number, y: number, anchor: Anchor, ctx: LayoutContext) {
  const ink = inkInLocal(node, 1)
  if (!ink) {
    ctx.issues.push({
      level: 'info',
      code: 'ink-anchor-empty',
      path: node.path,
      message: '子树没有着墨，已按布局盒子定位',
      hint: '空文字或全透明时 anchor-box="ink" 会退回 box',
    })
    return
  }
  const topLeft = anchorTopLeft(x, y, ink.width, ink.height, anchor)
  node.x = topLeft.x - ink.x
  node.y = topLeft.y - ink.y
  node.anchorBox = 'ink'
  node.inkOffset = {
    left: ink.x,
    top: ink.y,
    right: node.width - (ink.x + ink.width),
    bottom: node.height - (ink.y + ink.height),
  }
  if (node.rotate !== 0) {
    ctx.issues.push({
      level: 'info',
      code: 'ink-anchor-rotate',
      path: node.path,
      message: '对齐点是旋转前的着墨',
      hint: 'origin 仍按布局盒子计算，旋转不会改 anchor-box 的对齐点',
    })
  }
}

function readLayerView(node: FvgNode, layerW: number, layerH: number, ctx: LayoutContext) {
  const raw = node.attrs.view
  if (raw == null || raw.trim() === '') return undefined
  const widthSet = node.attrs.width != null && node.attrs.width.trim() !== ''
  const heightSet = node.attrs.height != null && node.attrs.height.trim() !== ''
  if (!widthSet || !heightSet || !(layerW > 0) || !(layerH > 0)) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'view 需要这一层写 width 和 height',
      hint: 'width 和 height 是屏幕上的取景窗，view="x y w h" 是舞台上被取的那一块',
    })
    return undefined
  }
  const parsed = parseView(raw)
  if (!parsed) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `无法解析 view: ${raw}`,
      hint: '写成四个数 view="x y w h"，宽和高要大于 0',
    })
    return undefined
  }
  const fitted = fitViewAspect(parsed, layerW, layerH)
  if (fitted.adjusted) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'view 的宽高比和取景窗不一致，已按宽度保持中心重算高度',
      hint: `取景窗是 ${formatSize(layerW)}×${formatSize(layerH)}，view 现为 ${formatSize(fitted.view.x)} ${formatSize(fitted.view.y)} ${formatSize(fitted.view.width)} ${formatSize(fitted.view.height)}`,
    })
  }
  return fitted.view
}

function layoutLayer(node: FvgNode, ctx: LayoutContext): LayerLayoutNode {
  if (ctx.pathPrefix === 'layer') ctx.issues.push(...originValueIssues(node.attrs.origin, ctx.pathPrefix))
  const appearance = readAttrAppearance(node.attrs)
  // 根节点的 background 是画布底色，由 paintDocument 绘制。layer 自身不填色。
  appearance.background = undefined
  const fixedW = parseNumber(node.attrs.width)
  const fixedH = parseNumber(node.attrs.height)
  const layerCtx = withLayerText(ctx, node)

  const childFvg = node.children.filter((c) => typeof c !== 'string') as FvgNode[]
  let chosenMask: FvgNode | undefined
  let chosenMaskPath = ''
  for (let i = 0; i < childFvg.length; i++) {
    const ch = childFvg[i]!
    if (ch.tag !== 'mask') continue
    const path = nodePath(ctx.pathPrefix, ch.tag, i)
    track(ctx, path, ch)
    if (!chosenMask) {
      chosenMask = ch
      chosenMaskPath = path
    } else {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-child',
        path,
        message: '一层只能有一个 mask，多出来的已忽略',
        hint: '把形状写进同一个 <mask>',
      })
    }
  }
  const placed: Array<{
    child: LayoutNode
    x: number
    y: number
    anchor: Anchor
    anchorBox: AnchorBoxMode
    coords: boolean
  }> = []

  for (let i = 0; i < childFvg.length; i++) {
    const ch = childFvg[i]!
    if (ch.tag === 'symbol' || ch.tag === 'draw' || ch.tag === 'mask') {
      if (ch.tag === 'symbol') track(ctx, nodePath(ctx.pathPrefix, ch.tag, i), ch)
      continue
    }
    if (ch.tag.toLowerCase() === FONT_TAG) {
      const path = nodePath(ctx.pathPrefix, ch.tag, i)
      track(ctx, path, ch)
      if (ctx.pathPrefix !== 'layer') warnMisplacedFont(ctx, path)
      continue
    }
    const concrete = materialize(ch)
    const path = nodePath(ctx.pathPrefix, concrete.tag, i)
    track(ctx, path, ch)
    ctx.issues.push(...checkChildAttrs(concrete, 'layer', path))
    const textMax = contentWidthFor(node, fixedW, layerCtx.maxContentWidth)
    const subCtx = { ...layerCtx, pathPrefix: path, maxContentWidth: textMax }
    const laidSource = prepareHtmlBox(concrete)
    let laid: LayoutNode | null = null
    if (laidSource.tag === 'use') laid = layoutUse(laidSource, subCtx)
    else if (laidSource.tag === 'g') laid = layoutGroup(laidSource, subCtx)
    else if (isLineTag(laidSource.tag)) laid = layoutLineNode(laidSource, subCtx, ctx.color)
    else if (isDisplayFlex(laidSource.attrs.style) && isTextBoxTag(laidSource.tag)) laid = layoutFlex(laidSource, subCtx)
    else if (isImageTag(laidSource.tag)) laid = layoutImage(laidSource, subCtx)
    else if (isTextBoxTag(laidSource.tag)) laid = layoutTextBox(laidSource, subCtx, textMax)
    else if (isShapeTag(laidSource.tag)) laid = layoutShape(laidSource, subCtx, ctx.color)
    else if (isMeshTag(laidSource.tag)) laid = layoutMesh(laidSource, subCtx)
    else if (laidSource.tag === 'layer') laid = layoutLayer(laidSource, subCtx)
    else if (laidSource.tag === 'math') laid = layoutMath(laidSource, subCtx)
    else {
      laid = layoutUnknownOrCustom(laidSource, subCtx)
    }
    if (!laid) continue
    const html = isHtmlTag(concrete.tag)
    placed.push({
      child: laid,
      x: html ? 0 : (parseNumber(ch.attrs.x) ?? 0),
      y: html ? 0 : (parseNumber(ch.attrs.y) ?? 0),
      anchor: html ? 'top-left' : anchorOf(ch.attrs.anchor, { ...ctx, pathPrefix: path }, concrete.tag),
      anchorBox: html ? 'absent' : parseAnchorBox(ch.attrs['anchor-box'], ctx.issues, path),
      coords: usesOwnCoords(ch, laid.kind),
    })
  }

  const positionOne = (p: (typeof placed)[0]) => {
    if (p.coords) return
    const tl = anchorTopLeft(p.x, p.y, p.child.width, p.child.height, p.anchor)
    p.child.x = tl.x
    p.child.y = tl.y
    if (p.child.kind !== 'layer') return
    if (p.anchorBox === 'ink') applyInkAnchor(p.child, p.x, p.y, p.anchor, ctx)
    else if (p.anchorBox === 'absent') maybeInkInset(p.child, p.anchor, ctx)
  }
  for (const p of placed) positionOne(p)

  // 原点固定在左上角。没写宽高时，大小等于从原点到子元素右下角。负坐标可以画出盒子，但不会把其他子元素一起平移。
  let maxRight = 0
  let maxBottom = 0
  for (const p of placed) {
    maxRight = Math.max(maxRight, p.child.x + p.child.width)
    maxBottom = Math.max(maxBottom, p.child.y + p.child.height)
  }
  const layerW = fixedW != null && fixedW > 0 ? fixedW : Math.max(0, maxRight)
  const layerH = fixedH != null && fixedH > 0 ? fixedH : Math.max(0, maxBottom)
  noteMeasureMismatch(node, layerW, layerH, ctx)

  for (const p of placed) {
    const child = p.child
    if (child.kind !== 'mesh' || child.mesh.type !== 'model') continue
    if (layerW > 0 && layerH > 0) {
      child.width = layerW
      child.height = layerH
      child.ink = { x: 0, y: 0, width: layerW, height: layerH }
      child.x = 0
      child.y = 0
    } else {
      ctx.issues.push({
        level: 'warn',
        code: 'missing-model',
        path: child.path,
        message: 'model 没有可放入的宽高',
        hint: '外包一层有宽高的 layer，例如 <layer x="220" y="80" width="200" height="200"><model src="hero.glb" /></layer>',
      })
    }
  }

  const children = placed.map((p) => p.child)

  const overlay = readLayerOverlay(node.attrs, ctx)
  const layerFilters = readLayerFilters(node.attrs, ctx)
  let perspective: number | undefined
  const perspectiveRaw = node.attrs.perspective
  if (perspectiveRaw != null && perspectiveRaw.trim() !== '') {
    const parsed = parseNumber(perspectiveRaw)
    if (parsed == null || parsed <= 0) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: `无法解析 perspective: ${perspectiveRaw}`,
        hint: '写成像素视距，例如 perspective="900"',
      })
    } else {
      perspective = parsed
    }
  }
  const mask = chosenMask
    ? layoutMask(chosenMask, { ...ctx, pathPrefix: chosenMaskPath })
    : undefined
  if (node.attrs.mask != null && node.attrs.mask.trim() !== '') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: '遮罩要写成 <mask> 标签，不要写成属性',
      hint: '在 layer 里写 <mask><circle cx="160" cy="90" r="90" /></mask>',
    })
  }
  const styleMask = parseStyle(node.attrs.style).mask
  if (styleMask != null && styleMask.trim() !== '') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'mask 不要写在 style 里',
      hint: '在 layer 里写 <mask>…</mask>，不要写进 style',
    })
  }
  const effects = readEffects(node.attrs, ctx, solidPaint(appearance.border?.color, ctx.color))
  const filters = mergeFilters(effects.filters, layerFilters.filters)
  let view = readLayerView(node, layerW, layerH, ctx)
  if (view && perspective != null) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'view 和 perspective 不要写在同一层',
      hint: '镜头写在外层 <layer view="x y w h">，perspective 写在里面的舞台上',
    })
    view = undefined
  }
  if (view && viewExceeds(view, children)) {
    ctx.issues.push({
      level: 'error',
      code: 'view-outside',
      path: ctx.pathPrefix,
      message: 'view 超出了舞台',
      hint: '把 view 收到子元素转完、缩完的范围内，或把舞台加大。取景窗没被盖住时，成片会露底',
    })
  }
  const laid: LayerLayoutNode = {
    kind: 'layer',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x: 0,
    y: 0,
    width: layerW,
    height: layerH,
    ink: emptyBox(),
    ...appearance,
    children,
    overflow: node.attrs.overflow === 'hidden' ? 'hidden' : 'visible',
    ...(view ? { view } : {}),
    ...(perspective != null ? { perspective } : {}),
    ...(mask ? { mask } : {}),
    ...effects,
    ...(overlay ? { overlay } : {}),
    ...layerFilters,
    ...(filters.length ? { filters } : {}),
    ...layoutDrawMeta(node, ctx),
  }
  laid.ink = inkInLocal(laid, 1) ?? emptyBox()
  return laid
}

function noteAttrTypos(node: FvgNode, path: string, issues: Issue[]) {
  const concrete = materialize(node)
  issues.push(...typoAttrIssues(concrete, path))
  issues.push(...hiddenAttrIssues(concrete, path))
  if (isHtmlTag(concrete.tag) || isTextBoxTag(concrete.tag)) issues.push(...styleIssues(concrete, path))
  let index = 0
  for (const child of concrete.children) {
    if (typeof child === 'string') continue
    noteAttrTypos(child, `${path}/${child.tag}[${index}]`, issues)
    index += 1
  }
}

function collectSymbols(node: FvgNode, symbols: Map<string, FvgNode>, issues: Issue[], path: string) {
  if (node.tag === 'symbol') {
    const id = node.attrs.id?.trim()
    if (!id) {
      issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path,
        message: 'symbol 缺少 id',
        hint: '写成 <symbol id="petal">…</symbol>',
      })
    } else if (symbols.has(id)) {
      issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path,
        message: `symbol id 重复: ${id}`,
        hint: '每个 id 只定义一次',
      })
    } else symbols.set(id, node)
  }
  node.children.forEach((child, index) => {
    if (typeof child !== 'string') collectSymbols(child, symbols, issues, `${path}/${child.tag}[${index}]`)
  })
}

function collectFontDecls(node: FvgNode, out: Array<{ family: string; src: string }>) {
  const concrete = materialize(node)
  const font = fontDecl(concrete)
  if (font?.family && font.src) out.push(font)
  for (const child of concrete.children) {
    if (typeof child !== 'string') collectFontDecls(child, out)
  }
}

/** 这一层实际会拿来排文字的字体名。 */
export function fontFamiliesOf(node: FvgNode): string[] {
  const out = new Set<string>()
  const visit = (current: FvgNode) => {
    const concrete = materialize(current)
    const add = (raw: string | undefined) => {
      const name = primaryFontFamily(raw)
      if (name) out.add(name)
    }
    add(concrete.attrs['font-family'])
    add(parseStyle(concrete.attrs.style)['font-family'])
    if (symbolsClassOf(classAttr(concrete.attrs))) out.add(ICON_FONT_FAMILY)
    for (const child of concrete.children) {
      if (typeof child !== 'string') visit(child)
    }
  }
  visit(node)
  return [...out]
}

function collectFontFamilies(node: FvgNode, out: Set<string>) {
  const concrete = materialize(node)
  const style = parseStyle(concrete.attrs.style)
  if (style['font-family']) out.add(style['font-family'])
  if (concrete.attrs['font-family']) out.add(concrete.attrs['font-family'])
  if (symbolsClassOf(classAttr(concrete.attrs))) out.add(ICON_FONT_FAMILY)
  for (const child of concrete.children) {
    if (typeof child !== 'string') collectFontFamilies(child, out)
  }
}

function collectImageSrcs(node: FvgNode, out: string[]) {
  const concrete = materialize(node)
  if ((concrete.tag === 'img' || concrete.tag === 'image') && concrete.attrs.src?.trim()) out.push(concrete.attrs.src)
  for (const child of concrete.children) {
    if (typeof child !== 'string') collectImageSrcs(child, out)
  }
}

/** canvas.create 量到的布局尺寸。最终排版不一致时报 measure-mismatch。 */
export function noteMeasuredSize(node: FvgNode, width: number, height: number) {
  measuredBoxes.set(node, { width, height })
}

function formatSize(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function noteMeasureMismatch(node: FvgNode, width: number, height: number, ctx: LayoutContext) {
  const expected = measuredBoxes.get(node)
  if (!expected) return
  if (Math.abs(expected.width - width) <= 0.5 && Math.abs(expected.height - height) <= 0.5) return
  ctx.issues.push({
    level: 'warn',
    code: 'measure-mismatch',
    path: ctx.pathPrefix,
    message: `排版尺寸 ${formatSize(width)}×${formatSize(height)} 和量到的 ${formatSize(expected.width)}×${formatSize(expected.height)} 不一致`,
    hint: '量的时候和最终画布的可用宽度要一致。检查 width、safe 和字号',
  })
}

export type MeasureEnv = {
  baseDir: string
  color: string
  fontFamily: string
  maxContentWidth: number
}

/** 同步量一个 layer。字体、图片和 Yoga 需要先准备好。 */
export function measureLayer(node: FvgNode, env: MeasureEnv): { laid: LayerLayoutNode; issues: Issue[] } {
  const issues: Issue[] = []
  const symbols = new Map<string, FvgNode>()
  collectSymbols(node, symbols, issues, 'layer')
  noteAttrTypos(node, 'layer', issues)
  attachDrawTags(node, issues, 'layer')
  const ctx: LayoutContext = {
    color: env.color,
    fontFamily: env.fontFamily,
    maxContentWidth: env.maxContentWidth,
    issues,
    pathPrefix: 'layer',
    symbols,
    useStack: [],
    baseDir: env.baseDir,
    sources: new Map(),
  }
  track(ctx, 'layer', node)
  const laid = layoutLayer(node, ctx)
  return { laid, issues }
}

export type LayoutAssets = {
  baseDir: string
}

export type PrepareOptions = {
  /** 写在根外面的 <font> */
  fonts?: Array<{ family: string; src: string }>
  /** 预先加载的图。写在 layer 里的图会在 create 时自动准备 */
  images?: string[]
  fontFamily?: string
  /** 把嵌套 layer 里的 <font> 也注册。canvas.create 量尺寸时需要。 */
  nestedFonts?: boolean
}

/** 准备字体、图片和 Yoga，并在这个进程里记住。已经备过的直接跳过。 */
export function prepareAssetsSync(root: FvgNode | null, baseDir: string, options: PrepareOptions = {}): LayoutAssets {
  getYoga()
  const fontNodes = [...(options.fonts ?? [])]
  if (root) {
    if (options.nestedFonts) collectFontDecls(root, fontNodes)
    else {
      for (const child of root.children) {
        if (typeof child === 'string') continue
        const font = fontDecl(child)
        if (font) fontNodes.push(font)
      }
    }
  }
  registerFontsFromDocumentSync(
    fontNodes.filter((font) => font.family && font.src),
    baseDir,
  )
  const families = new Set<string>([options.fontFamily ?? root?.attrs['font-family'] ?? 'ChillDuanSans'])
  if (root) collectFontFamilies(root, families)
  ensureBuiltinFontsSync(families)
  const srcs = [...(options.images ?? [])]
  if (root) collectImageSrcs(root, srcs)
  preloadLayerImagesSync(srcs, baseDir)
  return { baseDir }
}

/** 异步外壳。实际准备是同步的，同一进程里多帧接着用，不会重新开始。 */
export async function prepareAssets(root: FvgNode | null, baseDir: string, options: PrepareOptions = {}): Promise<LayoutAssets> {
  return prepareAssetsSync(root, baseDir, options)
}

export function readLayerRoot(source: string | FvgNode): { root: FvgNode; fonts: Array<{ family: string; src: string }> } {
  const nodes = typeof source === 'string' ? parseFvg(source) : [source]
  for (const node of nodes) canonicalizeTree(node)
  const fonts: Array<{ family: string; src: string }> = []
  let root: FvgNode | null = null
  for (const node of nodes) {
    const font = fontDecl(node)
    if (font) fonts.push(font)
    else if (!root) root = node
  }
  if (!root) throw new Error('Flex Layer 缺少根元素 <layer>')
  return { root, fonts }
}

/** 同步排版。字体、图片和 Yoga 由 prepareAssetsSync 记住，多帧不会重新准备。 */
export function layoutSync(rootNode: FvgNode, assets: LayoutAssets): FvgDocument {
  const baseDir = assets.baseDir
  const attrs = rootNode.attrs
  const width = parseNumber(attrs.width) ?? 1080
  const height = parseNumber(attrs.height) ?? 1920
  const color = attrs.color ?? '#111111'
  const fontFamily = attrs['font-family'] ?? 'ChillDuanSans'
  const safe = parseSafe(attrs.safe, width, height)
  const maxContentWidth = width - safe.left - safe.right

  const issues: Issue[] = []
  const sources = new Map<string, string>()
  const symbols = new Map<string, FvgNode>()
  collectSymbols(rootNode, symbols, issues, 'layer')
  noteAttrTypos(rootNode, 'layer', issues)
  if (attrs.style?.trim()) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: 'layer',
      message: 'layer 和图形不使用 style',
      hint: '把 width、opacity 写成属性。色块用 rect / HTML / <draw>',
    })
  }
  if (rootNode.tag !== 'layer') {
    throw new Error(`Flex Layer 根元素必须是 <layer>，收到 <${rootNode.tag}>`)
  }
  noteTagSpellings(rootNode, 'layer', issues)
  noteStructuredData(rootNode, 'layer', issues)
  issues.push(...legacyCenterIssues(rootNode, 'layer'))
  attachDrawTags(rootNode, issues, 'layer')
  const paintCtx: LayoutContext = {
    color,
    fontFamily,
    maxContentWidth,
    issues,
    pathPrefix: 'layer',
    symbols,
    useStack: [],
    baseDir,
    sources,
  }
  track(paintCtx, 'layer', rootNode)
  // 没写 background 时不铺底色，PNG 里空出来的像素保持透明。
  const rawBackground = attrs.background?.trim() ?? ''
  const background = rawBackground ? readPaint(rawBackground, '#ffffff', paintCtx, 'background') : 'transparent'
  const root = layoutLayer(rootNode, paintCtx)

  root.width = width
  root.height = height
  issues.push(...perspectiveIssues(root))

  if (attrs.bleed != null) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: 'layer',
      message: 'bleed 已不再使用',
      hint: '舞台写得比成片大，用 view="x y w h" 取出要出的那一块',
    })
  }

  return { width, height, background, color, fontFamily, safe, root, issues, sources }
}

function canonicalizeTree(node: FvgNode): void {
  const next = canonicalTag(node.tag)
  if (next !== node.tag) {
    node.writtenTag ??= node.tag
    node.tag = next
  }
  for (const child of node.children) {
    if (typeof child !== 'string') canonicalizeTree(child)
  }
}

/** 对象属性不能塞进字符串。`data` 解析失败是 error。 */
function noteStructuredData(node: FvgNode, path: string, issues: Issue[]): void {
  for (const name of node.badAttrs ?? []) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path,
      message: `属性 ${name} 是对象或数组，不能写成字符串`,
      hint: '结构化数据放进 data',
    })
  }
  if (node.dataError != null) {
    issues.push({
      level: 'error',
      code: 'invalid-attr',
      path,
      message: 'data 不是合法的 JSON',
      hint: `写成 data='{"values":[3,5,8]}'`,
    })
  }
  let index = 0
  for (const child of node.children) {
    if (typeof child === 'string') continue
    noteStructuredData(child, `${path}/${child.tag}[${index}]`, issues)
    index++
  }
}

/** 源码里写了大写标签时记一条 info，渲染仍用规范小写。 */
function noteTagSpellings(node: FvgNode, path: string, issues: Issue[]): void {
  if (node.writtenTag && node.writtenTag !== node.tag) {
    issues.push({
      level: 'info',
      code: 'non-canonical',
      path,
      message: `标签 <${node.writtenTag}> 应写成 <${node.tag}>`,
      hint: `改成 <${node.tag}>`,
    })
  }
  let index = 0
  for (const child of node.children) {
    if (typeof child === 'string') continue
    noteTagSpellings(child, `${path}/${child.tag}[${index}]`, issues)
    index++
  }
}

export async function layoutSource(source: string | FvgNode, baseDir: string): Promise<FvgDocument> {
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  return layoutSync(opened.root, assets)
}

export type { FvgDocument }
