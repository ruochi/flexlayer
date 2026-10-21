/**
 * 曲线命令，名字照 AutoCAD 和 Rhino：fillet、chamfer、offset、blend、trim、extend、join、reverse。
 * 查询：intersections、closestPoint、pointAt、tangentAt、length。
 * 一条曲线是一段子路径。直线和圆弧全程精确，贝塞尔的 offset 是拟合，误差在 0.05 px 以内。
 */
import { geomIssue } from './geom-issues.js'
import { Path2D } from './geom-path.js'
import { asEnum, asNumber, asPath, asPoint, type JoinStyle, type PointLike } from './geom-region.js'
import {
  TAU,
  add,
  arcSeg,
  arcToCubics,
  cross,
  dist,
  dot,
  elemOf,
  footOn,
  intersectElems,
  isCircular,
  lineSeg,
  mul,
  norm,
  offsetElem,
  paramOn,
  perp,
  quadToCubic,
  reverseSub,
  samePt,
  segFlatten,
  segLength,
  segLengthTo,
  segParamAt,
  segPoint,
  segSplit,
  segTangent,
  sub,
  subEnd,
  fmt,
  type Elem,
  type Pt,
  type Seg,
  type Sub,
} from './geom-seg.js'

const TOL = 0.05
const U_EPS = 1e-9

/** 取出一条曲线。多段子路径只用第一段，并记 not-a-curve。 */
function curveOf(v: unknown, fn: string, name = 'curve'): Sub {
  const p = asPath(v, fn, name)
  const subs = p.subs.filter((s) => s.segs.length > 0)
  if (subs.length > 1) {
    geomIssue('not-a-curve', `${fn} 的 ${name} 有 ${subs.length} 段子路径，只用了第一段`, '先用 join 连成一条，或分开调用')
  }
  const s = subs[0] ?? p.subs[0]
  if (!s) return { start: { x: 0, y: 0 }, segs: [], closed: false }
  return { start: s.start, segs: s.segs.slice(), closed: s.closed }
}

const pathOf = (...subs: Sub[]): Path2D => Path2D.fromSubs(subs)

function openSub(segs: Seg[], closed = false): Sub {
  return { start: segs[0]!.a, segs, closed }
}

/** 拼接时把相邻段的端点对齐，消掉浮点误差。 */
function stitch(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    if (s.k === 'L' && samePt(s.a, s.b, 1e-9)) continue
    const prev = out[out.length - 1]
    out.push(prev && !samePt(prev.b, s.a, 0) ? ({ ...s, a: prev.b } as Seg) : s)
  }
  return out
}

// ---------------------------------------------------------------- fillet

type Fit = { u1: number; u2: number; arc: Seg }
/** 切点参数的允许范围：u1 在 s1 上，u2 在 s2 上。 */
type Window = { lo1: number; hi1: number; lo2: number; hi2: number }
/** 拐角模式每边最多切掉一半，这是 CSS polygon(round) 的约束。 */
const HALF: Window = { lo1: 0.5, hi1: 1, lo2: 0, hi2: 0.5 }

/**
 * s1 的末端和 s2 的起端之间半径 r 的圆角。圆心是两条等距元素的交点，切点是圆心的垂足，
 * 切向必须和行进方向一致。
 */
function fitFillet(s1: Seg, s2: Seg, e1: Elem, e2: Elem, r: number, w: Window): Fit | null {
  let best: Fit | null = null
  let bestCost = Infinity
  for (const k1 of [1, -1]) {
    for (const k2 of [1, -1]) {
      const o1 = offsetElem(e1, k1 * r)
      const o2 = offsetElem(e2, k2 * r)
      if (!o1 || !o2) continue
      for (const c of intersectElems(o1, o2)) {
        const t1 = footOn(e1, c)
        const t2 = footOn(e2, c)
        const u1 = paramOn(s1, t1)
        const u2 = paramOn(s2, t2)
        if (u1 < w.lo1 - U_EPS || u1 > w.hi1 + U_EPS || u2 < w.lo2 - U_EPS || u2 > w.hi2 + U_EPS) continue
        const r1 = sub(t1, c)
        const r2 = sub(t2, c)
        const g1 = dot(perp(r1), segTangent(s1, u1))
        const g2 = dot(perp(r2), segTangent(s2, u2))
        const sigma = Math.sign(g1)
        if (sigma === 0 || g1 * sigma < r * 0.999 || g2 * sigma < r * 0.999) continue
        const a1 = Math.atan2(r1.y, r1.x)
        let dt = Math.atan2(r2.y, r2.x) - a1
        if (sigma > 0) while (dt <= 0) dt += TAU
        else while (dt >= 0) dt -= TAU
        if (Math.abs(dt) > TAU - 1e-9) continue
        const cost = dist(t1, s1.b) + dist(t2, s2.a)
        if (cost < bestCost) {
          bestCost = cost
          best = { u1, u2, arc: arcSeg(c, r, r, 0, a1, dt, t1, t2) }
        }
      }
    }
  }
  return best
}

/** 能放下的最大半径，二分查找。 */
function largestFit(test: (r: number) => boolean, hi: number): number {
  let lo = 0
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (test(mid)) lo = mid
    else hi = mid
  }
  return lo
}

const floor3 = (n: number) => Math.floor(n * 1000) / 1000

function isCorner(s1: Seg, s2: Seg): boolean {
  const c = dot(segTangent(s1, 1), segTangent(s2, 0))
  return c < 1 - 1e-9 && c > -1 + 1e-9
}

type CornerCut = { u1: number; u2: number; joint: Seg }

/** 一条曲线上所有拐角各做一次 cut，然后按参数裁剪并插入接头。 */
function rebuildCorners(s: Sub, cut: (s1: Seg, s2: Seg) => CornerCut | null): Sub {
  const segs = s.segs
  const n = segs.length
  const at: Array<CornerCut | null> = new Array(n).fill(null)
  for (let j = s.closed ? 0 : 1; j < n; j++) {
    const s1 = segs[(j - 1 + n) % n]!
    const s2 = segs[j]!
    if (n < 2 && !s.closed) break
    if (!samePt(s1.b, s2.a, 1e-6) || !isCorner(s1, s2)) continue
    at[j] = cut(s1, s2)
  }
  const out: Seg[] = []
  for (let i = 0; i < n; i++) {
    const u0 = at[i]?.u2 ?? 0
    const end = at[(i + 1) % n]
    const u1 = (i + 1 < n || s.closed) && end ? end.u1 : 1
    out.push(segSplit(segs[i]!, u0, u1))
    if ((i + 1 < n || s.closed) && end) out.push(end.joint)
  }
  const stitched = stitch(out)
  if (s.closed && stitched.length) stitched[stitched.length - 1] = { ...stitched[stitched.length - 1]!, b: stitched[0]!.a } as Seg
  return { start: stitched[0]?.a ?? s.start, segs: stitched, closed: s.closed }
}

function filletCorners(curve: Sub, r: number): Sub {
  let tooLarge = 0
  let fits = Infinity
  let unsupported = 0
  const out = rebuildCorners(curve, (s1, s2) => {
    const e1 = elemOf(s1)
    const e2 = elemOf(s2)
    if (!e1 || !e2) {
      unsupported++
      return null
    }
    let fit = fitFillet(s1, s2, e1, e2, r, HALF)
    if (!fit) {
      const best = largestFit((x) => fitFillet(s1, s2, e1, e2, x, HALF) !== null, r)
      tooLarge++
      fits = Math.min(fits, best)
      if (best < 1e-6) return null
      fit = fitFillet(s1, s2, e1, e2, best, HALF)
      if (!fit) return null
    }
    return { u1: fit.u1, u2: fit.u2, joint: fit.arc }
  })
  if (tooLarge) {
    geomIssue(
      'fillet-too-large',
      `fillet 半径 ${fmt(r)} 在 ${tooLarge} 个拐角放不下，已收小到能放下的最大值`,
      `半径不超过 ${floor3(fits)} 时每个拐角都放得下`,
    )
  }
  if (unsupported) {
    geomIssue('curve-unsupported', `fillet 跳过了 ${unsupported} 个带贝塞尔或椭圆弧的拐角`, '圆角只在直线和圆弧之间计算，贝塞尔拐角可以改用 blend')
  }
  return out
}

/** 两条曲线朝向会合点的那一端，返回调整好方向的两条曲线和会合点。 */
function meet(a: Sub, b: Sub, fn: string): { A: Sub; B: Sub; m: Pt } | null {
  let best: { A: Sub; B: Sub; m: Pt } | null = null
  let bestCost = Infinity
  let unsupported = false
  for (const ra of [false, true]) {
    for (const rb of [false, true]) {
      const A = ra ? reverseSub(a) : a
      const B = rb ? reverseSub(b) : b
      const s1 = A.segs[A.segs.length - 1]!
      const s2 = B.segs[0]!
      const e1 = elemOf(s1)
      const e2 = elemOf(s2)
      if (!e1 || !e2) {
        unsupported = true
        continue
      }
      for (const m of intersectElems(e1, e2)) {
        if (paramOn(s1, m) <= U_EPS || paramOn(s2, m) >= 1 - U_EPS) continue
        const cost = dist(m, s1.b) + dist(m, s2.a)
        if (cost < bestCost) {
          bestCost = cost
          best = { A, B, m }
        }
      }
    }
  }
  if (!best) {
    if (unsupported) geomIssue('curve-unsupported', `${fn} 的端点落在贝塞尔或椭圆弧上`, '两条曲线相接的那一段需要是直线或圆弧')
    else geomIssue('no-intersection', `${fn} 的两条曲线延长后也不相交`, '平行的直线没有交点。检查两条曲线是不是画反了方向')
  }
  return best
}

function joinPair(A: Sub, B: Sub, u1: number, joint: Seg | null, u2: number): Path2D {
  const s1 = A.segs[A.segs.length - 1]!
  const s2 = B.segs[0]!
  const segs = [...A.segs.slice(0, -1), segSplit(s1, 0, u1), ...(joint ? [joint] : []), segSplit(s2, u2, 1), ...B.segs.slice(1)]
  return pathOf(openSub(stitch(segs)))
}

/**
 * fillet(curve, r) 给一条曲线的每个拐角倒圆角。
 * fillet(a, b, r) 把两条曲线裁剪或延长到切点，用半径 r 的圆弧连成一条。r 为 0 时连成尖角。
 */
export function fillet(curve: Path2D, r: number): Path2D
export function fillet(a: Path2D, b: Path2D, r: number): Path2D
export function fillet(x: Path2D, y: Path2D | number, z?: number): Path2D {
  if (typeof y === 'number') {
    const r = asNumber(y, 'fillet', 'r')
    if (r < 0) throw new RangeError('fillet 的 r 不能是负数')
    const c = curveOf(x, 'fillet')
    return r === 0 || c.segs.length === 0 ? pathOf(c) : pathOf(filletCorners(c, r))
  }
  const r = asNumber(z, 'fillet', 'r')
  if (r < 0) throw new RangeError('fillet 的 r 不能是负数')
  const a = curveOf(x, 'fillet', 'a')
  const b = curveOf(y, 'fillet', 'b')
  if (!a.segs.length || !b.segs.length) return pathOf(a, b)
  const hit = meet(a, b, 'fillet')
  if (!hit) return pathOf(a, b)
  const { A, B, m } = hit
  const s1 = A.segs[A.segs.length - 1]!
  const s2 = B.segs[0]!
  if (r === 0) return joinPair(A, B, paramOn(s1, m), null, paramOn(s2, m))
  const e1 = elemOf(s1)!
  const e2 = elemOf(s2)!
  // 切点落在会合点之前保留的那部分上，否则会选到背面象限里的圆
  const w: Window = { lo1: U_EPS, hi1: paramOn(s1, m), lo2: paramOn(s2, m), hi2: 1 - U_EPS }
  const fit = fitFillet(s1, s2, e1, e2, r, w)
  if (!fit) {
    const best = largestFit((t) => fitFillet(s1, s2, e1, e2, t, w) !== null, r)
    geomIssue(
      'fillet-too-large',
      `fillet 的两条曲线之间放不下半径 ${fmt(r)} 的圆角`,
      best > 1e-6 ? `半径不超过 ${floor3(best)} 时放得下` : undefined,
    )
    return pathOf(a, b)
  }
  return joinPair(A, B, fit.u1, fit.arc, fit.u2)
}

// ---------------------------------------------------------------- chamfer

/**
 * chamfer(curve, d) 在每个拐角两边各切掉 d，连一条直线。
 * chamfer(a, b, d1, d2) 先把两条曲线裁剪或延长到交点，再从交点量 d1、d2。
 */
export function chamfer(curve: Path2D, d: number): Path2D
export function chamfer(a: Path2D, b: Path2D, d1: number, d2?: number): Path2D
export function chamfer(x: Path2D, y: Path2D | number, z?: number, w?: number): Path2D {
  if (typeof y === 'number') {
    const d = asNumber(y, 'chamfer', 'd')
    if (d < 0) throw new RangeError('chamfer 的 d 不能是负数')
    const c = curveOf(x, 'chamfer')
    if (d === 0 || !c.segs.length) return pathOf(c)
    let clamped = 0
    let fits = Infinity
    const out = rebuildCorners(c, (s1, s2) => {
      const l1 = segLength(s1)
      const l2 = segLength(s2)
      const max = Math.min(l1, l2) / 2
      let dd = d
      if (dd > max) {
        clamped++
        fits = Math.min(fits, max)
        dd = max
      }
      const u1 = segParamAt(s1, l1 - dd)
      const u2 = segParamAt(s2, dd)
      return { u1, u2, joint: lineSeg(segPoint(s1, u1), segPoint(s2, u2)) }
    })
    if (clamped) {
      geomIssue('fillet-too-large', `chamfer 距离 ${fmt(d)} 在 ${clamped} 个拐角超过半条边，已收小`, `距离不超过 ${floor3(fits)} 时每个拐角都放得下`)
    }
    return pathOf(out)
  }
  const d1 = asNumber(z, 'chamfer', 'd1')
  const d2 = w === undefined ? d1 : asNumber(w, 'chamfer', 'd2')
  if (d1 < 0 || d2 < 0) throw new RangeError('chamfer 的距离不能是负数')
  const a = curveOf(x, 'chamfer', 'a')
  const b = curveOf(y, 'chamfer', 'b')
  if (!a.segs.length || !b.segs.length) return pathOf(a, b)
  const hit = meet(a, b, 'chamfer')
  if (!hit) return pathOf(a, b)
  const { A, B, m } = hit
  const s1 = segSplit(A.segs[A.segs.length - 1]!, 0, paramOn(A.segs[A.segs.length - 1]!, m))
  const s2 = segSplit(B.segs[0]!, paramOn(B.segs[0]!, m), 1)
  const l1 = segLength(s1)
  const l2 = segLength(s2)
  if (d1 > l1 || d2 > l2) {
    geomIssue('fillet-too-large', `chamfer 的距离超过了到交点的长度`, `a 端不超过 ${floor3(l1)}，b 端不超过 ${floor3(l2)}`)
    return pathOf(a, b)
  }
  const u1 = segParamAt(s1, l1 - d1)
  const u2 = segParamAt(s2, d2)
  const A2: Sub = { ...A, segs: [...A.segs.slice(0, -1), s1] }
  const B2: Sub = { ...B, segs: [s2, ...B.segs.slice(1)] }
  return joinPair(A2, B2, u1, lineSeg(segPoint(s1, u1), segPoint(s2, u2)), u2)
}

// ---------------------------------------------------------------- offset

export type OffsetOptions = { joinStyle?: JoinStyle; mitreLimit?: number }

/** 三次贝塞尔的等距线：两端精确，用最小二乘定把手长度，误差超过 TOL 就对半分。 */
function offsetCubic(s: Extract<Seg, { k: 'C' }>, d: number, depth = 0): Seg[] {
  const off = (u: number) => add(segPoint(s, u), mul(perp(segTangent(s, u)), d))
  const p0 = off(0)
  const p3 = off(1)
  const t0 = segTangent(s, 0)
  const t3 = segTangent(s, 1)
  let suu = 0
  let suv = 0
  let svv = 0
  let sur = 0
  let svr = 0
  for (let i = 1; i < 8; i++) {
    const u = i / 8
    const v = 1 - u
    const b1 = 3 * v * v * u
    const b2 = 3 * v * u * u
    const base = add(mul(p0, v * v * v + b1), mul(p3, b2 + u * u * u))
    const r = sub(off(u), base)
    const U = mul(t0, b1)
    const V = mul(t3, -b2)
    suu += dot(U, U)
    suv += dot(U, V)
    svv += dot(V, V)
    sur += dot(U, r)
    svr += dot(V, r)
  }
  const det = suu * svv - suv * suv
  let alpha = dist(p0, p3) / 3
  let beta = alpha
  if (Math.abs(det) > 1e-12) {
    alpha = (sur * svv - svr * suv) / det
    beta = (svr * suu - sur * suv) / det
  }
  const fit: Seg = { k: 'C', a: p0, c1: add(p0, mul(t0, alpha)), c2: sub(p3, mul(t3, beta)), b: p3 }
  let err = 0
  for (let i = 1; i < 16; i++) err = Math.max(err, dist(segPoint(fit, i / 16), off(i / 16)))
  if (err <= TOL || depth >= 8) return [fit]
  const left = segSplit(s, 0, 0.5) as Extract<Seg, { k: 'C' }>
  const right = segSplit(s, 0.5, 1) as Extract<Seg, { k: 'C' }>
  return [...offsetCubic(left, d, depth + 1), ...offsetCubic(right, d, depth + 1)]
}

/** 一段的等距线。圆弧半径缩到零时返回空。 */
function offsetSeg(s: Seg, d: number): Seg[] {
  if (s.k === 'L') {
    const n = mul(perp(norm(sub(s.b, s.a))), d)
    return [lineSeg(add(s.a, n), add(s.b, n))]
  }
  if (s.k === 'A') {
    if (!isCircular(s)) return arcToCubics(s).flatMap((c) => offsetSeg(c, d))
    const r = s.rx - Math.sign(s.dt) * d
    if (r <= 1e-9) return []
    return [arcSeg(s.c, r, r, s.rot, s.t0, s.dt)]
  }
  if (s.k === 'Q') return offsetCubic(quadToCubic(s), d)
  return offsetCubic(s, d)
}

type Hit = { p: Pt; ua: number; ub: number }

/** 两段的交点和各自的参数。直线和圆弧用元素求交，其余折线化。 */
function segHits(a: Seg, b: Seg, extendA = false, extendB = false): Hit[] {
  const ea = elemOf(a)
  const eb = elemOf(b)
  const ok = (u: number, ext: boolean) => (ext ? true : u >= -U_EPS && u <= 1 + U_EPS)
  const clamp = (u: number, ext: boolean) => (ext ? u : Math.min(1, Math.max(0, u)))
  if (ea && eb) {
    return intersectElems(ea, eb)
      .map((p) => ({ p, ua: paramOn(a, p), ub: paramOn(b, p) }))
      .filter((h) => ok(h.ua, extendA) && ok(h.ub, extendB))
      .map((h) => ({ ...h, ua: clamp(h.ua, extendA), ub: clamp(h.ub, extendB) }))
  }
  const fa = segFlatten(a, TOL / 10)
  const fb = segFlatten(b, TOL / 10)
  const out: Hit[] = []
  for (let i = 1; i < fa.length; i++) {
    const p = fa[i - 1]!
    const q = fa[i]!
    for (let j = 1; j < fb.length; j++) {
      const r = fb[j - 1]!
      const s = fb[j]!
      const dp = sub(q.p, p.p)
      const dr = sub(s.p, r.p)
      const den = cross(dp, dr)
      if (Math.abs(den) < 1e-14) continue
      const t = cross(sub(r.p, p.p), dr) / den
      const v = cross(sub(r.p, p.p), dp) / den
      if (t < -1e-12 || t > 1 + 1e-12 || v < -1e-12 || v > 1 + 1e-12) continue
      out.push({ p: add(p.p, mul(dp, t)), ua: p.u + (q.u - p.u) * t, ub: r.u + (s.u - r.u) * v })
    }
  }
  return out
}

function joinCorner(e: Pt, s: Pt, corner: Pt, t1: Pt, t2: Pt, d: number, style: JoinStyle, limit: number): Seg[] {
  if (style === 'round') {
    const r1 = sub(e, corner)
    const sigma = Math.sign(dot(perp(r1), t1)) || 1
    const a1 = Math.atan2(r1.y, r1.x)
    let dt = Math.atan2(s.y - corner.y, s.x - corner.x) - a1
    if (sigma > 0) while (dt <= 0) dt += TAU
    else while (dt >= 0) dt -= TAU
    const r = Math.abs(d)
    return [arcSeg(corner, r, r, 0, a1, dt, e, s)]
  }
  if (style === 'mitre') {
    const x = intersectElems({ k: 'line', p: e, d: t1 }, { k: 'line', p: s, d: t2 })[0]
    if (x && dist(x, corner) <= limit * Math.abs(d)) return [lineSeg(e, x), lineSeg(x, s)]
  }
  return [lineSeg(e, s)]
}

/**
 * 等距曲线，距离 d 沿左法向 (−dy, dx)，y 向下时是屏幕上行进方向的右手边。
 * 凹角在交点处裁剪，凸角按 joinStyle 连接。
 */
export function offset(curve: Path2D, d: number, options: OffsetOptions = {}): Path2D {
  const c = curveOf(curve, 'offset')
  asNumber(d, 'offset', 'd')
  const style = asEnum(options.joinStyle, 'offset', 'joinStyle', ['mitre', 'round', 'bevel'] as const, 'mitre')
  const limit = options.mitreLimit === undefined ? 5 : asNumber(options.mitreLimit, 'offset', 'mitreLimit')
  if (d === 0 || !c.segs.length) return pathOf(c)
  const items: Array<{ src: Seg; out: Seg[] }> = []
  let collapsed = 0
  for (const s of c.segs) {
    const out = offsetSeg(s, d)
    if (out.length) items.push({ src: s, out })
    else collapsed++
  }
  if (collapsed) geomIssue('offset-collapse', `offset ${fmt(d)} 时有 ${collapsed} 段圆弧半径缩到了零，已去掉`, '减小距离，或在圆弧的外侧偏移')
  if (!items.length) return pathOf()
  const n = items.length
  const joints: Seg[][] = new Array(n).fill(null).map(() => [])
  for (let i = 0; i < n; i++) {
    const j = i + 1
    if (j === n && !c.closed) break
    const A = items[i]!
    const B = items[j % n]!
    const last = A.out[A.out.length - 1]!
    const first = B.out[0]!
    if (samePt(last.b, first.a, 1e-7)) continue
    const t1 = segTangent(A.src, 1)
    const t2 = segTangent(B.src, 0)
    const corner = A.src.b
    if (cross(t1, t2) * d > 0) {
      const hits = segHits(last, first).filter((h) => h.ua > U_EPS && h.ub < 1 - U_EPS)
      hits.sort((p, q) => dist(p.p, corner) - dist(q.p, corner))
      const h = hits[0]
      if (h) {
        A.out[A.out.length - 1] = segSplit(last, 0, h.ua)
        B.out[0] = segSplit(B.out[0]!, h.ub, 1)
        continue
      }
      joints[i] = [lineSeg(last.b, first.a)]
      continue
    }
    const joint = joinCorner(last.b, first.a, corner, t1, t2, d, style, limit)
    if (style === 'mitre' && joint.length === 2) {
      // 斜接时直线直接延长到尖点，不另起共线的一段
      const x = joint[0]!.b
      const head: Seg[] = []
      const tail: Seg[] = []
      if (last.k === 'L') A.out[A.out.length - 1] = lineSeg(last.a, x)
      else head.push(joint[0]!)
      if (first.k === 'L') B.out[0] = lineSeg(x, first.b)
      else tail.push(joint[1]!)
      joints[i] = [...head, ...tail]
      continue
    }
    joints[i] = joint
  }
  const segs = stitch(items.flatMap((it, i) => [...it.out, ...joints[i]!]))
  if (c.closed && segs.length) segs[segs.length - 1] = { ...segs[segs.length - 1]!, b: segs[0]!.a } as Seg
  return pathOf({ start: segs[0]!.a, segs, closed: c.closed })
}

// ---------------------------------------------------------------- blend

export type BlendOptions = { continuity?: 'tangency' | 'curvature'; bulge?: number | readonly [number, number] }

/** 从 a 的末端到 b 的起端，一条和两端相切的三次贝塞尔。把手长度是端点距离的 bulge / 3。 */
export function blend(a: Path2D, b: Path2D, options: BlendOptions = {}): Path2D {
  const A = curveOf(a, 'blend', 'a')
  const B = curveOf(b, 'blend', 'b')
  const continuity = asEnum(options.continuity, 'blend', 'continuity', ['tangency', 'curvature'] as const, 'tangency')
  if (continuity === 'curvature') throw new Error('blend 的 continuity: curvature 还没实现，先用 tangency')
  const raw = options.bulge ?? 1
  const [k1, k2] = typeof raw === 'number' ? [raw, raw] : raw
  asNumber(k1, 'blend', 'bulge')
  asNumber(k2, 'blend', 'bulge')
  if (!A.segs.length || !B.segs.length) throw new TypeError('blend 的两条曲线都不能是空的')
  const p0 = subEnd(A)
  const p3 = B.start
  const h = dist(p0, p3) / 3
  const c1 = add(p0, mul(segTangent(A.segs[A.segs.length - 1]!, 1), h * k1))
  const c2 = sub(p3, mul(segTangent(B.segs[0]!, 0), h * k2))
  return pathOf(openSub([{ k: 'C', a: p0, c1, c2, b: p3 }]))
}

// ---------------------------------------------------------------- 查询

function cumulative(s: Sub): number[] {
  const out = [0]
  for (const seg of s.segs) out.push(out[out.length - 1]! + segLength(seg))
  return out
}

/** 曲线长度，单位 px。 */
export function length(curve: Path2D): number {
  const c = curveOf(curve, 'length')
  return cumulative(c)[c.segs.length]!
}

function locate(c: Sub, s: number): { seg: Seg; u: number } {
  const cum = cumulative(c)
  const total = cum[cum.length - 1]!
  const t = Math.min(total, Math.max(0, s))
  for (let i = 0; i < c.segs.length; i++) {
    if (t <= cum[i + 1]! || i === c.segs.length - 1) {
      const seg = c.segs[i]!
      return { seg, u: segParamAt(seg, t - cum[i]!) }
    }
  }
  throw new TypeError('曲线是空的')
}

/** 弧长 s 处的点。s 超出两端时取端点。 */
export function pointAt(curve: Path2D, s: number): Pt {
  const c = curveOf(curve, 'pointAt')
  asNumber(s, 'pointAt', 's')
  if (!c.segs.length) return { ...c.start }
  const { seg, u } = locate(c, s)
  return segPoint(seg, u)
}

/** 弧长 s 处的单位切向，沿曲线方向。 */
export function tangentAt(curve: Path2D, s: number): Pt {
  const c = curveOf(curve, 'tangentAt')
  asNumber(s, 'tangentAt', 's')
  if (!c.segs.length) return { x: 1, y: 0 }
  const { seg, u } = locate(c, s)
  return segTangent(seg, u)
}

function closestOnSeg(seg: Seg, p: Pt): number {
  if (seg.k === 'L') {
    const v = sub(seg.b, seg.a)
    const l2 = dot(v, v)
    return l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, seg.a), v) / l2)) : 0
  }
  if (isCircular(seg)) {
    const u = paramOn(seg, p)
    if (u >= 0 && u <= 1) return u
    return dist(seg.a, p) <= dist(seg.b, p) ? 0 : 1
  }
  const N = 64
  let best = 0
  let bestD = Infinity
  for (let i = 0; i <= N; i++) {
    const dd = dist(segPoint(seg, i / N), p)
    if (dd < bestD) {
      bestD = dd
      best = i / N
    }
  }
  let lo = Math.max(0, best - 1 / N)
  let hi = Math.min(1, best + 1 / N)
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (dist(segPoint(seg, m1), p) < dist(segPoint(seg, m2), p)) hi = m2
    else lo = m1
  }
  return (lo + hi) / 2
}

/** 曲线上离 point 最近的点，s 是它的弧长位置，distance 是距离。 */
export function closestPoint(curve: Path2D, point: PointLike): { x: number; y: number; s: number; distance: number } {
  const c = curveOf(curve, 'closestPoint')
  const p = asPoint(point, 'closestPoint')
  if (!c.segs.length) return { ...c.start, s: 0, distance: dist(c.start, p) }
  const cum = cumulative(c)
  let best = { x: c.start.x, y: c.start.y, s: 0, distance: Infinity }
  c.segs.forEach((seg, i) => {
    const u = closestOnSeg(seg, p)
    const q = segPoint(seg, u)
    const dd = dist(q, p)
    if (dd < best.distance) best = { x: q.x, y: q.y, s: cum[i]! + segLengthTo(seg, u), distance: dd }
  })
  return best
}

/** 两条曲线的交点，按 a 上的弧长排序。sa、sb 是交点在两条曲线上的弧长位置。 */
export function intersections(a: Path2D, b: Path2D): Array<{ x: number; y: number; sa: number; sb: number }> {
  const A = curveOf(a, 'intersections', 'a')
  const B = curveOf(b, 'intersections', 'b')
  return hitsBetween(A, B)
}

function hitsBetween(A: Sub, B: Sub): Array<{ x: number; y: number; sa: number; sb: number }> {
  const ca = cumulative(A)
  const cb = cumulative(B)
  const out: Array<{ x: number; y: number; sa: number; sb: number }> = []
  A.segs.forEach((sa, i) => {
    B.segs.forEach((sb, j) => {
      for (const h of segHits(sa, sb)) {
        const hit = { x: h.p.x, y: h.p.y, sa: ca[i]! + segLengthTo(sa, h.ua), sb: cb[j]! + segLengthTo(sb, h.ub) }
        if (!out.some((o) => Math.hypot(o.x - hit.x, o.y - hit.y) < 1e-6)) out.push(hit)
      }
    })
  })
  return out.sort((p, q) => p.sa - q.sa)
}

// ---------------------------------------------------------------- trim / extend / join / reverse

/** 弧长 s0 到 s1 的一截。 */
function piece(c: Sub, s0: number, s1: number): Seg[] {
  const cum = cumulative(c)
  const out: Seg[] = []
  c.segs.forEach((seg, i) => {
    const lo = Math.max(s0, cum[i]!)
    const hi = Math.min(s1, cum[i + 1]!)
    if (hi - lo <= 1e-9) return
    const u0 = lo <= cum[i]! ? 0 : segParamAt(seg, lo - cum[i]!)
    const u1 = hi >= cum[i + 1]! ? 1 : segParamAt(seg, hi - cum[i]!)
    out.push(segSplit(seg, u0, u1))
  })
  return stitch(out)
}

/**
 * 用 cutter 截断曲线。keep 是 'start'、'end' 或一个点：
 * 'start' 留下第一个交点之前，'end' 留下最后一个交点之后，点留下离它最近的那一截。
 */
export function trim(curve: Path2D, cutter: Path2D, keep: 'start' | 'end' | PointLike): Path2D {
  const c = curveOf(curve, 'trim')
  const cut = asPath(cutter, 'trim', 'cutter')
  const mode = keep === 'start' || keep === 'end' ? keep : asPoint(keep, 'trim', 'keep')
  if (!c.segs.length) return pathOf(c)
  const cuts = [
    ...new Set(
      cut.subs
        .filter((s) => s.segs.length)
        .flatMap((s) => hitsBetween(c, s).map((h) => h.sa)),
    ),
  ].sort((p, q) => p - q)
  const total = cumulative(c)[c.segs.length]!
  const inner = cuts.filter((s) => s > 1e-9 && s < total - 1e-9)
  if (!inner.length) {
    geomIssue('no-intersection', 'trim 的 cutter 和曲线没有交点，曲线原样返回', '用 extend 先延长到 cutter，或检查 cutter 的位置')
    return pathOf(c)
  }
  if (mode === 'start') return pathOf(openSub(piece(c, 0, inner[0]!)))
  if (mode === 'end') return pathOf(openSub(piece(c, inner[inner.length - 1]!, total)))
  const ranges: Array<[number, number][]> = []
  if (c.closed) {
    for (let i = 0; i < inner.length; i++) {
      const s0 = inner[i]!
      const s1 = inner[(i + 1) % inner.length]!
      ranges.push(s1 > s0 ? [[s0, s1]] : [[s0, total], [0, s1]])
    }
  } else {
    const marks = [0, ...inner, total]
    for (let i = 1; i < marks.length; i++) ranges.push([[marks[i - 1]!, marks[i]!]])
  }
  let best: Seg[] = []
  let bestD = Infinity
  for (const r of ranges) {
    const segs = stitch(r.flatMap(([s0, s1]) => piece(c, s0, s1)))
    if (!segs.length) continue
    const sub0: Sub = openSub(segs)
    const dd = closestPoint(pathOf(sub0), mode).distance
    if (dd < bestD) {
      bestD = dd
      best = segs
    }
  }
  return pathOf(openSub(best))
}

function extendEnd(c: Sub, boundary: Sub[]): Sub | null {
  const last = c.segs[c.segs.length - 1]!
  const p = last.b
  const bsegs = boundary.flatMap((s) => s.segs)
  if (isCircular(last)) {
    const sigma = Math.sign(last.dt)
    const circle = { k: 'circle' as const, c: last.c, r: last.rx }
    const endAngle = Math.atan2(p.y - last.c.y, p.x - last.c.x)
    let bestA = Infinity
    for (const b of bsegs) {
      const fake = arcSeg(last.c, last.rx, last.rx, 0, endAngle, sigma * (TAU - 1e-6))
      const hits = elemOf(b) ? intersectElems(circle, elemOf(b)!).filter((q) => {
        const u = paramOn(b, q)
        return u >= -U_EPS && u <= 1 + U_EPS
      }) : segHits(fake, b).map((h) => h.p)
      for (const q of hits) {
        let da = (Math.atan2(q.y - last.c.y, q.x - last.c.x) - endAngle) * sigma
        da = ((da % TAU) + TAU) % TAU
        if (da > 1e-9 && da < bestA) bestA = da
      }
    }
    if (!Number.isFinite(bestA)) return null
    const ext = arcSeg(last.c, last.rx, last.ry, last.rot, last.t0, last.dt + sigma * bestA, last.a)
    return { ...c, segs: [...c.segs.slice(0, -1), ext] }
  }
  const t = segTangent(last, 1)
  const ray = { k: 'line' as const, p, d: t }
  let best: Pt | null = null
  let bestT = Infinity
  const far = Math.max(1e6, ...bsegs.map((b) => dist(b.a, p) + dist(b.b, p)))
  const probe = lineSeg(p, add(p, mul(t, far)))
  for (const b of bsegs) {
    const eb = elemOf(b)
    const hits = eb
      ? intersectElems(ray, eb).filter((q) => {
          const u = paramOn(b, q)
          return u >= -U_EPS && u <= 1 + U_EPS
        })
      : segHits(probe, b).map((h) => h.p)
    for (const q of hits) {
      const along = dot(sub(q, p), t)
      if (along > 1e-9 && along < bestT) {
        bestT = along
        best = q
      }
    }
  }
  if (!best) return null
  const segs = last.k === 'L' ? [...c.segs.slice(0, -1), lineSeg(last.a, best)] : [...c.segs, lineSeg(p, best)]
  return { ...c, segs }
}

/** 把曲线的一端或两端延长到 boundary。直线沿直线，圆弧沿原来的圆，贝塞尔沿端点切向。 */
export function extend(curve: Path2D, boundary: Path2D, end: 'start' | 'end' | 'both' = 'both'): Path2D {
  let c = curveOf(curve, 'extend')
  const b = asPath(boundary, 'extend', 'boundary').subs.filter((s) => s.segs.length)
  const which = asEnum(end, 'extend', 'end', ['start', 'end', 'both'] as const, 'both')
  if (!c.segs.length) return pathOf(c)
  if (c.closed) throw new TypeError('extend 需要开放的曲线，闭合曲线没有端点')
  let missed = 0
  if (which !== 'start') {
    const out = extendEnd(c, b)
    if (out) c = out
    else missed++
  }
  if (which !== 'end') {
    const out = extendEnd(reverseSub(c), b)
    if (out) c = reverseSub(out)
    else missed++
  }
  if (missed) geomIssue('no-intersection', `extend 有 ${missed} 个端点延长后碰不到 boundary`, '检查 boundary 是否在曲线延长的方向上')
  return pathOf({ ...c, start: c.segs[0]!.a })
}

/** 首尾相接的曲线连成一条，容差 0.01 px。按给出的顺序连，必要时翻转后一条。连不上时保留成多段子路径。 */
export function join(...curves: Path2D[]): Path2D {
  const subs = curves.map((p, i) => curveOf(p, 'join', `第 ${i + 1} 个参数`)).filter((s) => s.segs.length)
  const out: Sub[] = []
  for (const s of subs) {
    const prev = out[out.length - 1]
    if (prev && !prev.closed) {
      const end = subEnd(prev)
      const next = dist(end, s.start) <= 0.01 ? s : dist(end, subEnd(s)) <= 0.01 ? reverseSub(s) : null
      if (next) {
        const segs = stitch([...prev.segs, ...next.segs])
        const closed = dist(subEnd({ ...prev, segs }), prev.start) <= 0.01
        if (closed) segs[segs.length - 1] = { ...segs[segs.length - 1]!, b: prev.start } as Seg
        out[out.length - 1] = { start: prev.start, segs, closed }
        continue
      }
    }
    out.push(s)
  }
  if (out.length > 1) geomIssue('not-a-curve', `join 之后还剩 ${out.length} 段，端点没有接上`, '相接的端点要在 0.01 px 以内')
  return pathOf(...out)
}

/** 翻转方向。每段子路径各自翻转。 */
export function reverse(path: Path2D): Path2D {
  const p = asPath(path, 'reverse')
  return pathOf(...p.subs.map(reverseSub))
}