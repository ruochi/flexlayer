import { convertSVGTextToPath, Path2D } from '@napi-rs/canvas'
import { applyCanvasFont, resolveOutlineFont, type OutlineFont } from './fonts.js'
import { getMeasureCtx } from './measureCtx.js'
import { parseSvgPath, serializeSvgPath, translateSvgPath } from './path.js'

export type GlyphInk = { x: number; y: number; width: number; height: number }

/**
 * 一个字的轮廓。
 * `d` 的原点在字身盒子左上角，y 向下，单位是像素。
 * `width` 是字宽，`height` 是字体的上沿到下沿。同一字体、同一字号的每个字，`height` 和 `baseline` 都相同。
 * 着墨可以稍微探出这个盒子。
 */
export type Glyph = {
  text: string
  d: string
  font: string
  size: number
  weight: number
  width: number
  height: number
  baseline: number
  ink: GlyphInk | null
  /** 字体里没有这个字。`d` 仍是缺字方框，和别的缺字相同。 */
  missing: boolean
}

export type GlyphOptions = {
  /** 字体名。见 `resources.fonts`，默认 `ChillDuanSans`。别名如「楷体」也可以。 */
  font?: string
  /** 字号，像素。默认 40。 */
  size?: number
  /** 字重。宋体、楷体取最近的 400 或 700。可变字体只能用默认字重。 */
  weight?: number
}

type FontBox = { baseline: number; height: number }

const boxCache = new Map<string, FontBox>()
const glyphCache = new Map<string, Glyph>()
const notdefCache = new Map<string, string>()

/** 三个几乎不会被真字体收录的码位。路径相同的那条就是 .notdef。不用 U+FFFE，那个码位会让 SVG 转换崩溃。 */
const NOTDEF_PROBES = ['\uE000', '\uE001', '\u0378']

function round3(n: number): number {
  const rounded = Math.round(n * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}

/** XML 1.0 不接受的码位。塞进 SVG 会让轮廓转换直接崩溃，连数字引用也不行。 */
function unsafeXmlChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  return (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff
}

function xmlChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0
  if (unsafeXmlChar(ch) || ch === '&' || ch === '<' || ch === '>') return `&#${cp};`
  return ch
}

/** 相对命令收成绝对命令，方便整体平移。已经是绝对命令时只做一次格式统一。 */
function absoluteSvgPath(d: string): string {
  const commands = parseSvgPath(d)
  if (commands.length === 0) return ''
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const out: Array<{ op: string; args: number[] }> = []
  for (const command of commands) {
    const upper = command.op.toUpperCase()
    const rel = command.op !== upper
    const args = command.args.slice()
    if (rel) {
      if (upper === 'H') args[0] = (args[0] ?? 0) + cx
      else if (upper === 'V') args[0] = (args[0] ?? 0) + cy
      else if (upper === 'A') {
        args[5] = (args[5] ?? 0) + cx
        args[6] = (args[6] ?? 0) + cy
      } else {
        for (let i = 0; i + 1 < args.length; i += 2) {
          args[i] = (args[i] ?? 0) + cx
          args[i + 1] = (args[i + 1] ?? 0) + cy
        }
      }
    }
    if (upper === 'Z') {
      cx = sx
      cy = sy
    } else if (upper === 'H') {
      cx = args[0] ?? cx
    } else if (upper === 'V') {
      cy = args[0] ?? cy
    } else if (upper === 'A') {
      cx = args[5] ?? cx
      cy = args[6] ?? cy
    } else if (args.length >= 2) {
      cx = args[args.length - 2] ?? cx
      cy = args[args.length - 1] ?? cy
      if (upper === 'M') {
        sx = cx
        sy = cy
      }
    }
    out.push({ op: upper, args })
  }
  return serializeSvgPath(out)
}

function fontBox(face: OutlineFont, size: number): FontBox {
  const key = `${face.canvasFamily}|${face.weight}|${size}`
  const hit = boxCache.get(key)
  if (hit) return hit
  const ctx = getMeasureCtx()
  applyCanvasFont(ctx, face.family, face.weight, size)
  const metrics = ctx.measureText('0')
  const ascent = round3(metrics.emHeightAscent)
  const descent = round3(metrics.emHeightDescent)
  const box = { baseline: ascent, height: round3(ascent + descent) }
  boxCache.set(key, box)
  return box
}

function notdefOutline(face: OutlineFont, size: number): string {
  const key = `${face.canvasFamily}|${face.weight}|${size}`
  const hit = notdefCache.get(key)
  if (hit != null) return hit
  const paths = NOTDEF_PROBES.map((ch) => outlineOf(ch, face, size)).filter((d) => d.trim())
  let found = ''
  for (let i = 0; i < paths.length; i++) {
    if (paths.slice(i + 1).includes(paths[i]!)) {
      found = paths[i]!
      break
    }
  }
  notdefCache.set(key, found)
  return found
}

function outlineOf(ch: string, face: OutlineFont, size: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 4}" height="${size * 4}"><text x="0" y="0" font-size="${size}" font-family="${face.canvasFamily}">${xmlChar(ch)}</text></svg>`
  const out = convertSVGTextToPath(svg).toString()
  const d = out.match(/\sd="([^"]*)"/)?.[1] ?? ''
  return d
}

function inkOf(d: string): GlyphInk | null {
  if (!d.trim()) return null
  const [left, top, right, bottom] = new Path2D(d).computeTightBounds()
  const width = right - left
  const height = bottom - top
  if (!(width > 0) || !(height > 0)) return null
  return { x: round3(left), y: round3(top), width: round3(width), height: round3(height) }
}

function expose(glyph: Glyph): Glyph {
  return { ...glyph, ink: glyph.ink ? { ...glyph.ink } : null }
}

function oneGlyph(ch: string, face: OutlineFont, size: number, box: FontBox): Glyph {
  const key = `${face.canvasFamily}|${face.weight}|${size}|${ch}`
  const hit = glyphCache.get(key)
  if (hit) return expose(hit)
  const ctx = getMeasureCtx()
  applyCanvasFont(ctx, face.family, face.weight, size)
  const width = round3(ctx.measureText(ch).width)
  const unsafe = unsafeXmlChar(ch)
  const raw = unsafe ? notdefOutline(face, size) : outlineOf(ch, face, size)
  const missing = unsafe || (raw.trim() !== '' && raw === notdefOutline(face, size))
  const placed = translateSvgPath(absoluteSvgPath(raw), 0, box.baseline)
  const glyph: Glyph = {
    text: ch,
    d: placed,
    font: face.family,
    size,
    weight: face.weight,
    width,
    height: box.height,
    baseline: box.baseline,
    ink: inkOf(placed),
    missing,
  }
  glyphCache.set(key, glyph)
  return expose(glyph)
}

/**
 * 从字体取出每个字的轮廓。按码位拆开，空字符串返回空数组。
 * 字宽和字身高度来自字体，不来自路径的外接框。
 */
export async function glyph(text: string, options: GlyphOptions = {}): Promise<Glyph[]> {
  const size = options.size ?? 40
  if (!(size > 0) || !Number.isFinite(size)) throw new Error('size 要是正数')
  if (options.weight != null && !Number.isFinite(options.weight)) throw new Error('weight 要是数字')
  const face = await resolveOutlineFont(options.font, options.weight)
  const box = fontBox(face, size)
  return Array.from(text).map((ch) => oneGlyph(ch, face, size, box))
}
