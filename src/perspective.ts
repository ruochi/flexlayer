import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { originOffset } from './matrix.js'
import type { Issue, LayoutNode } from './types.js'

export type Vec3 = { x: number; y: number; z: number }
export type Vec2 = { x: number; y: number }

type Pose = {
  x: number
  y: number
  originX: number
  originY: number
  scale: number
  rotate: number
  rotateX: number
  rotateY: number
  z: number
}

function poseOf(node: LayoutNode): Pose {
  const o = originOffset(node.origin, node.width, node.height)
  return {
    x: node.x,
    y: node.y,
    originX: o.x,
    originY: o.y,
    scale: node.scale || 1,
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
  let x = du * pose.scale
  let y = dv * pose.scale
  let z = pose.z + dz * pose.scale
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

/** 视距像素。灭点 (vx, vy)。z 越大越近。观众身后返回 null。 */
export function project(vx: number, vy: number, perspective: number, p: Vec3): Vec2 | null {
  const w = 1 - p.z / perspective
  if (w <= 1e-4) return null
  return { x: vx + (p.x - vx) / w, y: vy + (p.y - vy) / w }
}

export function planeDepth(node: LayoutNode): number {
  return posePoint(node, node.width / 2, node.height / 2).z
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

type DrawCtx = CanvasRenderingContext2D & { drawImage(...args: unknown[]): void }

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
    const pr = mix(p00[0], p10[0], p01[0], p11[0])
    const pg = mix(p00[1], p10[1], p01[1], p11[1])
    const pb = mix(p00[2], p10[2], p01[2], p11[2])
    const pa = mix(p00[3], p10[3], p01[3], p11[3])
    return { r: pr, g: pg, b: pb, a: pa }
  }
  for (let py = 0; py < ph; py++) {
    const ly = y0 + (py + 0.5) / raster
    for (let px = 0; px < pw; px++) {
      const lx = x0 + (px + 0.5) / raster
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
  const base = deviceScale(ctx)
  const pad = 2
  const x0 = Math.floor(minX - pad)
  const y0 = Math.floor(minY - pad)
  const x1 = Math.ceil(maxX + pad)
  const y1 = Math.ceil(maxY + pad)
  const lw = Math.max(1, x1 - x0)
  const lh = Math.max(1, y1 - y0)
  let samples = PERSPECTIVE_AA
  while (samples > 1 && (lw * base * samples > MAX_RASTER_SIDE || lh * base * samples > MAX_RASTER_SIDE)) samples /= 2
  const raster = base * samples
  const pw = Math.max(1, Math.round(lw * raster))
  const ph = Math.max(1, Math.round(lh * raster))
  const off = createCanvas(pw, ph)
  const octx = off.getContext('2d') as DrawCtx
  if (!paintHomography(off, bitmap, logicalWidth, logicalHeight, at, x0, y0, raster)) {
    octx.setTransform(raster, 0, 0, raster, -x0 * raster, -y0 * raster)
    paintGrid(octx, bitmap, logicalWidth, logicalHeight, n, pts, 0)
    closeInteriorCracks(off)
  }
  const resolved = samples > 1 ? resolveSamples(off, Math.max(1, Math.round(lw * base)), Math.max(1, Math.round(lh * base))) : off
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(resolved, x0, y0, lw, lh)
}

/**
 * 直接子级的平面才进入这一层的镜头。再往里的子孙先画进父平面。
 * 网格沿着祖先里最近的 perspective 走，不要求自己是直接子级。
 */
export function perspectiveIssues(root: LayoutNode): Issue[] {
  const issues: Issue[] = []
  const visit = (node: LayoutNode, inCamera: boolean, distance: number | undefined) => {
    if (node.kind === 'mesh') {
      if (distance == null) {
        issues.push({
          level: 'warn',
          code: 'flatten-3d',
          path: node.path,
          message: `${node.tag} 没有落在带 perspective 的 layer 里`,
          hint: '在父 layer 上写 perspective，例如 <layer perspective="900">',
        })
      } else if ((node.z ?? 0) >= distance) {
        issues.push({
          level: 'warn',
          code: 'behind-camera',
          path: node.path,
          message: '网格在观众身后，不绘制',
          hint: `把 z 减小到小于 perspective（${distance}）`,
        })
      }
      return
    }
    if (has3dPose(node) && !inCamera) {
      issues.push({
        level: 'warn',
        code: 'flatten-3d',
        path: node.path,
        message: 'rotateX、rotateY、z 没有落在带 perspective 的 layer 里',
        hint: '在父 layer 上写 perspective，例如 <layer perspective="900">',
      })
    }
    if (inCamera && distance != null && (node.z ?? 0) >= distance) {
      issues.push({
        level: 'warn',
        code: 'behind-camera',
        path: node.path,
        message: '平面在观众身后，不绘制',
        hint: `把 z 减小到小于 perspective（${distance}）`,
      })
    }
    const children = node.kind === 'layer' || node.kind === 'flex' ? node.children : []
    const opens = node.kind === 'layer' && node.perspective != null && node.perspective > 0
    for (const child of children) visit(child, opens, opens ? node.perspective : distance)
  }
  visit(root, false, undefined)
  return issues
}
