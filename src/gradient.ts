import { createCanvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { isGradientPaint, parseFieldGradient, rgbaToCss, sampleGradient } from './gradientField.js'

export { isGradientPaint, sampleGradient }

export type GradientStop = { color: string; offset: number }

export type RadialExtent = 'closest-side' | 'farthest-side' | 'closest-corner' | 'farthest-corner'

export type Gradient = {
  kind: 'linear' | 'radial'
  /** CSS 角度：0 朝上，顺时针。线性渐变默认 180，也就是从上到下。 */
  angle: number
  /** 径向渐变的圆心，相对元素盒子的 0 到 1。 */
  at: { x: number; y: number }
  /** 径向渐变盖住盒子的方式。缺省是 farthest-corner，和 CSS 一样。 */
  extent?: RadialExtent
  stops: GradientStop[]
}

let colorProbe: CanvasRenderingContext2D | undefined

/** 画布能当成色标的颜色。不认识的名字、坏掉的 hex、残缺的 rgb() 都不是。 */
function isCanvasColor(color: string): boolean {
  const text = color.trim()
  if (!text || text.toLowerCase() === 'currentcolor') return false
  colorProbe ??= createCanvas(1, 1).getContext('2d')
  try {
    colorProbe.createLinearGradient(0, 0, 1, 0).addColorStop(0, text)
    return true
  } catch {
    return false
  }
}

function splitArgs(value: string): string[] {
  const args: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      if (cur.trim()) args.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) args.push(cur.trim())
  return args
}

function directionAngle(token: string): number | undefined {
  const text = token.trim().toLowerCase().replace(/\s+/g, ' ')
  const named: Record<string, number> = {
    'to top': 0,
    'to right': 90,
    'to bottom': 180,
    'to left': 270,
    'to top right': 45,
    'to right top': 45,
    'to bottom right': 135,
    'to right bottom': 135,
    'to bottom left': 225,
    'to left bottom': 225,
    'to top left': 315,
    'to left top': 315,
  }
  if (text in named) return named[text]
  const angle = /^(-?\d*\.?\d+)deg$/.exec(text)
  return angle ? Number(angle[1]) : undefined
}

function parseOffset(token: string | undefined): number | undefined {
  if (token == null) return undefined
  const text = token.trim()
  if (text.endsWith('%')) {
    const n = Number(text.slice(0, -1))
    return Number.isFinite(n) ? n / 100 : undefined
  }
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

function parseStop(arg: string): { color: string; offset?: number } | undefined {
  const parts = arg.trim().split(/\s+/)
  if (parts.length === 0 || parts.length > 2) return undefined
  const color = parts[0]!
  if (!isCanvasColor(color)) return undefined
  if (parts.length === 1) return { color }
  const offset = parseOffset(parts[1])
  if (offset == null) return undefined
  return { color, offset }
}

const RADIAL_EXTENTS = new Set<RadialExtent>(['closest-side', 'farthest-side', 'closest-corner', 'farthest-corner'])

function keywordOffset(token: string): number | undefined {
  if (token === 'left' || token === 'top') return 0
  if (token === 'center') return 0.5
  if (token === 'right' || token === 'bottom') return 1
  return undefined
}

function axisOf(token: string): 'x' | 'y' | 'either' | undefined {
  if (token === 'left' || token === 'right') return 'x'
  if (token === 'top' || token === 'bottom') return 'y'
  if (token === 'center') return 'either'
  return undefined
}

/** CSS `<position>`。一个值时另一个轴是 center。`top left` 按轴认，不按书写顺序硬套到 x、y。 */
function readPosition(parts: string[]): { x: number; y: number } | undefined {
  if (parts.length === 0 || parts.length > 2) return undefined
  const value = (token: string) => keywordOffset(token) ?? parseOffset(token)
  if (parts.length === 1) {
    const token = parts[0]!
    const axis = axisOf(token)
    if (axis === 'y') return { x: 0.5, y: keywordOffset(token)! }
    if (axis === 'x') return { x: keywordOffset(token)!, y: 0.5 }
    const n = value(token)
    if (n == null) return undefined
    return { x: n, y: 0.5 }
  }
  const a = parts[0]!
  const b = parts[1]!
  const ax = axisOf(a)
  const bx = axisOf(b)
  if (ax === 'y' && (bx === 'x' || bx === 'either')) return { x: keywordOffset(b)!, y: keywordOffset(a)! }
  if (ax === 'x' && (bx === 'y' || bx === 'either')) return { x: keywordOffset(a)!, y: keywordOffset(b)! }
  if (ax === 'either' && bx === 'x') return { x: keywordOffset(b)!, y: 0.5 }
  if (ax === 'either' && bx === 'y') return { x: 0.5, y: keywordOffset(b)! }
  if (ax === 'y') {
    const x = value(b)
    const y = keywordOffset(a)
    if (x == null || y == null) return undefined
    return { x, y }
  }
  if (bx === 'y') {
    const x = value(a)
    const y = keywordOffset(b)
    if (x == null || y == null) return undefined
    return { x, y }
  }
  const x = value(a)
  const y = value(b)
  if (x == null || y == null) return undefined
  return { x, y }
}

/**
 * `circle` / `ellipse`、尺寸和 `at` 位置。不是这种前缀时返回 null，调用方把它当色标。
 * 写了形状但位置读不出来时返回 undefined，整段渐变无效，不能把 `circle` 当成颜色。
 */
function parseRadialPrelude(raw: string): { at: { x: number; y: number }; extent: RadialExtent } | null | undefined {
  const parts = raw.trim().toLowerCase().replace(/\s+/g, ' ').split(' ')
  const radial = parts.some((part) => part === 'circle' || part === 'ellipse' || part === 'at' || RADIAL_EXTENTS.has(part as RadialExtent))
  if (!radial) return null
  let extent: RadialExtent = 'farthest-corner'
  let i = 0
  while (i < parts.length && parts[i] !== 'at') {
    const part = parts[i]!
    if (part === 'circle' || part === 'ellipse') {
      i++
      continue
    }
    if (RADIAL_EXTENTS.has(part as RadialExtent)) {
      extent = part as RadialExtent
      i++
      continue
    }
    if (/^-?\d*\.?\d+(px|%)?$/.test(part)) {
      i++
      continue
    }
    return undefined
  }
  if (i === parts.length) return { at: { x: 0.5, y: 0.5 }, extent }
  const at = readPosition(parts.slice(i + 1))
  if (!at) return undefined
  return { at, extent }
}

function assignOffsets(stops: Array<{ color: string; offset?: number }>): GradientStop[] | undefined {
  if (stops.length === 0) return undefined
  const out: GradientStop[] = stops.map((stop) => ({ color: stop.color, offset: stop.offset ?? Number.NaN }))
  if (out[0]!.offset !== out[0]!.offset) out[0]!.offset = 0
  if (out[out.length - 1]!.offset !== out[out.length - 1]!.offset) out[out.length - 1]!.offset = 1
  let i = 0
  while (i < out.length) {
    if (out[i]!.offset === out[i]!.offset) {
      i++
      continue
    }
    const start = i - 1
    let end = i + 1
    while (end < out.length && out[end]!.offset !== out[end]!.offset) end++
    const left = out[start]!.offset
    const right = out[end]!.offset
    const span = end - start
    for (let k = 1; k < span; k++) out[start + k]!.offset = left + ((right - left) * k) / span
    i = end
  }
  return out
}

/** 解析 `linear-gradient(...)` / `radial-gradient(...)`。不是这种写法时返回 undefined。 */
export function parseCssGradient(value: string | undefined): Gradient | undefined {
  if (!value) return undefined
  const match = /^(linear-gradient|radial-gradient)\(([\s\S]*)\)$/i.exec(value.trim())
  if (!match) return undefined
  const kind = match[1]!.toLowerCase().startsWith('radial') ? 'radial' : 'linear'
  const args = splitArgs(match[2]!)
  if (args.length === 0) return undefined
  let angle = 180
  let at = { x: 0.5, y: 0.5 }
  let extent: RadialExtent = 'farthest-corner'
  let index = 0
  const first = args[0]!
  if (kind === 'linear') {
    const parsed = directionAngle(first)
    if (parsed != null) {
      angle = parsed
      index = 1
    }
  } else {
    const prelude = parseRadialPrelude(first)
    if (prelude === undefined) return undefined
    if (prelude) {
      at = prelude.at
      extent = prelude.extent
      index = 1
    }
  }
  const parsedStops = args.slice(index).map(parseStop)
  if (parsedStops.some((stop) => stop == null)) return undefined
  const stops = assignOffsets(parsedStops as Array<{ color: string; offset?: number }>)
  if (!stops || stops.length === 0) return undefined
  return { kind, angle, at, stops, ...(kind === 'radial' ? { extent } : {}) }
}

export function isGradient(value: string | undefined): boolean {
  if (value == null) return false
  const text = value.trim()
  return isGradientPaint(text) || /^(linear-gradient|radial-gradient)\(/i.test(text)
}

/**
 * `gradient()` 返回矩阵渐变；`linear-gradient` / `radial-gradient` 返回 CSS 渐变。
 * 写了 `gradient()` 但解析失败时返回 null。
 */
export function parseGradient(value: string | undefined): Gradient | ReturnType<typeof parseFieldGradient> | undefined {
  if (value != null && isGradientPaint(value)) return parseFieldGradient(value)
  return parseCssGradient(value)
}

/** 渐变取第一个色标，给光晕默认色用。普通颜色原样返回。 */
export function solidPaint(value: string | undefined, fallback: string): string {
  if (!value || value === 'none' || value === 'transparent') return fallback
  if (isGradientPaint(value)) {
    const field = parseFieldGradient(value)
    if (!field) return fallback
    return rgbaToCss(field.first)
  }
  const gradient = parseCssGradient(value)
  if (gradient) return gradient.stops[0]?.color ?? fallback
  return value
}

export function canvasPaint(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string | ReturnType<CanvasRenderingContext2D['createLinearGradient']> {
  const gradient = parseCssGradient(value)
  if (!gradient) return value
  const width = Math.max(w, 1)
  const height = Math.max(h, 1)
  if (gradient.kind === 'radial') {
    const cx = x + gradient.at.x * width
    const cy = y + gradient.at.y * height
    const radius = radialRadius(x, y, width, height, cx, cy, gradient.extent ?? 'farthest-corner')
    const paint = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(radius, 1))
    if (!addStops(paint, gradient.stops)) return '#000000'
    return paint
  }
  const radians = (gradient.angle * Math.PI) / 180
  const dx = Math.sin(radians)
  const dy = -Math.cos(radians)
  const length = Math.abs(width * dx) + Math.abs(height * dy)
  const cx = x + width / 2
  const cy = y + height / 2
  const paint = ctx.createLinearGradient(cx - (dx * length) / 2, cy - (dy * length) / 2, cx + (dx * length) / 2, cy + (dy * length) / 2)
  if (!addStops(paint, gradient.stops)) return '#000000'
  return paint
}

/** 画布的径向渐变是圆。`ellipse` 也用这个圆盖住盒子，尺寸关键字决定半径。 */
function radialRadius(x: number, y: number, width: number, height: number, cx: number, cy: number, extent: RadialExtent): number {
  const left = Math.max(0, cx - x)
  const right = Math.max(0, x + width - cx)
  const top = Math.max(0, cy - y)
  const bottom = Math.max(0, y + height - cy)
  const sides = [left, right, top, bottom]
  const corners = [Math.hypot(left, top), Math.hypot(right, top), Math.hypot(left, bottom), Math.hypot(right, bottom)]
  if (extent === 'closest-side') return Math.min(...sides)
  if (extent === 'farthest-side') return Math.max(...sides)
  if (extent === 'closest-corner') return Math.min(...corners)
  return Math.max(...corners)
}

function addStops(paint: ReturnType<CanvasRenderingContext2D['createLinearGradient']>, stops: GradientStop[]): boolean {
  let added = 0
  for (const stop of stops) {
    try {
      paint.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color)
      added++
    } catch {
      // 解析时已经拒绝画布不认识的颜色。这里再挡住，避免一档都没加上时绘制抛出。
    }
  }
  return added > 0
}
