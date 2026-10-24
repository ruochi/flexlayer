import { convertSVGTextToPath, createCanvas, Path2D, SvgExportFlag } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { applyCanvasFont, fontFileFor, resolveOutlineFont, type OutlineFont } from './fonts.js'
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
  /** 字重。静态字体取最近的一档。可变字体按 wght 轴，超出轴的两端会夹住。 */
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

function faceKey(face: OutlineFont): string {
  return `${face.canvasFamily}|${face.weight}|${face.variation ? 1 : 0}`
}

function fontBox(face: OutlineFont, size: number): FontBox {
  const key = `${faceKey(face)}|${size}`
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
  const key = `${faceKey(face)}|${size}`
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

/**
 * 默认实例。这条转换不认字重轴，所以只用于轴上的默认档。
 * 基线放在 SVG 视口中间。贴着 y=0 时，整段都在基线上方的符号会被裁掉，
 * 路径变成空的，又不算缺字。可变字体里的 —、…、「 就是这样。
 * `d` 仍相对基线，平移写在 transform 上，这里不用。
 */
function svgOutline(ch: string, face: OutlineFont, size: number): string {
  const pad = Math.ceil(size * 4)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pad * 2}" height="${pad * 2}"><text x="${pad}" y="${pad}" font-size="${size}" font-family="${face.canvasFamily}">${xmlChar(ch)}</text></svg>`
  const out = convertSVGTextToPath(svg).toString()
  return out.match(/\sd="([^"]*)"/)?.[1] ?? ''
}

/**
 * 非默认字重。画布导出会应用 wght 轴。
 * 锚点若贴在画布边上，整段都在基线上方的符号会被丢掉，路径变成空的。
 * 先画在画布中间，再平移回基线，和 svgOutline 同一个坐标系。
 */
function variedOutline(ch: string, face: OutlineFont, size: number): string {
  const span = Math.max(1, Math.ceil(size * 4))
  const origin = span / 2
  const canvas = createCanvas(span, span, SvgExportFlag.ConvertTextToPaths)
  const ctx = canvas.getContext('2d')
  applyCanvasFont(ctx, face.family, face.weight, size)
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(ch, origin, origin)
  const out = canvas.getContent().toString()
  const raw = [...out.matchAll(/\sd="([^"]*)"/g)].map((match) => match[1] ?? '').join(' ')
  return translateSvgPath(absoluteSvgPath(raw), -origin, -origin)
}

function outlineOf(ch: string, face: OutlineFont, size: number): string {
  return face.variation ? variedOutline(ch, face, size) : svgOutline(ch, face, size)
}

function blankChar(ch: string): boolean {
  return /^\s$/u.test(ch)
}

/** 画布量到了墨，说明字体里有这个符号，不是空格。 */
function measuredInk(metrics: { actualBoundingBoxLeft: number; actualBoundingBoxRight: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number }): boolean {
  const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
  const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
  return width > 0.01 || height > 0.01
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

/** 对勾画成一根又高又瘦的细线时，看起来像根号。楷体那种笔画多的勾留着。 */
function radicalTick(glyph: Glyph): boolean {
  if (glyph.missing || !glyph.ink) return false
  if (!(glyph.ink.height > glyph.ink.width * 1.1)) return false
  return parseSvgPath(glyph.d).length < 20
}

function scalePathX(d: string, factor: number): string {
  const commands = parseSvgPath(absoluteSvgPath(d)).map((command) => {
    const op = command.op.toUpperCase()
    const args = command.args.slice()
    if (op === 'H') args[0] = (args[0] ?? 0) * factor
    else if (op === 'A') {
      args[0] = (args[0] ?? 0) * factor
      args[5] = (args[5] ?? 0) * factor
    } else {
      for (let i = 0; i + 1 < args.length; i += 2) args[i] = (args[i] ?? 0) * factor
    }
    return { op, args }
  })
  return serializeSvgPath(commands)
}

/**
 * 固定对勾。单位是 em，y 向下，基线在 0。
 * 目录里的拉丁子集没有 U+2713。自带这个码位的字面都是又高又瘦的勾。
 * 这条路径比高更宽，画出来是对勾，不靠系统字体回退。
 */
const CHECK_EM: Array<[number, number]> = [
  [0.05, -0.22],
  [0.3, 0.04],
  [0.96, -0.4],
  [0.86, -0.5],
  [0.28, -0.1],
  [0.14, -0.28],
]
const CHECK_ADVANCE = 1.02

const cmapCache = new Map<string, boolean>()

function fontTables(buf: Buffer): Map<string, Buffer> | null {
  if (buf.length < 12) return null
  const signature = buf.toString('latin1', 0, 4)
  const tables = new Map<string, Buffer>()
  if (signature === 'wOFF') {
    const count = buf.readUInt16BE(12)
    if (count < 1 || count > 512 || 44 + count * 20 > buf.length) return null
    for (let i = 0; i < count; i++) {
      const at = 44 + i * 20
      const tag = buf.toString('latin1', at, at + 4)
      const offset = buf.readUInt32BE(at + 4)
      const compLength = buf.readUInt32BE(at + 8)
      const origLength = buf.readUInt32BE(at + 12)
      if (compLength > buf.length || offset > buf.length - compLength) return null
      const raw = buf.subarray(offset, offset + compLength)
      tables.set(tag, compLength < origLength ? inflateSync(raw) : Buffer.from(raw))
    }
    return tables
  }
  if (signature === 'wOF2' || signature === 'ttcf') return null
  const count = buf.readUInt16BE(4)
  if (count < 1 || count > 512 || 12 + count * 16 > buf.length) return null
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = buf.toString('latin1', at, at + 4)
    const offset = buf.readUInt32BE(at + 8)
    const length = buf.readUInt32BE(at + 12)
    if (length > buf.length || offset > buf.length - length) return null
    tables.set(tag, buf.subarray(offset, offset + length))
  }
  return tables
}

/** 字文件的 cmap 里有没有这个码位。读不到表就当没有，避免把系统回退当成这套字自己的字形。 */
function faceCovers(face: OutlineFont, cp: number): boolean {
  let path = ''
  try {
    path = fontFileFor(face.canvasFamily, face.weight).path
  } catch {
    return false
  }
  const key = `${path}\0${cp}`
  const hit = cmapCache.get(key)
  if (hit != null) return hit
  let covered = false
  try {
    const cmap = fontTables(readFileSync(path))?.get('cmap')
    covered = cmap != null && cmap.length >= 4 && cmapGlyph(cmap, cp) > 0
  } catch {
    covered = false
  }
  cmapCache.set(key, covered)
  return covered
}

function cmapGlyph(cmap: Buffer, cp: number): number {
  const n = cmap.readUInt16BE(2)
  if (n < 1 || 4 + n * 8 > cmap.length) return 0
  let format12 = -1
  let format4 = -1
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8
    const platform = cmap.readUInt16BE(rec)
    const encoding = cmap.readUInt16BE(rec + 2)
    const offset = cmap.readUInt32BE(rec + 4)
    if (offset + 2 > cmap.length) continue
    const format = cmap.readUInt16BE(offset)
    if (format === 12 && (platform === 3 || platform === 0)) format12 = offset
    if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) format4 = offset
  }
  if (format12 >= 0) {
    const at = format12
    if (at + 16 > cmap.length) return 0
    const groups = cmap.readUInt32BE(at + 12)
    if (groups > 1_000_000 || at + 16 + groups * 12 > cmap.length) return 0
    let lo = 0
    let hi = groups - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const g = at + 16 + mid * 12
      const start = cmap.readUInt32BE(g)
      const end = cmap.readUInt32BE(g + 4)
      if (cp < start) hi = mid - 1
      else if (cp > end) lo = mid + 1
      else return cmap.readUInt32BE(g + 8) + cp - start
    }
    return 0
  }
  if (format4 >= 0) {
    const at = format4
    if (at + 14 > cmap.length) return 0
    const segX2 = cmap.readUInt16BE(at + 6)
    const ends = at + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const ranges = deltas + segX2
    if (cp > 0xffff || ranges + segX2 > cmap.length) return 0
    for (let i = 0; i < segX2; i += 2) {
      if (cp > cmap.readUInt16BE(ends + i)) continue
      const start = cmap.readUInt16BE(starts + i)
      if (cp < start) return 0
      const delta = cmap.readInt16BE(deltas + i)
      const range = cmap.readUInt16BE(ranges + i)
      if (range === 0) return (cp + delta) & 0xffff
      const glyphAt = ranges + i + range + (cp - start) * 2
      if (glyphAt + 2 > cmap.length) return 0
      const g = cmap.readUInt16BE(glyphAt)
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
  }
  return 0
}

function checkCommands(size: number, baseline: number): Array<{ op: string; args: number[] }> {
  const points = CHECK_EM.map(([x, y]) => [round3(x * size), round3(baseline + y * size)])
  return [
    { op: 'M', args: points[0]! },
    ...points.slice(1).map((point) => ({ op: 'L', args: point })),
    { op: 'Z', args: [] },
  ]
}

/** 相对基线的对勾。`d` 的 y 向下，基线在 0。`width` 是字宽。 */
export function checkMarkPath(size: number): { d: string; width: number } {
  return { d: serializeSvgPath(checkCommands(size, 0)), width: round3(CHECK_ADVANCE * size) }
}

/** 排版用的字宽和着墨。着墨相对基线：基线之上是 ascent。 */
export function checkMarkMetrics(size: number): { width: number; left: number; right: number; ascent: number; descent: number } {
  const mark = checkMarkPath(size)
  const [left, top, right, bottom] = new Path2D(mark.d).computeTightBounds()
  return {
    width: mark.width,
    left: round3(Math.max(0, -left)),
    right: round3(Math.max(right, 0)),
    ascent: round3(Math.max(0, -top)),
    descent: round3(Math.max(0, bottom)),
  }
}

/**
 * 正文和 `glyph()` 共用。
 * 字体里没有 en dash 时，用同一套字的数字短横。
 * 对勾缺字，或画成细长的根号形时，改用固定路径。`check` 为真时不要换字体。
 */
export function markStandIn(ch: string, font?: string, weight?: number): { text: string; font?: string; check?: boolean } | null {
  if (ch !== '\u2013' && ch !== '\u2713') return null
  const face = resolveOutlineFont(font, weight)
  const box = fontBox(face, 40)
  if (ch === '\u2713') {
    if (!faceCovers(face, 0x2713)) return { text: ch, check: true }
    // 可变字体的非默认档会把同一条细勾拆成很多曲线。是否像根号，看默认实例。
    const probe = face.variation ? { ...face, variation: false } : face
    const raw = oneGlyph(ch, probe, 40, fontBox(probe, 40), false)
    if (raw.missing || radicalTick(raw)) return { text: ch, check: true }
    return null
  }
  const raw = oneGlyph(ch, face, 40, box, false)
  if (!raw.missing) return null
  const figure = oneGlyph('\u2012', face, 40, box, false)
  if (!figure.missing && figure.d) return { text: '\u2012' }
  const em = oneGlyph('\u2014', face, 40, box, false)
  if (!em.missing && em.d) return { text: '\u2014' }
  return null
}

function applyStandIn(raw: Glyph, face: OutlineFont, size: number, box: FontBox): Glyph {
  const sub = markStandIn(raw.text, face.family, face.weight)
  if (!sub) return raw
  if (sub.check) {
    const d = serializeSvgPath(checkCommands(size, box.baseline))
    return { ...raw, d, width: round3(CHECK_ADVANCE * size), ink: inkOf(d), missing: false }
  }
  if (sub.text === '\u2012') {
    const figure = oneGlyph(sub.text, face, size, box, false)
    if (figure.missing || !figure.d) return raw
    return { ...raw, d: figure.d, width: figure.width, ink: figure.ink ? { ...figure.ink } : null, missing: false }
  }
  const em = oneGlyph('\u2014', face, size, box, false)
  if (em.missing || !em.d) return raw
  const d = scalePathX(em.d, 0.5)
  return { ...raw, d, width: round3(em.width * 0.5), ink: inkOf(d), missing: false }
}

function oneGlyph(ch: string, face: OutlineFont, size: number, box: FontBox, standIn = true): Glyph {
  const key = `${faceKey(face)}|${size}|${ch}|${standIn ? 1 : 0}`
  const hit = glyphCache.get(key)
  if (hit) return expose(hit)
  const ctx = getMeasureCtx()
  applyCanvasFont(ctx, face.family, face.weight, size)
  const metrics = ctx.measureText(ch)
  const width = round3(metrics.width)
  const unsafe = unsafeXmlChar(ch)
  const raw = unsafe ? notdefOutline(face, size) : outlineOf(ch, face, size)
  const missing = unsafe || (raw.trim() !== '' && raw === notdefOutline(face, size))
  if (!unsafe && !missing && !raw.trim() && !blankChar(ch) && measuredInk(metrics)) {
    throw new Error(`没能取出「${ch}」的轮廓。字体 ${face.family} 里这个符号有墨，但转换结果是空的`)
  }
  const placed = translateSvgPath(absoluteSvgPath(raw), 0, box.baseline)
  let glyph: Glyph = {
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
  if (standIn) glyph = applyStandIn(glyph, face, size, box)
  glyphCache.set(key, glyph)
  return expose(glyph)
}

/**
 * 从字体取出每个字的轮廓。按码位拆开，空字符串返回空数组。
 * 字宽和字身高度来自字体，不来自路径的外接框。
 * 同步返回。目录里的字体第一次用时会下载，下完直接给出数组，可以写在 `layer.create` 前面。
 * 字体里没有 en dash 时用同一套字的数字短横。细长得像根号的对勾改用固定路径，仍放在这套字的基线上。
 */
export function glyph(text: string, options: GlyphOptions = {}): Glyph[] {
  const size = options.size ?? 40
  if (!(size > 0) || !Number.isFinite(size)) throw new Error('size 要是正数')
  if (options.weight != null && !Number.isFinite(options.weight)) throw new Error('weight 要是数字')
  const face = resolveOutlineFont(options.font, options.weight)
  const box = fontBox(face, size)
  return Array.from(text).map((ch) => oneGlyph(ch, face, size, box))
}
