/**
 * 区域运算，名字和含义照 OGC Simple Features：buffer、union、difference、intersection、symDifference。
 * 区域按 nonzero 规则读，开放的子路径按直线闭合。结果由 Skia PathOps 算出，
 * 圆弧会变成二次曲线，误差在 0.05 px 以内。结果的外轮廓在屏幕上顺时针，洞逆时针。
 */
import { Path2D as NativePath2D, PathOp, StrokeCap, StrokeJoin } from '@napi-rs/canvas'
import { geomIssue } from './geom-issues.js'
import { Path2D } from './geom-path.js'
import {
  EPS,
  TAU,
  cross,
  reverseSub,
  segBounds,
  segFlatten,
  subsFromD,
  subsToD,
  type Box,
  type Pt,
  type Sub,
} from './geom-seg.js'

export type JoinStyle = 'round' | 'mitre' | 'bevel'
export type CapStyle = 'round' | 'flat' | 'square'
export type BufferOptions = { joinStyle?: JoinStyle; capStyle?: CapStyle; mitreLimit?: number }
export type PointLike = { x: number; y: number } | readonly [number, number]

const FLAT_TOL = 0.01

export function asPath(v: unknown, fn: string, name = 'path'): Path2D {
  if (v instanceof Path2D) return v
  if (v instanceof NativePath2D) return new Path2D(v)
  throw new TypeError(`${fn} 的 ${name} 需要 Path2D，收到 ${describe(v)}。字符串先写成 new Path2D(d)`)
}

export function asNumber(v: unknown, fn: string, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${fn} 的 ${name} 需要有限的数，收到 ${describe(v)}`)
  return v
}

export function asPoint(v: unknown, fn: string, name = 'point'): Pt {
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { x: v[0] as number, y: v[1] as number }
  }
  const o = v as { x?: unknown; y?: unknown } | null
  if (o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number' && Number.isFinite(o.x) && Number.isFinite(o.y)) {
    return { x: o.x, y: o.y }
  }
  throw new TypeError(`${fn} 的 ${name} 需要 {x, y} 或 [x, y]，收到 ${describe(v)}`)
}

export function asEnum<T extends string>(v: unknown, fn: string, name: string, allowed: readonly T[], fallback: T): T {
  if (v === undefined) return fallback
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
  throw new TypeError(`${fn} 的 ${name} 只能是 ${allowed.join('、')}，收到 ${describe(v)}`)
}

function describe(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v)
  if (v === null) return 'null'
  if (Array.isArray(v)) return `数组(${v.length})`
  if (typeof v === 'object') return (v as object).constructor?.name ?? 'object'
  return String(v)
}

const toNative = (subs: Sub[]): NativePath2D => new NativePath2D(subsToD(subs))

/** 折线化后的闭合多边形，供面积、包含和定向使用。 */
export function polygonOf(s: Sub, tol = FLAT_TOL): Pt[] {
  const pts: Pt[] = [s.start]
  for (const seg of s.segs) {
    const flat = segFlatten(seg, tol)
    for (let i = 1; i < flat.length; i++) pts.push(flat[i]!.p)
  }
  return pts
}

/** y 向下时，正值表示屏幕上顺时针。 */
export function signedArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) a += cross(poly[i]!, poly[(i + 1) % poly.length]!)
  return a / 2
}

function windingAt(poly: Pt[], p: Pt): number {
  let w = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    if (a.y <= p.y) {
      if (b.y > p.y && cross({ x: b.x - a.x, y: b.y - a.y }, { x: p.x - a.x, y: p.y - a.y }) > 0) w++
    } else if (b.y <= p.y && cross({ x: b.x - a.x, y: b.y - a.y }, { x: p.x - a.x, y: p.y - a.y }) < 0) w--
  }
  return w
}

/** Skia 的结果互不相交，嵌套层数的奇偶就是内外。外轮廓改成顺时针，洞改成逆时针。 */
function normalize(subs: Sub[]): Sub[] {
  const items = subs
    .filter((s) => s.segs.length > 0)
    .map((s) => {
      const poly = polygonOf(s)
      return { s: { ...s, closed: true }, poly, area: signedArea(poly) }
    })
    .filter((it) => Math.abs(it.area) > 1e-6)
  return items.map((it, i) => {
    let depth = 0
    for (let j = 0; j < items.length; j++) {
      if (j !== i && windingAt(items[j]!.poly, it.poly[0]!) !== 0) depth++
    }
    const wantCw = depth % 2 === 0
    return wantCw === it.area > 0 ? it.s : reverseSub(it.s)
  })
}

function result(n: NativePath2D, fn: string): Path2D {
  const subs = normalize(subsFromD(n.toSVGString()))
  if (subs.length === 0) geomIssue('empty-geometry', `${fn} 的结果是空的`, '检查输入是否重叠，或距离是否把形状缩没了')
  return Path2D.fromSubs(subs)
}

function regionSubs(p: Path2D): Sub[] {
  return p.subs.filter((s) => s.segs.length > 0)
}

export function union(...paths: Path2D[]): Path2D {
  const acc = new NativePath2D()
  for (const [i, p] of paths.entries()) acc.op(toNative(regionSubs(asPath(p, 'union', `第 ${i + 1} 个参数`))), PathOp.Union)
  return result(acc, 'union')
}

export function difference(a: Path2D, ...others: Path2D[]): Path2D {
  const acc = toNative(regionSubs(asPath(a, 'difference', 'a')))
  acc.simplify()
  for (const p of others) acc.op(toNative(regionSubs(asPath(p, 'difference', 'b'))), PathOp.Difference)
  return result(acc, 'difference')
}

export function intersection(a: Path2D, ...others: Path2D[]): Path2D {
  const acc = toNative(regionSubs(asPath(a, 'intersection', 'a')))
  acc.simplify()
  for (const p of others) acc.op(toNative(regionSubs(asPath(p, 'intersection', 'b'))), PathOp.Intersect)
  return result(acc, 'intersection')
}

export function symDifference(a: Path2D, b: Path2D): Path2D {
  const acc = toNative(regionSubs(asPath(a, 'symDifference', 'a')))
  acc.simplify()
  acc.op(toNative(regionSubs(asPath(b, 'symDifference', 'b'))), PathOp.Xor)
  return result(acc, 'symDifference')
}

const JOIN = { round: StrokeJoin.Round, mitre: StrokeJoin.Miter, bevel: StrokeJoin.Bevel }
const CAP = { round: StrokeCap.Round, flat: StrokeCap.Butt, square: StrokeCap.Square }

/**
 * 距离 d 以内的所有点。闭合子路径是区域，开放子路径是曲线，只有一个点的子路径是点。
 * 负的 d 只收缩区域。mitreLimit 是斜接长度和距离之比，和 SVG 的 stroke-miterlimit 相同。
 */
export function buffer(path: Path2D, d: number, options: BufferOptions = {}): Path2D {
  const p = asPath(path, 'buffer')
  asNumber(d, 'buffer', 'd')
  const joinStyle = asEnum(options.joinStyle, 'buffer', 'joinStyle', ['round', 'mitre', 'bevel'] as const, 'round')
  const capStyle = asEnum(options.capStyle, 'buffer', 'capStyle', ['round', 'flat', 'square'] as const, 'round')
  const mitreLimit = options.mitreLimit === undefined ? 5 : asNumber(options.mitreLimit, 'buffer', 'mitreLimit')
  const regions = p.subs.filter((s) => s.closed && s.segs.length > 0)
  const curves = p.subs.filter((s) => !s.closed && s.segs.length > 0)
  const points = p.subs.filter((s) => s.segs.length === 0)
  const acc = new NativePath2D()
  if (regions.length) {
    const area = toNative(regions)
    area.simplify()
    if (d !== 0) {
      const ring = toNative(regions).stroke({ width: 2 * Math.abs(d), join: JOIN[joinStyle], miterLimit: mitreLimit })
      area.op(ring, d > 0 ? PathOp.Union : PathOp.Difference)
    }
    acc.op(area, PathOp.Union)
  }
  if (d > 0) {
    if (curves.length) {
      acc.op(toNative(curves).stroke({ width: 2 * d, join: JOIN[joinStyle], cap: CAP[capStyle], miterLimit: mitreLimit }), PathOp.Union)
    }
    for (const s of points) {
      const dot = new NativePath2D()
      if (capStyle === 'round') dot.arc(s.start.x, s.start.y, d, 0, TAU)
      else if (capStyle === 'square') dot.rect(s.start.x - d, s.start.y - d, 2 * d, 2 * d)
      acc.op(dot, PathOp.Union)
    }
  }
  const out = normalize(subsFromD(acc.toSVGString()))
  if (d < 0 && regions.length) {
    const before = normalize(subsFromD(toNative(regions).simplify().toSVGString()))
    const outers = (subs: Sub[]) => subs.filter((s) => signedArea(polygonOf(s)) > 0).length
    if (outers(out) < outers(before)) {
      geomIssue(
        'offset-collapse',
        `buffer 向内 ${-d} px 时有 ${outers(before) - outers(out)} 块区域缩没了`,
        '缩小距离，或先确认最窄处的宽度大于 2 倍距离',
      )
    }
  }
  if (out.length === 0 && (regions.length || (d > 0 && (curves.length || points.length)))) {
    geomIssue('empty-geometry', 'buffer 的结果是空的', d < 0 ? '向内的距离超过了形状的一半宽' : undefined)
  }
  return Path2D.fromSubs(out)
}

/** 区域面积，按 nonzero 规则，重叠部分只算一次。 */
export function area(path: Path2D): number {
  const p = asPath(path, 'area')
  const subs = normalize(subsFromD(toNative(regionSubs(p)).simplify().toSVGString()))
  return subs.reduce((sum, s) => sum + signedArea(polygonOf(s)), 0)
}

/** 点在区域内，按 nonzero 规则。 */
export function contains(path: Path2D, point: PointLike): boolean {
  const p = asPath(path, 'contains')
  const q = asPoint(point, 'contains')
  let w = 0
  for (const s of regionSubs(p)) w += windingAt(polygonOf(s), q)
  return w !== 0
}

export type Bounds = { x: number; y: number; width: number; height: number }

/** 精确包围盒，取曲线本身，不取控制点。 */
export function bounds(path: Path2D): Bounds {
  const p = asPath(path, 'bounds')
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const s of p.subs) {
    if (s.segs.length === 0) segBounds({ k: 'L', a: s.start, b: s.start }, box)
    for (const seg of s.segs) segBounds(seg, box)
  }
  if (box.x0 > box.x1) return { x: 0, y: 0, width: 0, height: 0 }
  const r = (n: number) => (Math.abs(n - Math.round(n)) < EPS * 1000 ? Math.round(n) : n)
  return { x: r(box.x0), y: r(box.y0), width: r(box.x1 - box.x0), height: r(box.y1 - box.y0) }
}
