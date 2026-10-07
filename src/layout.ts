import { Path2D } from '@napi-rs/canvas'
import {
  Align,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  Wrap,
  type Node as YogaNode,
} from 'yoga-layout/load'
import { attachDrawTags } from './draw-tag.js'
import { parseGrade } from './grade.js'
import { parseColor } from './gradientField.js'
import { imageInk, peekLayerImage, preloadLayerImagesSync, parseObjectFit, parseObjectPosition } from './image.js'
import type { FvgNode } from './parse.js'
import { parseFvg } from './parse.js'
import { ensureBuiltinFontsSync, primaryFontFamily, registerFontsFromDocumentSync } from './fonts.js'
import { materialize } from './components.js'
import { catmullRomPath } from './curve.js'
import { isGradient, parseGradient, solidPaint } from './gradient.js'
import { glbSpan, resolveModelFile } from './glb.js'
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
  parseScale,
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
import { allowsBleed, checkChildAttrs, checkTextBoxChildren, hasTwoPoint, isDisplayFlex, isHtmlTag, legacyCenterIssues, rowColumnHint, typoAttrIssues } from './rules.js'
import { canonicalTag, FONT_TAG, isImageTag, isLineTag, isMaskContentTag, isMeshTag, isShapeTag } from './tags.js'
import { boundsOf, parseSvgTransform } from './svg-transform.js'
import type {
  Anchor,
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
import { formatSourceLoc } from './source-loc.js'
import { getYoga } from './yoga.js'

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

function parseAnchor(raw: string | undefined, fallback: Anchor = 'center'): Anchor {
  const v = (raw ?? fallback).trim().toLowerCase() as Anchor
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
    ...scalePair(attrs.scale),
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
    data: node.data,
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
function lineBounds(geom: LineGeometry): Box {
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
  if (geom.kind === 'path') {
    const p = new Path2D(geom.d)
    const b = p.getBounds?.() ?? p.computeTightBounds?.()
    if (b && b.length >= 4) {
      return { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] }
    }
  }
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
  if (node.tag === 'circle' || node.tag === 'ellipse' || node.tag === 'sphere') return true
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
  const fontSize = parsePx(style['font-size']) ?? defaultFontSizeForTag(tag)
  const fontWeight = parseFontWeight(style['font-weight']) ?? defaultFontWeightForTag(tag)
  const fontFamily = style['font-family']?.trim() || ctx.fontFamily
  const color = style.color ?? ctx.color
  const segments = extractTextSegments(
    node,
    {
      fontFamily,
      fontSize,
      fontWeight,
      color,
      letterSpacing: parsePx(style['letter-spacing']) ?? 0,
      lineHeightRatio: parseNumber(style['line-height']) ?? 1.2,
    },
    ctx.pathPrefix,
  )
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
      hint: 'shadow 写在平面上；网格只使用 fill',
    })
  }
  if (effects.glow) {
    ctx.issues.push({
      level: 'warn',
      code: 'invalid-attr',
      path: ctx.pathPrefix,
      message: `${node.tag} 不支持 glow`,
      hint: 'glow 写在平面上；网格只使用 fill',
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
  const box = lineBounds(geom)
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
    origin: parseAnchor(node.attrs.origin),
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

function measureFlexChild(raw: FvgNode, ctx: LayoutContext, direction: 'row' | 'column'): FlexMeasure | null {
  const node = materialize(raw)
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

function layoutFlex(node: FvgNode, ctx: LayoutContext): FlexLayoutNode {
  const style = parseStyle(node.attrs.style)
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
    const m = measureFlexChild(ch, { ...ctx, pathPrefix: path }, direction)
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
  let minX = 0
  let minY = 0
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
    minX = Math.min(minX, layout.left)
    minY = Math.min(minY, layout.top)
    contentW = Math.max(contentW, layout.left + layout.width)
    contentH = Math.max(contentH, layout.top + layout.height)
  }

  for (const yn of yogaChildren) yn.free()
  root.freeRecursive()
  config.free()

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

function placeInLayer(node: FvgNode, laid: LayoutNode) {
  if (usesOwnCoords(node, laid.kind)) return
  const html = isHtmlTag(node.tag)
  const x = html ? 0 : (parseNumber(node.attrs.x) ?? 0)
  const y = html ? 0 : (parseNumber(node.attrs.y) ?? 0)
  const anchor = html ? 'top-left' : parseAnchor(node.attrs.anchor, 'top-left')
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
function contentWidthFor(node: FvgNode, fixedW: number | undefined, parentMax: number): number {
  if (fixedW == null || !measuredBoxes.has(node)) return parentMax
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

function layoutLayer(node: FvgNode, ctx: LayoutContext): LayerLayoutNode {
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
    const textMax = contentWidthFor(node, fixedW, ctx.maxContentWidth)
    const subCtx = { ...ctx, pathPrefix: path, maxContentWidth: textMax }
    let laid: LayoutNode | null = null
    if (concrete.tag === 'use') laid = layoutUse(concrete, subCtx)
    else if (concrete.tag === 'g') laid = layoutGroup(concrete, subCtx)
    else if (isLineTag(concrete.tag)) laid = layoutLineNode(concrete, subCtx, ctx.color)
    else if (isDisplayFlex(concrete.attrs.style) && isTextBoxTag(concrete.tag)) laid = layoutFlex(concrete, subCtx)
    else if (isImageTag(concrete.tag)) laid = layoutImage(concrete, subCtx)
    else if (isTextBoxTag(concrete.tag)) laid = layoutTextBox(concrete, subCtx, textMax)
    else if (isShapeTag(concrete.tag)) laid = layoutShape(concrete, subCtx, ctx.color)
    else if (isMeshTag(concrete.tag)) laid = layoutMesh(concrete, subCtx)
    else if (concrete.tag === 'layer') laid = layoutLayer(concrete, subCtx)
    else {
      laid = layoutUnknownOrCustom(concrete, subCtx)
    }
    if (!laid) continue
    const html = isHtmlTag(concrete.tag)
    placed.push({
      child: laid,
      x: html ? 0 : (parseNumber(ch.attrs.x) ?? 0),
      y: html ? 0 : (parseNumber(ch.attrs.y) ?? 0),
      anchor: html ? 'top-left' : parseAnchor(ch.attrs.anchor, 'top-left'),
      coords: usesOwnCoords(ch, laid.kind),
    })
  }

  const positionOne = (p: (typeof placed)[0]) => {
    if (p.coords) return
    const tl = anchorTopLeft(p.x, p.y, p.child.width, p.child.height, p.anchor)
    p.child.x = tl.x
    p.child.y = tl.y
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

function noteAttrTypos(node: FvgNode, path: string, issues: Issue[]) {
  const concrete = materialize(node)
  issues.push(...typoAttrIssues(concrete, path))
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
  return { laid: layoutLayer(node, ctx), issues }
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
  const bleed = allowsBleed(attrs.bleed)
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

  return { width, height, background, color, fontFamily, safe, bleed, root, issues, sources }
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
