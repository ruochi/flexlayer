import type { Box, Origin, OriginAxis } from './types.js'

/** 画布仿射矩阵：x' = a*x + c*y + e，y' = b*x + d*y + f。 */
export type Matrix = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** 逆矩阵。缩放为 0 时返回 null。 */
export function invert(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c
  if (Math.abs(det) < 1e-12) return null
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  }
}

/** 先应用 n，再应用 m。 */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

export function translated(x: number, y: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y }
}

export function rotated(deg: number): Matrix {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
}

export function scaled(sx: number, sy = sx): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

/** 绕 (px, py) 旋转再缩放，与绘制时的变换顺序一致。只传一个缩放时两轴相同。 */
export function aroundPivot(px: number, py: number, deg: number, sx: number, sy = sx): Matrix {
  return multiply(multiply(translated(px, py), multiply(rotated(deg), scaled(sx, sy))), translated(-px, -py))
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
}

/** 四个角变换后的轴对齐外接矩形。 */
export function applyToBox(m: Matrix, box: Box): Box {
  const corners: Array<[number, number]> = [
    apply(m, box.x, box.y),
    apply(m, box.x + box.width, box.y),
    apply(m, box.x, box.y + box.height),
    apply(m, box.x + box.width, box.y + box.height),
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

export function intersectBox(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

function axisOffset(axis: OriginAxis, size: number): number {
  if (axis.unit === 'px') return axis.value
  return (axis.value / 100) * size
}

/** origin 在盒子内的偏移，缺省为中心。百分比按当前宽高算，所以盒子后来变了也仍然贴着那个比例。 */
export function originOffset(origin: Origin | undefined, w: number, h: number): { x: number; y: number } {
  if (!origin) return { x: w / 2, y: h / 2 }
  return { x: axisOffset(origin.x, w), y: axisOffset(origin.y, h) }
}
