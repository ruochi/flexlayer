import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGISTERED_FONTS } from '../font-catalog.js'
import { ensureBuiltinFontsSync, getFontsCacheDir } from '../fonts.js'
import { contoursToPath, parseOpenType, type GlyphPart, type MathConstantName, type OpenTypeFont } from './opentype.js'

export const MATH_FONT_FAMILY = 'STIXTwoMath'

/** 一个画成路径的字形。原点在盒子左上角，基线在 `ascent` 处，单位是像素。 */
export type GlyphShape = {
  d: string
  width: number
  ascent: number
  descent: number
  ink: { x: number; y: number; width: number; height: number }
  italic: number
}

let loaded: OpenTypeFont | null = null

export function mathFont(): OpenTypeFont {
  if (loaded) return loaded
  ensureBuiltinFontsSync([MATH_FONT_FAMILY])
  const face = REGISTERED_FONTS.find((font) => font.family === MATH_FONT_FAMILY)!.faces[0]!
  loaded = parseOpenType(readFileSync(join(getFontsCacheDir(), face.file)))
  return loaded
}

/** MATH 表里的常量换成像素。 */
export function mathConstant(name: MathConstantName, fontSize: number): number {
  const font = mathFont()
  return (font.constants[name] * fontSize) / font.unitsPerEm
}

export function hasMathGlyph(text: string): boolean {
  const font = mathFont()
  for (const ch of text) if (font.glyphIndex(ch.codePointAt(0)!) === 0) return false
  return text.length > 0
}

export function italicCorrectionOf(text: string, fontSize: number): number {
  const chars = Array.from(text)
  if (chars.length !== 1) return 0
  const font = mathFont()
  const glyph = font.glyphIndex(chars[0]!.codePointAt(0)!)
  return glyph ? (font.italicCorrection(glyph) * fontSize) / font.unitsPerEm : 0
}

function glyphOf(text: string): number {
  const chars = Array.from(text)
  if (chars.length !== 1) return 0
  return mathFont().glyphIndex(chars[0]!.codePointAt(0)!)
}

function singleGlyph(glyph: number, fontSize: number): GlyphShape {
  const font = mathFont()
  const s = fontSize / font.unitsPerEm
  const b = font.bounds(glyph) ?? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  const ascent = Math.max(0, b.yMax * s)
  const descent = Math.max(0, -b.yMin * s)
  return {
    d: contoursToPath(font.contours(glyph), s, 0, ascent),
    width: font.advance(glyph) * s,
    ascent,
    descent,
    ink: { x: b.xMin * s, y: ascent - b.yMax * s, width: (b.xMax - b.xMin) * s, height: (b.yMax - b.yMin) * s },
    italic: font.italicCorrection(glyph) * s,
  }
}

/** 拼接件按顺序排开：竖排从下往上，横排从左往右。返回每一件的起点（字体单位）。 */
function assemble(parts: GlyphPart[], target: number, overlapMin: number): { list: GlyphPart[]; offsets: number[]; total: number } {
  const extenders = parts.filter((p) => p.extender)
  let repeat = 0
  const expand = (r: number) => parts.flatMap((p) => (p.extender ? Array.from({ length: r }, () => p) : [p]))
  const longest = (list: GlyphPart[]) => list.reduce((sum, p) => sum + p.fullAdvance, 0) - Math.max(0, list.length - 1) * overlapMin
  if (extenders.length) {
    while (repeat < 200 && longest(expand(repeat)) < target) repeat++
  }
  const list = expand(repeat)
  const sum = list.reduce((acc, p) => acc + p.fullAdvance, 0)
  const joints = Math.max(1, list.length - 1)
  const want = (sum - target) / joints
  const offsets: number[] = []
  let cursor = 0
  for (let i = 0; i < list.length; i++) {
    offsets.push(cursor)
    const next = list[i + 1]
    if (!next) {
      cursor += list[i]!.fullAdvance
      break
    }
    const limit = Math.max(overlapMin, Math.min(list[i]!.endConnector, next.startConnector))
    const overlap = Math.min(limit, Math.max(overlapMin, want))
    cursor += list[i]!.fullAdvance - overlap
  }
  return { list, offsets, total: cursor }
}

function shapeFromPaths(paths: string[], width: number, height: number, fontSize: number, italic: number): GlyphShape {
  return {
    d: paths.join(''),
    width,
    ascent: height,
    descent: 0,
    ink: { x: 0, y: 0, width, height },
    italic: (italic * fontSize) / mathFont().unitsPerEm,
  }
}

/**
 * 竖向伸长到至少 `size` 像素高。先挑够高的变体，变体不够再用拼接件。
 * 字体里没有这个字的伸长信息时返回 null。
 */
export function stretchVertical(text: string, size: number, fontSize: number): GlyphShape | null {
  const font = mathFont()
  const glyph = glyphOf(text)
  if (!glyph) return null
  const construction = font.vertical(glyph)
  if (!construction) return null
  const s = fontSize / font.unitsPerEm
  const target = size / s
  const variant = construction.variants.find((v) => v.advance >= target)
  if (variant || construction.parts.length === 0) {
    const pick = variant ?? construction.variants[construction.variants.length - 1]
    return singleGlyph(pick ? pick.glyph : glyph, fontSize)
  }
  const { list, offsets, total } = assemble(construction.parts, target, font.minConnectorOverlap)
  const width = Math.max(...list.map((p) => font.advance(p.glyph))) * s
  const height = total * s
  const paths = list.map((part, i) => {
    const b = font.bounds(part.glyph)
    const bottom = b ? b.yMin : 0
    const baseline = height + (bottom - offsets[i]!) * s
    return contoursToPath(font.contours(part.glyph), s, 0, baseline)
  })
  return shapeFromPaths(paths, width, height, fontSize, 0)
}

/** 横向伸长到至少 `size` 像素宽。返回的盒子按字形自己的基线。 */
export function stretchHorizontal(text: string, size: number, fontSize: number): GlyphShape | null {
  const font = mathFont()
  const glyph = glyphOf(text)
  if (!glyph) return null
  const construction = font.horizontal(glyph)
  if (!construction) return null
  const s = fontSize / font.unitsPerEm
  const target = size / s
  const variant = construction.variants.find((v) => v.advance >= target)
  if (variant || construction.parts.length === 0) {
    const pick = variant ?? construction.variants[construction.variants.length - 1]
    return singleGlyph(pick ? pick.glyph : glyph, fontSize)
  }
  const { list, offsets, total } = assemble(construction.parts, target, font.minConnectorOverlap)
  let yMax = 0
  let yMin = 0
  for (const part of list) {
    const b = font.bounds(part.glyph)
    if (!b) continue
    yMax = Math.max(yMax, b.yMax)
    yMin = Math.min(yMin, b.yMin)
  }
  const ascent = yMax * s
  const paths = list.map((part, i) => {
    const b = font.bounds(part.glyph)
    const left = b ? b.xMin : 0
    return contoursToPath(font.contours(part.glyph), s, (offsets[i]! - left) * s, ascent)
  })
  const width = total * s
  return {
    d: paths.join(''),
    width,
    ascent,
    descent: -yMin * s,
    ink: { x: 0, y: 0, width, height: (yMax - yMin) * s },
    italic: 0,
  }
}

/** 按字体里本来的样子取一个字形。字体里没有这个字时返回 null。 */
export function glyphShape(text: string, fontSize: number): GlyphShape | null {
  const glyph = glyphOf(text)
  return glyph ? singleGlyph(glyph, fontSize) : null
}

/** 显示样式的大运算符：挑第一个不矮于 DisplayOperatorMinHeight 的变体，都不够就用最大的。 */
export function displayOperator(text: string, fontSize: number): GlyphShape | null {
  const font = mathFont()
  const glyph = glyphOf(text)
  if (!glyph) return null
  const construction = font.vertical(glyph)
  if (!construction || construction.variants.length === 0) return null
  const min = font.constants.DisplayOperatorMinHeight
  const pick = construction.variants.find((v) => v.advance >= min) ?? construction.variants[construction.variants.length - 1]!
  return singleGlyph(pick.glyph, fontSize)
}

/** 字形不伸长时的自然高度（字体单位换成像素），用来判断要不要伸长。 */
export function naturalVerticalSize(text: string, fontSize: number): number {
  const font = mathFont()
  const glyph = glyphOf(text)
  if (!glyph) return 0
  const construction = font.vertical(glyph)
  const first = construction?.variants[0]
  if (first) return (first.advance * fontSize) / font.unitsPerEm
  const b = font.bounds(glyph)
  return b ? ((b.yMax - b.yMin) * fontSize) / font.unitsPerEm : 0
}

export function naturalHorizontalSize(text: string, fontSize: number): number {
  const font = mathFont()
  const glyph = glyphOf(text)
  if (!glyph) return 0
  return (font.advance(glyph) * fontSize) / font.unitsPerEm
}
