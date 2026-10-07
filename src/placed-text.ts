import { apply, aroundPivot, IDENTITY, multiply, originOffset, scaled, translated, type Matrix } from './matrix.js'
import { splitAdvances } from './text.js'
import type { FlexLayoutNode, LayerLayoutNode, LayoutNode, TextLayoutNode } from './types.js'

/** 一行里的一个码位。基线用所在行的 `baseline`。 */
export type PlacedChar = {
  text: string
  /** 这一笔的左边缘，相对层的布局盒左上角。 */
  x: number
  /** 到下一笔的距离。最后一个字不加多余字距。 */
  width: number
}

/** 排出来的一行。一个字就是只有一个字的一行。 */
export type PlacedLine = {
  /** 行盒左上角，相对层的布局盒。 */
  x: number
  y: number
  width: number
  height: number
  /** 这一行基线的 y。同一行只有一个。 */
  baseline: number
  chars: PlacedChar[]
}

/** 一个文字节点排完的行。 */
export type PlacedText = {
  /** 相对这一层的路径，例如 `h1[0]`、`div[0]/p[0]`。 */
  path: string
  lines: PlacedLine[]
}

/** 只计入缩放。旋转留在节点上，避免把水平基线折成斜线。 */
function nodePose(node: LayoutNode): Matrix {
  if (node.rotate !== 0 || node.scale === 1) return IDENTITY
  const pivot = originOffset(node.origin, node.width, node.height)
  return aroundPivot(node.x + pivot.x, node.y + pivot.y, 0, node.scale)
}

/** 子元素所在的坐标系：先做这一层自己的缩放和旋转，再移到内容原点。根层的变换留给调用方。 */
function childSpace(node: LayerLayoutNode | FlexLayoutNode, space: Matrix, isRoot: boolean): Matrix {
  const border = node.border?.width ?? 0
  const insetX = node.kind === 'flex' ? node.padding.left + border : 0
  const insetY = node.kind === 'flex' ? node.padding.top + border : 0
  const origin = translated((isRoot ? 0 : node.x) + insetX, (isRoot ? 0 : node.y) + insetY)
  if (isRoot) return multiply(space, origin)
  return multiply(space, multiply(nodePose(node), origin))
}

function pushText(node: TextLayoutNode, space: Matrix, found: PlacedText[]) {
  const border = node.border?.width ?? 0
  const contentX = node.x + node.padding.left + border
  const contentY = node.y + node.padding.top + border
  const innerW = node.width - node.padding.left - node.padding.right - border * 2
  const lines: PlacedLine[] = []
  for (const line of node.textLayout.lines) {
    let offsetX = 0
    if (node.textAlign === 'center') offsetX = (innerW - line.width) / 2
    if (node.textAlign === 'right') offsetX = innerW - line.width
    const segments = line.segments
    const minX = segments.length === 0 ? 0 : Math.min(...segments.map((segment) => segment.x))
    const maxX = segments.length === 0 ? 0 : Math.max(...segments.map((segment) => segment.x + segment.width))
    const localX = contentX + offsetX + minX
    const lineTop = line.ink.y - (line.height - line.ink.height) / 2
    const localY = contentY + lineTop
    const localBaseline = contentY + line.baselineY
    const [x, y] = apply(space, localX, localY)
    const [x1] = apply(space, localX + (maxX - minX), localY)
    const [, y2] = apply(space, localX, localY + line.height)
    const [, baseline] = apply(space, localX, localBaseline)
    const chars: PlacedChar[] = []
    for (const segment of segments) {
      const advances = splitAdvances(segment.text, segment.style, segment.width)
      let pen = 0
      for (const advance of advances) {
        const start = contentX + offsetX + segment.x + pen
        const [cx] = apply(space, start, localBaseline)
        const [cx2] = apply(space, start + advance.width, localBaseline)
        chars.push({ text: advance.text, x: cx, width: cx2 - cx })
        pen += advance.width
      }
    }
    lines.push({
      x,
      y,
      width: x1 - x,
      height: y2 - y,
      baseline,
      chars,
    })
  }
  if (lines.length === 0) return
  const path = node.path.replace(/^layer\//, '')
  found.push({ path, lines })
}

function visit(node: LayoutNode, space: Matrix, isRoot: boolean, found: PlacedText[]) {
  if (node.kind === 'text') {
    pushText(node, multiply(space, nodePose(node)), found)
    return
  }
  if (node.kind === 'layer' || node.kind === 'flex') {
    const next = childSpace(node, space, isRoot)
    for (const child of node.children) visit(child, next, false, found)
    return
  }
  if (node.kind === 'group') {
    const next = multiply(multiply(space, nodePose(node)), node.svg)
    for (const child of node.children) visit(child, next, false, found)
  }
}

/**
 * 把排完的文字收成行。坐标在根层布局盒里，嵌套层的位置和缩放已经算进去，旋转不算。
 * `fitScale` 是只写了宽或高时的整层比例，原点在左上角。
 */
export function placedText(root: LayerLayoutNode, fitScale: number): PlacedText[] {
  const found: PlacedText[] = []
  visit(root, scaled(fitScale), true, found)
  return found
}
