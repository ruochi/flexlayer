/**
 * flexlayer 的 Path2D。方法和 WHATWG Path2D 相同，额外记下每一笔的精确分段，
 * 所以 `toSVGString()` 写回的是原样的直线和圆弧。原生 Path2D 的状态同步保留，ctx 照常能画。
 */
import { Path2D as NativePath2D, type DOMMatrix2DInit, type PathOp, type StrokeOptions } from '@napi-rs/canvas'
import {
  TAU,
  arcSeg,
  cloneSubs,
  ellipsePoint,
  lineSeg,
  pt,
  samePt,
  subEnd,
  subsFromD,
  subsToD,
  transformSeg,
  type Matrix,
  type Pt,
  type Seg,
  type Sub,
  add,
  sub,
  mul,
  norm,
  dot,
  cross,
  len,
  wrapPi,
} from './geom-seg.js'

const nativeSvg = (p: NativePath2D): string => NativePath2D.prototype.toSVGString.call(p)
const finite = (...ns: number[]): boolean => ns.every(Number.isFinite)

type Radius = number | { x: number; y: number }

export class Path2D extends NativePath2D {
  /** 精确分段。几何函数只读这一份。 */
  subs: Sub[]
  private cur: Pt | null = null
  private reopen = false

  constructor(path?: NativePath2D | string) {
    super(path as NativePath2D)
    if (typeof path === 'string') this.subs = subsFromD(path)
    else if (path instanceof Path2D) this.subs = cloneSubs(path.subs)
    else if (path) this.subs = subsFromD(nativeSvg(path))
    else this.subs = []
    this.syncCursor()
  }

  /** 由分段直接建一条路径，不经过字符串，精度不丢。 */
  static fromSubs(subs: Sub[]): Path2D {
    const p = new Path2D(subsToD(subs))
    p.subs = subs
    p.syncCursor()
    return p
  }

  private syncCursor(): void {
    const last = this.subs[this.subs.length - 1]
    if (!last) {
      this.cur = null
      this.reopen = false
    } else if (last.closed) {
      this.cur = last.start
      this.reopen = true
    } else {
      this.cur = subEnd(last)
      this.reopen = false
    }
  }

  private open(): Sub {
    const last = this.subs[this.subs.length - 1]
    if (!last || this.reopen) {
      const s: Sub = { start: this.cur ?? pt(0, 0), segs: [], closed: false }
      this.subs.push(s)
      this.reopen = false
      return s
    }
    return last
  }

  private push(seg: Seg): void {
    if (!(seg.k === 'L' && samePt(seg.a, seg.b, 1e-12))) this.open().segs.push(seg)
    this.cur = seg.b
  }

  private recMove(p: Pt): void {
    const last = this.subs[this.subs.length - 1]
    if (last && !last.closed && last.segs.length === 0) this.subs.pop()
    this.subs.push({ start: p, segs: [], closed: false })
    this.cur = p
    this.reopen = false
  }

  private recLine(p: Pt): void {
    if (!this.cur) this.recMove(p)
    else this.push(lineSeg(this.cur, p))
  }

  override moveTo(x: number, y: number): void {
    super.moveTo(x, y)
    if (finite(x, y)) this.recMove(pt(x, y))
  }

  override lineTo(x: number, y: number): void {
    super.lineTo(x, y)
    if (finite(x, y)) this.recLine(pt(x, y))
  }

  override quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    super.quadraticCurveTo(cpx, cpy, x, y)
    if (!finite(cpx, cpy, x, y)) return
    if (!this.cur) this.recMove(pt(cpx, cpy))
    this.push({ k: 'Q', a: this.cur!, c1: pt(cpx, cpy), b: pt(x, y) })
  }

  override bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    super.bezierCurveTo(c1x, c1y, c2x, c2y, x, y)
    if (!finite(c1x, c1y, c2x, c2y, x, y)) return
    if (!this.cur) this.recMove(pt(c1x, c1y))
    this.push({ k: 'C', a: this.cur!, c1: pt(c1x, c1y), c2: pt(c2x, c2y), b: pt(x, y) })
  }

  override arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    super.arc(x, y, r, a0, a1, ccw)
    this.recEllipse(x, y, r, r, 0, a0, a1, ccw)
  }

  override ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    super.ellipse(x, y, rx, ry, rot, a0, a1, ccw)
    this.recEllipse(x, y, rx, ry, rot, a0, a1, ccw)
  }

  private recEllipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean): void {
    if (!finite(x, y, rx, ry, rot, a0, a1) || rx < 0 || ry < 0) return
    let dt: number
    if (!ccw && a1 - a0 >= TAU) dt = TAU
    else if (ccw && a0 - a1 >= TAU) dt = -TAU
    else {
      dt = (((a1 - a0) % TAU) + TAU) % TAU
      if (ccw && dt > 0) dt -= TAU
      if (ccw && dt === 0 && a0 !== a1) dt = -TAU
    }
    const c = pt(x, y)
    const s = ellipsePoint(c, rx, ry, rot, a0)
    this.recLine(s)
    if (dt !== 0 && rx > 0 && ry > 0) this.push(arcSeg(c, rx, ry, rot, a0, dt, s))
    else if (dt !== 0) this.recLine(ellipsePoint(c, rx, ry, rot, a0 + dt))
  }

  override arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    super.arcTo(x1, y1, x2, y2, r)
    if (!finite(x1, y1, x2, y2, r)) return
    const p1 = pt(x1, y1)
    const p2 = pt(x2, y2)
    if (!this.cur) {
      this.recMove(p1)
      return
    }
    const p0 = this.cur
    const v0 = sub(p0, p1)
    const v2 = sub(p2, p1)
    const turn = cross(v0, v2)
    if (samePt(p0, p1, 1e-12) || samePt(p1, p2, 1e-12) || r === 0 || Math.abs(turn) < 1e-12 * len(v0) * len(v2)) {
      this.recLine(p1)
      return
    }
    const u0 = norm(v0)
    const u2 = norm(v2)
    const half = Math.acos(Math.max(-1, Math.min(1, dot(u0, u2)))) / 2
    const cut = r / Math.tan(half)
    const t0 = add(p1, mul(u0, cut))
    const t2 = add(p1, mul(u2, cut))
    const c = add(p1, mul(norm(add(u0, u2)), r / Math.sin(half)))
    const a0 = Math.atan2(t0.y - c.y, t0.x - c.x)
    const a2 = Math.atan2(t2.y - c.y, t2.x - c.x)
    this.recLine(t0)
    this.push(arcSeg(c, r, r, 0, a0, wrapPi(a2 - a0), t0, t2))
  }

  override closePath(): void {
    super.closePath()
    const last = this.subs[this.subs.length - 1]
    if (!last || this.reopen) return
    const end = subEnd(last)
    if (!samePt(end, last.start, 1e-12)) last.segs.push(lineSeg(end, last.start))
    last.closed = true
    this.cur = last.start
    this.reopen = true
  }

  override rect(x: number, y: number, w: number, h: number): void {
    super.rect(x, y, w, h)
    if (!finite(x, y, w, h)) return
    const a = pt(x, y)
    const corners = [pt(x + w, y), pt(x + w, y + h), pt(x, y + h), a]
    const segs: Seg[] = []
    let p = a
    for (const q of corners) {
      if (!samePt(p, q, 1e-12)) segs.push(lineSeg(p, q))
      p = q
    }
    this.recMove(a)
    this.subs[this.subs.length - 1] = { start: a, segs, closed: true }
    this.cur = a
    this.reopen = true
  }

  override roundRect(x: number, y: number, w: number, h: number, radii?: number | number[]): void {
    super.roundRect(x, y, w, h, radii)
    if (!finite(x, y, w, h)) return
    const list: Radius[] = radii == null ? [0] : Array.isArray(radii) ? (radii as Radius[]) : [radii]
    const R = list.map((r) => (typeof r === 'number' ? { x: r, y: r } : { x: r.x, y: r.y }))
    let [tl, tr, br, bl] =
      R.length === 1
        ? [R[0]!, R[0]!, R[0]!, R[0]!]
        : R.length === 2
          ? [R[0]!, R[1]!, R[0]!, R[1]!]
          : R.length === 3
            ? [R[0]!, R[1]!, R[2]!, R[1]!]
            : [R[0]!, R[1]!, R[2]!, R[3]!]
    const ox = x
    const oy = y
    if (w < 0) {
      x += w
      w = -w
      ;[tl, tr, br, bl] = [tr, tl, bl, br]
    }
    if (h < 0) {
      y += h
      h = -h
      ;[tl, tr, br, bl] = [bl, br, tr, tl]
    }
    const sums = [
      [w, tl.x + tr.x],
      [h, tr.y + br.y],
      [w, br.x + bl.x],
      [h, tl.y + bl.y],
    ]
    let scale = 1
    for (const [side, sum] of sums) if (sum! > 0) scale = Math.min(scale, side! / sum!)
    const k = (r: { x: number; y: number }) => ({ x: r.x * scale, y: r.y * scale })
    ;[tl, tr, br, bl] = [k(tl), k(tr), k(br), k(bl)]
    const segs: Seg[] = []
    const start = pt(x + tl.x, y)
    let cur = start
    const line = (p: Pt) => {
      if (!samePt(cur, p, 1e-12)) segs.push(lineSeg(cur, p))
      cur = p
    }
    const corner = (c: Pt, r: { x: number; y: number }, t0: number) => {
      if (r.x > 0 && r.y > 0) {
        const s = arcSeg(c, r.x, r.y, 0, t0, Math.PI / 2, cur)
        segs.push(s)
        cur = s.b
      }
    }
    line(pt(x + w - tr.x, y))
    corner(pt(x + w - tr.x, y + tr.y), tr, -Math.PI / 2)
    line(pt(x + w, y + h - br.y))
    corner(pt(x + w - br.x, y + h - br.y), br, 0)
    line(pt(x + bl.x, y + h))
    corner(pt(x + bl.x, y + h - bl.y), bl, Math.PI / 2)
    line(pt(x, y + tl.y))
    corner(pt(x + tl.x, y + tl.y), tl, Math.PI)
    line(start)
    const last = segs[segs.length - 1]
    if (last) segs[segs.length - 1] = { ...last, b: start } as Seg
    this.recMove(start)
    this.subs[this.subs.length - 1] = { start, segs, closed: true }
    this.cur = pt(ox, oy)
    this.reopen = true
  }

  override addPath(path: NativePath2D, transform?: DOMMatrix2DInit): void {
    super.addPath(path, transform)
    let subs = path instanceof Path2D ? cloneSubs(path.subs) : subsFromD(nativeSvg(path))
    if (transform) subs = transformSubs(toMatrix(transform), subs)
    this.subs.push(...subs)
    this.syncCursor()
  }

  private adopt(out: NativePath2D): Path2D {
    if (out !== this) return new Path2D(out)
    this.subs = subsFromD(nativeSvg(this))
    this.syncCursor()
    return this
  }

  override op(path: NativePath2D, operation: PathOp): Path2D {
    return this.adopt(super.op(path, operation))
  }
  override simplify(): Path2D {
    return this.adopt(super.simplify())
  }
  override asWinding(): Path2D {
    return this.adopt(super.asWinding())
  }
  override stroke(options?: StrokeOptions): Path2D {
    return this.adopt(super.stroke(options))
  }
  override trim(start: number, end: number, isComplement?: boolean): Path2D {
    return this.adopt(super.trim(start, end, isComplement))
  }
  override dash(on: number, off: number, phase: number): Path2D {
    return this.adopt(super.dash(on, off, phase))
  }
  override round(radius: number): Path2D {
    return this.adopt(super.round(radius))
  }
  override transform(transform: DOMMatrix2DInit): Path2D {
    const subs = transformSubs(toMatrix(transform), this.subs)
    super.transform(transform)
    this.subs = subs
    this.syncCursor()
    return this
  }

  override toSVGString(): string {
    return subsToD(this.subs)
  }
}

function toMatrix(m: DOMMatrix2DInit): Matrix {
  const any = m as DOMMatrix2DInit & Partial<Record<'m11' | 'm12' | 'm21' | 'm22' | 'm41' | 'm42', number>>
  return {
    a: any.a ?? any.m11 ?? 1,
    b: any.b ?? any.m12 ?? 0,
    c: any.c ?? any.m21 ?? 0,
    d: any.d ?? any.m22 ?? 1,
    e: any.e ?? any.m41 ?? 0,
    f: any.f ?? any.m42 ?? 0,
  }
}

export function transformSubs(m: Matrix, subs: Sub[]): Sub[] {
  return subs.map((s) => {
    const segs = s.segs.flatMap((seg) => transformSeg(m, seg))
    const start = segs[0]?.a ?? { x: m.a * s.start.x + m.c * s.start.y + m.e, y: m.b * s.start.x + m.d * s.start.y + m.f }
    return { start, segs, closed: s.closed }
  })
}
