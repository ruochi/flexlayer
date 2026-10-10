import { luma } from './pixels.js'

export const PRESETS = ['portrait', 'product', 'flat'] as const
export type Preset = (typeof PRESETS)[number]

export function isPreset(value: string): value is Preset {
  return (PRESETS as readonly string[]).includes(value)
}

const SOLID = 128
const BG_MAX = 12
const SOFT_LOW = 8
const SOFT_HIGH = 247
/** 主体外接矩形最下面这一截，加上紧挨着的脚下，算影子。 */
const FOOT = 0.15
const SHADOW_LUMA = 50
const SHADOW_ALPHA = 180
/** 颜色和背景几乎一样、又不算实心，当成渗进来的背景。 */
const FRINGE_DIST = 24
const FRINGE_ALPHA = 160

export type PresetResult = {
  /** 最终选区，0 到 255，和原图一样大。 */
  alpha: Uint8ClampedArray
  /** 前景去色之后的图。flat 不改颜色。alpha 就是选区。 */
  rgba: Uint8ClampedArray
  /** 只在 product 里有。脚下的影子单独一层，黑底加 alpha。 */
  shadow: Uint8ClampedArray | null
}

type Box = { x: number; y: number; width: number; height: number }
type Rgb = { r: number; g: number; b: number }

function clampByte(n: number): number {
  if (n <= 0) return 0
  if (n >= 255) return 255
  return Math.round(n)
}

function subjectBox(matte: Uint8ClampedArray, width: number, height: number): Box | null {
  const seen = new Uint8Array(matte.length)
  const stack = new Int32Array(matte.length)
  let best: Box | null = null
  let bestPixels = 0
  for (let start = 0; start < matte.length; start++) {
    if (seen[start] || matte[start]! < SOLID) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    let pixels = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    while (top > 0) {
      const i = stack[--top]!
      pixels += 1
      const x = i % width
      const y = (i / width) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (seen[ni] || matte[ni]! < SOLID) continue
          seen[ni] = 1
          stack[top++] = ni
        }
      }
    }
    if (pixels > bestPixels) {
      bestPixels = pixels
      best = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    }
  }
  return best
}

function isFoot(x: number, y: number, box: Box): boolean {
  const bottom = box.y + box.height
  const bandTop = box.y + box.height * (1 - FOOT)
  const reach = Math.max(2, box.height * FOOT)
  const inBand = y >= bandTop && y < bottom
  const below = y >= bottom && y < bottom + reach
  return (inBand || below) && x >= box.x - 2 && x < box.x + box.width + 2
}

function isShadowPixel(matte: number, rgb: Rgb, x: number, y: number, box: Box | null): boolean {
  if (!box) return false
  if (matte < SOFT_LOW || matte >= SHADOW_ALPHA) return false
  if (luma(rgb.r, rgb.g, rgb.b) >= SHADOW_LUMA) return false
  return isFoot(x, y, box)
}

function localBackground(
  rgba: Uint8ClampedArray,
  matte: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  fallback: Rgb | null,
): Rgb | null {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const i = ny * width + nx
      if (matte[i]! >= BG_MAX) continue
      const o = i * 4
      r += rgba[o]!
      g += rgba[o + 1]!
      b += rgba[o + 2]!
      n += 1
    }
  }
  if (n === 0) return fallback
  return { r: r / n, g: g / n, b: b / n }
}

function globalBackground(rgba: Uint8ClampedArray, matte: Uint8ClampedArray): Rgb | null {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < matte.length; i++) {
    if (matte[i]! >= BG_MAX) continue
    const o = i * 4
    r += rgba[o]!
    g += rgba[o + 1]!
    b += rgba[o + 2]!
    n += 1
  }
  if (n === 0) return null
  return { r: r / n, g: g / n, b: b / n }
}

function colorDist(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

/**
 * 预设只改蒙版，不跑模型。
 * portrait 留下头发的软边，去掉和背景同色的渗色，并丢掉脚下的暗影子。
 * product 和 portrait 一样，但把那层影子单独交出来。
 * flat 按 128 硬切，不羽化，也不改颜色。
 */
export function applyPreset(
  preset: Preset,
  rgba: Uint8ClampedArray,
  matteIn: Uint8ClampedArray,
  width: number,
  height: number,
): PresetResult {
  if (matteIn.length !== width * height) throw new Error('蒙版尺寸和图片不一致')
  if (rgba.length !== width * height * 4) throw new Error('图片尺寸不对')
  const matte = new Uint8ClampedArray(matteIn.length)
  for (let i = 0; i < matteIn.length; i++) matte[i] = clampByte(matteIn[i]!)
  const alpha = new Uint8ClampedArray(matte)
  const out = new Uint8ClampedArray(rgba)

  if (preset === 'flat') {
    for (let i = 0; i < alpha.length; i++) alpha[i] = matte[i]! >= SOLID ? 255 : 0
    for (let i = 0; i < alpha.length; i++) out[i * 4 + 3] = alpha[i]!
    return { alpha, rgba: out, shadow: null }
  }

  const box = subjectBox(matte, width, height)
  const fallback = globalBackground(rgba, matte)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const value = matte[i]!
      if (value < SOFT_LOW || value > SOFT_HIGH) continue
      const o = i * 4
      const color = { r: rgba[o]!, g: rgba[o + 1]!, b: rgba[o + 2]! }
      const bg = localBackground(rgba, matte, width, height, x, y, fallback)
      if (!bg || value >= FRINGE_ALPHA) continue
      if (colorDist(color, bg) >= FRINGE_DIST) continue
      alpha[i] = 0
    }
  }

  const shadow = preset === 'product' ? new Uint8ClampedArray(alpha.length) : null
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const o = i * 4
      const color = { r: rgba[o]!, g: rgba[o + 1]!, b: rgba[o + 2]! }
      if (!isShadowPixel(matte[i]!, color, x, y, box)) continue
      if (shadow) shadow[i] = matte[i]!
      alpha[i] = 0
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const o = i * 4
      const a = alpha[i]! / 255
      out[o + 3] = alpha[i]!
      if (a <= 0.02 || a >= 0.98) continue
      const bg = localBackground(rgba, matte, width, height, x, y, fallback)
      if (!bg) continue
      const keep = 1 - a
      out[o] = clampByte((rgba[o]! - bg.r * keep) / a)
      out[o + 1] = clampByte((rgba[o + 1]! - bg.g * keep) / a)
      out[o + 2] = clampByte((rgba[o + 2]! - bg.b * keep) / a)
    }
  }
  return { alpha, rgba: out, shadow }
}
