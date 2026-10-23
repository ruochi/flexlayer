import { initFontsForMeasure, setFontsCacheDir } from './fonts.js'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { IDENTITY, absoluteNodeMatrix, apply, invert, multiply, translated, type Matrix } from './matrix.js'
import type { LayerNode } from './parse.js'
import { flexContentInset, overflowClips } from './style.js'
import type { Issue, LayoutNode } from './types.js'
import { viewMatrix } from './view.js'

/** 根画布上的像素。y 向下。不随 `--scale` 放大。 */
export type PickPoint = { x: number; y: number }

export type PickHit = {
  path: string
  id?: string
  tag: string
  /** 布局盒左上角为原点。 */
  localX: number
  localY: number
  /** 离观众的距离，像素。平面元素没有镜头时是 0，更远的 z 更大。 */
  depth: number
}

export type PickOptions = {
  baseDir?: string
  fontsCacheDir?: string
}

export type PickResult = {
  hit: PickHit | null
  issues: Issue[]
}

type Clip = { toLocal: Matrix; width: number; height: number }

function insideClips(clips: Clip[], x: number, y: number): boolean {
  for (const clip of clips) {
    const [lx, ly] = apply(clip.toLocal, x, y)
    if (lx < -1e-3 || ly < -1e-3 || lx > clip.width + 1e-3 || ly > clip.height + 1e-3) return false
  }
  return true
}

function depthOf(node: LayoutNode): number {
  const z = node.z ?? 0
  return z > 0 ? 0 : -z
}

function contentMatrix(node: LayoutNode, posed: Matrix): Matrix {
  if (node.kind === 'group') return multiply(posed, node.svg)
  const inset = flexContentInset(node)
  let content = multiply(posed, translated(node.x + inset.x, node.y + inset.y))
  if (node.kind === 'layer' && node.view) content = multiply(content, viewMatrix(node.width, node.height, node.view))
  return content
}

/**
 * 用和绘制相同的矩阵链做命中。后画的、深度差在 0.5px 以内的元素胜出。
 * 布局盒算命中，字形间隙也算。线的盒子按墨迹扩一圈。
 */
export function pickNode(root: LayoutNode, at: PickPoint): PickHit | null {
  const found: { hit: PickHit | null; order: number } = { hit: null, order: 0 }
  let order = 0
  const visit = (node: LayoutNode, parent: Matrix, clips: Clip[], shown: number) => {
    const opacity = shown * node.opacity
    if (opacity < 0.01) return
    if (!insideClips(clips, at.x, at.y)) return
    const posed = multiply(parent, absoluteNodeMatrix(node))
    const inv = invert(posed)
    if (!inv) return
    order += 1
    const [px, py] = apply(inv, at.x, at.y)
    const localX = px - node.x
    const localY = py - node.y
    let x0 = 0
    let y0 = 0
    let x1 = node.width
    let y1 = node.height
    if (node.kind === 'line') {
      x0 = Math.min(0, node.ink.x)
      y0 = Math.min(0, node.ink.y)
      x1 = Math.max(node.width, node.ink.x + node.ink.width)
      y1 = Math.max(node.height, node.ink.y + node.ink.height)
    }
    if (localX >= x0 - 1e-3 && localY >= y0 - 1e-3 && localX <= x1 + 1e-3 && localY <= y1 + 1e-3) {
      const hit: PickHit = {
        path: node.path,
        ...(node.id ? { id: node.id } : {}),
        tag: node.tag,
        localX,
        localY,
        depth: depthOf(node),
      }
      const paintOrder = order
      const current = found.hit
      const nearer = current != null && hit.depth < current.depth - 0.5
      const samePlane = current == null || Math.abs(hit.depth - current.depth) <= 0.5
      if (current == null || nearer || (samePlane && paintOrder >= found.order)) {
        found.hit = hit
        found.order = paintOrder
      }
    }
    const next = clips.slice()
    if ((node.kind === 'layer' && (node.overflow === 'hidden' || node.view)) || overflowClips(node)) {
      const toBox = invert(multiply(posed, translated(node.x, node.y)))
      if (toBox) next.push({ toLocal: toBox, width: node.width, height: node.height })
    }
    if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
      const content = contentMatrix(node, posed)
      for (const child of node.children) visit(child, content, next, opacity)
    }
  }
  visit(root, IDENTITY, [], 1)
  return found.hit
}

/** 排版后按画布像素拾取。没有命中时 `hit` 是 null，这不是错误。 */
export async function pickLayer(source: string | LayerNode, at: PickPoint, options: PickOptions = {}): Promise<PickResult> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  return { hit: pickNode(doc.root, at), issues: doc.issues }
}
