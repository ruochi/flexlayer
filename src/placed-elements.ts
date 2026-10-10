import { applyToBox, aroundPivot, IDENTITY, multiply, originOffset, translated, type Matrix } from './matrix.js'
import type { LayerBox } from './canvas.js'
import { maskStats, type MaskStats } from './mask-stats.js'
import type { Box, LayoutNode } from './types.js'

/**
 * 带 `<mask>` 的 layer 才有。`area`、`pieces`、`softEdge` 按这一层自己的像素量。
 * `ink` 是留下来的部分的外接矩形，和 `box` 同一套坐标。
 */
export type PlacedMask = Omit<MaskStats, 'ink'> & { ink: LayerBox | null }

/**
 * 一个排进去的元素。坐标相对创建出来的这一层布局盒左上角，和 `text` 同一套：
 * 嵌套层的位置和缩放算进去，这一层和祖先的旋转不算。
 */
export type PlacedElement = {
  /** 相对这一层的路径，例如 `rect[0]`、`div[0]/p[0]`。根层自己不在里面。 */
  path: string
  tag: string
  /** 写了 `id` 才有。 */
  id?: string
  /**
   * 布局盒。不含这一元素自己的 `rotate`。
   * `left` 到 `height` 和返回值上的布局盒同一套字段。
   */
  box: LayerBox
  /**
   * 这一元素自己的 `rotate`、`scale` 之后的外接矩形。
   * 线条含描边。没有这些时和 `box` 重合。祖先的旋转不算。
   */
  ink: LayerBox
  /** 这一层写了 `<mask>` 时，蒙版画成位图之后的面积、外接矩形、碎片数和软边宽度。 */
  mask?: PlacedMask
}

/** 只计入缩放。旋转留在节点上，和文字坐标同一套，避免把水平基线折成斜线。 */
function nodePose(node: LayoutNode, atX: number, atY: number): Matrix {
  if (node.scaleX === 1 && node.scaleY === 1) return IDENTITY
  const pivot = originOffset(node.origin, node.width, node.height)
  return aroundPivot(atX + pivot.x, atY + pivot.y, 0, node.scaleX, node.scaleY)
}

/** 子元素所在的坐标系：先做这一层自己的缩放，再移到内容原点。根层的变换留给调用方。 */
function childSpace(node: LayoutNode, space: Matrix, isRoot: boolean): Matrix {
  if (node.kind !== 'layer' && node.kind !== 'flex') return space
  const border = node.border?.width ?? 0
  const insetX = node.kind === 'flex' ? node.padding.left + border : 0
  const insetY = node.kind === 'flex' ? node.padding.top + border : 0
  const origin = translated((isRoot ? 0 : node.x) + insetX, (isRoot ? 0 : node.y) + insetY)
  if (isRoot) return multiply(space, origin)
  return multiply(space, multiply(nodePose(node, node.x, node.y), origin))
}

function layerBox(visual: Box): LayerBox {
  return {
    left: visual.x,
    top: visual.y,
    right: visual.x + visual.width,
    bottom: visual.y + visual.height,
    width: visual.width,
    height: visual.height,
  }
}

/** 把节点局部盒子变到父级内容坐标，再乘上父级空间。`rotate` 为真时带上这一元素自己的旋转。 */
function mapLocal(node: LayoutNode, space: Matrix, local: Box, rotate: boolean): LayerBox {
  const pivot = originOffset(node.origin, node.width, node.height)
  const pose = rotate
    ? aroundPivot(node.x + pivot.x, node.y + pivot.y, node.rotate, node.scaleX, node.scaleY)
    : nodePose(node, node.x, node.y)
  const visual = applyToBox(multiply(space, pose), {
    x: node.x + local.x,
    y: node.y + local.y,
    width: local.width,
    height: local.height,
  })
  return layerBox(visual)
}

function pushElement(node: LayoutNode, space: Matrix, found: PlacedElement[]) {
  const entry: PlacedElement = {
    path: node.path.replace(/^layer\//, ''),
    tag: node.tag,
    box: mapLocal(node, space, { x: 0, y: 0, width: node.width, height: node.height }, false),
    ink: mapLocal(node, space, node.ink, true),
  }
  if (node.id) entry.id = node.id
  const mask = placedMaskOf(node, (ink) => mapLocal(node, space, ink, false))
  if (mask) entry.mask = mask
  found.push(entry)
}

function placedMaskOf(node: LayoutNode, place: (ink: Box) => LayerBox): PlacedMask | undefined {
  if (node.kind !== 'layer' || !node.mask?.length) return undefined
  const stats = maskStats(node.mask, node.width, node.height, {
    feather: node.maskFeather,
    invert: node.maskInvert,
  })
  if (!stats) return undefined
  return { ...stats, ink: stats.ink ? place(stats.ink) : null }
}

/** 根层自己的 mask。坐标和 `elements` 同一套，根层的缩放已经算进去。 */
export function placedRootMask(root: LayoutNode): PlacedMask | undefined {
  return placedMaskOf(root, (ink) => layerBox(applyToBox(nodePose(root, 0, 0), ink)))
}

function visit(node: LayoutNode, space: Matrix, isRoot: boolean, found: PlacedElement[]) {
  if (!isRoot) pushElement(node, space, found)
  if (node.kind === 'layer' || node.kind === 'flex') {
    const next = childSpace(node, space, isRoot)
    for (const child of node.children) visit(child, next, false, found)
    return
  }
  if (node.kind === 'group') {
    const next = multiply(multiply(space, nodePose(node, node.x, node.y)), node.svg)
    for (const child of node.children) visit(child, next, false, found)
  }
}

/**
 * 这一层里每个排进去的元素。根层自己不在里面，`mask`、`symbol`、`draw` 也不在。
 * 坐标在根层布局盒里。只写宽或高时，比例已经乘进根层的 `scale`。
 */
export function placedElements(root: LayoutNode): PlacedElement[] {
  const found: PlacedElement[] = []
  visit(root, nodePose(root, 0, 0), true, found)
  return found
}
