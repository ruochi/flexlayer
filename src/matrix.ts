import type { Box, CssLength, CssMotion, Origin, OriginAxis } from './types.js'

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

export function isIdentity(m: Matrix): boolean {
  return (
    Math.abs(m.a - 1) < 1e-9 &&
    Math.abs(m.b) < 1e-9 &&
    Math.abs(m.c) < 1e-9 &&
    Math.abs(m.d - 1) < 1e-9 &&
    Math.abs(m.e) < 1e-9 &&
    Math.abs(m.f) < 1e-9
  )
}

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

/** 两轴缩放绝对值的几何平均。旋转不改变它。用来把局部像素换算成屏幕像素。 */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1
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

function cssLengthPx(len: CssLength, size: number): number {
  return len.unit === 'percent' ? (len.value / 100) * size : len.value
}

/**
 * 局部矩阵，原点是盒子左上角。
 * `T(origin) * translate * rotate * scale * transform * T(-origin)`，和 CSS 一样，右边的先作用在点上。
 */
export function cssMotionMatrix(motion: CssMotion, origin: Origin | undefined, w: number, h: number): Matrix {
  const o = originOffset(origin, w, h)
  let list = IDENTITY
  for (const step of motion.steps) {
    if (step.op === 'translate') list = multiply(list, translated(cssLengthPx(step.x, w), cssLengthPx(step.y, h)))
    else if (step.op === 'rotate') list = multiply(list, rotated(step.degrees))
    else list = multiply(list, scaled(step.x, step.y))
  }
  let m = translated(-o.x, -o.y)
  m = multiply(list, m)
  m = multiply(scaled(motion.scaleX, motion.scaleY), m)
  m = multiply(rotated(motion.rotate), m)
  m = multiply(translated(cssLengthPx(motion.translateX, w), cssLengthPx(motion.translateY, h)), m)
  m = multiply(translated(o.x, o.y), m)
  return m
}

type PoseNode = {
  x: number
  y: number
  width: number
  height: number
  rotate: number
  scaleX: number
  scaleY: number
  origin?: Origin
  motion?: CssMotion
}

/** 盒子局部变换。没有平移和一般 `transform` 时，就是绕 origin 的旋转和缩放。 */
export function localNodeMatrix(node: PoseNode): Matrix {
  if (node.motion) return cssMotionMatrix(node.motion, node.origin, node.width, node.height)
  if (node.rotate === 0 && node.scaleX === 1 && node.scaleY === 1) return IDENTITY
  const o = originOffset(node.origin, node.width, node.height)
  return aroundPivot(o.x, o.y, node.rotate, node.scaleX, node.scaleY)
}

/** 画布坐标里的变换。绘制仍用 node.x / node.y，所以先挪到左上角，变完再挪回去。 */
export function absoluteNodeMatrix(node: PoseNode): Matrix {
  if (node.motion) {
    const local = cssMotionMatrix(node.motion, node.origin, node.width, node.height)
    return multiply(translated(node.x, node.y), multiply(local, translated(-node.x, -node.y)))
  }
  if (node.rotate === 0 && node.scaleX === 1 && node.scaleY === 1) return IDENTITY
  const o = originOffset(node.origin, node.width, node.height)
  return aroundPivot(node.x + o.x, node.y + o.y, node.rotate, node.scaleX, node.scaleY)
}
