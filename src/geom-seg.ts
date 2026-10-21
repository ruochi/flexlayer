/**
 * 二维几何的精确分段：直线、椭圆弧、二次和三次贝塞尔。
 * 坐标是 layer 局部像素，y 向下。角度是弧度，增大方向在屏幕上顺时针，和 Canvas 一致。
 * 段的参数 u 在 [0, 1]。直线和圆弧允许 u 越界，表示沿原元素延长。
 */
import { parseSvgPath } from './path.js'

export type Pt = { x: number; y: number }
export type Seg =
  | { k: 'L'; a: Pt; b: Pt }
  | { k: 'A'; a: Pt; b: Pt; c: Pt; rx: number; ry: number; rot: number; t0: number; dt: number }
  | { k: 'Q'; a: Pt; c1: Pt; b: Pt }
  | { k: 'C'; a: Pt; c1: Pt; c2: Pt; b: Pt }
export type ArcSeg = Extract<Seg, { k: 'A' }>
/** 一段子路径。闭合时最后一段一定回到 start，闭合边是显式的直线段。 */
export type Sub = { start: Pt; segs: Seg[]; closed: boolean }
export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }

export const TAU = Math.PI * 2
export const EPS = 1e-9

export const pt = (x: number, y: number): Pt => ({ x, y })
export const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, y: p.y + q.y })
export const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y })
export const mul = (p: Pt, k: number): Pt => ({ x: p.x * k, y: p.y * k })
export const dot = (p: Pt, q: Pt): number => p.x * q.x + p.y * q.y
export const cross = (p: Pt, q: Pt): number => p.x * q.y - p.y * q.x
export const len = (p: Pt): number => Math.hypot(p.x, p.y)
export const dist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y - q.y)
export const lerp = (p: Pt, q: Pt, t: number): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
/** 左法向 (−y, x)。y 向下时在屏幕上指向行进方向的右手边。 */
export const perp = (p: Pt): Pt => ({ x: -p.y, y: p.x })
export function norm(p: Pt): Pt {
  const l = len(p)
  return l > 0 ? { x: p.x / l, y: p.y / l } : { x: 0, y: 0 }
}
export const samePt = (p: Pt, q: Pt, tol = 1e-7): boolean => dist(p, q) <= tol
export function wrapPi(a: number): number {
  const w = (((a + Math.PI) % TAU) + TAU) % TAU
  return w - Math.PI
}

export function ellipsePoint(c: Pt, rx: number, ry: number, rot: number, t: number): Pt {
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const ex = rx * Math.cos(t)
  const ey = ry * Math.sin(t)
  return { x: c.x + ex * cos - ey * sin, y: c.y + ex * sin + ey * cos }
}

/** 椭圆对参数角 t 的导数，不乘 dt。 */
function ellipseDeriv(rx: number, ry: number, rot: number, t: number): Pt {
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const ex = -rx * Math.sin(t)
  const ey = ry * Math.cos(t)
  return { x: ex * cos - ey * sin, y: ex * sin + ey * cos }
}

export function arcSeg(c: Pt, rx: number, ry: number, rot: number, t0: number, dt: number, a?: Pt, b?: Pt): ArcSeg {
  return {
    k: 'A',
    a: a ?? ellipsePoint(c, rx, ry, rot, t0),
    b: b ?? ellipsePoint(c, rx, ry, rot, t0 + dt),
    c,
    rx,
    ry,
    rot,
    t0,
    dt,
  }
}

export const lineSeg = (a: Pt, b: Pt): Seg => ({ k: 'L', a, b })

export function isCircular(s: Seg): s is ArcSeg {
  return s.k === 'A' && Math.abs(s.rx - s.ry) <= 1e-9 * Math.max(1, s.rx)
}

export function segPoint(s: Seg, u: number): Pt {
  switch (s.k) {
    case 'L':
      return lerp(s.a, s.b, u)
    case 'A':
      if (u === 0) return s.a
      if (u === 1) return s.b
      return ellipsePoint(s.c, s.rx, s.ry, s.rot, s.t0 + u * s.dt)
    case 'Q': {
      const v = 1 - u
      return {
        x: v * v * s.a.x + 2 * v * u * s.c1.x + u * u * s.b.x,
        y: v * v * s.a.y + 2 * v * u * s.c1.y + u * u * s.b.y,
      }
    }
    case 'C': {
      const v = 1 - u
      const b0 = v * v * v
      const b1 = 3 * v * v * u
      const b2 = 3 * v * u * u
      const b3 = u * u * u
      return {
        x: b0 * s.a.x + b1 * s.c1.x + b2 * s.c2.x + b3 * s.b.x,
        y: b0 * s.a.y + b1 * s.c1.y + b2 * s.c2.y + b3 * s.b.y,
      }
    }
  }
}

export function segDeriv(s: Seg, u: number): Pt {
  switch (s.k) {
    case 'L':
      return sub(s.b, s.a)
    case 'A':
      return mul(ellipseDeriv(s.rx, s.ry, s.rot, s.t0 + u * s.dt), s.dt)
    case 'Q':
      return add(mul(sub(s.c1, s.a), 2 * (1 - u)), mul(sub(s.b, s.c1), 2 * u))
    case 'C': {
      const v = 1 - u
      return add(
        add(mul(sub(s.c1, s.a), 3 * v * v), mul(sub(s.c2, s.c1), 6 * v * u)),
        mul(sub(s.b, s.c2), 3 * u * u),
      )
    }
  }
}

/** 单位切向，沿行进方向。控制点和端点重合时退到下一个控制点。 */
export function segTangent(s: Seg, u: number): Pt {
  const d = segDeriv(s, u)
  if (len(d) > 1e-12) return norm(d)
  if (s.k === 'C') {
    if (u <= 0) return norm(sub(samePt(s.c2, s.a, 1e-12) ? s.b : s.c2, s.a))
    if (u >= 1) return norm(sub(s.b, samePt(s.c1, s.b, 1e-12) ? s.a : s.c1))
  }
  if (s.k === 'Q') return norm(sub(s.b, s.a))
  const h = 1e-4
  return norm(sub(segPoint(s, Math.min(1, u + h)), segPoint(s, Math.max(0, u - h))))
}

const GL_X = [
  -0.9894009349916499, -0.9445750230732326, -0.8656312023878318, -0.755404408355003, -0.6178762444026438,
  -0.45801677765722737, -0.2816035507792589, -0.09501250983763744, 0.09501250983763744, 0.2816035507792589,
  0.45801677765722737, 0.6178762444026438, 0.755404408355003, 0.8656312023878318, 0.9445750230732326,
  0.9894009349916499,
]
const GL_W = [
  0.027152459411754096, 0.062253523938647894, 0.09515851168249279, 0.12462897125553388, 0.14959598881657674,
  0.16915651939500254, 0.18260341504492358, 0.1894506104550685, 0.1894506104550685, 0.18260341504492358,
  0.16915651939500254, 0.14959598881657674, 0.12462897125553388, 0.09515851168249279, 0.062253523938647894,
  0.027152459411754096,
]

function integrateSpeed(s: Seg, u0: number, u1: number): number {
  const pieces = 8
  let total = 0
  const step = (u1 - u0) / pieces
  for (let p = 0; p < pieces; p++) {
    const lo = u0 + p * step
    const half = step / 2
    const mid = lo + half
    for (let i = 0; i < GL_X.length; i++) total += GL_W[i]! * len(segDeriv(s, mid + half * GL_X[i]!))
  }
  return total * (step / 2)
}

export function segLength(s: Seg): number {
  if (s.k === 'L') return dist(s.a, s.b)
  if (isCircular(s)) return s.rx * Math.abs(s.dt)
  return integrateSpeed(s, 0, 1)
}

/** 从段起点到参数 u 的弧长。 */
export function segLengthTo(s: Seg, u: number): number {
  if (u <= 0) return s.k === 'L' || isCircular(s) ? u * segLength(s) : 0
  if (s.k === 'L' || isCircular(s)) return u * segLength(s)
  if (u >= 1) return segLength(s)
  return integrateSpeed(s, 0, u)
}

/** 弧长 l 处的参数。 */
export function segParamAt(s: Seg, l: number): number {
  const total = segLength(s)
  if (total <= 0) return 0
  if (s.k === 'L' || isCircular(s)) return l / total
  if (l <= 0) return 0
  if (l >= total) return 1
  let lo = 0
  let hi = 1
  let u = l / total
  for (let i = 0; i < 40; i++) {
    const f = segLengthTo(s, u) - l
    if (Math.abs(f) < 1e-9) break
    if (f > 0) hi = u
    else lo = u
    const speed = len(segDeriv(s, u))
    const next = speed > 1e-12 ? u - f / speed : (lo + hi) / 2
    u = next > lo && next < hi ? next : (lo + hi) / 2
  }
  return u
}

function splitCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): [Pt[], Pt[]] {
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const c = lerp(p2, p3, t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  const f = lerp(d, e, t)
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ]
}

/** 参数 u0 到 u1 的一截。直线和圆弧可以越过端点。 */
export function segSplit(s: Seg, u0: number, u1: number): Seg {
  if (u0 === 0 && u1 === 1) return s
  const a = u0 === 0 ? s.a : u0 === 1 ? s.b : segPoint(s, u0)
  const b = u1 === 1 ? s.b : u1 === 0 ? s.a : segPoint(s, u1)
  switch (s.k) {
    case 'L':
      return { k: 'L', a, b }
    case 'A':
      return arcSeg(s.c, s.rx, s.ry, s.rot, s.t0 + u0 * s.dt, (u1 - u0) * s.dt, a, b)
    case 'Q': {
      const c = segSplit(quadToCubic(s), u0, u1) as Extract<Seg, { k: 'C' }>
      // 二次曲线的子段仍是二次：控制点取三次形式的反推
      const c1 = lerp(c.a, c.c1, 1.5)
      return { k: 'Q', a, c1, b }
    }
    case 'C': {
      const [, right] = splitCubic(s.a, s.c1, s.c2, s.b, u0)
      const t = u0 >= 1 ? 0 : (u1 - u0) / (1 - u0)
      const [left] = splitCubic(right[0]!, right[1]!, right[2]!, right[3]!, t)
      return { k: 'C', a, c1: left[1]!, c2: left[2]!, b }
    }
  }
}

export function segReverse(s: Seg): Seg {
  switch (s.k) {
    case 'L':
      return { k: 'L', a: s.b, b: s.a }
    case 'A':
      return arcSeg(s.c, s.rx, s.ry, s.rot, s.t0 + s.dt, -s.dt, s.b, s.a)
    case 'Q':
      return { k: 'Q', a: s.b, c1: s.c1, b: s.a }
    case 'C':
      return { k: 'C', a: s.b, c1: s.c2, c2: s.c1, b: s.a }
  }
}

export function quadToCubic(s: Extract<Seg, { k: 'Q' }>): Extract<Seg, { k: 'C' }> {
  return { k: 'C', a: s.a, c1: lerp(s.a, s.c1, 2 / 3), c2: lerp(s.b, s.c1, 2 / 3), b: s.b }
}

/** 椭圆弧换成三次贝塞尔，每段不超过 90°。 */
export function arcToCubics(s: ArcSeg): Seg[] {
  const n = Math.max(1, Math.ceil(Math.abs(s.dt) / (Math.PI / 2) - 1e-9))
  const step = s.dt / n
  const k = (4 / 3) * Math.tan(step / 4)
  const out: Seg[] = []
  for (let i = 0; i < n; i++) {
    const t = s.t0 + i * step
    const p0 = i === 0 ? s.a : out[i - 1]!.b
    const p3 = i === n - 1 ? s.b : ellipsePoint(s.c, s.rx, s.ry, s.rot, t + step)
    const d0 = ellipseDeriv(s.rx, s.ry, s.rot, t)
    const d3 = ellipseDeriv(s.rx, s.ry, s.rot, t + step)
    out.push({ k: 'C', a: p0, c1: add(p0, mul(d0, k)), c2: sub(p3, mul(d3, k)), b: p3 })
  }
  return out
}

export type Box = { x0: number; y0: number; x1: number; y1: number }

function grow(box: Box, p: Pt): void {
  if (p.x < box.x0) box.x0 = p.x
  if (p.y < box.y0) box.y0 = p.y
  if (p.x > box.x1) box.x1 = p.x
  if (p.y > box.y1) box.y1 = p.y
}

function quadRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b]
  const disc = b * b - 4 * a * c
  if (disc < 0) return []
  const r = Math.sqrt(disc)
  return [(-b + r) / (2 * a), (-b - r) / (2 * a)]
}

export function segBounds(s: Seg, box: Box): void {
  grow(box, s.a)
  grow(box, s.b)
  const inside = (u: number): boolean => u > 0 && u < 1
  if (s.k === 'A') {
    const tx = Math.atan2(-s.ry * Math.sin(s.rot), s.rx * Math.cos(s.rot))
    const ty = Math.atan2(s.ry * Math.cos(s.rot), s.rx * Math.sin(s.rot))
    for (const base of [tx, ty]) {
      for (let k = -6; k <= 6; k++) {
        const u = (base + k * Math.PI - s.t0) / s.dt
        if (inside(u)) grow(box, segPoint(s, u))
      }
    }
  } else if (s.k === 'Q') {
    for (const axis of ['x', 'y'] as const) {
      const den = s.a[axis] - 2 * s.c1[axis] + s.b[axis]
      if (Math.abs(den) > 1e-12) {
        const u = (s.a[axis] - s.c1[axis]) / den
        if (inside(u)) grow(box, segPoint(s, u))
      }
    }
  } else if (s.k === 'C') {
    for (const axis of ['x', 'y'] as const) {
      const p0 = s.a[axis]
      const p1 = s.c1[axis]
      const p2 = s.c2[axis]
      const p3 = s.b[axis]
      const a = -p0 + 3 * p1 - 3 * p2 + p3
      const b = 2 * (p0 - 2 * p1 + p2)
      const c = p1 - p0
      for (const u of quadRoots(a, b, c)) if (inside(u)) grow(box, segPoint(s, u))
    }
  }
}

export type FlatPt = { p: Pt; u: number }

/** 按弦高误差 tol 拆成折线，含两端。 */
export function segFlatten(s: Seg, tol: number): FlatPt[] {
  let n = 1
  if (s.k === 'A') {
    const r = Math.max(s.rx, s.ry)
    const step = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 2
    n = Math.ceil(Math.abs(s.dt) / step)
  } else if (s.k === 'Q') {
    n = Math.ceil(Math.sqrt(len(add(sub(s.a, mul(s.c1, 2)), s.b)) / (4 * tol)))
  } else if (s.k === 'C') {
    const m = Math.max(len(add(sub(s.a, mul(s.c1, 2)), s.c2)), len(add(sub(s.c1, mul(s.c2, 2)), s.b)))
    n = Math.ceil(Math.sqrt((0.75 * m) / tol))
  }
  n = Math.min(10000, Math.max(1, n))
  const out: FlatPt[] = [{ p: s.a, u: 0 }]
  for (let i = 1; i < n; i++) out.push({ p: segPoint(s, i / n), u: i / n })
  out.push({ p: s.b, u: 1 })
  return out
}

export function applyMatrix(m: Matrix, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

/** 变换一段。带旋转和等比缩放时圆弧仍是圆弧，其他变换下椭圆弧换成三次贝塞尔。 */
export function transformSeg(m: Matrix, s: Seg): Seg[] {
  const f = (p: Pt): Pt => applyMatrix(m, p)
  switch (s.k) {
    case 'L':
      return [{ k: 'L', a: f(s.a), b: f(s.b) }]
    case 'Q':
      return [{ k: 'Q', a: f(s.a), c1: f(s.c1), b: f(s.b) }]
    case 'C':
      return [{ k: 'C', a: f(s.a), c1: f(s.c1), c2: f(s.c2), b: f(s.b) }]
    case 'A': {
      const det = m.a * m.d - m.b * m.c
      const similar = det > 0 && Math.abs(m.a - m.d) < 1e-12 && Math.abs(m.b + m.c) < 1e-12
      if (!similar) return arcToCubics(s).flatMap((c) => transformSeg(m, c))
      const k = Math.sqrt(det)
      return [arcSeg(f(s.c), s.rx * k, s.ry * k, s.rot + Math.atan2(m.b, m.a), s.t0, s.dt, f(s.a), f(s.b))]
    }
  }
}

/** SVG 端点式圆弧转中心式。半径过小时按规范放大。 */
function svgArc(a: Pt, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, b: Pt): Seg | null {
  if (samePt(a, b, 1e-12)) return null
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (rx < 1e-12 || ry < 1e-12) return lineSeg(a, b)
  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (a.x - b.x) / 2
  const dy = (a.y - b.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    const k = Math.sqrt(lambda)
    rx *= k
    ry *= k
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let coef = den > 0 ? Math.sqrt(Math.max(0, num / den)) : 0
  if (large === sweep) coef = -coef
  const cx1 = (coef * rx * y1) / ry
  const cy1 = (-coef * ry * x1) / rx
  const c = {
    x: cos * cx1 - sin * cy1 + (a.x + b.x) / 2,
    y: sin * cx1 + cos * cy1 + (a.y + b.y) / 2,
  }
  const angle = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const ux = (x1 - cx1) / rx
  const uy = (y1 - cy1) / ry
  const vx = (-x1 - cx1) / rx
  const vy = (-y1 - cy1) / ry
  const t0 = angle(1, 0, ux, uy)
  let dt = angle(ux, uy, vx, vy)
  if (!sweep && dt > 0) dt -= TAU
  else if (sweep && dt < 0) dt += TAU
  return arcSeg(c, rx, ry, phi, t0, dt, a, b)
}

/** 读 SVG 的 `d`。闭合的子路径补上显式的闭合边。 */
export function subsFromD(d: string): Sub[] {
  const subs: Sub[] = []
  let cur: Pt = pt(0, 0)
  let start: Pt = cur
  let open: Sub | null = null
  let lastC: Pt | null = null
  let lastQ: Pt | null = null
  const ensure = (): Sub => {
    if (!open) {
      open = { start: cur, segs: [], closed: false }
      subs.push(open)
      start = cur
    }
    return open
  }
  const push = (s: Seg | null): void => {
    const target = ensure()
    if (s && !(s.k === 'L' && samePt(s.a, s.b, 1e-12))) target.segs.push(s)
    if (s) cur = s.b
  }
  for (const { op, args } of parseSvgPath(d)) {
    const rel = op !== op.toUpperCase()
    const P = (i: number): Pt => (rel ? pt(cur.x + args[i]!, cur.y + args[i + 1]!) : pt(args[i]!, args[i + 1]!))
    const upper = op.toUpperCase()
    let nextC: Pt | null = null
    let nextQ: Pt | null = null
    switch (upper) {
      case 'M': {
        const p = P(0)
        const prev = open as Sub | null
        if (prev && prev.segs.length === 0 && !prev.closed) subs.pop()
        open = { start: p, segs: [], closed: false }
        subs.push(open)
        cur = start = p
        break
      }
      case 'L':
        push(lineSeg(cur, P(0)))
        break
      case 'H':
        push(lineSeg(cur, pt(rel ? cur.x + args[0]! : args[0]!, cur.y)))
        break
      case 'V':
        push(lineSeg(cur, pt(cur.x, rel ? cur.y + args[0]! : args[0]!)))
        break
      case 'C': {
        const c1 = P(0)
        const c2 = P(2)
        push({ k: 'C', a: cur, c1, c2, b: P(4) })
        nextC = c2
        break
      }
      case 'S': {
        const c1 = lastC ? sub(mul(cur, 2), lastC) : cur
        const c2 = P(0)
        push({ k: 'C', a: cur, c1, c2, b: P(2) })
        nextC = c2
        break
      }
      case 'Q': {
        const c1 = P(0)
        push({ k: 'Q', a: cur, c1, b: P(2) })
        nextQ = c1
        break
      }
      case 'T': {
        const c1: Pt = lastQ ? sub(mul(cur, 2), lastQ) : cur
        push({ k: 'Q', a: cur, c1, b: P(0) })
        nextQ = c1
        break
      }
      case 'A': {
        const b = rel ? pt(cur.x + args[5]!, cur.y + args[6]!) : pt(args[5]!, args[6]!)
        push(svgArc(cur, args[0]!, args[1]!, args[2]!, args[3] !== 0, args[4] !== 0, b))
        cur = b
        break
      }
      case 'Z': {
        const target = open as Sub | null
        if (target) {
          if (!samePt(cur, start, 1e-12)) target.segs.push(lineSeg(cur, start))
          target.closed = true
        }
        open = null
        cur = start
        break
      }
    }
    lastC = nextC
    lastQ = nextQ
  }
  return subs
}

export function fmt(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}
const P = (p: Pt): string => `${fmt(p.x)} ${fmt(p.y)}`

function arcD(s: ArcSeg): string {
  const rot = fmt((s.rot * 180) / Math.PI)
  const pieces: ArcSeg[] = Math.abs(s.dt) > Math.PI * 1.999 ? [segSplit(s, 0, 0.5) as ArcSeg, segSplit(s, 0.5, 1) as ArcSeg] : [s]
  return pieces
    .map((p) => `A${fmt(p.rx)} ${fmt(p.ry)} ${rot} ${Math.abs(p.dt) > Math.PI ? 1 : 0} ${p.dt > 0 ? 1 : 0} ${P(p.b)}`)
    .join(' ')
}

/** 写成绝对坐标的 M L A Q C Z，三位小数。闭合边是直线时由 Z 代替。 */
export function subsToD(subs: Sub[]): string {
  const parts: string[] = []
  for (const s of subs) {
    parts.push(`M${P(s.start)}`)
    let segs = s.segs
    const last = segs[segs.length - 1]
    if (s.closed && last?.k === 'L' && samePt(last.b, s.start, 1e-9)) segs = segs.slice(0, -1)
    for (const seg of segs) {
      if (seg.k === 'L') parts.push(`L${P(seg.b)}`)
      else if (seg.k === 'A') parts.push(arcD(seg))
      else if (seg.k === 'Q') parts.push(`Q${P(seg.c1)} ${P(seg.b)}`)
      else parts.push(`C${P(seg.c1)} ${P(seg.c2)} ${P(seg.b)}`)
    }
    if (s.closed) parts.push('Z')
  }
  return parts.join(' ')
}

export function cloneSubs(subs: Sub[]): Sub[] {
  return subs.map((s) => ({ start: s.start, segs: s.segs.slice(), closed: s.closed }))
}

export function subEnd(s: Sub): Pt {
  return s.segs.length ? s.segs[s.segs.length - 1]!.b : s.start
}

export function reverseSub(s: Sub): Sub {
  const segs = s.segs.map(segReverse).reverse()
  return { start: segs.length ? segs[0]!.a : s.start, segs, closed: s.closed }
}

/** 几何元素：直线是无限长的线，圆弧是整圆。圆角、交点和延长都在元素上算。 */
export type Elem = { k: 'line'; p: Pt; d: Pt } | { k: 'circle'; c: Pt; r: number }

export function elemOf(s: Seg): Elem | null {
  if (s.k === 'L') return { k: 'line', p: s.a, d: norm(sub(s.b, s.a)) }
  if (isCircular(s)) return { k: 'circle', c: s.c, r: s.rx }
  return null
}

export function offsetElem(e: Elem, d: number): Elem | null {
  if (e.k === 'line') return { k: 'line', p: add(e.p, mul(perp(e.d), d)), d: e.d }
  return e.r + d > 1e-9 ? { k: 'circle', c: e.c, r: e.r + d } : null
}

export function intersectElems(e1: Elem, e2: Elem): Pt[] {
  if (e1.k === 'line' && e2.k === 'line') {
    const den = cross(e1.d, e2.d)
    if (Math.abs(den) < 1e-12) return []
    const t = cross(sub(e2.p, e1.p), e2.d) / den
    return [add(e1.p, mul(e1.d, t))]
  }
  if (e1.k === 'circle' && e2.k === 'line') return intersectElems(e2, e1)
  if (e1.k === 'line' && e2.k === 'circle') {
    const f = sub(e1.p, e2.c)
    const b = dot(f, e1.d)
    const disc = b * b - (dot(f, f) - e2.r * e2.r)
    const tol = 1e-9 * Math.max(1, e2.r * e2.r)
    if (disc < -tol) return []
    if (disc <= tol) return [add(e1.p, mul(e1.d, -b))]
    const r = Math.sqrt(disc)
    return [add(e1.p, mul(e1.d, -b - r)), add(e1.p, mul(e1.d, -b + r))]
  }
  const c1 = (e1 as { c: Pt; r: number }).c
  const r1 = (e1 as { c: Pt; r: number }).r
  const c2 = (e2 as { c: Pt; r: number }).c
  const r2 = (e2 as { c: Pt; r: number }).r
  const d = dist(c1, c2)
  const tol = 1e-9 * Math.max(1, r1 + r2)
  if (d < 1e-12 || d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const u = mul(sub(c2, c1), 1 / d)
  const m = add(c1, mul(u, a))
  if (h <= tol) return [m]
  return [add(m, mul(perp(u), h)), sub(m, mul(perp(u), h))]
}

export function footOn(e: Elem, p: Pt): Pt {
  if (e.k === 'line') return add(e.p, mul(e.d, dot(sub(p, e.p), e.d)))
  return add(e.c, mul(norm(sub(p, e.c)), e.r))
}

/** 元素上一点在段上的参数，可以越界。圆弧取离段中点最近的那一圈。 */
export function paramOn(s: Seg, p: Pt): number {
  if (s.k === 'L') {
    const v = sub(s.b, s.a)
    const l2 = dot(v, v)
    return l2 > 0 ? dot(sub(p, s.a), v) / l2 : 0
  }
  if (s.k === 'A') {
    const t = Math.atan2(p.y - s.c.y, p.x - s.c.x) - s.rot
    const mid = s.t0 + s.dt / 2
    return 0.5 + wrapPi(t - mid) / s.dt
  }
  return 0
}
