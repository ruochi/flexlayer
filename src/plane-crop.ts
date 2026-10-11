import { isGradient } from './gradient.js'
import type { LayoutNode } from './types.js'

/**
 * 大地面只画落进取景窗的那一块。
 * 局部坐标 u、v 是补过留白的位图坐标，原点在位图左上角。
 * 屏幕坐标是 project() 的结果，和取景窗用同一套。
 */
export type PlaneCorner = { u: number; v: number; x: number; y: number; z: number }

export type PlaneWindow = {
  u: number
  v: number
  width: number
  height: number
  /** 屏幕像素 / 局部像素。取边上最大的一档，近处的边不会被远处拉糊。 */
  densityU: number
  densityV: number
  /** 裁进镜头前面和取景窗之后的多边形，顺序绕一圈。u、v 仍是位图坐标。 */
  polygon: Array<{ u: number; v: number; x: number; y: number }>
}

type Space = { x: number; y: number; z: number; u: number; v: number }

function lerp(a: Space, b: Space, t: number): Space {
  return {
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

/** keep >= 0 留在内侧。 */
function clipHalf(poly: Space[], keep: (p: Space) => number): Space[] {
  if (poly.length === 0) return []
  const out: Space[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const va = keep(a)
    const vb = keep(b)
    const ain = va >= -1e-6
    const bin = vb >= -1e-6
    if (ain && bin) out.push(b)
    else if (ain !== bin) {
      const denom = va - vb
      const t = Math.abs(denom) < 1e-12 ? 0 : va / denom
      const hit = lerp(a, b, Math.min(1, Math.max(0, t)))
      out.push(hit)
      if (bin) out.push(b)
    }
  }
  return out
}

function projectOf(
  p: Space,
  perspective: number | 'parallel',
  vx: number,
  vy: number,
): { x: number; y: number } | null {
  if (perspective === 'parallel') return { x: p.x, y: p.y }
  const w = 1 - p.z / perspective
  if (w <= 1e-4) return null
  return { x: vx + (p.x - vx) / w, y: vy + (p.y - vy) / w }
}

/**
 * 先切掉镜头后面，再按视锥切进取景窗。
 * 屏幕上的一条边对应空间里的一个平面，不能按屏幕参数去插局部坐标，否则靠近镜头的地面会裁错。
 */
export function visiblePlaneWindow(
  corners: PlaneCorner[],
  perspective: number | 'parallel',
  vx: number,
  vy: number,
  view: { x: number; y: number; width: number; height: number },
  margin: number,
): PlaneWindow | null {
  if (corners.length < 3) return null
  let poly: Space[] = corners.map((corner) => ({ ...corner }))
  if (typeof perspective === 'number') {
    const nearZ = perspective * (1 - 1e-3)
    poly = clipHalf(poly, (p) => nearZ - p.z)
  }
  const left = view.x - margin
  const right = view.x + view.width + margin
  const top = view.y - margin
  const bottom = view.y + view.height + margin
  if (perspective === 'parallel') {
    poly = clipHalf(poly, (p) => p.x - left)
    poly = clipHalf(poly, (p) => right - p.x)
    poly = clipHalf(poly, (p) => p.y - top)
    poly = clipHalf(poly, (p) => bottom - p.y)
  } else {
    const focal = perspective
    const side = (edge: number, horizontal: boolean, upper: boolean) => (p: Space) => {
      const d = edge - (horizontal ? vx : vy)
      const coord = horizontal ? p.x : p.y
      const origin = horizontal ? vx : vy
      const limit = origin + d
      const plane = coord + (d / focal) * p.z
      return upper ? plane - limit : limit - plane
    }
    poly = clipHalf(poly, side(left, true, true))
    poly = clipHalf(poly, side(right, true, false))
    poly = clipHalf(poly, side(top, false, true))
    poly = clipHalf(poly, side(bottom, false, false))
  }
  const screen: Array<{ u: number; v: number; x: number; y: number }> = []
  for (const point of poly) {
    const projected = projectOf(point, perspective, vx, vy)
    if (!projected) continue
    screen.push({ u: point.u, v: point.v, x: projected.x, y: projected.y })
  }
  if (screen.length < 3) return null
  let u0 = Infinity
  let v0 = Infinity
  let u1 = -Infinity
  let v1 = -Infinity
  let densityU = 0
  let densityV = 0
  for (let i = 0; i < screen.length; i++) {
    const a = screen[i]!
    const b = screen[(i + 1) % screen.length]!
    u0 = Math.min(u0, a.u)
    v0 = Math.min(v0, a.v)
    u1 = Math.max(u1, a.u)
    v1 = Math.max(v1, a.v)
    const su = Math.hypot(b.x - a.x, b.y - a.y)
    const du = Math.abs(b.u - a.u)
    const dv = Math.abs(b.v - a.v)
    if (du > 1e-3) densityU = Math.max(densityU, su / du)
    if (dv > 1e-3) densityV = Math.max(densityV, su / dv)
  }
  if (!(u1 > u0) || !(v1 > v0)) return null
  const boundsU0 = Math.min(...corners.map((corner) => corner.u))
  const boundsV0 = Math.min(...corners.map((corner) => corner.v))
  const boundsU1 = Math.max(...corners.map((corner) => corner.u))
  const boundsV1 = Math.max(...corners.map((corner) => corner.v))
  u0 = Math.max(boundsU0, u0 - 1)
  v0 = Math.max(boundsV0, v0 - 1)
  u1 = Math.min(boundsU1, u1 + 1)
  v1 = Math.min(boundsV1, v1 + 1)
  if (!(densityU > 0) && !(densityV > 0)) return null
  if (!(densityU > 0)) densityU = densityV
  if (!(densityV > 0)) densityV = densityU
  return { u: u0, v: v0, width: u1 - u0, height: v1 - v0, densityU, densityV, polygon: screen }
}

function outwardPad(node: LayoutNode): number {
  const shadow = node.shadow
    ? node.shadow.blur * 2 + node.shadow.spread + Math.max(Math.abs(node.shadow.x), Math.abs(node.shadow.y))
    : 0
  let glass = 0
  if (!node.shadow && node.glass) {
    const depth = node.glass.variant === 'thick' ? 18 : node.glass.variant === 'clear' ? 12 : 14
    glass = depth * 2 + Math.abs(depth * 0.35)
  }
  const glow = node.glow ? node.glow.blur * 2 + node.glow.spread : 0
  const blur = node.blur != null ? node.blur * 2 : 0
  return Math.max(shadow, glass, glow, blur)
}

/** 平面位图要比盒子大一圈，否则发光和阴影会被裁在平面自己的框里。 */
export function planeBitmapPad(node: LayoutNode): number {
  let pad = outwardPad(node)
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) pad = Math.max(pad, planeBitmapPad(child))
  }
  return pad > 0 ? Math.ceil(pad + 2) : 0
}

function effectFree(node: LayoutNode): boolean {
  return (
    node.shadow == null &&
    node.glow == null &&
    node.innerShadow == null &&
    node.innerGlow == null &&
    (node.blur == null || node.blur === 0) &&
    (node.backdropBlur == null || node.backdropBlur === 0) &&
    node.noise == null &&
    node.overlay == null &&
    node.glass == null &&
    node.grade == null &&
    (node.filters == null || node.filters.length === 0) &&
    (node.inkStroke == null || node.inkStroke.length === 0)
  )
}

function plainColor(value: string | undefined): string | null {
  if (!value || value === 'none' || value === 'transparent') return null
  if (isGradient(value)) return null
  return value
}

/** #rgb、#rrggbb 和颜色名。带透明通道的留给位图，避免三角形接缝叠两次。 */
export function opaqueCss(value: string): boolean {
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return true
  if (value.startsWith('#')) return false
  if (/rgba|hsla|transparent/i.test(value)) return false
  return /^[a-z]+$/i.test(value.trim())
}

/**
 * 整张位图都是同一个不透明颜色时返回这个颜色。
 * 这种地面不必先按平面尺寸画位图，四个顶点进光栅就够了。
 */
export function flatFill(node: LayoutNode): string | null {
  if (!effectFree(node) || (node.opacity ?? 1) < 1) return null
  if (node.kind === 'shape') {
    if (node.shape !== 'rect') return null
    if ((node.rx ?? 0) > 0 || (node.ry ?? 0) > 0) return null
    if (node.stroke !== 'none' || (node.dash != null && node.dash.length > 0)) return null
    const fill = plainColor(node.fill)
    return fill && opaqueCss(fill) ? fill : null
  }
  if (node.kind !== 'layer' && node.kind !== 'flex') return null
  if (node.border != null && node.border.width > 0) return null
  if (node.kind === 'layer' && node.mask != null && node.mask.length > 0) return null
  if (node.children.length === 0) {
    const background = plainColor(node.background)
    return background && opaqueCss(background) ? background : null
  }
  if (node.children.length !== 1) return null
  const background = node.background
  if (background != null && background !== 'transparent' && background !== 'none') return null
  const child = node.children[0]!
  if (Math.abs(child.x) > 0.5 || Math.abs(child.y) > 0.5) return null
  if (Math.abs(child.width - node.width) > 0.5 || Math.abs(child.height - node.height) > 0.5) return null
  return flatFill(child)
}
