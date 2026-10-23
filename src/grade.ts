import { registerFilter } from './filter.js'
import { oklabToSrgb, parseColor, rgbToOklab } from './gradientField.js'
import { splitCssTokens } from './style.js'
import type { GradePresetName, GradeSpec, GradeTone } from './types.js'

type GradeParams = Omit<GradeSpec, 'preset' | 'amount'>

export const NEUTRAL_GRADE: GradeParams = {
  contrast: 1,
  fade: 0,
  saturate: 1,
  warmth: 0,
  vignette: 0,
  vignetteColor: '#000000',
}

export const GRADE_PRESETS: Record<GradePresetName, GradeParams> = {
  lomo: {
    ...NEUTRAL_GRADE,
    shadows: { color: '#1f5a6e', amount: 0.8 },
    highlights: { color: '#ffd59a', amount: 0.6 },
    contrast: 1.2,
    saturate: 1.15,
    vignette: 0.55,
  },
  matte: {
    ...NEUTRAL_GRADE,
    highlights: { color: '#fff0d8', amount: 0.3 },
    contrast: 0.9,
    fade: 0.35,
    saturate: 0.85,
  },
  chrome: {
    ...NEUTRAL_GRADE,
    shadows: { color: '#1a6a7a', amount: 0.8 },
    highlights: { color: '#ffb070', amount: 0.7 },
    contrast: 1.1,
    saturate: 1.1,
  },
  bleach: {
    ...NEUTRAL_GRADE,
    contrast: 1.25,
    fade: 0.05,
    saturate: 0.55,
  },
  mono: {
    ...NEUTRAL_GRADE,
    contrast: 1.1,
    saturate: 0,
  },
}

const RANGES = {
  contrast: [0, 2],
  fade: [0, 1],
  saturate: [0, 2],
  warmth: [-1, 1],
} as const

export type GradeParseResult = { spec: GradeSpec } | { error: string }

function splitClauses(value: string): string[] {
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

function unitNumber(token: string | undefined, min: number, max: number): number | undefined {
  if (token == null) return undefined
  const t = token.trim()
  const pct = /^(-?\d*\.?\d+)%$/.exec(t)
  const n = pct ? Number.parseFloat(pct[1]!) / 100 : Number(t)
  if (!Number.isFinite(n) || n < min || n > max) return undefined
  return n
}

function isPreset(word: string): word is GradePresetName {
  return Object.prototype.hasOwnProperty.call(GRADE_PRESETS, word)
}

/**
 * `grade="lomo 0.8, fade 0.1, shadows #2a6080 0.3"`。
 * 第一项可以是预设和整体强度，后面的项覆盖同名参数。写 `none` 返回 undefined。
 */
export function parseGrade(value: string | undefined): GradeParseResult | undefined {
  if (value == null || value.trim() === '' || value.trim().toLowerCase() === 'none') return undefined
  const clauses = splitClauses(value)
  if (clauses.some((clause) => clause === '')) return { error: '多了一个逗号' }
  let params: GradeParams = { ...NEUTRAL_GRADE }
  let preset: GradePresetName | undefined
  let amount = 1
  for (let i = 0; i < clauses.length; i++) {
    const tokens = splitCssTokens(clauses[i]!)
    const name = tokens[0]!.toLowerCase()
    const args = tokens.slice(1)
    if (isPreset(name)) {
      if (i !== 0) return { error: `预设 ${name} 只能写在第一项` }
      if (args.length > 1) return { error: `预设后面只能跟一个强度：${clauses[i]}` }
      if (args.length === 1) {
        const n = unitNumber(args[0], 0, 1)
        if (n === undefined) return { error: `预设强度要在 0 到 1 之间：${args[0]}` }
        amount = n
      }
      preset = name
      params = { ...GRADE_PRESETS[name] }
      continue
    }
    if (name === 'shadows' || name === 'midtones' || name === 'highlights') {
      if (args.length < 1 || args.length > 2) return { error: `${name} 写成 ${name} #2a6080 0.5` }
      if (!parseColor(args[0]!)) return { error: `无法识别的颜色：${args[0]}` }
      const toneAmount = args.length === 2 ? unitNumber(args[1], 0, 1) : 1
      if (toneAmount === undefined) return { error: `${name} 的强度要在 0 到 1 之间：${args[1]}` }
      const tone: GradeTone = { color: args[0]!, amount: toneAmount }
      params[name] = tone
      continue
    }
    if (name === 'vignette') {
      if (args.length < 1 || args.length > 2) return { error: 'vignette 写成 vignette 0.5 或 vignette 0.5 #120c08' }
      const v = unitNumber(args[0], 0, 1)
      if (v === undefined) return { error: `vignette 要在 0 到 1 之间：${args[0]}` }
      if (args[1] != null && !parseColor(args[1])) return { error: `无法识别的颜色：${args[1]}` }
      params.vignette = v
      if (args[1] != null) params.vignetteColor = args[1]
      continue
    }
    if (name in RANGES) {
      const key = name as keyof typeof RANGES
      const [min, max] = RANGES[key]
      if (args.length !== 1) return { error: `${key} 后面写一个数` }
      const n = unitNumber(args[0], min, max)
      if (n === undefined) return { error: `${key} 要在 ${min} 到 ${max} 之间：${args[0]}` }
      params[key] = n
      continue
    }
    return { error: `不认识的项：${clauses[i]}` }
  }
  return { spec: { ...(preset ? { preset } : {}), amount, ...params } }
}

const TINT_MAX = 0.1
const WARM_A = 0.02
const WARM_B = 0.06
const SQRT2 = Math.SQRT2

/** 色调在 OKLab a、b 上的偏移。亮度不参与，颜色越鲜艳偏得越多。 */
function toneShift(tone: GradeTone | undefined): [number, number] {
  if (!tone || tone.amount <= 0) return [0, 0]
  const rgba = parseColor(tone.color)
  if (!rgba) return [0, 0]
  const lab = rgbToOklab(rgba.r, rgba.g, rgba.b)
  const chroma = Math.hypot(lab.a, lab.b)
  if (chroma < 1e-4) return [0, 0]
  const vivid = Math.min(1, chroma / Math.max(lab.L, 0.05) / 0.25)
  const k = (TINT_MAX * vivid * tone.amount) / chroma
  return [lab.a * k, lab.b * k]
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** 盒子在像素缓冲里的位置，用来算暗角。 */
export type GradeFrame = { x: number; y: number; width: number; height: number }

/**
 * 原地调色。data 是 getImageData 的非预乘 RGBA。
 * mask 是同尺寸的 RGBA，取 alpha 作为强度；不传就是全强度。
 */
export function applyGrade(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  spec: GradeSpec,
  frame: GradeFrame,
  mask?: Uint8ClampedArray,
): void {
  if (spec.amount <= 0) return
  const [sa, sb] = toneShift(spec.shadows)
  const [ma, mb] = toneShift(spec.midtones)
  const [ha, hb] = toneShift(spec.highlights)
  const fadeLift = spec.fade * 0.3
  const warmA = spec.warmth * WARM_A
  const warmB = spec.warmth * WARM_B
  const vignetteRgba = parseColor(spec.vignetteColor) ?? { r: 0, g: 0, b: 0, a: 255 }
  const vig = rgbToOklab(vignetteRgba.r, vignetteRgba.g, vignetteRgba.b)
  const fw = Math.max(frame.width, 1e-6)
  const fh = Math.max(frame.height, 1e-6)

  for (let py = 0; py < height; py++) {
    const ny = ((py + 0.5 - frame.y) / fh - 0.5) * 2
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4
      if (data[i + 3] === 0) continue
      const strength = spec.amount * (mask ? mask[i + 3]! / 255 : 1)
      if (strength <= 0) continue
      const r0 = data[i]!
      const g0 = data[i + 1]!
      const b0 = data[i + 2]!
      const lab = rgbToOklab(r0, g0, b0)
      let L = 0.5 + (lab.L - 0.5) * spec.contrast
      L = fadeLift + L * (1 - fadeLift)
      let a = lab.a * spec.saturate + warmA
      let b = lab.b * spec.saturate + warmB
      const t = Math.min(1, Math.max(0, L))
      const ws = (1 - t) * (1 - t)
      const wh = t * t
      const wm = 1 - ws - wh
      a += ws * sa + wm * ma + wh * ha
      b += ws * sb + wm * mb + wh * hb
      if (spec.vignette > 0) {
        const nx = ((px + 0.5 - frame.x) / fw - 0.5) * 2
        const w = smoothstep(0.35, 1, Math.hypot(nx, ny) / SQRT2) * spec.vignette
        L += (vig.L - L) * w
        a += (vig.a - a) * w
        b += (vig.b - b) * w
      }
      const [r1, g1, b1] = oklabToSrgb(L, a, b)
      data[i] = r0 + (r1 - r0) * strength
      data[i + 1] = g0 + (g1 - g0) * strength
      data[i + 2] = b0 + (b1 - b0) * strength
    }
  }
}

const GRADE_HINT = '写成 lomo 0.8, fade 0.1，或 shadows #2a6080, highlights #ffd8a8, contrast 1.1, vignette 0.4'

registerFilter<GradeSpec>({
  name: 'grade',
  kind: 'pixel',
  layerOnly: true,
  maskAttr: 'grade-mask',
  includeBackdrop: true,
  hint: GRADE_HINT,
  maskHint: '和 grade 一起写，例如 <layer grade="lomo" grade-mask="radial-gradient(#fff0 30%, #fff)">',
  maskPaintHint: '写成 linear-gradient(to right, #fff, #fff0)、radial-gradient(#fff0 30%, #fff) 或 gradient(...)；alpha 是强度',
  parse: parseGrade,
  apply(pixels, spec) {
    applyGrade(pixels.data, pixels.width, pixels.height, spec, pixels.frame)
  },
})
