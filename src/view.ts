import { apply, aroundPivot, matrixScale, multiply, originOffset, scaled, translated, type Matrix } from './matrix.js'
import { parseNumber } from './style.js'
import type { LayoutNode, ViewRect } from './types.js'

/** 四个数 `x y w h`。宽高必须大于 0。 */
export function parseView(raw: string): ViewRect | null {
  const parts = raw.trim().split(/[\s,]+/).filter((part) => part !== '')
  if (parts.length !== 4) return null
  const nums = parts.map((part) => parseNumber(part))
  if (nums.some((n) => n == null)) return null
  const x = nums[0]!
  const y = nums[1]!
  const width = nums[2]!
  const height = nums[3]!
  if (!(width > 0) || !(height > 0)) return null
  return { x, y, width, height }
}

/**
 * 取景窗和 view 的宽高比差超过 1% 时，保持中心和宽度，按取景窗的比例重算高度。
 * 不拉伸画面。
 */
export function fitViewAspect(
  view: ViewRect,
  viewportWidth: number,
  viewportHeight: number,
): { view: ViewRect; adjusted: boolean } {
  const layerAspect = viewportWidth / viewportHeight
  const viewAspect = view.width / view.height
  if (!Number.isFinite(layerAspect) || layerAspect <= 0) return { view, adjusted: false }
  if (Math.abs(layerAspect - viewAspect) / layerAspect <= 0.01) return { view, adjusted: false }
  const height = view.width / layerAspect
  const y = view.y + view.height / 2 - height / 2
  return { view: { x: view.x, y, width: view.width, height }, adjusted: true }
}

/** 舞台上的点变到取景窗局部坐标：view 的左上角落到 (0, 0)，view 的宽高铺满取景窗。 */
export function viewMatrix(viewportWidth: number, viewportHeight: number, view: ViewRect): Matrix {
  const sx = viewportWidth / view.width
  const sy = viewportHeight / view.height
  return multiply(scaled(sx, sy), translated(-view.x, -view.y))
}

/** 这一层自己的 scale，再乘上 view 带来的缩放。给离屏光栅用，好按屏幕像素绘制。 */
export function layoutScale(node: LayoutNode): number {
  let k = matrixScale({ a: node.scaleX, b: 0, c: 0, d: node.scaleY, e: 0, f: 0 })
  if (node.kind === 'layer' && node.view && node.width > 0 && node.height > 0) {
    k *= matrixScale(viewMatrix(node.width, node.height, node.view))
  }
  return k || 1
}

const VIEW_SLACK = 0.51

/** 绕自己的 origin 做 rotate、scale。没有这些时是单位变换。 */
function poseOf(node: LayoutNode): Matrix | null {
  if (node.rotate === 0 && node.scaleX === 1 && node.scaleY === 1) return null
  const pivot = originOffset(node.origin, node.width, node.height)
  return aroundPivot(node.x + pivot.x, node.y + pivot.y, node.rotate, node.scaleX, node.scaleY)
}

/** 布局盒子绕 origin 做完 rotate、scale 之后的四个角，顺序是左上、右上、右下、左下。 */
function childQuad(child: LayoutNode): Array<[number, number]> | null {
  if (child.width <= 1e-3 || child.height <= 1e-3) return null
  const corners: Array<[number, number]> = [
    [child.x, child.y],
    [child.x + child.width, child.y],
    [child.x + child.width, child.y + child.height],
    [child.x, child.y + child.height],
  ]
  const pose = poseOf(child)
  return pose ? corners.map(([x, y]) => apply(pose, x, y)) : corners
}

/**
 * 盖住镜头的四边形。`<g>` 用 SVG transform 之后每个形状自己的四边形。
 * 组自己的 rotate、scale 再绕外接矩形的 origin 做一次。
 */
function coverageQuads(node: LayoutNode): Array<Array<[number, number]>> {
  if (node.kind !== 'group') {
    const quad = childQuad(node)
    return quad ? [quad] : []
  }
  const mapped = node.children
    .flatMap((child) => coverageQuads(child))
    .map((quad) => quad.map(([x, y]) => apply(node.svg, x, y)))
  const pose = poseOf(node)
  return pose ? mapped.map((quad) => quad.map(([x, y]) => apply(pose, x, y))) : mapped
}

/** 凸多边形，边向内或向外绕一圈都可以。点落在边上算在里面。 */
function pointInConvex(point: [number, number], corners: Array<[number, number]>): boolean {
  let sign = 0
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % corners.length]!
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
    if (Math.abs(cross) <= 1e-3) continue
    const next = cross > 0 ? 1 : -1
    if (sign === 0) sign = next
    else if (next !== sign) return false
  }
  return true
}

/**
 * view 有没有被直接子元素转完、缩完的四边形盖住。没盖住的部分出图会露底。
 * 镜头四角各向内收 0.51px 再测，贴边的取景不算超出。多个子元素时，每个角落在其中一块里即可。
 */
export function viewExceeds(view: ViewRect, children: LayoutNode[]): boolean {
  const quads = children.flatMap((child) => coverageQuads(child))
  if (quads.length === 0) return true
  const dx = Math.min(VIEW_SLACK, view.width / 2)
  const dy = Math.min(VIEW_SLACK, view.height / 2)
  const x = view.x + dx
  const y = view.y + dy
  const right = view.x + view.width - dx
  const bottom = view.y + view.height - dy
  const corners: Array<[number, number]> = [
    [x, y],
    [right, y],
    [right, bottom],
    [x, bottom],
  ]
  return corners.some((corner) => !quads.some((quad) => pointInConvex(corner, quad)))
}

function trimNum(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/**
 * 以 `center` 为中心、把 `size` 那么大的取景窗推到 `zoom` 倍时的 `view`。
 * `zoom` 大于 1 是推近。返回可以直接写进 `view` 的 `"x y w h"`。
 */
export function zoomView(center: readonly [number, number], zoom: number, size: readonly [number, number]): string {
  if (!(zoom > 0) || !(size[0] > 0) || !(size[1] > 0)) {
    throw new Error('zoomView 的 zoom 和 size 必须大于 0')
  }
  const w = size[0] / zoom
  const h = size[1] / zoom
  const x = center[0] - w / 2
  const y = center[1] - h / 2
  return `${trimNum(x)} ${trimNum(y)} ${trimNum(w)} ${trimNum(h)}`
}
