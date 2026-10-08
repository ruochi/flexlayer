import { matrixScale, multiply, scaled, translated, type Matrix } from './matrix.js'
import { parseNumber } from './style.js'
import { unionBoxes, type Box, type LayoutNode, type ViewRect } from './types.js'

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

/** view 有没有被直接子元素的布局盒盖住。没盖住的部分出图会露底。 */
export function viewExceeds(view: ViewRect, children: LayoutNode[]): boolean {
  let union: Box | null = null
  for (const child of children) {
    if (child.width <= 1e-3 || child.height <= 1e-3) continue
    const box: Box = { x: child.x, y: child.y, width: child.width, height: child.height }
    union = union ? unionBoxes(union, box) : box
  }
  if (!union) return true
  const eps = 0.51
  return (
    view.x < union.x - eps ||
    view.y < union.y - eps ||
    view.x + view.width > union.x + union.width + eps ||
    view.y + view.height > union.y + union.height + eps
  )
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
