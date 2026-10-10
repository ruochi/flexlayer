import type { Origin, OriginAxis } from './types.js'

export type StyleMap = Record<string, string>

export function parseStyle(text: string | undefined): StyleMap {
  const out: StyleMap = {}
  if (!text) return out
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const key = decl.slice(0, i).trim().toLowerCase()
    const value = decl.slice(i + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

/** 像素长度：数字或 `12px`；无法解析返回 undefined */
export function parsePx(value: string | undefined): number | undefined {
  if (value == null) return undefined
  const m = /^\s*(-?\d*\.?\d+)\s*(px)?\s*$/i.exec(value)
  return m ? Number.parseFloat(m[1]) : undefined
}

/**
 * 字距。数字、`px`、`em` 或 `normal`。`em` 按传入的字号换算成像素。
 * 无法解析返回 undefined。
 */
export function parseLetterSpacing(value: string | undefined, fontSize: number): number | undefined {
  if (value == null) return undefined
  if (value.trim().toLowerCase() === 'normal') return 0
  const m = /^\s*(-?\d*\.?\d+)\s*(px|em)?\s*$/i.exec(value)
  if (!m) return undefined
  const n = Number.parseFloat(m[1]!)
  return m[2]?.toLowerCase() === 'em' ? n * fontSize : n
}

export function parseNumber(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

const CENTER_ORIGIN: Origin = {
  x: { unit: 'percent', value: 50 },
  y: { unit: 'percent', value: 50 },
}

const NAMED_ORIGIN: Record<string, Origin> = {
  center: CENTER_ORIGIN,
  top: { x: { unit: 'percent', value: 50 }, y: { unit: 'percent', value: 0 } },
  bottom: { x: { unit: 'percent', value: 50 }, y: { unit: 'percent', value: 100 } },
  left: { x: { unit: 'percent', value: 0 }, y: { unit: 'percent', value: 50 } },
  right: { x: { unit: 'percent', value: 100 }, y: { unit: 'percent', value: 50 } },
  'top-left': { x: { unit: 'percent', value: 0 }, y: { unit: 'percent', value: 0 } },
  'top-right': { x: { unit: 'percent', value: 100 }, y: { unit: 'percent', value: 0 } },
  'bottom-left': { x: { unit: 'percent', value: 0 }, y: { unit: 'percent', value: 100 } },
  'bottom-right': { x: { unit: 'percent', value: 100 }, y: { unit: 'percent', value: 100 } },
}

function axisLength(token: string, axis: 'x' | 'y'): OriginAxis | null {
  const t = token.trim().toLowerCase()
  if (axis === 'x') {
    if (t === 'left') return { unit: 'percent', value: 0 }
    if (t === 'center') return { unit: 'percent', value: 50 }
    if (t === 'right') return { unit: 'percent', value: 100 }
    if (t === 'top' || t === 'bottom') return null
  } else {
    if (t === 'top') return { unit: 'percent', value: 0 }
    if (t === 'center') return { unit: 'percent', value: 50 }
    if (t === 'bottom') return { unit: 'percent', value: 100 }
    if (t === 'left' || t === 'right') return null
  }
  if (t.endsWith('%')) {
    const n = parseNumber(t.slice(0, -1))
    if (n == null) return null
    return { unit: 'percent', value: n }
  }
  const px = parsePx(t)
  if (px == null) return null
  return { unit: 'px', value: px }
}

/** 词是横轴、纵轴，还是两边都能用。长度和 center 两边都能用。 */
function axisRole(token: string): 'h' | 'v' | 'either' | 'bad' {
  const t = token.trim().toLowerCase()
  if (t === 'left' || t === 'right') return 'h'
  if (t === 'top' || t === 'bottom') return 'v'
  if (t === 'center') return 'either'
  if (t.endsWith('%')) return parseNumber(t.slice(0, -1)) == null ? 'bad' : 'either'
  return parsePx(t) == null ? 'bad' : 'either'
}

function assignOriginAxes(a: string, b: string): { x: string; y: string } | null {
  const ra = axisRole(a)
  const rb = axisRole(b)
  if (ra === 'bad' || rb === 'bad') return null
  if (ra === 'h' && rb === 'h') return null
  if (ra === 'v' && rb === 'v') return null
  if (ra === 'v' && rb === 'h') return { x: b, y: a }
  if (ra === 'h') return { x: a, y: b }
  if (rb === 'h') return { x: b, y: a }
  if (ra === 'v') return { x: b, y: a }
  if (rb === 'v') return { x: a, y: b }
  return { x: a, y: b }
}

/**
 * 旋转和缩放的支点。九宫格仍可用。
 * 两个数是相对盒子左上角的像素，`30% 40%` 按宽高。词可以换顺序：`top 40` 和 `40 top` 一样。
 * 只写一个数或百分比时，另一轴是中心。解析失败时退回中心，`invalid` 为 true。
 */
export function readOrigin(raw: string | undefined): { origin: Origin; invalid: boolean } {
  if (raw == null || raw.trim() === '') return { origin: CENTER_ORIGIN, invalid: false }
  const text = raw.trim().toLowerCase()
  const named = NAMED_ORIGIN[text]
  if (named) return { origin: named, invalid: false }
  const parts = text.split(/[\s,]+/).filter(Boolean)
  if (parts.length === 1) {
    const x = axisLength(parts[0]!, 'x')
    if (!x) return { origin: CENTER_ORIGIN, invalid: true }
    return { origin: { x, y: { unit: 'percent', value: 50 } }, invalid: false }
  }
  if (parts.length !== 2) return { origin: CENTER_ORIGIN, invalid: true }
  const assigned = assignOriginAxes(parts[0]!, parts[1]!)
  if (!assigned) return { origin: CENTER_ORIGIN, invalid: true }
  const x = axisLength(assigned.x, 'x')
  const y = axisLength(assigned.y, 'y')
  if (!x || !y) return { origin: CENTER_ORIGIN, invalid: true }
  return { origin: { x, y }, invalid: false }
}

export function parseOrigin(raw: string | undefined): Origin {
  return readOrigin(raw).origin
}

/** `1.2` 两轴相同；`1.2 0.8` 或 `-1 1` 分轴。解析失败时为 1。 */
export function parseScale(value: string | undefined): { x: number; y: number } {
  const parts = value?.trim().split(/[\s,]+/).filter(Boolean) ?? []
  const x = parseNumber(parts[0])
  if (x == null) return { x: 1, y: 1 }
  if (parts.length < 2) return { x, y: x }
  const y = parseNumber(parts[1])
  return { x, y: y ?? x }
}

export type Edges = { top: number; right: number; bottom: number; left: number }

export const ZERO_EDGES: Edges = { top: 0, right: 0, bottom: 0, left: 0 }

/** 1 到 4 个值的边距（同 CSS padding 语法） */
export function parseEdges(value: string | undefined): Edges | undefined {
  if (value == null) return undefined
  const parts = value.trim().split(/\s+/).map(parsePx)
  if (parts.length === 0 || parts.length > 4 || parts.some((p) => p === undefined)) return undefined
  const [a, b = a, c = a, d = b] = parts as number[]
  return { top: a, right: b, bottom: c, left: d }
}

export type Border = { width: number; color: string }

/** `2px solid #fff`；只支持实线，顺序不限 */
export function parseBorder(value: string | undefined): Border | undefined {
  if (!value || value.trim() === 'none') return undefined
  let width = 1
  let color = '#000000'
  for (const token of splitCssTokens(value)) {
    const px = parsePx(token)
    if (px !== undefined) width = px
    else if (!/^(solid|dashed|dotted|double)$/i.test(token)) color = token
  }
  return width > 0 ? { width, color } : undefined
}

/** 按空白拆分，但保留括号内的空白（如 `rgb(1, 2, 3)`） */
export function splitCssTokens(value: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value.trim()) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) tokens.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

export type ShadowValue = { x: number; y: number; blur: number; spread: number; color?: string }
export type GlowValue = { blur: number; spread: number; color?: string }
export type NoiseValue = { amount: number; color?: string }
/** layer 专用：`overlay="<paint> [opacity] [blend]"` */
export type OverlayValue = { paint: string; opacity: number; blend: BlendMode }
export type ColorFilterFn =
  | { name: 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'invert'; value: number }
  | { name: 'hue-rotate'; value: number }

export const BLEND_MODES = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'lighten',
  'darken',
] as const
export type BlendMode = (typeof BLEND_MODES)[number]

function splitLengthsAndColor(value: string): { lengths: number[]; color?: string } | undefined {
  const lengths: number[] = []
  let color: string | undefined
  for (const token of splitCssTokens(value)) {
    const px = parsePx(token)
    if (px !== undefined) {
      if (color !== undefined) return undefined
      lengths.push(px)
    } else if (color === undefined) color = token
    else return undefined
  }
  return { lengths, color }
}

/** `x y [blur] [spread] [color]`，同 CSS box-shadow。无法解析返回 undefined。 */
export function parseShadow(value: string | undefined): ShadowValue | undefined {
  if (!value || value.trim() === 'none') return undefined
  const parts = splitLengthsAndColor(value)
  if (!parts || parts.lengths.length < 2 || parts.lengths.length > 4) return undefined
  const [x, y, blur = 0, spread = 0] = parts.lengths as [number, number, number?, number?]
  if (blur < 0) return undefined
  return { x, y, blur, spread, color: parts.color }
}

/** `blur [spread] [color]`。无法解析返回 undefined。 */
export function parseGlow(value: string | undefined): GlowValue | undefined {
  if (!value || value.trim() === 'none') return undefined
  const parts = splitLengthsAndColor(value)
  if (!parts || parts.lengths.length < 1 || parts.lengths.length > 2) return undefined
  const [blur, spread = 0] = parts.lengths as [number, number?]
  if (blur < 0) return undefined
  return { blur, spread, color: parts.color }
}

export type InkStrokePosition = 'outside' | 'inside' | 'center'
/** 一层墨迹描边。width 是到墨迹的总距离，不是相对上一层的增量。 */
export type InkStrokeValue = { width: number; color: string; position: InkStrokePosition }

const INK_STROKE_POSITIONS = new Set<InkStrokePosition>(['outside', 'inside', 'center'])

/** 按顶层逗号拆开，括号里的逗号留给渐变。 */
function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/**
 * `ink-stroke`: `<宽度> <颜色或渐变> [outside|inside|center] [, 下一层…]`。
 * 多层从内到外，宽度是到墨迹的总距离。`none` 与无法解析都返回 undefined。
 */
export function parseInkStroke(value: string | undefined): InkStrokeValue[] | undefined {
  if (!value || value.trim() === 'none') return undefined
  const layers = splitTopLevelCommas(value)
  if (layers.length === 0) return undefined
  const out: InkStrokeValue[] = []
  for (const layer of layers) {
    const tokens = splitCssTokens(layer)
    if (tokens.length < 2 || tokens.length > 3) return undefined
    const width = parsePx(tokens[0])
    if (width === undefined || !(width > 0)) return undefined
    let position: InkStrokePosition = 'outside'
    if (tokens.length === 3) {
      const pos = tokens[2]!.toLowerCase()
      if (!INK_STROKE_POSITIONS.has(pos as InkStrokePosition)) return undefined
      position = pos as InkStrokePosition
    }
    const color = tokens[1]!
    if (INK_STROKE_POSITIONS.has(color.toLowerCase() as InkStrokePosition)) return undefined
    if (parsePx(color) !== undefined) return undefined
    out.push({ width, color, position })
  }
  return out
}

/** 外侧描边伸出去的最大距离。center 只算外半。 */
export function outerInkStrokeReach(layers: Array<{ width: number; position: string }> | undefined): number {
  if (!layers?.length) return 0
  let max = 0
  for (const layer of layers) {
    const reach = layer.position === 'inside' ? 0 : layer.position === 'center' ? layer.width / 2 : layer.width
    if (reach > max) max = reach
  }
  return max
}

/** inside 的宽度，或 center 的内半。用来判断会不会填死字腔。 */
export function innerInkStrokeReach(layers: Array<{ width: number; position: string }> | undefined): number {
  if (!layers?.length) return 0
  let max = 0
  for (const layer of layers) {
    const reach = layer.position === 'inside' ? layer.width : layer.position === 'center' ? layer.width / 2 : 0
    if (reach > max) max = reach
  }
  return max
}

/** 单个非负长度，如 `12` / `12px`。 */
export function parseBlurRadius(value: string | undefined): number | undefined {
  if (!value || value.trim() === 'none') return undefined
  const n = parsePx(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/** `0.08` 或 `0.08 #ffffff`，强度 0 到 1。 */
export function parseNoise(value: string | undefined): NoiseValue | undefined {
  if (!value || value.trim() === 'none') return undefined
  const tokens = splitCssTokens(value)
  if (tokens.length < 1 || tokens.length > 2) return undefined
  const amount = Number(tokens[0])
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) return undefined
  const color = tokens[1]
  if (color !== undefined && parsePx(color) !== undefined) return undefined
  return { amount, color }
}

function parseOpacityToken(token: string): number | undefined {
  const t = token.trim()
  const pct = /^(-?\d*\.?\d+)\s*%$/.exec(t)
  if (pct) {
    const n = Number.parseFloat(pct[1]!) / 100
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined
  }
  // 不带单位的纯数字才当透明度；带 px 的留给其它解析
  if (/px$/i.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined
}

/**
 * layer 专用叠加：`overlay="<paint> [opacity] [blend]"`。
 * paint 为纯色或 linear-gradient / radial-gradient / gradient；opacity 与 blend 顺序可互换。
 */
export function parseOverlay(value: string | undefined): OverlayValue | undefined {
  if (!value || value.trim() === 'none') return undefined
  const tokens = splitCssTokens(value)
  if (tokens.length < 1 || tokens.length > 3) return undefined
  const paint = tokens[0]!
  if (!paint || paint.toLowerCase() === 'none') return undefined
  // 混合模式名不能当 paint（须写在后面）
  if (parseBlend(paint)) return undefined
  let opacity = 1
  let blend: BlendMode = 'source-over'
  let sawOpacity = false
  let sawBlend = false
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!
    const asBlend = parseBlend(token)
    if (asBlend) {
      if (sawBlend) return undefined
      blend = asBlend
      sawBlend = true
      continue
    }
    const asOpacity = parseOpacityToken(token)
    if (asOpacity !== undefined) {
      if (sawOpacity) return undefined
      opacity = asOpacity
      sawOpacity = true
      continue
    }
    return undefined
  }
  return { paint, opacity, blend }
}

const COLOR_FILTER_NAMES = new Set([
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
  'sepia',
  'invert',
  'hue-rotate',
])

function parseFilterArg(raw: string, kind: 'ratio' | 'angle'): number | undefined {
  const t = raw.trim()
  if (kind === 'angle') {
    const m = /^(-?\d*\.?\d+)\s*(deg)?$/i.exec(t)
    return m ? Number.parseFloat(m[1]!) : undefined
  }
  const pct = /^(-?\d*\.?\d+)\s*%$/.exec(t)
  if (pct) return Number.parseFloat(pct[1]!) / 100
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** 色彩滤镜：`brightness(1.1) contrast(1.2) …`，不含 blur / drop-shadow。 */
export function parseColorFilter(value: string | undefined): ColorFilterFn[] | undefined {
  if (!value || value.trim() === 'none') return undefined
  const out: ColorFilterFn[] = []
  const re = /([a-z-]+)\(\s*([^)]*?)\s*\)/gi
  let m: RegExpExecArray | null
  let consumed = 0
  while ((m = re.exec(value))) {
    const name = m[1]!.toLowerCase()
    if (!COLOR_FILTER_NAMES.has(name)) return undefined
    if (name === 'blur' || name === 'drop-shadow') return undefined
    const arg = parseFilterArg(m[2]!, name === 'hue-rotate' ? 'angle' : 'ratio')
    if (arg === undefined) return undefined
    out.push({ name: name as ColorFilterFn['name'], value: arg })
    consumed = m.index + m[0].length
  }
  if (out.length === 0) return undefined
  if (value.slice(consumed).trim() !== '') return undefined
  // 拒绝整串里夹了未匹配的标识
  const stripped = value.replace(/[a-z-]+\(\s*[^)]*?\)/gi, '').trim()
  if (stripped !== '') return undefined
  return out
}

/** 转成 canvas `filter` 字符串。 */
export function colorFilterToCss(fns: ColorFilterFn[]): string {
  return fns
    .map((fn) => (fn.name === 'hue-rotate' ? `hue-rotate(${fn.value}deg)` : `${fn.name}(${fn.value})`))
    .join(' ')
}

export function parseBlend(value: string | undefined): BlendMode | undefined {
  if (!value || value.trim() === 'none') return undefined
  const v = value.trim().toLowerCase()
  return (BLEND_MODES as readonly string[]).includes(v) ? (v as BlendMode) : undefined
}

export type GlassVariant = 'regular' | 'clear' | 'thick'
export type GlassValue = {
  variant: GlassVariant
  blur: number
  tint?: string
  /** 折射强度 0–1：边缘最大向内位移 = bezel × 0.5 × refraction */
  refraction: number
  specular: number
  /** 边缘弧面宽度，占短边的比例 */
  bezel: number
  /** 色散：R/B 通道位移差 */
  dispersion: number
}

const GLASS_PRESETS: Record<GlassVariant, Omit<GlassValue, 'variant' | 'tint'>> = {
  // clear：不模糊，折射清晰；regular：略糊；thick：毛玻璃
  clear: { blur: 0, refraction: 1, specular: 0.7, bezel: 0.24, dispersion: 0.06 },
  regular: { blur: 6, refraction: 0.85, specular: 0.6, bezel: 0.22, dispersion: 0.04 },
  thick: { blur: 36, refraction: 0.5, specular: 0.6, bezel: 0.2, dispersion: 0 },
}

/**
 * `glass` 语法：
 * - 空格：`clear` / `regular` / `thick`；`24` 或 `24px`（其余按 regular）；`clear #a8c8ff20`；`regular 8 #ffffff22`
 * - 逗号：`clear, blur 8, tint #fff2`。第一项是预设，后面用 `blur` / `tint` / `refraction` / `specular` / `bezel` / `dispersion` 覆盖
 */
function looksLikeColorToken(token: string): boolean {
  const t = token.trim()
  return (
    t.startsWith('#') ||
    /^(rgb|rgba|hsl|hsla)\(/i.test(t) ||
    t.toLowerCase() === 'transparent' ||
    t.toLowerCase() === 'white' ||
    t.toLowerCase() === 'black'
  )
}

const GLASS_NAMED = new Set(['blur', 'tint', 'refraction', 'specular', 'bezel', 'dispersion'])

function splitCommaClauses(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function finishGlass(
  variant: GlassVariant,
  blur: number | undefined,
  tint: string | undefined,
  extra: Partial<Pick<GlassValue, 'refraction' | 'specular' | 'bezel' | 'dispersion'>>,
): GlassValue {
  const preset = GLASS_PRESETS[variant]
  return {
    ...preset,
    ...extra,
    variant,
    blur: blur ?? preset.blur,
    tint,
  }
}

/** 空格写法：`clear` / `regular 8 #ffffff22` / `0`。 */
function parseGlassLegacy(value: string): GlassValue | undefined {
  const tokens = splitCssTokens(value)
  if (tokens.length < 1 || tokens.length > 3) return undefined
  let variant: GlassVariant = 'regular'
  let blur: number | undefined
  let tint: string | undefined
  let sawVariant = false
  for (const token of tokens) {
    const key = token.toLowerCase()
    if (key === 'regular' || key === 'clear' || key === 'thick') {
      variant = key
      sawVariant = true
      continue
    }
    const px = parsePx(token)
    if (px !== undefined) {
      if (px < 0 || blur !== undefined) return undefined
      blur = px
      continue
    }
    if (tint !== undefined || !looksLikeColorToken(token)) return undefined
    tint = token
  }
  if (!sawVariant && blur === undefined && tint === undefined) return undefined
  return finishGlass(variant, blur, tint, {})
}

function parseUnit(token: string, min: number, max: number): number | undefined {
  const n = Number(token)
  if (!Number.isFinite(n) || n < min || n > max) return undefined
  return n
}

/**
 * 逗号写法，和 grade 一样：第一项是预设（可带模糊像素和色调），后面用名字覆盖。
 * `clear, blur 8, tint #fff2`、`thick, refraction 0.4`。
 */
function parseGlassNamed(value: string): GlassValue | undefined {
  const clauses = splitCommaClauses(value)
  if (clauses.some((clause) => clause === '')) return undefined
  let variant: GlassVariant = 'regular'
  let blur: number | undefined
  let tint: string | undefined
  const extra: Partial<Pick<GlassValue, 'refraction' | 'specular' | 'bezel' | 'dispersion'>> = {}
  for (let i = 0; i < clauses.length; i++) {
    const tokens = splitCssTokens(clauses[i]!)
    if (tokens.length === 0) return undefined
    const head = tokens[0]!.toLowerCase()
    if (!GLASS_NAMED.has(head)) {
      if (i !== 0) return undefined
      const legacy = parseGlassLegacy(clauses[i]!)
      if (!legacy) return undefined
      variant = legacy.variant
      blur = legacy.blur
      tint = legacy.tint
      continue
    }
    if (head === 'blur') {
      if (tokens.length !== 2) return undefined
      const n = parsePx(tokens[1])
      if (n === undefined || n < 0) return undefined
      blur = n
      continue
    }
    if (head === 'tint') {
      if (tokens.length !== 2 || !looksLikeColorToken(tokens[1]!)) return undefined
      tint = tokens[1]
      continue
    }
    if (tokens.length !== 2) return undefined
    const max = head === 'refraction' ? 2 : 1
    const n = parseUnit(tokens[1]!, 0, max)
    if (n === undefined) return undefined
    extra[head as 'refraction' | 'specular' | 'bezel' | 'dispersion'] = n
  }
  return finishGlass(variant, blur, tint, extra)
}

export function parseGlass(value: string | undefined): GlassValue | undefined {
  if (!value || value.trim() === 'none') return undefined
  if (splitCommaClauses(value).length > 1) return parseGlassNamed(value)
  return parseGlassLegacy(value)
}

export function parseFontWeight(value: string | undefined): number | undefined {
  if (!value) return undefined
  const v = value.trim().toLowerCase()
  if (v === 'normal') return 400
  if (v === 'bold') return 700
  if (v === 'lighter') return 300
  if (v === 'bolder') return 800
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : undefined
}

/** 行高：无单位是字号的倍数，`px` 是绝对行高，`normal` 按 1.2。`%`、`em` 等不接受。 */
export type LineHeight = { unit: 'ratio'; value: number } | { unit: 'px'; value: number }

export function parseLineHeight(value: string | undefined): LineHeight | undefined {
  if (value == null) return undefined
  const text = value.trim().toLowerCase()
  if (!text) return undefined
  if (text === 'normal') return { unit: 'ratio', value: 1.2 }
  if (text.endsWith('px')) {
    const n = parsePx(text)
    if (n == null || n < 0) return undefined
    return { unit: 'px', value: n }
  }
  if (/[a-z%]/.test(text)) return undefined
  const n = parseNumber(text)
  if (n == null || n < 0) return undefined
  return { unit: 'ratio', value: n }
}

const ANCHOR_NAMES = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const

/** 九宫格锚点。空值用 fallback 且不算写错；认不出的值也退回 fallback，并标 invalid。 */
export function readAnchor(
  raw: string | undefined,
  fallback: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'top-left',
): {
  anchor: (typeof ANCHOR_NAMES)[number]
  invalid: boolean
} {
  if (raw == null || raw.trim() === '') return { anchor: fallback, invalid: false }
  const value = raw.trim().toLowerCase()
  if ((ANCHOR_NAMES as readonly string[]).includes(value)) {
    return { anchor: value as (typeof ANCHOR_NAMES)[number], invalid: false }
  }
  return { anchor: fallback, invalid: true }
}

export type StyleDiagnostic = { hint: string }

/**
 * 布局已经单独报过的样式。这里只把它们算作认识，避免同一处报两次。
 * 滤镜名也走这条：不认识的名字另由滤镜表处理。
 */
const QUIET_STYLE = new Set([
  'writing-mode',
  'object-fit',
  'object-position',
  'shadow',
  'glow',
  'inner-shadow',
  'inner-glow',
  'ink-stroke',
  'blur',
  'backdrop-blur',
  'noise',
  'blend',
  'glass',
  'filter',
])

function keywordHint(value: string, allowed: readonly string[], hint: string): StyleDiagnostic | null {
  const token = value.trim().toLowerCase()
  return allowed.includes(token) ? null : { hint }
}

function lengthHint(value: string, hint: string): StyleDiagnostic | null {
  return parsePx(value) == null ? { hint } : null
}

function numberHint(value: string, hint: string): StyleDiagnostic | null {
  return parseNumber(value) == null ? { hint } : null
}

/** 认识的 CSS 属性。返回 null 表示值可用；不在表里的名字由调用方当成不支持。 */
const STYLE_CHECKS: Record<string, (value: string) => StyleDiagnostic | null> = {
  'font-size': (value) => lengthHint(value, '写成 40 或 40px'),
  'font-weight': (value) => (parseFontWeight(value) == null ? { hint: '写成 400、700，或 normal、bold' } : null),
  'font-family': () => null,
  color: () => null,
  fill: () => null,
  'letter-spacing': (value) => (parseLetterSpacing(value, 16) == null ? { hint: '写成 0、2px 或 0.05em' } : null),
  'line-height': (value) => (parseLineHeight(value) == null ? { hint: '写成倍数 1.4，或像素 24px' } : null),
  'text-align': (value) => keywordHint(value, ['left', 'center', 'right', 'start', 'end'], '写成 left、center 或 right'),
  'white-space': (value) => keywordHint(value, ['normal', 'nowrap'], '写成 normal 或 nowrap'),
  'text-wrap': (value) => keywordHint(value, ['wrap', 'balance'], '写成 wrap 或 balance'),
  'max-width': (value) => lengthHint(value, '写成 320 或 320px'),
  'max-height': (value) => lengthHint(value, '写成 180 或 180px'),
  width: (value) => lengthHint(value, '写成 320 或 320px'),
  height: (value) => lengthHint(value, '写成 180 或 180px'),
  display: (value) => keywordHint(value, ['flex', 'inline-flex', 'block'], '写成 flex、inline-flex 或 block'),
  'flex-direction': (value) => keywordHint(value, ['row', 'column'], '写成 row 或 column'),
  'align-items': (value) =>
    keywordHint(
      value,
      ['flex-start', 'flex-end', 'center', 'stretch', 'start', 'end', 'baseline'],
      '写成 flex-start、center、flex-end、stretch 或 baseline',
    ),
  'align-self': (value) =>
    keywordHint(
      value,
      ['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'start', 'end', 'baseline'],
      '写成 auto、flex-start、center、flex-end、stretch 或 baseline',
    ),
  'align-content': (value) =>
    keywordHint(
      value,
      ['flex-start', 'flex-end', 'center', 'stretch', 'space-between', 'space-around', 'space-evenly', 'start', 'end'],
      '写成 flex-start、center、stretch 或 space-between',
    ),
  'justify-content': (value) =>
    keywordHint(
      value,
      ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end'],
      '写成 flex-start、center、flex-end 或 space-between',
    ),
  'flex-wrap': (value) => keywordHint(value, ['nowrap', 'wrap', 'wrap-reverse'], '写成 nowrap、wrap 或 wrap-reverse'),
  flex: (value) => (value.trim() === '1' ? null : { hint: '写成 flex:1。需要分开控制时用 flex-grow 和 flex-shrink' }),
  'flex-grow': (value) => numberHint(value, '写成数字，例如 1'),
  'flex-shrink': (value) => numberHint(value, '写成数字，例如 1'),
  gap: (value) => lengthHint(value, '写成 16 或 16px'),
  'row-gap': (value) => lengthHint(value, '写成 16 或 16px'),
  'column-gap': (value) => lengthHint(value, '写成 16 或 16px'),
  padding: (value) => (parseEdges(value) == null ? { hint: '写成 12、12 16，或带 px 的 1 到 4 个长度' } : null),
  border: (value) => (value.trim().toLowerCase() === 'none' || parseBorder(value) != null ? null : { hint: '写成 2px solid #fff' }),
  'border-radius': (value) => lengthHint(value, '写成 12 或 12px'),
  background: () => null,
  'background-color': () => null,
  opacity: (value) => numberHint(value, '写成 0 到 1 的数字，例如 0.5'),
  rotate: (value) => numberHint(value, '写成角度，例如 12'),
  rotateX: (value) => numberHint(value, '写成角度，例如 20'),
  rotateY: (value) => numberHint(value, '写成角度，例如 20'),
  z: (value) => numberHint(value, '写成像素，例如 40'),
  scale: (value) => {
    const parts = value.trim().split(/[\s,]+/).filter(Boolean)
    if (parts.length === 0 || parts.length > 2) return { hint: '写成 1.2 或 1.2 0.8' }
    if (parts.some((part) => parseNumber(part) == null)) return { hint: '写成 1.2 或 1.2 0.8' }
    return null
  },
  origin: (value) => (readOrigin(value).invalid ? { hint: '写成 center、top-left，或 120 80、30% 40%' } : null),
}

/** 拼写提示用的样式名。包含会生效、以及别处单独校验的名字。 */
export function cssPropertyNames(): string[] {
  return [...Object.keys(STYLE_CHECKS), ...QUIET_STYLE]
}

/**
 * 一条样式声明的诊断。
 * null：值可用，或这条已经由布局单独报告。
 * `unknown`：名字不在样式表里。
 */
export function diagnoseStyle(key: string, value: string): StyleDiagnostic | 'unknown' | null {
  if (QUIET_STYLE.has(key)) return null
  const check = STYLE_CHECKS[key]
  if (!check) return 'unknown'
  return check(value)
}
