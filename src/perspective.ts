import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { applyToBox, invert, originOffset } from './matrix.js'
import type { Issue, LayerLayoutNode, LayoutNode } from './types.js'

export type Vec3 = { x: number; y: number; z: number }
export type Vec2 = { x: number; y: number }

type Pose = {
  x: number
  y: number
  originX: number
  originY: number
  scaleX: number
  scaleY: number
  /** 两轴相同时用这个数（含负号）。分轴时取两轴绝对值乘积的平方根。 */
  scaleZ: number
  rotate: number
  rotateX: number
  rotateY: number
  z: number
}

function poseOf(node: LayoutNode): Pose {
  const o = originOffset(node.origin, node.width, node.height)
  const scaleX = node.scaleX || 1
  const scaleY = node.scaleY || 1
  return {
    x: node.x,
    y: node.y,
    originX: o.x,
    originY: o.y,
    scaleX,
    scaleY,
    scaleZ: scaleX === scaleY ? scaleX : Math.sqrt(Math.abs(scaleX * scaleY)),
    rotate: node.rotate || 0,
    rotateX: node.rotateX ?? 0,
    rotateY: node.rotateY ?? 0,
    z: node.z ?? 0,
  }
}

export function has3dPose(node: LayoutNode): boolean {
  return (node.rotateX ?? 0) !== 0 || (node.rotateY ?? 0) !== 0 || (node.z ?? 0) !== 0
}

/**
 * 相对支点的偏移，先缩放，再平移 z，再 rotateX、rotateY、rotate，回到父级坐标。
 * du 向右，dv 向下，dz 朝观众。z 属性加在缩放之后、旋转之前。
 */
export function poseOffset(node: LayoutNode, du: number, dv: number, dz: number): Vec3 {
  const pose = poseOf(node)
  let x = du * pose.scaleX
  let y = dv * pose.scaleY
  let z = pose.z + dz * pose.scaleZ
  const rx = (pose.rotateX * Math.PI) / 180
  const ry = (pose.rotateY * Math.PI) / 180
  const rz = (pose.rotate * Math.PI) / 180
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const yx = y * cx - z * sx
  const zx = y * sx + z * cx
  const xy = x * cy + zx * sy
  const zy = -x * sy + zx * cy
  const xz = xy * cz - yx * sz
  const yz = xy * sz + yx * cz
  return { x: pose.x + pose.originX + xz, y: pose.y + pose.originY + yz, z: zy }
}

/** 盒子局部 (u, v) 回到父级坐标。z 朝观众。 */
export function posePoint(node: LayoutNode, u: number, v: number): Vec3 {
  const pose = poseOf(node)
  return poseOffset(node, u - pose.originX, v - pose.originY, 0)
}

/** 列主序。把盒子局部 (u, v, z)（左上角为原点，y 向下）变到父级坐标。 */
export function poseMatrix(node: LayoutNode): number[] {
  const pose = poseOf(node)
  const at = (u: number, v: number, z: number) => poseOffset(node, u - pose.originX, v - pose.originY, z)
  const p0 = at(0, 0, 0)
  const px = at(1, 0, 0)
  const py = at(0, 1, 0)
  const pz = at(0, 0, 1)
  return [
    px.x - p0.x, px.y - p0.y, px.z - p0.z, 0,
    py.x - p0.x, py.y - p0.y, py.z - p0.z, 0,
    pz.x - p0.x, pz.y - p0.y, pz.z - p0.z, 0,
    p0.x, p0.y, p0.z, 1,
  ]
}

export function applyPoseMatrix(m: number[], u: number, v: number, z: number): Vec3 {
  return {
    x: m[0]! * u + m[4]! * v + m[8]! * z + m[12]!,
    y: m[1]! * u + m[5]! * v + m[9]! * z + m[13]!,
    z: m[2]! * u + m[6]! * v + m[10]! * z + m[14]!,
  }
}

/** 像素视距，或 `parallel`：视线平行于 z，没有近大远小。 */
export type Perspective = number | 'parallel'

export function hasPerspective(value: Perspective | undefined): value is Perspective {
  return value === 'parallel' || (typeof value === 'number' && value > 0)
}

/**
 * 平行投影没有镜头平面。数值视距里，采样点的 w = 1 - z/perspective，
 * w 小于等于 0 就是观众身后，和 project 返回 null 是同一条线。
 */
export function behindCamera(z: number, perspective: Perspective): boolean {
  if (perspective === 'parallel') return false
  return 1 - z / perspective <= 1e-4
}

/** 视距像素。灭点 (vx, vy)。z 越大越近。观众身后返回 null。平行投影不缩放。 */
export function project(vx: number, vy: number, perspective: Perspective, p: Vec3): Vec2 | null {
  if (perspective === 'parallel') return { x: p.x, y: p.y }
  const w = 1 - p.z / perspective
  if (w <= 1e-4) return null
  return { x: vx + (p.x - vx) / w, y: vy + (p.y - vy) / w }
}

export function planeDepth(node: LayoutNode): number {
  return posePoint(node, node.width / 2, node.height / 2).z
}

/** 这些效果会把子树收成一张图，写了 preserve-3d 也不展开。 */
export function flattenReason(node: LayoutNode): string | null {
  if ((node.opacity ?? 1) < 1 - 1e-9) return 'opacity'
  if ((node.blur ?? 0) > 0) return 'blur'
  if (node.filters != null && node.filters.length > 0) return 'filter'
  if (node.grade) return 'grade'
  if (node.kind === 'layer' && node.mask != null && node.mask.length > 0) return 'mask'
  if (node.kind === 'layer' && node.overflow === 'hidden') return 'overflow'
  if (node.glass) return 'glass'
  if (node.backdropFilter != null && node.backdropFilter.length > 0) return 'backdrop-filter'
  if ((node.backdropBlur ?? 0) > 0) return 'backdrop-blur'
  if (node.blend && node.blend !== 'source-over') return 'blend'
  if (node.noise) return 'noise'
  if (node.overlay) return 'overlay'
  return null
}

/** 机位不是默认的，或者某级子元素写了还能展开的 preserve-3d。 */
export function cameraSceneCustom(layer: LayerLayoutNode): boolean {
  if (!hasPerspective(layer.perspective)) return false
  if (layer.cameraMoved) return true
  const visit = (node: LayoutNode, blocked: boolean): boolean => {
    if (blocked) return false
    if (node.preserve3d && !flattenReason(node)) return true
    if (node.kind !== 'layer' && node.kind !== 'flex') return false
    return node.children.some((child) => visit(child, child.kind === 'layer' && hasPerspective(child.perspective)))
  }
  return layer.children.some((child) => visit(child, child.kind === 'layer' && hasPerspective(child.perspective)))
}

/** 子树里有要单独进当前镜头的网格、姿态或还能展开的 preserve-3d。压平的层和另一台镜头拦住。 */
function subtreeEntersCamera(node: LayoutNode): boolean {
  if (node.kind === 'mesh' || node.kind === 'ground' || has3dPose(node)) return true
  if (node.preserve3d && !flattenReason(node) && (node.kind === 'layer' || node.kind === 'flex')) return true
  if (node.kind !== 'layer' && node.kind !== 'flex') return false
  if (flattenReason(node)) return false
  if (node.kind === 'layer' && hasPerspective(node.perspective)) return false
  return node.children.some(subtreeEntersCamera)
}

/**
 * 这一层拆开，子元素各自进当前镜头。
 * 自己写了 preserve-3d 就拆。祖先已经拆过、自己又没有姿态时，只在子孙需要单独一层时穿过：
 * 旋转卡片没有 preserve-3d 时仍是一张图，文字留在卡片里。
 */
export function splitsForCamera(node: LayoutNode, descended: boolean): boolean {
  if (node.kind !== 'layer' && node.kind !== 'flex') return false
  if (node.kind === 'layer' && hasPerspective(node.perspective)) return false
  if (flattenReason(node)) return false
  if (node.preserve3d) return true
  if (!descended || has3dPose(node)) return false
  return node.children.some(subtreeEntersCamera)
}

function solveAffine(
  s0: Vec2,
  s1: Vec2,
  s2: Vec2,
  d0: Vec2,
  d1: Vec2,
  d2: Vec2,
): { a: number; b: number; c: number; d: number; e: number; f: number } | null {
  const det = s0.x * (s1.y - s2.y) - s0.y * (s1.x - s2.x) + (s1.x * s2.y - s2.x * s1.y)
  if (Math.abs(det) < 1e-8) return null
  const coeff = (u0: number, u1: number, u2: number) => {
    const a = (u0 * (s1.y - s2.y) - s0.y * (u1 - u2) + (u1 * s2.y - u2 * s1.y)) / det
    const c = (s0.x * (u1 - u2) - u0 * (s1.x - s2.x) + (s1.x * u2 - s2.x * u1)) / det
    const e = (s0.x * (s1.y * u2 - s2.y * u1) - s0.y * (s1.x * u2 - s2.x * u1) + u0 * (s1.x * s2.y - s2.x * s1.y)) / det
    return { a, c, e }
  }
  const x = coeff(d0.x, d1.x, d2.x)
  const y = coeff(d0.y, d1.y, d2.y)
  return { a: x.a, b: y.a, c: x.c, d: y.c, e: x.e, f: y.e }
}

/** 透视平面的超采样倍数。只作用在投影后的平面上，二维绘制不经过这里。 */
export const PERSPECTIVE_AA = 4

function expandTriangle(points: [Vec2, Vec2, Vec2], amount: number): [Vec2, Vec2, Vec2] {
  const cx = (points[0].x + points[1].x + points[2].x) / 3
  const cy = (points[0].y + points[1].y + points[2].y) / 3
  return points.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount }
  }) as [Vec2, Vec2, Vec2]
}

type DrawCtx = CanvasRenderingContext2D & {
  canvas: Canvas
  drawImage(...args: unknown[]): void
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number }
}

const MAX_RASTER_SIDE = 8192

function drawTriangle(
  ctx: DrawCtx,
  bitmap: Canvas,
  logicalWidth: number,
  logicalHeight: number,
  s0: Vec2,
  s1: Vec2,
  s2: Vec2,
  d0: Vec2,
  d1: Vec2,
  d2: Vec2,
) {
  const m = solveAffine(s0, s1, s2, d0, d1, d2)
  if (!m) return
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.beginPath()
  ctx.moveTo(d0.x, d0.y)
  ctx.lineTo(d1.x, d1.y)
  ctx.lineTo(d2.x, d2.y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, logicalWidth, logicalHeight)
  ctx.restore()
}

function deviceScale(ctx: CanvasRenderingContext2D): number {
  const matrix = (
    ctx as CanvasRenderingContext2D & { getTransform(): { a: number; b: number; c: number; d: number } }
  ).getTransform()
  return Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1
}

function paintGrid(
  ctx: DrawCtx,
  bitmap: Canvas,
  logicalWidth: number,
  logicalHeight: number,
  n: number,
  pts: Array<Vec2 | null>,
  expand: number,
) {
  const atGrid = (i: number, j: number) => pts[j * (n + 1) + i]!
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const d00 = atGrid(i, j)
      const d10 = atGrid(i + 1, j)
      const d11 = atGrid(i + 1, j + 1)
      const d01 = atGrid(i, j + 1)
      if (!d00 || !d10 || !d11 || !d01) continue
      const s00 = { x: (i / n) * logicalWidth, y: (j / n) * logicalHeight }
      const s10 = { x: ((i + 1) / n) * logicalWidth, y: (j / n) * logicalHeight }
      const s11 = { x: ((i + 1) / n) * logicalWidth, y: ((j + 1) / n) * logicalHeight }
      const s01 = { x: (i / n) * logicalWidth, y: ((j + 1) / n) * logicalHeight }
      // 相邻格只重叠一个采样像素，盖住裁剪缝，又不把轮廓顶成一截一截的台阶。
      const [a, b, c] = expandTriangle([d00, d10, d11], expand)
      const [d, e, f] = expandTriangle([d00, d11, d01], expand)
      drawTriangle(ctx, bitmap, logicalWidth, logicalHeight, s00, s10, s11, a!, b!, c!)
      drawTriangle(ctx, bitmap, logicalWidth, logicalHeight, s00, s11, s01, d!, e!, f!)
    }
  }
}

/** 把高分辨率画面平均缩回目标像素。颜色按预乘 alpha 平均，避免边缘发暗。透视平面和网格共用。 */
export function resolveSamples(src: Canvas, dw: number, dh: number): Canvas {
  const sw = src.width
  const sh = src.height
  const srcData = src.getContext('2d').getImageData(0, 0, sw, sh).data
  const out = createCanvas(dw, dh)
  const octx = out.getContext('2d')
  const image = octx.createImageData(dw, dh)
  const dst = image.data
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh)
    const y1 = Math.floor(((y + 1) * sh) / dh)
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw)
      const x1 = Math.floor(((x + 1) * sw) / dw)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let iy = y0; iy < y1; iy++) {
        for (let ix = x0; ix < x1; ix++) {
          const si = (iy * sw + ix) * 4
          const ai = srcData[si + 3] ?? 0
          r += (srcData[si] ?? 0) * ai
          g += (srcData[si + 1] ?? 0) * ai
          b += (srcData[si + 2] ?? 0) * ai
          a += ai
          n++
        }
      }
      const di = (y * dw + x) * 4
      dst[di + 3] = n > 0 ? Math.round(a / n) : 0
      if (a > 0) {
        dst[di] = Math.round(r / a)
        dst[di + 1] = Math.round(g / a)
        dst[di + 2] = Math.round(b / a)
      }
    }
  }
  octx.putImageData(image, 0, 0)
  return out
}

function solveLinear(rows: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const m = rows.map((row, i) => [...row, rhs[i]!])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r
    const pivotRow = m[pivot]
    if (!pivotRow || Math.abs(pivotRow[col]!) < 1e-10) return null
    if (pivot !== col) {
      m[pivot] = m[col]!
      m[col] = pivotRow
    }
    const div = m[col]![col]!
    for (let c = col; c <= n; c++) m[col]![c] = m[col]![c]! / div
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = m[r]![col]!
      if (factor === 0) continue
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - factor * m[col]![c]!
    }
  }
  return m.map((row) => row[n]!)
}

/** 四点决定的投影。平面透视是单应，不是一格一格的仿射。 */
function fitHomography(from: Vec2[], to: Vec2[]): number[] | null {
  const rows: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < 4; i++) {
    const x = from[i]!.x
    const y = from[i]!.y
    const u = to[i]!.x
    const v = to[i]!.y
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    rhs.push(u)
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    rhs.push(v)
  }
  return solveLinear(rows, rhs)
}

function applyHomography(h: number[], x: number, y: number): Vec2 | null {
  const w = h[6]! * x + h[7]! * y + 1
  if (Math.abs(w) < 1e-8) return null
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / w, y: (h[3]! * x + h[4]! * y + h[5]!) / w }
}

/** 相邻三角形叠在一起时，半透明的阴影和发光会在接缝上叠两次，看起来像网格。这里每个像素只采样一次。 */
function paintHomography(
  off: Canvas,
  bitmap: Canvas,
  logicalWidth: number,
  logicalHeight: number,
  at: (u: number, v: number) => Vec2 | null,
  x0: number,
  y0: number,
  raster: number,
): boolean {
  const src: Vec2[] = [
    { x: 0, y: 0 },
    { x: logicalWidth, y: 0 },
    { x: logicalWidth, y: logicalHeight },
    { x: 0, y: logicalHeight },
  ]
  const dst: Vec2[] = []
  for (const p of src) {
    const q = at(p.x, p.y)
    if (!q) return false
    dst.push(q)
  }
  const h = fitHomography(dst, src)
  if (!h) return false
  const mid = at(logicalWidth / 2, logicalHeight / 2)
  if (mid) {
    const back = applyHomography(h, mid.x, mid.y)
    if (!back || Math.hypot(back.x - logicalWidth / 2, back.y - logicalHeight / 2) > 1.5) return false
  }
  writeHomography(off, bitmap, h, logicalWidth, logicalHeight, x0, y0, raster)
  return true
}

/** 屏幕上的点是否在多边形里。水平边不计入，避免除零。 */
function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if ((a.y > y) === (b.y > y)) continue
    const cross = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    if (x < cross) inside = !inside
  }
  return inside
}

/** 四个点用原来的求解。更多点用最小二乘，裁出来的多边形仍落在同一张平面上。 */
function fitHomographyPoints(from: Vec2[], to: Vec2[]): number[] | null {
  if (from.length < 4 || from.length !== to.length) return null
  if (from.length === 4) return fitHomography(from, to)
  const cols = 8
  const ata = Array.from({ length: cols }, () => new Array<number>(cols).fill(0))
  const atb = new Array<number>(cols).fill(0)
  const accumulate = (row: number[], rhs: number) => {
    for (let i = 0; i < cols; i++) {
      atb[i]! += row[i]! * rhs
      for (let j = 0; j < cols; j++) ata[i]![j]! += row[i]! * row[j]!
    }
  }
  for (let i = 0; i < from.length; i++) {
    const x = from[i]!.x
    const y = from[i]!.y
    const u = to[i]!.x
    const v = to[i]!.y
    accumulate([x, y, 1, 0, 0, 0, -u * x, -u * y], u)
    accumulate([0, 0, 0, x, y, 1, -v * x, -v * y], v)
  }
  return solveLinear(ata, atb)
}

function writeHomography(
  off: Canvas,
  bitmap: Canvas,
  h: number[],
  logicalWidth: number,
  logicalHeight: number,
  x0: number,
  y0: number,
  raster: number,
  inside?: (x: number, y: number) => boolean,
): void {
  const bw = bitmap.width
  const bh = bitmap.height
  const srcData = bitmap.getContext('2d').getImageData(0, 0, bw, bh).data
  const pw = off.width
  const ph = off.height
  const octx = off.getContext('2d')
  const image = octx.createImageData(pw, ph)
  const dstData = image.data
  const sample = (fx: number, fy: number) => {
    if (fx < -0.5 || fy < -0.5 || fx > bw - 0.5 || fy > bh - 0.5) return
    const x = Math.max(0, Math.min(bw - 1.0001, fx))
    const y = Math.max(0, Math.min(bh - 1.0001, fy))
    const x0p = Math.floor(x)
    const y0p = Math.floor(y)
    const x1p = Math.min(bw - 1, x0p + 1)
    const y1p = Math.min(bh - 1, y0p + 1)
    const tx = x - x0p
    const ty = y - y0p
    const atPx = (px: number, py: number) => {
      const i = (py * bw + px) * 4
      const a = (srcData[i + 3] ?? 0) / 255
      return [(srcData[i] ?? 0) * a, (srcData[i + 1] ?? 0) * a, (srcData[i + 2] ?? 0) * a, a] as const
    }
    const p00 = atPx(x0p, y0p)
    const p10 = atPx(x1p, y0p)
    const p01 = atPx(x0p, y1p)
    const p11 = atPx(x1p, y1p)
    const mix = (a: number, b: number, c: number, d: number) => a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
    return { r: mix(p00[0], p10[0], p01[0], p11[0]), g: mix(p00[1], p10[1], p01[1], p11[1]), b: mix(p00[2], p10[2], p01[2], p11[2]), a: mix(p00[3], p10[3], p01[3], p11[3]) }
  }
  for (let py = 0; py < ph; py++) {
    const ly = y0 + (py + 0.5) / raster
    for (let px = 0; px < pw; px++) {
      const lx = x0 + (px + 0.5) / raster
      if (inside && !inside(lx, ly)) continue
      const uv = applyHomography(h, lx, ly)
      if (!uv || uv.x < 0 || uv.y < 0 || uv.x > logicalWidth || uv.y > logicalHeight) continue
      const color = sample((uv.x / logicalWidth) * bw - 0.5, (uv.y / logicalHeight) * bh - 0.5)
      if (!color || color.a <= 0) continue
      const di = (py * pw + px) * 4
      dstData[di] = Math.round(color.r / color.a)
      dstData[di + 1] = Math.round(color.g / color.a)
      dstData[di + 2] = Math.round(color.b / color.a)
      dstData[di + 3] = Math.round(color.a * 255)
    }
  }
  octx.putImageData(image, 0, 0)
}

/**
 * 裁过的多边形仍是同一张平面。用单应贴图，不再切成仿射三角形，接缝处的贴图和圆角描边才不会折。
 * 对不上单应时退回三角形。
 */
function paintPolygonHomography(
  off: Canvas,
  bitmap: Canvas,
  logicalWidth: number,
  logicalHeight: number,
  polygon: ScreenPoint[],
  x0: number,
  y0: number,
  raster: number,
): boolean {
  if (polygon.length < 4) return false
  const h = fitHomographyPoints(
    polygon.map((point) => ({ x: point.x, y: point.y })),
    polygon.map((point) => ({ x: point.u, y: point.v })),
  )
  if (!h) return false
  let worst = 0
  for (const point of polygon) {
    const back = applyHomography(h, point.x, point.y)
    if (!back) return false
    worst = Math.max(worst, Math.hypot(back.x - point.u, back.y - point.v))
  }
  const tolerance = Math.max(1.5, 0.002 * Math.hypot(logicalWidth, logicalHeight))
  if (worst > tolerance) return false
  writeHomography(off, bitmap, h, logicalWidth, logicalHeight, x0, y0, raster, (x, y) => pointInPolygon(x, y, polygon))
  return true
}

/** 不重叠绘制时，裁剪会在共享边上留下一条全透明的缝。只补两侧都有颜色的缝，不把外轮廓撑大。 */
function closeInteriorCracks(canvas: Canvas) {
  const ctx = canvas.getContext('2d')
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const src = image.data
  const w = canvas.width
  const h = canvas.height
  const dst = new Uint8ClampedArray(src)
  const alpha = (x: number, y: number) => src[(y * w + x) * 4 + 3] ?? 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      if ((src[i + 3] ?? 0) !== 0) continue
      const left = alpha(x - 1, y)
      const right = alpha(x + 1, y)
      const up = alpha(x, y - 1)
      const down = alpha(x, y + 1)
      let from = -1
      if (left > 0 && right > 0) from = (y * w + (x - 1)) * 4
      else if (up > 0 && down > 0) from = ((y - 1) * w + x) * 4
      if (from < 0) continue
      dst[i] = src[from]!
      dst[i + 1] = src[from + 1]!
      dst[i + 2] = src[from + 2]!
      dst[i + 3] = src[from + 3]!
    }
  }
  image.data.set(dst)
  ctx.putImageData(image, 0, 0)
}

/** 当前变换下，画布在用户坐标里的外接矩形。 */
function userBounds(ctx: DrawCtx): { x: number; y: number; width: number; height: number } | null {
  const canvas = ctx.canvas
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null
  const tr = ctx.getTransform()
  const inv = invert({ a: tr.a, b: tr.b, c: tr.c, d: tr.d, e: tr.e, f: tr.f })
  if (!inv) return null
  return applyToBox(inv, { x: 0, y: 0, width: canvas.width, height: canvas.height })
}

/** 投影外框和画布相交。画布外面的像素不会被看到，不必分配。 */
function clipRasterBounds(
  ctx: DrawCtx,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const pad = 2
  let x0 = Math.floor(minX - pad)
  let y0 = Math.floor(minY - pad)
  let x1 = Math.ceil(maxX + pad)
  let y1 = Math.ceil(maxY + pad)
  const view = userBounds(ctx)
  if (view) {
    const slack = 4
    x0 = Math.max(x0, Math.floor(view.x) - slack)
    y0 = Math.max(y0, Math.floor(view.y) - slack)
    x1 = Math.min(x1, Math.ceil(view.x + view.width) + slack)
    y1 = Math.min(y1, Math.ceil(view.y + view.height) + slack)
  }
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  return { x0, y0, x1, y1 }
}

function rasterScale(base: number, lw: number, lh: number): { samples: number; raster: number; pw: number; ph: number } {
  let samples = PERSPECTIVE_AA
  while (samples > 1 && (lw * base * samples > MAX_RASTER_SIDE || lh * base * samples > MAX_RASTER_SIDE)) samples /= 2
  const raster = base * samples
  return {
    samples,
    raster,
    pw: Math.max(1, Math.round(lw * raster)),
    ph: Math.max(1, Math.round(lh * raster)),
  }
}

function blitRaster(ctx: DrawCtx, off: Canvas, samples: number, base: number, x0: number, y0: number, lw: number, lh: number) {
  const resolved = samples > 1 ? resolveSamples(off, Math.max(1, Math.round(lw * base)), Math.max(1, Math.round(lh * base))) : off
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(resolved, x0, y0, lw, lh)
}

/** 把位图贴到投影后的平面上。平面是一次投影，每个像素只采样一次，柔和的阴影和发光不会出现网格。 */
export function drawTexturedPlane(
  ctx: DrawCtx,
  bitmap: Canvas,
  logicalWidth: number,
  logicalHeight: number,
  at: (u: number, v: number) => Vec2 | null,
) {
  const edge = Math.max(logicalWidth, logicalHeight)
  const n = Math.min(24, Math.max(4, Math.ceil(edge / 32)))
  const pts: Array<Vec2 | null> = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const p = at((i / n) * logicalWidth, (j / n) * logicalHeight)
      pts.push(p)
      if (!p) continue
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  if (!Number.isFinite(minX)) return
  const bounds = clipRasterBounds(ctx, minX, minY, maxX, maxY)
  if (!bounds) return
  const { x0, y0, x1, y1 } = bounds
  const lw = Math.max(1, x1 - x0)
  const lh = Math.max(1, y1 - y0)
  const base = deviceScale(ctx)
  const { samples, raster, pw, ph } = rasterScale(base, lw, lh)
  const off = createCanvas(pw, ph)
  const octx = off.getContext('2d') as DrawCtx
  if (!paintHomography(off, bitmap, logicalWidth, logicalHeight, at, x0, y0, raster)) {
    octx.setTransform(raster, 0, 0, raster, -x0 * raster, -y0 * raster)
    paintGrid(octx, bitmap, logicalWidth, logicalHeight, n, pts, 0)
    closeInteriorCracks(off)
  }
  blitRaster(ctx, off, samples, base, x0, y0, lw, lh)
}

export type ScreenPoint = { u: number; v: number; x: number; y: number }

/** 已经裁进画布的多边形。u、v 是位图局部坐标，和 logicalWidth 同一套。 */
export function drawTexturedPolygon(
  ctx: DrawCtx,
  bitmap: Canvas,
  logicalWidth: number,
  logicalHeight: number,
  polygon: ScreenPoint[],
) {
  if (polygon.length < 3 || logicalWidth <= 0 || logicalHeight <= 0) return
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of polygon) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const bounds = clipRasterBounds(ctx, minX, minY, maxX, maxY)
  if (!bounds) return
  const { x0, y0, x1, y1 } = bounds
  const lw = Math.max(1, x1 - x0)
  const lh = Math.max(1, y1 - y0)
  const base = deviceScale(ctx)
  const { samples, raster, pw, ph } = rasterScale(base, lw, lh)
  const off = createCanvas(pw, ph)
  if (!paintPolygonHomography(off, bitmap, logicalWidth, logicalHeight, polygon, x0, y0, raster)) {
    const octx = off.getContext('2d') as DrawCtx
    octx.setTransform(raster, 0, 0, raster, -x0 * raster, -y0 * raster)
    for (let i = 1; i < polygon.length - 1; i++) {
      const a = polygon[0]!
      const b = polygon[i]!
      const c = polygon[i + 1]!
      drawTriangle(
        octx,
        bitmap,
        logicalWidth,
        logicalHeight,
        { x: a.u, y: a.v },
        { x: b.u, y: b.v },
        { x: c.u, y: c.v },
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
        { x: c.x, y: c.y },
      )
    }
    closeInteriorCracks(off)
  }
  blitRaster(ctx, off, samples, base, x0, y0, lw, lh)
}

/** 纯色多边形。不需要按平面尺寸准备位图。 */
export function drawSolidPolygon(ctx: DrawCtx, color: string, polygon: Array<{ x: number; y: number }>) {
  if (polygon.length < 3) return
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of polygon) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const bounds = clipRasterBounds(ctx, minX, minY, maxX, maxY)
  if (!bounds) return
  const { x0, y0, x1, y1 } = bounds
  const lw = Math.max(1, x1 - x0)
  const lh = Math.max(1, y1 - y0)
  const base = deviceScale(ctx)
  const { samples, raster, pw, ph } = rasterScale(base, lw, lh)
  const off = createCanvas(pw, ph)
  const octx = off.getContext('2d') as DrawCtx
  octx.setTransform(raster, 0, 0, raster, -x0 * raster, -y0 * raster)
  octx.fillStyle = color
  octx.beginPath()
  octx.moveTo(polygon[0]!.x, polygon[0]!.y)
  for (const point of polygon.slice(1)) octx.lineTo(point.x, point.y)
  octx.closePath()
  octx.fill()
  blitRaster(ctx, off, samples, base, x0, y0, lw, lh)
}

/**
 * 直接子级的平面才进入这一层的镜头。再往里的子孙先画进父平面。
 * 写了还能展开的 preserve-3d 时，子孙沿父链进入外层镜头，不报 flatten-3d。
 * 网格沿着祖先里最近的 perspective 走，不要求自己是直接子级。
 * 非默认机位的 behind-camera 由 cameraAuditIssues 按乘过视图矩阵之后的采样点报。
 */
export function perspectiveIssues(root: LayoutNode): Issue[] {
  const issues: Issue[] = []
  const visit = (node: LayoutNode, inCamera: boolean, distance: Perspective | undefined, projected: boolean, custom: boolean) => {
    if (node.kind === 'mesh' || node.kind === 'ground') {
      if (distance == null) {
        issues.push({
          level: 'warn',
          code: 'flatten-3d',
          path: node.path,
          message: `${node.tag} 没有落在镜头里`,
          hint: '给这一层正的 height。不写 camera 时视距等于 height，要改视距写 camera="900"',
        })
      } else if (node.kind === 'mesh' && !custom && behindCamera(node.z ?? 0, distance)) {
        issues.push({
          level: 'warn',
          code: 'behind-camera',
          path: node.path,
          message: '网格在观众身后，不绘制',
          hint: `把 z 减小到小于视距（${distance}）`,
        })
      }
      return
    }
    if (has3dPose(node) && !inCamera && !projected) {
      issues.push({
        level: 'warn',
        code: 'flatten-3d',
        path: node.path,
        message: 'rotateX、rotateY、z 没有落在镜头里',
        hint: '给这一层正的 height。不写 camera 时视距等于 height，要改视距写 camera="900"',
      })
    }
    if (inCamera && !custom && distance != null && behindCamera(planeDepth(node), distance)) {
      issues.push({
        level: 'warn',
        code: 'behind-camera',
        path: node.path,
        message: '平面在观众身后，不绘制',
        hint: `把 z 减小到小于视距（${distance}）`,
      })
    }
    const children = node.kind === 'layer' || node.kind === 'flex' ? node.children : []
    const opens = node.kind === 'layer' && hasPerspective(node.perspective)
    const nextCustom = opens ? cameraSceneCustom(node) : custom
    const nextProjected = !opens && projected
    const childProjected = (parent: LayoutNode) =>
      nextProjected || (!!parent.preserve3d && !flattenReason(parent) && (opens || projected || inCamera))
    for (const child of children) {
      visit(child, opens, opens ? node.perspective : distance, opens ? false : childProjected(node), nextCustom && (opens || custom))
    }
  }
  visit(root, false, undefined, false, false)
  return issues
}
