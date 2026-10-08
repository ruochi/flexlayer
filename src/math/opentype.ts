import { inflateSync } from 'node:zlib'

/** OpenType MATH 表 MathConstants 里的数值，单位是字体单位。顺序与规范一致。 */
export const MATH_CONSTANT_NAMES = [
  'MathLeading',
  'AxisHeight',
  'AccentBaseHeight',
  'FlattenedAccentBaseHeight',
  'SubscriptShiftDown',
  'SubscriptTopMax',
  'SubscriptBaselineDropMin',
  'SuperscriptShiftUp',
  'SuperscriptShiftUpCramped',
  'SuperscriptBottomMin',
  'SuperscriptBaselineDropMax',
  'SubSuperscriptGapMin',
  'SuperscriptBottomMaxWithSubscript',
  'SpaceAfterScript',
  'UpperLimitGapMin',
  'UpperLimitBaselineRiseMin',
  'LowerLimitGapMin',
  'LowerLimitBaselineDropMin',
  'StackTopShiftUp',
  'StackTopDisplayStyleShiftUp',
  'StackBottomShiftDown',
  'StackBottomDisplayStyleShiftDown',
  'StackGapMin',
  'StackDisplayStyleGapMin',
  'StretchStackTopShiftUp',
  'StretchStackBottomShiftDown',
  'StretchStackGapAboveMin',
  'StretchStackGapBelowMin',
  'FractionNumeratorShiftUp',
  'FractionNumeratorDisplayStyleShiftUp',
  'FractionDenominatorShiftDown',
  'FractionDenominatorDisplayStyleShiftDown',
  'FractionNumeratorGapMin',
  'FractionNumDisplayStyleGapMin',
  'FractionRuleThickness',
  'FractionDenominatorGapMin',
  'FractionDenomDisplayStyleGapMin',
  'SkewedFractionHorizontalGap',
  'SkewedFractionVerticalGap',
  'OverbarVerticalGap',
  'OverbarRuleThickness',
  'OverbarExtraAscender',
  'UnderbarVerticalGap',
  'UnderbarRuleThickness',
  'UnderbarExtraDescender',
  'RadicalVerticalGap',
  'RadicalDisplayStyleVerticalGap',
  'RadicalRuleThickness',
  'RadicalExtraAscender',
  'RadicalKernBeforeDegree',
  'RadicalKernAfterDegree',
] as const

export type MathConstantName =
  | (typeof MATH_CONSTANT_NAMES)[number]
  | 'ScriptPercentScaleDown'
  | 'ScriptScriptPercentScaleDown'
  | 'DelimitedSubFormulaMinHeight'
  | 'DisplayOperatorMinHeight'
  | 'RadicalDegreeBottomRaisePercent'

export type MathConstants = Record<MathConstantName, number>

export type GlyphVariant = { glyph: number; advance: number }

export type GlyphPart = {
  glyph: number
  startConnector: number
  endConnector: number
  fullAdvance: number
  extender: boolean
}

export type GlyphConstruction = { variants: GlyphVariant[]; parts: GlyphPart[] }

export type GlyphBounds = { xMin: number; yMin: number; xMax: number; yMax: number }

type Contour = Array<{ x: number; y: number; on: boolean }>

export type OpenTypeFont = {
  unitsPerEm: number
  constants: MathConstants
  minConnectorOverlap: number
  glyphIndex(codePoint: number): number
  advance(glyph: number): number
  bounds(glyph: number): GlyphBounds | null
  /** 轮廓，字体单位，y 向上。 */
  contours(glyph: number): Contour[]
  italicCorrection(glyph: number): number
  vertical(glyph: number): GlyphConstruction | null
  horizontal(glyph: number): GlyphConstruction | null
}

function readTables(buf: Buffer): Map<string, Buffer> {
  const tables = new Map<string, Buffer>()
  const signature = buf.toString('latin1', 0, 4)
  if (signature === 'wOFF') {
    const count = buf.readUInt16BE(12)
    for (let i = 0; i < count; i++) {
      const at = 44 + i * 20
      const tag = buf.toString('latin1', at, at + 4)
      const offset = buf.readUInt32BE(at + 4)
      const compLength = buf.readUInt32BE(at + 8)
      const origLength = buf.readUInt32BE(at + 12)
      const raw = buf.subarray(offset, offset + compLength)
      tables.set(tag, compLength < origLength ? inflateSync(raw) : raw)
    }
    return tables
  }
  if (signature === 'wOF2') throw new Error('数学字体不能是 woff2')
  const count = buf.readUInt16BE(4)
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = buf.toString('latin1', at, at + 4)
    const offset = buf.readUInt32BE(at + 8)
    const length = buf.readUInt32BE(at + 12)
    tables.set(tag, buf.subarray(offset, offset + length))
  }
  return tables
}

function coverage(table: Buffer, at: number): Map<number, number> {
  const out = new Map<number, number>()
  const format = table.readUInt16BE(at)
  if (format === 1) {
    const n = table.readUInt16BE(at + 2)
    for (let i = 0; i < n; i++) out.set(table.readUInt16BE(at + 4 + i * 2), i)
  } else if (format === 2) {
    const n = table.readUInt16BE(at + 2)
    for (let i = 0; i < n; i++) {
      const r = at + 4 + i * 6
      const start = table.readUInt16BE(r)
      const end = table.readUInt16BE(r + 2)
      const index = table.readUInt16BE(r + 4)
      for (let g = start; g <= end; g++) out.set(g, index + g - start)
    }
  }
  return out
}

function cmapLookup(cmap: Buffer): (cp: number) => number {
  const n = cmap.readUInt16BE(2)
  let format12 = -1
  let format4 = -1
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8
    const platform = cmap.readUInt16BE(rec)
    const encoding = cmap.readUInt16BE(rec + 2)
    const offset = cmap.readUInt32BE(rec + 4)
    const format = cmap.readUInt16BE(offset)
    if (format === 12 && (platform === 3 || platform === 0)) format12 = offset
    if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) format4 = offset
  }
  if (format12 >= 0) {
    const at = format12
    const groups = cmap.readUInt32BE(at + 12)
    return (cp) => {
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
  }
  if (format4 >= 0) {
    const at = format4
    const segX2 = cmap.readUInt16BE(at + 6)
    const ends = at + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const ranges = deltas + segX2
    return (cp) => {
      if (cp > 0xffff) return 0
      for (let i = 0; i < segX2; i += 2) {
        if (cp > cmap.readUInt16BE(ends + i)) continue
        const start = cmap.readUInt16BE(starts + i)
        if (cp < start) return 0
        const delta = cmap.readInt16BE(deltas + i)
        const range = cmap.readUInt16BE(ranges + i)
        if (range === 0) return (cp + delta) & 0xffff
        const g = cmap.readUInt16BE(ranges + i + range + (cp - start) * 2)
        return g === 0 ? 0 : (g + delta) & 0xffff
      }
      return 0
    }
  }
  return () => 0
}

function simpleContours(glyf: Buffer, at: number, count: number): Contour[] {
  const ends: number[] = []
  for (let i = 0; i < count; i++) ends.push(glyf.readUInt16BE(at + 10 + i * 2))
  const points = (ends[ends.length - 1] ?? -1) + 1
  let p = at + 10 + count * 2
  p += 2 + glyf.readUInt16BE(p)
  const flags: number[] = []
  while (flags.length < points) {
    const flag = glyf.readUInt8(p++)
    flags.push(flag)
    if (flag & 8) {
      const repeat = glyf.readUInt8(p++)
      for (let r = 0; r < repeat; r++) flags.push(flag)
    }
  }
  const xs: number[] = []
  let x = 0
  for (const flag of flags) {
    if (flag & 2) {
      const d = glyf.readUInt8(p++)
      x += flag & 16 ? d : -d
    } else if (!(flag & 16)) {
      x += glyf.readInt16BE(p)
      p += 2
    }
    xs.push(x)
  }
  const ys: number[] = []
  let y = 0
  for (const flag of flags) {
    if (flag & 4) {
      const d = glyf.readUInt8(p++)
      y += flag & 32 ? d : -d
    } else if (!(flag & 32)) {
      y += glyf.readInt16BE(p)
      p += 2
    }
    ys.push(y)
  }
  const out: Contour[] = []
  let start = 0
  for (const end of ends) {
    const contour: Contour = []
    for (let i = start; i <= end; i++) contour.push({ x: xs[i]!, y: ys[i]!, on: (flags[i]! & 1) === 1 })
    out.push(contour)
    start = end + 1
  }
  return out
}

export function parseOpenType(buf: Buffer): OpenTypeFont {
  const tables = readTables(buf)
  const need = (tag: string) => {
    const t = tables.get(tag)
    if (!t) throw new Error(`字体缺少 ${tag} 表`)
    return t
  }
  const head = need('head')
  const hhea = need('hhea')
  const hmtx = need('hmtx')
  const loca = need('loca')
  const glyf = need('glyf')
  const math = need('MATH')
  const unitsPerEm = head.readUInt16BE(18)
  const longLoca = head.readInt16BE(50) === 1
  const hMetrics = hhea.readUInt16BE(34)
  const lookup = cmapLookup(need('cmap'))

  const constOffset = math.readUInt16BE(4)
  const glyphInfoOffset = math.readUInt16BE(6)
  const variantsOffset = math.readUInt16BE(8)

  const c = constOffset
  const constants = {
    ScriptPercentScaleDown: math.readInt16BE(c),
    ScriptScriptPercentScaleDown: math.readInt16BE(c + 2),
    DelimitedSubFormulaMinHeight: math.readUInt16BE(c + 4),
    DisplayOperatorMinHeight: math.readUInt16BE(c + 6),
  } as MathConstants
  MATH_CONSTANT_NAMES.forEach((name, i) => {
    constants[name] = math.readInt16BE(c + 8 + i * 4)
  })
  constants.RadicalDegreeBottomRaisePercent = math.readInt16BE(c + 8 + MATH_CONSTANT_NAMES.length * 4)

  const italics = new Map<number, number>()
  const italicsOffset = math.readUInt16BE(glyphInfoOffset)
  if (italicsOffset) {
    const at = glyphInfoOffset + italicsOffset
    const cov = coverage(math, at + math.readUInt16BE(at))
    for (const [glyph, index] of cov) italics.set(glyph, math.readInt16BE(at + 4 + index * 4))
  }

  const v = variantsOffset
  const minConnectorOverlap = math.readUInt16BE(v)
  const vertCov = coverage(math, v + math.readUInt16BE(v + 2))
  const horizCov = coverage(math, v + math.readUInt16BE(v + 4))
  const vertCount = math.readUInt16BE(v + 6)

  const construction = (index: number | undefined, base: number): GlyphConstruction | null => {
    if (index == null) return null
    const at = v + math.readUInt16BE(base + index * 2)
    const assemblyOffset = math.readUInt16BE(at)
    const count = math.readUInt16BE(at + 2)
    const variants: GlyphVariant[] = []
    for (let i = 0; i < count; i++) {
      variants.push({ glyph: math.readUInt16BE(at + 4 + i * 4), advance: math.readUInt16BE(at + 6 + i * 4) })
    }
    const parts: GlyphPart[] = []
    if (assemblyOffset) {
      const a = at + assemblyOffset
      const n = math.readUInt16BE(a + 4)
      for (let i = 0; i < n; i++) {
        const r = a + 6 + i * 10
        parts.push({
          glyph: math.readUInt16BE(r),
          startConnector: math.readUInt16BE(r + 2),
          endConnector: math.readUInt16BE(r + 4),
          fullAdvance: math.readUInt16BE(r + 6),
          extender: (math.readUInt16BE(r + 8) & 1) === 1,
        })
      }
    }
    return { variants, parts }
  }

  const glyphRange = (glyph: number): [number, number] => {
    if (longLoca) return [loca.readUInt32BE(glyph * 4), loca.readUInt32BE(glyph * 4 + 4)]
    return [loca.readUInt16BE(glyph * 2) * 2, loca.readUInt16BE(glyph * 2 + 2) * 2]
  }

  const contourCache = new Map<number, Contour[]>()
  const contours = (glyph: number, depth = 0): Contour[] => {
    const cached = contourCache.get(glyph)
    if (cached) return cached
    const [start, end] = glyphRange(glyph)
    let out: Contour[] = []
    if (end > start) {
      const count = glyf.readInt16BE(start)
      if (count >= 0) out = simpleContours(glyf, start, count)
      else if (depth < 8) {
        let p = start + 10
        for (;;) {
          const flags = glyf.readUInt16BE(p)
          const child = glyf.readUInt16BE(p + 2)
          p += 4
          let dx = 0
          let dy = 0
          if (flags & 1) {
            dx = flags & 2 ? glyf.readInt16BE(p) : 0
            dy = flags & 2 ? glyf.readInt16BE(p + 2) : 0
            p += 4
          } else {
            dx = flags & 2 ? glyf.readInt8(p) : 0
            dy = flags & 2 ? glyf.readInt8(p + 1) : 0
            p += 2
          }
          let a = 1
          let b = 0
          let cc = 0
          let d = 1
          const f2 = (at: number) => glyf.readInt16BE(at) / 16384
          if (flags & 8) {
            a = d = f2(p)
            p += 2
          } else if (flags & 0x40) {
            a = f2(p)
            d = f2(p + 2)
            p += 4
          } else if (flags & 0x80) {
            a = f2(p)
            b = f2(p + 2)
            cc = f2(p + 4)
            d = f2(p + 6)
            p += 8
          }
          for (const contour of contours(child, depth + 1)) {
            out.push(contour.map((pt) => ({ x: a * pt.x + cc * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })))
          }
          if (!(flags & 0x20)) break
        }
      }
    }
    contourCache.set(glyph, out)
    return out
  }

  return {
    unitsPerEm,
    constants,
    minConnectorOverlap,
    glyphIndex: lookup,
    advance(glyph) {
      const i = Math.min(glyph, hMetrics - 1)
      return hmtx.readUInt16BE(i * 4)
    },
    bounds(glyph) {
      const [start, end] = glyphRange(glyph)
      if (end <= start) return null
      return {
        xMin: glyf.readInt16BE(start + 2),
        yMin: glyf.readInt16BE(start + 4),
        xMax: glyf.readInt16BE(start + 6),
        yMax: glyf.readInt16BE(start + 8),
      }
    },
    contours: (glyph) => contours(glyph),
    italicCorrection: (glyph) => italics.get(glyph) ?? 0,
    vertical: (glyph) => construction(vertCov.get(glyph), v + 10),
    horizontal: (glyph) => construction(horizCov.get(glyph), v + 10 + vertCount * 2),
  }
}

/** TrueType 轮廓转 SVG 路径。`scale` 把字体单位换成像素，y 翻成向下，原点挪到 (ox, oy)。 */
export function contoursToPath(list: Contour[], scale: number, ox: number, oy: number): string {
  const fmt = (n: number) => String(Math.round(n * 100) / 100)
  const X = (x: number) => fmt(ox + x * scale)
  const Y = (y: number) => fmt(oy - y * scale)
  const out: string[] = []
  for (const contour of list) {
    if (contour.length === 0) continue
    const n = contour.length
    let first = contour.findIndex((p) => p.on)
    let start: { x: number; y: number }
    if (first < 0) {
      const a = contour[0]!
      const b = contour[1 % n]!
      start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      first = 0
    } else start = contour[first]!
    out.push(`M${X(start.x)} ${Y(start.y)}`)
    let control: { x: number; y: number } | null = null
    for (let k = 1; k <= n; k++) {
      const p = contour[(first + k) % n]!
      if (p.on) {
        out.push(control ? `Q${X(control.x)} ${Y(control.y)} ${X(p.x)} ${Y(p.y)}` : `L${X(p.x)} ${Y(p.y)}`)
        control = null
      } else if (control) {
        const mid = { x: (control.x + p.x) / 2, y: (control.y + p.y) / 2 }
        out.push(`Q${X(control.x)} ${Y(control.y)} ${X(mid.x)} ${Y(mid.y)}`)
        control = p
      } else control = p
    }
    if (control) out.push(`Q${X(control.x)} ${Y(control.y)} ${X(start.x)} ${Y(start.y)}`)
    out.push('Z')
  }
  return out.join('')
}
