import { Path2D } from '@napi-rs/canvas'
import {
  Align,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  type Node as YogaNode,
} from 'yoga-layout/load'
import { attachDrawTags } from './draw-tag.js'
import { parseGrade } from './grade.js'
import { parseColor } from './gradientField.js'
import { imageInk, loadLayerImage, parseObjectFit, parseObjectPosition } from './image.js'
import type { FvgNode } from './parse.js'
import { parseFvg } from './parse.js'
import { ensureBuiltinFonts, registerFontsFromDocument } from './fonts.js'
import { catmullRomPath } from './curve.js'
import { isGradient, parseGradient, solidPaint } from './gradient.js'
import { resolveModelFile } from './glb.js'
import { translateSvgPath } from './path.js'
import { perspectiveIssues } from './perspective.js'
import {
  parseBlend,
  parseBlurRadius,
  parseBorder,
  parseColorFilter,
  parseEdges,
  parseFontWeight,
  parseGlass,
  parseGlow,
  parseNoise,
  parseNumber,
  parseOverlay,
  parsePx,
  parseShadow,
  parseStyle,
  ZERO_EDGES,
  type Edges,
} from './style.js'
import {
  defaultFontSizeForTag,
  defaultFontWeightForTag,
  extractTextSegments,
  isTextBoxTag,
  layoutText,
} from './text.js'
import { checkChildAttrs, checkTextBoxChildren, hasTwoPoint, isDisplayFlex, isHtmlTag, rowColumnHint } from './rules.js'
import { canonicalTag, FONT_TAG, isImageTag, isLineTag, isMaskContentTag, isMeshTag, isShapeTag } from './tags.js'
import type {
  Anchor,
  Box,
  CustomLayoutNode,
  DrawComputedStyle,
  FlexLayoutNode,
  FvgDocument,
  ImageLayoutNode,
  Issue,
  LayerLayoutNode,
  LayoutNode,
  BlendMode,
  ColorFilterSpec,
  GlassSpec,
  GlowSpec,
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
import { emptyBox, translateBox, unionBoxes } from './types.js'
import { ensureYoga } from './yoga.js'

export type LayoutContext = {
  color: string
  fontFamily: string
  maxContentWidth: number
  issues: Issue[]
  pathPrefix: string
  symbols: Map<string, FvgNode>
  useStack: string[]
  /** 解析 img 的相对路径。 */
  baseDir: string
  /** 设了之后，省略的 fill 用这个值，省略的 stroke 为 none。mask 里用 #ffffff。 */
  fillDefault?: string
}

function isClosedFlag(raw: string | undefined): boolean {
  if (raw == null) return false
  const text = raw.trim().toLowerCase()
  return text !== 'false' && text !== '0' && text !== 'no'
}

function parseAnchor(raw: string | undefined): Anchor {
  const v = (raw ?? 'center').trim().toLowerCase() as Anchor
  const allowed: Anchor[] = [
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ]
  return allowed.includes(v) ? v : 'center'
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

function parseSafe(raw: string | undefined, w: number, h: number): Edges {
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

const DEFAULT_SHADOW_COLOR = '#00000066'

type EffectFields = {
  shadow?: ShadowSpec
  glow?: GlowSpec
  innerShadow?: ShadowSpec
  innerGlow?: GlowSpec
  blur?: number
  backdropBlur?: number
  noise?: NoiseSpec
  glass?: GlassSpec
  colorFilter?: ColorFilterSpec[]
  blend?: BlendMode
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

  const filterRaw = src.filter
  const parsedFilter = parseColorFilter(filterRaw)
  if (parsedFilter) out.colorFilter = parsedFilter
  else if (filterRaw && filterRaw.trim() !== 'none') {
    warnInvalid(
      ctx,
      'filter',
      filterRaw,
      '写成 brightness(1.1) contrast(1.2) saturate(0.8) grayscale(0.2) hue-rotate(15) sepia(0.1) invert(0)，不要写 blur/drop-shadow',
    )
  }

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

/** 仅 layer：解析 grade 与 grade-mask。 */
function readLayerGrade(attrs: Record<string, string>, ctx: LayoutContext): { grade?: GradeSpec; gradeMask?: string } {
  const parsed = parseGrade(attrs.grade)
  const maskRaw = attrs['grade-mask']?.trim()
  if (parsed && 'error' in parsed) {
    warnInvalid(
      ctx,
      'grade',
      attrs.grade!,
      `${parsed.error}。写成 lomo 0.8, fade 0.1，或 shadows #2a6080, highlights #ffd8a8, contrast 1.1, vignette 0.4`,
    )
  }
  const grade = parsed && 'spec' in parsed ? parsed.spec : undefined
  if (!maskRaw || maskRaw === 'none') return grade ? { grade } : {}
  if (!grade) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: '写了 grade-mask 但没有可用的 grade',
      hint: '和 grade 一起写，例如 <layer grade="lomo" grade-mask="radial-gradient(#fff0 30%, #fff)">',
    })
    return {}
  }
  if (isGradient(maskRaw) ? !parseGradient(maskRaw) : !parseColor(maskRaw)) {
    warnInvalid(ctx, 'grade-mask', maskRaw, '写成 linear-gradient(to right, #fff, #fff0)、radial-gradient(#fff0 30%, #fff) 或 gradient(...)；alpha 是强度')
    return { grade }
  }
  return { grade, gradeMask: maskRaw }
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
    scale: parseNumber(style.scale) ?? 1,
    origin: parseAnchor(style.origin),
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
    scale: parseNumber(attrs.scale) ?? 1,
    origin: parseAnchor(attrs.origin),
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

function computeDrawStyle(node: FvgNode, ctx: LayoutContext, style: Record<string, string>): DrawComputedStyle {
  const tag = node.tag.toLowerCase()
  const fontSize =
    parsePx(style['font-size']) ?? (isTextBoxTag(node.tag) ? defaultFontSizeForTag(tag) : 40)
  const fontWeight =
    parseFontWeight(style['font-weight']) ?? (isTextBoxTag(node.tag) ? defaultFontWeightForTag(tag) : 400)
  const fontFamily = style['font-family']?.trim() || ctx.fontFamily
  const color = style.color ?? ctx.color
  const opacity = isHtmlTag(node.tag) ? parseNumber(style.opacity) ?? 1 : parseNumber(node.attrs.opacity) ?? 1
  return { color, fontFamily, fontSize, fontWeight, opacity }
}

function layoutDrawMeta(node: FvgNode, ctx: LayoutContext) {
  const style = parseStyle(node.attrs.style)
  return {
    draw: node.draw,
    attr: { ...node.attrs },
    style,
    computed: computeDrawStyle(node, ctx, style),
    text: directTextContent(node),
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
  switch ((v ?? 'center').trim()) {
    case 'start':
    case 'flex-start':
      return Align.FlexStart
    case 'end':
    case 'flex-end':
      return Align.FlexEnd
    case 'stretch':
      return Align.Stretch
    default:
      return Align.Center
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
function lineBounds(geom: LineGeometry): Box {
  if (geom.kind === 'line' || geom.kind === 'arrow') {
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
  if (geom.kind === 'path') {
    const p = new Path2D(geom.d)
    const b = p.getBounds?.() ?? p.computeTightBounds?.()
    if (b && b.length >= 4) {
      return { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] }
    }
  }
  return { x: 0, y: 0, width: 0, height: 0 }
}

function arrowWing(x1: number, y1: number, x2: number, y2: number, head: number, turn: number) {
  const ang = Math.atan2(y2 - y1, x2 - x1) + turn
  return { x: x2 - head * Math.cos(ang), y: y2 - head * Math.sin(ang) }
}

/** 相对几何盒子的着墨：半个描边，箭头再算上两翼。 */
function lineInk(geom: LineGeometry, box: Box, strokeWidth: number, head?: number): Box {
  const pad = Math.max(0, strokeWidth) / 2
  let minX = box.x
  let minY = box.y
  let maxX = box.x + box.width
  let maxY = box.y + box.height
  if (geom.kind === 'arrow') {
    const headLen = head ?? Math.max(12, strokeWidth * 4)
    for (const wing of [arrowWing(geom.x1, geom.y1, geom.x2, geom.y2, headLen, -Math.PI / 6), arrowWing(geom.x1, geom.y1, geom.x2, geom.y2, headLen, Math.PI / 6)]) {
      minX = Math.min(minX, wing.x)
      minY = Math.min(minY, wing.y)
      maxX = Math.max(maxX, wing.x)
      maxY = Math.max(maxY, wing.y)
    }
  }
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad
  return { x: minX - box.x, y: minY - box.y, width: maxX - minX, height: maxY - minY }
}

function usesOwnCoords(node: FvgNode, kind: LayoutNode['kind']): boolean {
  if (kind === 'line') return true
  if (kind !== 'shape' && kind !== 'custom') return false
  if (node.tag === 'circle') return false
  if (hasTwoPoint(node.attrs)) return true
  return node.attrs.x != null || node.attrs.y != null
}

function normalizeLineGeometry(geom: LineGeometry, box: Box): LineGeometry {
  const ox = box.x
  const oy = box.y
  if (geom.kind === 'line' || geom.kind === 'arrow') {
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
  const fontSize = parsePx(style['font-size']) ?? defaultFontSizeForTag(tag)
  const fontWeight = parseFontWeight(style['font-weight']) ?? defaultFontWeightForTag(tag)
  const fontFamily = style['font-family']?.trim() || ctx.fontFamily
  const color = style.color ?? ctx.color
  const segments = extractTextSegments(node, {
    fontFamily,
    fontSize,
    fontWeight,
    color,
    letterSpacing: parsePx(style['letter-spacing']) ?? 0,
    lineHeightRatio: parseNumber(style['line-height']) ?? (1.2),
  })
  const nowrap = style['white-space'] === 'nowrap'
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
  const lineHeightRatio = parseNumber(style['line-height']) ?? (segments.length > 1 && !vertical ? 1.4 : 1.2)

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
    fontSize,
    writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
  })

  let contentW = textLayout.contentWidth
  let contentH = textLayout.contentHeight
  if (fixedW != null) contentW = Math.max(contentW, fixedW - appearance.padding.left - appearance.padding.right - (appearance.border?.width ?? 0) * 2)
  if (fixedH != null) contentH = Math.max(contentH, fixedH - appearance.padding.top - appearance.padding.bottom - (appearance.border?.width ?? 0) * 2)

  const outer = outerFromContent(contentW, contentH, appearance.padding, appearance.border)
  const ink = translateBox(textLayout.ink, outer.contentOffsetX, outer.contentOffsetY)

  const textAlign = (style['text-align'] ?? 'left').trim() as 'left' | 'center' | 'right'
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

async function layoutImage(node: FvgNode, ctx: LayoutContext): Promise<ImageLayoutNode> {
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
    try {
      bitmap = await loadLayerImage(node.attrs.src, ctx.baseDir)
    } catch {
      ctx.issues.push({
        level: 'warn',
        code: 'missing-image',
        path: ctx.pathPrefix,
        message: `图片无法加载: ${displaySrc(node.attrs.src.trim())}`,
        hint: 'src 相对 .layer 所在目录，也可以写 http(s) 或 data URL',
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

function layoutShape(node: FvgNode, ctx: LayoutContext, defaultStroke: string): ShapeLayoutNode {
  warnNestedMasks(node, ctx)
  const appearance = readAttrAppearance(node.attrs)
  let x = 0
  let y = 0
  let w = parseNumber(node.attrs.width) ?? 0
  let h = parseNumber(node.attrs.height) ?? 0
  const twoPoint = hasTwoPoint(node.attrs) && node.tag !== 'circle'
  if (twoPoint) {
    const x1 = parseNumber(node.attrs.x1) ?? 0
    const y1 = parseNumber(node.attrs.y1) ?? 0
    const x2 = parseNumber(node.attrs.x2) ?? 0
    const y2 = parseNumber(node.attrs.y2) ?? 0
    x = Math.min(x1, x2)
    y = Math.min(y1, y2)
    w = Math.abs(x2 - x1)
    h = Math.abs(y2 - y1)
  } else if (node.tag === 'rect' && (node.attrs.x != null || node.attrs.y != null)) {
    x = parseNumber(node.attrs.x) ?? 0
    y = parseNumber(node.attrs.y) ?? 0
    w = parseNumber(node.attrs.width) ?? w
    h = parseNumber(node.attrs.height) ?? h
  } else {
    if (node.tag === 'circle') {
      const r = parseNumber(node.attrs.r) ?? 0
      w = h = r * 2
    }
    if (node.tag === 'ellipse') {
      w = (parseNumber(node.attrs.rx) ?? 0) * 2
      h = (parseNumber(node.attrs.ry) ?? 0) * 2
    }
    if (node.tag === 'rect') {
      w = parseNumber(node.attrs.width) ?? w
      h = parseNumber(node.attrs.height) ?? h
    }
  }
  const fillFallback = ctx.fillDefault ?? '#000000'
  const fill = readPaint(node.attrs.fill ?? fillFallback, fillFallback, ctx, 'fill')
  const stroke = readPaint(node.attrs.stroke ?? 'none', 'none', ctx, 'stroke')
  const strokeWidth = parseNumber(node.attrs['stroke-width']) ?? 1
  const ink = { x: 0, y: 0, width: w, height: h }
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
    rx: parseNumber(node.attrs.rx),
    r: parseNumber(node.attrs.r),
    rxEllipse: twoPoint ? undefined : parseNumber(node.attrs.rx),
    ry: twoPoint ? undefined : parseNumber(node.attrs.ry),
    ...readEffects(node.attrs, ctx, solidPaint(fill !== 'none' ? fill : stroke, ctx.color)),
    ...layoutDrawMeta(node, ctx),
  }
}

function pathBoundsOf(d: string): Box {
  if (!d.trim()) return { x: 0, y: 0, width: 0, height: 0 }
  const p = new Path2D(d)
  const b = p.getBounds?.() ?? p.computeTightBounds?.()
  if (b && b.length >= 4) return { x: b[0], y: b[1], width: Math.max(0, b[2] - b[0]), height: Math.max(0, b[3] - b[1]) }
  return { x: 0, y: 0, width: 0, height: 0 }
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

function layoutMesh(node: FvgNode, ctx: LayoutContext): MeshLayoutNode {
  warnNestedMasks(node, ctx)
  const appearance = readAttrAppearance(node.attrs)
  const fill = readPaint(node.attrs.fill ?? '#000000', '#000000', ctx, 'fill')
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
    width = height = Math.max(0, r) * 2
    mesh = { type: 'sphere', r: Math.max(0, r) }
  } else if (node.tag === 'box') {
    width = parseNumber(node.attrs.width) ?? 0
    height = parseNumber(node.attrs.height) ?? 0
    if (!(width > 0) || !(height > 0)) {
      ctx.issues.push({
        level: 'warn',
        code: 'invalid-attr',
        path: ctx.pathPrefix,
        message: 'box 需要正的 width 和 height',
        hint: '例如 <box cx="430" cy="400" width="150" height="100" depth="60" />',
      })
    }
    const depth = readDepth(node.attrs.depth, Math.min(width, height), ctx, 'box')
    mesh = { type: 'box', depth }
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
    const box = pathBoundsOf(d)
    width = box.width
    height = box.height
    const depth = readDepth(node.attrs.depth, Math.min(width, height), ctx, 'extrude')
    mesh = { type: 'extrude', d: translateSvgPath(d, -box.x, -box.y), depth }
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
    mesh = { type: 'model', src, ...(resolved.file ? { file: resolved.file } : {}) }
  }
  return {
    kind: 'mesh',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x: 0,
    y: 0,
    width,
    height,
    ink: { x: 0, y: 0, width, height },
    ...appearance,
    mesh,
    fill,
    ...readEffects(node.attrs, ctx, solidPaint(fill, ctx.color)),
    ...layoutDrawMeta(node, ctx),
  }
}

function layoutLineNode(node: FvgNode, ctx: LayoutContext, defaultStroke: string): LineLayoutNode {
  warnNestedMasks(node, ctx)
  let geom: LineGeometry
  if (node.tag === 'line' || node.tag === 'arrow') {
    geom = {
      kind: node.tag === 'arrow' ? 'arrow' : 'line',
      x1: parseNumber(node.attrs.x1) ?? 0,
      y1: parseNumber(node.attrs.y1) ?? 0,
      x2: parseNumber(node.attrs.x2) ?? 0,
      y2: parseNumber(node.attrs.y2) ?? 0,
      head: parseNumber(node.attrs.head),
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
  const strokeFallback = ctx.fillDefault != null ? 'none' : defaultStroke
  const stroke = readPaint(node.attrs.stroke ?? strokeFallback, strokeFallback, ctx, 'stroke')
  const fillFallback = ctx.fillDefault ?? 'none'
  let fill = readPaint(node.attrs.fill ?? fillFallback, fillFallback, ctx, 'fill')
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
  const box = lineBounds(geom)
  const ink = lineInk(geom, box, strokeWidth, geom.kind === 'arrow' ? geom.head : undefined)
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
    scale: parseNumber(node.attrs.scale) ?? 1,
    origin: parseAnchor(node.attrs.origin),
    padding: ZERO_EDGES,
    geometry: localGeom,
    stroke,
    strokeWidth,
    fill,
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

async function measureFlexChild(node: FvgNode, ctx: LayoutContext, direction: 'row' | 'column'): Promise<FlexMeasure | null> {
  if (node.tag === 'symbol' || node.tag === 'draw') return null
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
    const used = await layoutUse(node, ctx)
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
    const nested = await layoutFlex(node, ctx)
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
    const laid = await layoutImage(node, ctx)
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
    const laid = layoutTextBox(node, ctx, ctx.maxContentWidth)
    return {
      node: laid,
      minMain: direction === 'row' ? laid.textLayout.minWidth : laid.height,
      minCross: direction === 'row' ? laid.height : laid.textLayout.minWidth,
      preferredMain: direction === 'row' ? laid.width : laid.height,
      preferredCross: direction === 'row' ? laid.height : laid.width,
      isText: true,
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
        hint: '外包一层有宽高的 layer，例如 <layer width="200" height="200"><model src="hero.glb" /></layer>',
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
  if (node.tag === 'layer') {
    const nested = await layoutLayer(node, ctx)
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

async function layoutFlex(node: FvgNode, ctx: LayoutContext): Promise<FlexLayoutNode> {
  const style = parseStyle(node.attrs.style)
  const direction = flexDirectionOf(style)
  const appearance = readHtmlAppearance(style)
  if (appearance.background) appearance.background = readPaint(appearance.background, 'transparent', ctx, 'background')
  const gap = parsePx(style.gap) ?? 0
  const justify = mapJustify(style['justify-content'])
  const alignItems = mapAlign(style['align-items'])

  const fixedW = parsePx(style.width)
  const fixedH = parsePx(style.height)
  const childNodes = node.children.filter((c) => typeof c !== 'string') as FvgNode[]
  const measures: FlexMeasure[] = []
  for (let i = 0; i < childNodes.length; i++) {
    const ch = childNodes[i]!
    const m = await measureFlexChild(ch, { ...ctx, pathPrefix: nodePath(ctx.pathPrefix, ch.tag, i) }, direction)
    if (m) measures.push(m)
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

  const Yoga = await ensureYoga()
  const config = Yoga.Config.create()
  config.setUseWebDefaults(true)
  // Text children are re-laid out at their Yoga width; pixel rounding could shave off a fraction and force a wrap.
  config.setPointScaleFactor(0)
  const root = Yoga.Node.createWithConfig(config)
  root.setFlexDirection(direction === 'row' ? FlexDirection.Row : FlexDirection.Column)
  root.setJustifyContent(justify)
  root.setAlignItems(alignItems)
  if (gap > 0) root.setGap(direction === 'row' ? Gutter.Column : Gutter.Row, gap)

  const mainAvailable =
    direction === 'row'
      ? fixedW != null
        ? fixedW - appearance.padding.left - appearance.padding.right - (appearance.border?.width ?? 0) * 2
        : ctx.maxContentWidth
      : fixedH ?? 1e6

  if (direction === 'row') {
    root.setWidth(Math.max(0, mainAvailable))
    root.setHeight(Math.max(0, crossAvailable === Infinity ? 0 : crossAvailable))
  } else {
    root.setWidth(Math.max(0, crossAvailable))
    root.setHeight(Math.max(0, mainAvailable))
  }

  const yogaChildren: YogaNode[] = []
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i]!
    const childFvg = childNodes[i]!
    const chParsed = parseStyle(childFvg.attrs.style)
    const { grow, shrink } = parseFlexGrowShrink(chParsed, m.isText)
    const yn = Yoga.Node.createWithConfig(config)
    yn.setFlexGrow(grow)
    yn.setFlexShrink(shrink)
    yn.setFlexBasisAuto()
    if (direction === 'row') {
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
  let contentW = 0
  let contentH = 0
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i]!
    const yn = yogaChildren[i]!
    const layout = yn.getComputedLayout()
    let child = m.node
    if (m.isText && child.kind === 'text') {
      const assignedW =
        direction === 'column'
          ? layout.width
          : layout.width
      const styleCh = parseStyle(childNodes[i]!.attrs.style)
      const innerW = assignedW - child.padding.left - child.padding.right - (child.border?.width ?? 0) * 2
      const re = layoutTextBox(childNodes[i]!, { ...ctx, pathPrefix: child.path }, innerW)
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
    contentW = Math.max(contentW, layout.left + layout.width)
    contentH = Math.max(contentH, layout.top + layout.height)
  }

  for (const yn of yogaChildren) yn.free()
  root.freeRecursive()
  config.free()

  const outer = outerFromContent(contentW, contentH, appearance.padding, appearance.border)
  if (fixedW != null && outer.width > fixedW + 1e-3) {
    ctx.issues.push({ level: 'warn', code: 'flex-overflow', path: ctx.pathPrefix, message: 'flex 内容超出写死的 width' })
  }
  if (fixedH != null && outer.height > fixedH + 1e-3) {
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

async function layoutUse(node: FvgNode, ctx: LayoutContext): Promise<LayerLayoutNode | null> {
  warnNestedMasks(node, ctx)
  const href = (node.attrs.href || node.attrs['xlink:href'] || '').trim()
  const id = href.startsWith('#') ? href.slice(1) : href
  if (!id) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'use 缺少 href',
      hint: '写成 <use href="#petal" cx="120" cy="80" />',
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
  const laid = await layoutLayer(
    { tag: 'layer', attrs, children: symbol.children },
    { ...ctx, useStack: [...ctx.useStack, id] },
  )
  const appearance = readAttrAppearance(node.attrs)
  // use 与 layer 一样不填背景；色块用 rect / HTML / <draw>
  appearance.background = undefined
  return {
    ...laid,
    tag: 'use',
    id: node.attrs.id,
    path: ctx.pathPrefix,
    ...appearance,
    ...readEffects(node.attrs, ctx, solidPaint(appearance.border?.color, ctx.color)),
    ...layoutDrawMeta(node, ctx),
  }
}

function placeInLayer(node: FvgNode, laid: LayoutNode, layerW: number, layerH: number) {
  if (usesOwnCoords(node, laid.kind)) return
  const html = isHtmlTag(node.tag)
  const cx = html ? undefined : parseNumber(node.attrs.cx)
  const cy = html ? undefined : parseNumber(node.attrs.cy)
  const anchor = html ? 'center' : parseAnchor(node.attrs.anchor)
  const tl = anchorTopLeft(cx ?? layerW / 2, cy ?? layerH / 2, laid.width, laid.height, anchor)
  laid.x = tl.x
  laid.y = tl.y
}

/** 把 mask 里的形状和图片排进 layer 的局部坐标。空的或全被忽略时不生效。 */
async function layoutMask(maskNode: FvgNode, ctx: LayoutContext, layerW: number, layerH: number): Promise<LayoutNode[] | undefined> {
  if (maskNode.attrs.style != null && maskNode.attrs.style.trim() !== '') {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: 'mask 不使用 style',
      hint: '形状用属性写 fill、cx、cy；图片的宽高写在 img 的 style 上',
    })
  }
  const children = maskNode.children.filter((c) => typeof c !== 'string') as FvgNode[]
  const laid: LayoutNode[] = []
  for (let i = 0; i < children.length; i++) {
    const ch = children[i]!
    const path = nodePath(ctx.pathPrefix, ch.tag, i)
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
      ? await layoutImage(ch, sub)
      : isShapeTag(ch.tag)
        ? layoutShape(ch, sub, ctx.color)
        : layoutLineNode(ch, sub, ctx.color)
    placeInLayer(ch, node, layerW, layerH)
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

async function layoutLayer(node: FvgNode, ctx: LayoutContext): Promise<LayerLayoutNode> {
  const appearance = readAttrAppearance(node.attrs)
  // 根节点的 background 是画布底色，由 paintDocument 绘制。layer 自身不填色。
  appearance.background = undefined
  const fixedW = parseNumber(node.attrs.width)
  const fixedH = parseNumber(node.attrs.height)

  const childFvg = node.children.filter((c) => typeof c !== 'string') as FvgNode[]
  let chosenMask: FvgNode | undefined
  let chosenMaskPath = ''
  for (let i = 0; i < childFvg.length; i++) {
    const ch = childFvg[i]!
    if (ch.tag !== 'mask') continue
    const path = nodePath(ctx.pathPrefix, ch.tag, i)
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
    cx?: number
    cy?: number
    anchor: Anchor
    useDefaultCenter: boolean
    coords: boolean
  }> = []

  for (let i = 0; i < childFvg.length; i++) {
    const ch = childFvg[i]!
    if (ch.tag === 'symbol' || ch.tag === 'draw' || ch.tag === 'mask') continue
    if (ch.tag.toLowerCase() === FONT_TAG) {
      if (ctx.pathPrefix !== 'layer') warnMisplacedFont(ctx, nodePath(ctx.pathPrefix, ch.tag, i))
      continue
    }
    const path = nodePath(ctx.pathPrefix, ch.tag, i)
    ctx.issues.push(...checkChildAttrs(ch, 'layer', path))
    const subCtx = { ...ctx, pathPrefix: path }
    let laid: LayoutNode | null = null
    if (ch.tag === 'use') laid = await layoutUse(ch, subCtx)
    else if (isLineTag(ch.tag)) laid = layoutLineNode(ch, subCtx, ctx.color)
    else if (isDisplayFlex(ch.attrs.style) && isTextBoxTag(ch.tag)) laid = await layoutFlex(ch, subCtx)
    else if (isImageTag(ch.tag)) laid = await layoutImage(ch, subCtx)
    else if (isTextBoxTag(ch.tag)) laid = layoutTextBox(ch, subCtx, ctx.maxContentWidth)
    else if (isShapeTag(ch.tag)) laid = layoutShape(ch, subCtx, ctx.color)
    else if (isMeshTag(ch.tag)) laid = layoutMesh(ch, subCtx)
    else if (ch.tag === 'layer') laid = await layoutLayer(ch, subCtx)
    else {
      laid = layoutUnknownOrCustom(ch, subCtx)
    }
    if (!laid) continue
    const html = isHtmlTag(ch.tag)
    const cx = html ? undefined : parseNumber(ch.attrs.cx)
    const cy = html ? undefined : parseNumber(ch.attrs.cy)
    placed.push({
      child: laid,
      cx: cx ?? undefined,
      cy: cy ?? undefined,
      anchor: html ? 'center' : parseAnchor(ch.attrs.anchor),
      useDefaultCenter: cx == null || cy == null,
      coords: usesOwnCoords(ch, laid.kind),
    })
  }

  let layerW = fixedW ?? 0
  let layerH = fixedH ?? 0

  const positionOne = (p: (typeof placed)[0], lw: number, lh: number) => {
    if (p.coords) return
    const cx = p.cx ?? lw / 2
    const cy = p.cy ?? lh / 2
    const tl = anchorTopLeft(cx, cy, p.child.width, p.child.height, p.anchor)
    p.child.x = tl.x
    p.child.y = tl.y
  }

  // 原点固定在左上角。负坐标的内容可以画出盒子，但不会把其他子元素一起平移。
  const bothFixed = (fixedW ?? 0) > 0 && (fixedH ?? 0) > 0
  if (bothFixed) {
    layerW = fixedW!
    layerH = fixedH!
    for (const p of placed) positionOne(p, layerW, layerH)
  } else {
    for (const p of placed) {
      if (!p.useDefaultCenter) positionOne(p, 0, 0)
    }
    let maxRight = 0
    let maxBottom = 0
    let maxDefaultW = 0
    let maxDefaultH = 0
    for (const p of placed) {
      const explicit = p.coords || !p.useDefaultCenter
      if (explicit) {
        maxRight = Math.max(maxRight, p.child.x + p.child.width)
        maxBottom = Math.max(maxBottom, p.child.y + p.child.height)
      } else {
        maxDefaultW = Math.max(maxDefaultW, p.child.width)
        maxDefaultH = Math.max(maxDefaultH, p.child.height)
      }
    }
    layerW = fixedW != null && fixedW > 0 ? fixedW : Math.max(0, maxRight, maxDefaultW)
    layerH = fixedH != null && fixedH > 0 ? fixedH : Math.max(0, maxBottom, maxDefaultH)
    for (const p of placed) {
      if (p.useDefaultCenter && !p.coords) positionOne(p, layerW, layerH)
    }
  }

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
        hint: '外包一层有宽高的 layer，例如 <layer width="200" height="200"><model src="hero.glb" /></layer>',
      })
    }
  }

  let ink = emptyBox()
  const children = placed.map((p) => {
    ink = unionBoxes(ink, translateBox(p.child.ink, p.child.x, p.child.y))
    return p.child
  })

  const overlay = readLayerOverlay(node.attrs, ctx)
  const grade = readLayerGrade(node.attrs, ctx)
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
    ? await layoutMask(chosenMask, { ...ctx, pathPrefix: chosenMaskPath }, layerW, layerH)
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
  return {
    kind: 'layer',
    path: ctx.pathPrefix,
    id: node.attrs.id,
    tag: node.tag,
    x: 0,
    y: 0,
    width: layerW,
    height: layerH,
    ink,
    ...appearance,
    children,
    overflow: node.attrs.overflow === 'hidden' ? 'hidden' : 'visible',
    ...(perspective != null ? { perspective } : {}),
    ...(mask ? { mask } : {}),
    ...readEffects(node.attrs, ctx, solidPaint(appearance.border?.color, ctx.color)),
    ...(overlay ? { overlay } : {}),
    ...grade,
    ...layoutDrawMeta(node, ctx),
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

function collectFontFamilies(node: FvgNode, out: Set<string>) {
  const style = parseStyle(node.attrs.style)
  if (style['font-family']) out.add(style['font-family'])
  if (node.attrs['font-family']) out.add(node.attrs['font-family'])
  for (const child of node.children) {
    if (typeof child !== 'string') collectFontFamilies(child, out)
  }
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
  const nodes = typeof source === 'string' ? parseFvg(source) : [source]
  for (const node of nodes) canonicalizeTree(node)
  const fontNodes: Array<{ family: string; src: string }> = []
  let rootNode: FvgNode | null = null
  for (const n of nodes) {
    const font = fontDecl(n)
    if (font) fontNodes.push(font)
    else if (!rootNode) rootNode = n
  }
  if (rootNode) {
    for (const child of rootNode.children) {
      if (typeof child === 'string') continue
      const font = fontDecl(child)
      if (font) fontNodes.push(font)
    }
  }
  if (!rootNode) throw new Error('Flex Layer 缺少根元素 <layer>')
  await registerFontsFromDocument(fontNodes.filter((f) => f.family && f.src), baseDir)

  const attrs = rootNode.attrs
  const width = parseNumber(attrs.width) ?? 1080
  const height = parseNumber(attrs.height) ?? 1920
  const color = attrs.color ?? '#111111'
  const fontFamily = attrs['font-family'] ?? 'ChillDuanSans'
  const safe = parseSafe(attrs.safe, width, height)
  const maxContentWidth = width - safe.left - safe.right

  const issues: Issue[] = []
  const symbols = new Map<string, FvgNode>()
  collectSymbols(rootNode, symbols, issues, 'layer')
  const families = new Set<string>([fontFamily])
  collectFontFamilies(rootNode, families)
  await ensureBuiltinFonts(families)
  if (attrs.style?.trim()) {
    issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: 'layer',
      message: 'layer 和图形不使用 style',
      hint: '把 width、opacity 写成属性。色块用 rect / HTML / <draw>',
    })
  }
  // 根必须是 layer；旧写法 <fvg> / <layer> 已在解析时归一成 layer
  if (rootNode.tag !== 'layer') {
    throw new Error(`Flex Layer 根元素必须是 <layer>，收到 <${rootNode.tag}>`)
  }
  noteTagSpellings(rootNode, 'layer', issues)
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
  }
  const hadBackground = attrs.background != null && attrs.background.trim() !== ''
  const background = hadBackground ? readPaint(attrs.background, '#ffffff', paintCtx, 'background') : '#ffffff'
  const root = await layoutLayer(rootNode, paintCtx)

  root.width = width
  root.height = height
  issues.push(...perspectiveIssues(root))

  return { width, height, background, color, fontFamily, safe, root, issues }
}

export type { FvgDocument }
