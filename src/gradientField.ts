import { createCanvas, type CanvasPattern, type CanvasRenderingContext2D, type SKRSContext2D } from '@napi-rs/canvas'

/** 元素盒子。渐变坐标相对盒子左上角，y 向下。 */
export type GradientBox = { x: number; y: number; width: number; height: number }

export type Rgba = { r: number; g: number; b: number; a: number }

type Domain =
  | { kind: 'box' }
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'radial'; cx: number; cy: number; r0: number; r1: number }
  | { kind: 'conic'; cx: number; cy: number; from: number }

type Stop = { t: number; L: number; a: number; b: number; alpha: number }

export type FieldGradient = {
  domain: Domain
  rows: Stop[][]
  /** 第一个色标，给光晕默认色用。 */
  first: Rgba
}

type Token =
  | { t: 'word'; v: string }
  | { t: 'num'; v: number }
  | { t: 'color'; v: Rgba }
  | { t: 'slash' }

const DOMAIN_WORDS = new Set(['box', 'linear', 'radial', 'conic'])

export function isGradientPaint(value: string): boolean {
  return /^gradient\s*\(/i.test(value.trim())
}

export function parseFieldGradient(input: string): FieldGradient | null {
  const wrapped = /^\s*gradient\s*\(([\s\S]*)\)\s*$/i.exec(input.trim())
  if (!wrapped) return null
  const tokens = tokenize(wrapped[1]!)
  if (!tokens) return null
  return parseTokens(tokens)
}

/** 在盒子坐标系里取渐变颜色。x、y 与 box 同一空间。 */
export function sampleGradient(gradient: FieldGradient, x: number, y: number, box: GradientBox): Rgba {
  const lx = x - box.x
  const ly = y - box.y
  const { u, v } = mapDomain(gradient.domain, lx, ly, box.width, box.height)
  return unpremultiply(sampleField(gradient.rows, u, v))
}

/**
 * 把纯色或 gradient() 变成当前坐标系里的 fillStyle / strokeStyle。
 * box 是元素盒子，pad 是描边向外多铺的像素。
 */
export function gradientStyle(
  ctx: CanvasRenderingContext2D,
  paint: string,
  box: GradientBox,
  pad: number,
): string | CanvasPattern {
  if (!isGradientPaint(paint)) return paint
  const gradient = parseFieldGradient(paint)
  if (!gradient) return '#000000'
  const destW = box.width + pad * 2
  const destH = box.height + pad * 2
  if (!(destW > 0) || !(destH > 0)) return '#000000'

  const sk = ctx as SKRSContext2D
  const tr = sk.getTransform()
  const sx = Math.max(Math.hypot(tr.a, tr.b), 1e-6)
  const sy = Math.max(Math.hypot(tr.c, tr.d), 1e-6)
  let pw = Math.max(1, Math.ceil(destW * sx))
  let ph = Math.max(1, Math.ceil(destH * sy))
  const maxPixels = 8_000_000
  if (pw * ph > maxPixels) {
    const k = Math.sqrt(maxPixels / (pw * ph))
    pw = Math.max(1, Math.floor(pw * k))
    ph = Math.max(1, Math.floor(ph * k))
  }

  const off = createCanvas(pw, ph)
  const octx = off.getContext('2d')
  const image = octx.createImageData(pw, ph)
  const data = image.data
  const destX = box.x - pad
  const destY = box.y - pad
  for (let j = 0; j < ph; j++) {
    const y = destY + ((j + 0.5) * destH) / ph
    for (let i = 0; i < pw; i++) {
      const x = destX + ((i + 0.5) * destW) / pw
      const color = sampleGradient(gradient, x, y, box)
      const p = (j * pw + i) * 4
      data[p] = color.r
      data[p + 1] = color.g
      data[p + 2] = color.b
      data[p + 3] = color.a
    }
  }
  octx.putImageData(image, 0, 0)
  const pattern = sk.createPattern(off, 'no-repeat')
  pattern.setTransform({ a: destW / pw, b: 0, c: 0, d: destH / ph, e: destX, f: destY })
  return pattern
}

function parseTokens(tokens: Token[]): FieldGradient | null {
  let i = 0
  let domain: Domain = { kind: 'box' }
  const first = tokens[0]
  if (first?.t === 'word') {
    if (!DOMAIN_WORDS.has(first.v)) return null
    const nums: number[] = []
    i = 1
    while (i < tokens.length && tokens[i]!.t === 'num') {
      nums.push((tokens[i] as { t: 'num'; v: number }).v)
      i++
    }
    const built = buildDomain(first.v, nums)
    if (!built) return null
    domain = built
  }

  const rows: Array<Array<{ t: number | null; color: Rgba }>> = []
  let row: Array<{ t: number | null; color: Rgba }> = []
  let pending: { t: number | null; color: Rgba } | null = null
  let firstColor: Rgba | null = null
  const flush = () => {
    if (!pending) return
    row.push(pending)
    pending = null
  }
  for (; i < tokens.length; i++) {
    const tok = tokens[i]!
    if (tok.t === 'slash') {
      flush()
      if (row.length === 0) return null
      rows.push(row)
      row = []
      continue
    }
    if (tok.t === 'color') {
      flush()
      if (!firstColor) firstColor = tok.v
      pending = { t: null, color: tok.v }
      continue
    }
    if (tok.t === 'num') {
      if (!pending || pending.t != null) return null
      pending.t = tok.v
      continue
    }
    return null
  }
  flush()
  if (row.length === 0) return null
  rows.push(row)

  const compiled = rows.map(compileRow)
  if (compiled.some((r) => r == null) || !firstColor) return null
  return { domain, rows: compiled as Stop[][], first: firstColor }
}

export function rgbaToCss(color: Rgba): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  const rgb = `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`
  return color.a === 255 ? rgb : `${rgb}${hex(color.a)}`
}

function buildDomain(kind: string, nums: number[]): Domain | null {
  if (kind === 'box') return nums.length === 0 ? { kind: 'box' } : null
  if (kind === 'linear') {
    if (nums.length !== 4) return null
    return { kind: 'linear', x1: nums[0]!, y1: nums[1]!, x2: nums[2]!, y2: nums[3]! }
  }
  if (kind === 'radial') {
    if (nums.length === 3) return { kind: 'radial', cx: nums[0]!, cy: nums[1]!, r0: 0, r1: nums[2]! }
    if (nums.length === 4) return { kind: 'radial', cx: nums[0]!, cy: nums[1]!, r0: nums[2]!, r1: nums[3]! }
    return null
  }
  if (kind === 'conic') {
    if (nums.length === 2) return { kind: 'conic', cx: nums[0]!, cy: nums[1]!, from: 0 }
    if (nums.length === 3) return { kind: 'conic', cx: nums[0]!, cy: nums[1]!, from: nums[2]! }
    return null
  }
  return null
}

function compileRow(raw: Array<{ t: number | null; color: Rgba }>): Stop[] | null {
  if (raw.length === 0) return null
  const offsets = resolveOffsets(raw.map((s) => s.t))
  const stops = raw.map((s, i) => {
    const lab = rgbToOklab(s.color.r, s.color.g, s.color.b)
    const alpha = s.color.a / 255
    return { t: offsets[i]!, L: lab.L * alpha, a: lab.a * alpha, b: lab.b * alpha, alpha }
  })
  stops.sort((p, q) => p.t - q.t)
  return stops
}

function resolveOffsets(raw: Array<number | null>): number[] {
  const n = raw.length
  const t = raw.slice()
  if (t[0] == null) t[0] = 0
  if (n === 1) return [clamp01(t[0] as number)]
  if (t[n - 1] == null) t[n - 1] = 1
  let i = 1
  while (i < n - 1) {
    if (t[i] != null) {
      i++
      continue
    }
    let j = i
    while (j < n && t[j] == null) j++
    const left = t[i - 1] as number
    const right = t[j] as number
    const count = j - (i - 1)
    for (let k = i; k < j; k++) t[k] = left + ((right - left) * (k - (i - 1))) / count
    i = j
  }
  for (let k = 1; k < n; k++) {
    if ((t[k] as number) < (t[k - 1] as number)) t[k] = t[k - 1]
  }
  return t.map((v) => clamp01(v as number))
}

function mapDomain(domain: Domain, x: number, y: number, w: number, h: number): { u: number; v: number } {
  if (domain.kind === 'box') {
    return { u: w === 0 ? 0 : x / w, v: h === 0 ? 0 : y / h }
  }
  if (domain.kind === 'linear') {
    const dx = domain.x2 - domain.x1
    const dy = domain.y2 - domain.y1
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return { u: 0, v: 0 }
    const px = x - domain.x1
    const py = y - domain.y1
    return { u: (px * dx + py * dy) / len2, v: (px * dy - py * dx) / len2 }
  }
  if (domain.kind === 'radial') {
    const dx = x - domain.cx
    const dy = y - domain.cy
    const dist = Math.hypot(dx, dy)
    const span = domain.r1 - domain.r0
    const u = span === 0 ? (dist <= domain.r0 ? 0 : 1) : (dist - domain.r0) / span
    return { u, v: angle01(dx, dy, 0) }
  }
  const dx = x - domain.cx
  const dy = y - domain.cy
  const far = Math.max(Math.hypot(domain.cx, domain.cy), Math.hypot(domain.cx - w, domain.cy), Math.hypot(domain.cx, domain.cy - h), Math.hypot(domain.cx - w, domain.cy - h))
  return { u: angle01(dx, dy, domain.from), v: far === 0 ? 0 : Math.hypot(dx, dy) / far }
}

/** 0 在正上方，顺时针到 1。y 向下。 */
function angle01(dx: number, dy: number, fromDeg: number): number {
  const ang = Math.atan2(dy, dx)
  const zero = -Math.PI / 2 + (fromDeg * Math.PI) / 180
  const tau = Math.PI * 2
  let t = ang - zero
  t = ((t % tau) + tau) % tau
  return t / tau
}

function sampleField(rows: Stop[][], u: number, v: number): Stop {
  const uu = clamp01(u)
  if (rows.length === 1) return sampleStops(rows[0]!, uu)
  const vv = clamp01(v)
  if (vv >= 1) return sampleStops(rows[rows.length - 1]!, uu)
  const pos = vv * (rows.length - 1)
  const i = Math.min(rows.length - 2, Math.floor(pos))
  const tv = pos - i
  return lerpStop(sampleStops(rows[i]!, uu), sampleStops(rows[i + 1]!, uu), tv)
}

function sampleStops(stops: Stop[], u: number): Stop {
  const first = stops[0]!
  if (stops.length === 1 || u <= first.t) return first
  const last = stops[stops.length - 1]!
  if (u >= last.t) return last
  let i = 0
  while (i < stops.length - 1 && stops[i + 1]!.t < u) i++
  const a = stops[i]!
  const b = stops[i + 1]!
  const span = b.t - a.t
  return lerpStop(a, b, span === 0 ? 1 : (u - a.t) / span)
}

function lerpStop(a: Stop, b: Stop, t: number): Stop {
  return {
    t: 0,
    L: a.L + (b.L - a.L) * t,
    a: a.a + (b.a - a.a) * t,
    b: a.b + (b.b - a.b) * t,
    alpha: a.alpha + (b.alpha - a.alpha) * t,
  }
}

function unpremultiply(s: Stop): Rgba {
  if (s.alpha <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 }
  const [r, g, b] = oklabToSrgb(s.L / s.alpha, s.a / s.alpha, s.b / s.alpha)
  return { r, g, b, a: Math.round(clamp01(s.alpha) * 255) }
}

function tokenize(body: string): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < body.length) {
    const ch = body[i]!
    if (/\s/.test(ch) || ch === ',') {
      i++
      continue
    }
    if (ch === '/') {
      out.push({ t: 'slash' })
      i++
      continue
    }
    if (ch === '#') {
      const hex = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/.exec(body.slice(i))
      if (!hex) return null
      const color = hexToRgba(hex[0])
      if (!color) return null
      out.push({ t: 'color', v: color })
      i += hex[0].length
      continue
    }
    if (/[a-zA-Z]/.test(ch)) {
      const ident = /^[a-zA-Z]+/.exec(body.slice(i))!
      const word = ident[0].toLowerCase()
      i += ident[0].length
      const next = skipCommaSpace(body, i)
      if (body[next] === '(' && (word === 'rgb' || word === 'rgba')) {
        const end = matchParen(body, next)
        if (end < 0) return null
        const color = parseRgb(body.slice(next + 1, end))
        if (!color) return null
        out.push({ t: 'color', v: color })
        i = end + 1
        continue
      }
      if (word === 'transparent') {
        out.push({ t: 'color', v: { r: 0, g: 0, b: 0, a: 0 } })
        continue
      }
      out.push({ t: 'word', v: word })
      continue
    }
    if (ch === '-' || ch === '.' || /[0-9]/.test(ch)) {
      const num = /^-?(?:\d+\.?\d*|\.\d+)(?:px)?/i.exec(body.slice(i))
      if (!num || !/\d/.test(num[0])) return null
      out.push({ t: 'num', v: Number.parseFloat(num[0]) })
      i += num[0].length
      continue
    }
    return null
  }
  return out
}

function skipCommaSpace(s: string, i: number): number {
  while (i < s.length && (/\s/.test(s[i]!) || s[i] === ',')) i++
  return i
}

function matchParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** `#rgb`…`#rrggbbaa`、`rgb()`、`rgba()`、`transparent`、`black`、`white`。 */
export function parseColor(text: string): Rgba | null {
  const t = text.trim().toLowerCase()
  if (t.startsWith('#')) return hexToRgba(t)
  const fn = /^rgba?\(([^)]*)\)$/.exec(t)
  if (fn) return parseRgb(fn[1]!)
  if (t === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (t === 'black') return { r: 0, g: 0, b: 0, a: 255 }
  if (t === 'white') return { r: 255, g: 255, b: 255, a: 255 }
  return null
}

export function hexToRgba(hex: string): Rgba | null {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  const n = Number.parseInt(h, 16)
  if (!Number.isFinite(n)) return null
  if (h.length === 6) return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 }
  return { r: (n >> 24) & 255, g: (n >> 16) & 255, b: (n >> 8) & 255, a: n & 255 }
}

function parseRgb(body: string): Rgba | null {
  const parts = body
    .trim()
    .split(/[\s,\/]+/)
    .filter(Boolean)
  if (parts.length !== 3 && parts.length !== 4) return null
  const nums = parts.map((p) => Number.parseFloat(p))
  if (nums.some((n) => !Number.isFinite(n))) return null
  const [r, g, b, a] = nums
  const alpha = a == null ? 255 : Math.round(clamp01(a) * 255)
  return {
    r: clamp255(r!),
    g: clamp255(g!),
    b: clamp255(b!),
    a: alpha,
  }
}

export function rgbToOklab(r8: number, g8: number, b8: number): { L: number; a: number; b: number } {
  const r = srgbToLinear(r8)
  const g = srgbToLinear(g8)
  const b = srgbToLinear(b8)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

export function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = L + 0.3963377774 * a + 0.2158037573 * b
  const m = L - 0.1055613458 * a - 0.0638541728 * b
  const s = L - 0.0894841775 * a - 1.291485548 * b
  const l3 = l * l * l
  const m3 = m * m * m
  const s3 = s * s * s
  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const bv = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bv)]
}

function srgbToLinear(channel: number): number {
  const x = channel / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(channel: number): number {
  const x = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
  return clamp255(Math.round(x * 255))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)))
}
