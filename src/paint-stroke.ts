import type { Canvas, CanvasRenderingContext2D, SKRSContext2D } from '@napi-rs/canvas'
import { bandCoverage, distanceToSites, outerEdgeFade } from './distance-field.js'
import { parseColor } from './gradientField.js'
import type { PaintState } from './paint.js'
import { hasBorder, outerInkStrokeReach } from './style.js'
import type { Box, InkStrokeSpec, LayoutNode } from './types.js'

type PaintCtx = SKRSContext2D
type StrokeBand = { inner: number; outer: number; color: string; side: 'out' | 'in' }
type RasterUser = { canvas: Canvas; x: number; y: number }
type RasterScreen = RasterUser & { scale: number; sample: number; dw: number; dh: number }

export type StrokeHost = {
  drawInkMask(ctx: PaintCtx, node: LayoutNode, isTop: boolean, state?: PaintState): void
  drawNodeInk(ctx: CanvasRenderingContext2D, node: LayoutNode, spread: number, ink?: string): void
  groupInkBounds(node: LayoutNode, state?: PaintState): Box | null
  leafInkBounds(node: LayoutNode): Box
  rasterizeUser(bounds: Box, draw: (ctx: PaintCtx) => void): RasterUser | null
  rasterizeOnScreen(
    matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
    bounds: Box,
    draw: (ctx: PaintCtx) => void,
    samples?: number,
  ): RasterScreen | null
  blitCoverage(
    ctx: PaintCtx,
    originX: number,
    originY: number,
    alpha: Uint8ClampedArray,
    w: number,
    h: number,
    color: string,
    gradientBox: Box | null,
    screen?: { matrix: { a: number; b: number; c: number; d: number; e: number; f: number }; cover: Box; sample: number; dw: number; dh: number },
  ): void
  transformTurns(matrix: { b: number; c: number }): boolean
  inkNeedsScreen(node: LayoutNode): boolean
}

let host: StrokeHost | null = null

export function bindStroke(next: StrokeHost): void {
  host = next
}

function collectStrokeBands(layers: InkStrokeSpec[], phase: 'outer' | 'inner'): StrokeBand[] {
  const bands: StrokeBand[] = []
  const take = (position: InkStrokeSpec['position'], side: 'out' | 'in', scale: number) => {
    let prev = 0
    for (const layer of layers) {
      if (layer.position !== position) continue
      bands.push({ inner: prev * scale, outer: layer.width * scale, color: layer.color, side })
      prev = layer.width
    }
  }
  if (phase === 'outer') {
    take('outside', 'out', 1)
    take('center', 'out', 0.5)
  } else {
    take('inside', 'in', 1)
    take('center', 'in', 0.5)
  }
  bands.sort((a, b) => b.outer - a.outer)
  return bands.filter((band) => band.outer > band.inner + 1e-3)
}

/** 填充会盖住描边内缘。全透明时内缘露在外面。 */
function colorAlpha(color: string | undefined): number | null {
  if (color == null) return null
  const t = color.trim().toLowerCase()
  if (t === '' || t === 'none' || t === 'transparent') return 0
  const parsed = parseColor(t)
  if (!parsed) return null
  return parsed.a / 255
}

function plateCovers(node: LayoutNode): boolean {
  const background = node.background
  if (background != null && background !== 'transparent' && background !== 'none') {
    const alpha = colorAlpha(background)
    if (alpha == null || alpha > 0.004) return true
  }
  return hasBorder(node.border)
}

function inkCoversStroke(node: LayoutNode): boolean {
  switch (node.kind) {
    case 'text': {
      if (plateCovers(node)) return true
      for (const line of node.textLayout.lines) {
        for (const seg of line.segments) {
          if (!seg.text) continue
          const alpha = colorAlpha(seg.style.fill ?? seg.style.color)
          if (alpha == null || alpha > 0.004) return true
        }
      }
      return false
    }
    case 'shape':
    case 'line': {
      const alpha = colorAlpha(node.fill)
      return alpha == null || alpha > 0.004
    }
    case 'image':
    case 'canvas':
    case 'mesh':
    case 'ground':
      return true
    case 'custom':
      return plateCovers(node)
    case 'layer':
    case 'flex':
    case 'group':
      if (plateCovers(node)) return true
      return node.children.some(inkCoversStroke)
    default: {
      const unreachable: never = node
      return unreachable
    }
  }
}

/** 内外两条环带在轮廓上相遇，而且是同一种颜色。接缝藏在描边中间，不该再被盖住率劈开。 */
function contourSeam(bands: StrokeBand[]): boolean {
  let outside: StrokeBand | null = null
  let inside: StrokeBand | null = null
  for (const band of bands) {
    if (band.inner > 1e-3) continue
    if (band.side === 'out') outside = band
    else inside = band
  }
  return outside != null && inside != null && outside.color === inside.color
}

/** 把外侧描边的不透明度扩进墨迹，只盖住填充的抗锯齿边，不改外缘。 */
function tuckStrokeUnderInk(alpha: Uint8ClampedArray, src: Uint8ClampedArray, w: number, h: number, radius: number) {
  const tmp = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let m = 0
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w - 1, x + radius)
      for (let xx = x0; xx <= x1; xx++) {
        const v = alpha[row + xx]!
        if (v > m) m = v
      }
      tmp[row + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x
      if (src[i * 4 + 3]! === 0) continue
      let m = 0
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(h - 1, y + radius)
      for (let yy = y0; yy <= y1; yy++) {
        const v = tmp[yy * w + x]!
        if (v > m) m = v
      }
      if (m > alpha[i]!) alpha[i] = m
    }
  }
}

export function paintInkStrokes(
  ctx: PaintCtx,
  node: LayoutNode,
  phase: 'outer' | 'inner',
  source?: { bounds: Box; draw: (ctx: PaintCtx) => void },
  state?: PaintState,
) {
  const api = host
  if (!api) throw new Error('描边模块还没接上绘制')
  const layers = node.inkStroke
  if (!layers?.length) return
  const bands = collectStrokeBands(layers, phase)
  if (bands.length === 0) return
  const subtree = node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group'
  const base = source?.bounds ?? (subtree ? api.groupInkBounds(node, state) : api.leafInkBounds(node))
  if (!base || base.width <= 0 || base.height <= 0) return
  const reach = phase === 'outer' ? outerInkStrokeReach(layers) : 2
  const pad = Math.ceil(Math.max(reach, 2)) + 2
  const user: Box = { x: base.x - pad, y: base.y - pad, width: base.width + pad * 2, height: base.height + pad * 2 }
  const draw = (octx: PaintCtx) => {
    if (source) source.draw(octx)
    else if (subtree) api.drawInkMask(octx, node, true, state)
    else api.drawNodeInk(octx, node, 0, '#ffffff')
  }
  const matrix = ctx.getTransform()
  const pixelScale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1
  const covers = inkCoversStroke(node)
  // 旋转、空心、以及不是 1:1 的缩放，都在屏幕像素里算距离。空心和旋转再超采样，避免二值轮廓的台阶被放大。
  const fine = api.transformTurns(matrix) || api.inkNeedsScreen(node) || !covers
  const needsScreen = fine || Math.abs(pixelScale - 1) > 1e-3
  const turned = needsScreen ? api.rasterizeOnScreen(matrix, user, draw, fine ? undefined : 1) : null
  const axis = turned ? null : api.rasterizeUser(user, draw)
  const raster = turned ?? (axis ? { canvas: axis.canvas, x: axis.x, y: axis.y, scale: 1 } : null)
  if (!raster) return
  const { canvas, x, y, scale } = raster
  const w = canvas.width
  const h = canvas.height
  const src = (canvas.getContext('2d') as PaintCtx).getImageData(0, 0, w, h).data
  const inkAt = (i: number) => src[i * 4 + 3]! >= 128
  const outside = bands.some((band) => band.side === 'out') ? distanceToSites(inkAt, w, h, 0) : null
  const inside = bands.some((band) => band.side === 'in') ? distanceToSites((i) => !inkAt(i), w, h, 0) : null
  const box: Box = { x: node.x, y: node.y, width: node.width, height: node.height }
  const screen = turned
    ? { matrix, cover: user, sample: turned.sample, dw: turned.dw, dh: turned.dh }
    : undefined
  const seam = contourSeam(bands)
  for (const band of bands) {
    const field = band.side === 'out' ? outside : inside
    if (!field) continue
    const inner = band.inner * scale
    const outer = band.outer * scale
    const openEdge = !covers && !seam && band.inner <= 1e-3
    const alpha = new Uint8ClampedArray(w * h)
    for (let i = 0; i < w * h; i++) {
      let cover: number
      if (openEdge) {
        const fade = outerEdgeFade(field[i]!, outer)
        const glyph = src[i * 4 + 3]! / 255
        // 内缘跟着字形覆盖，不在 50% 阈值上切一刀。填充会盖住这条边时不走这里。
        cover = band.side === 'out' ? fade * (1 - glyph) : fade * glyph
      } else {
        cover = bandCoverage(field[i]!, inner, outer)
        if (band.side === 'in' && (covers || !seam)) cover *= src[i * 4 + 3]! / 255
      }
      if (cover <= 0) continue
      const a = Math.round(255 * cover)
      if (a > 0) alpha[i] = a
    }
    // 填充的抗锯齿边要压在描边上。超采样后这条边不落在像素网格上，垫进大约 1 个屏幕像素，黑底才不会从缝里露出来。
    if (turned && covers && band.side === 'out' && turned.sample > 1) {
      tuckStrokeUnderInk(alpha, src, w, h, Math.max(1, Math.round(turned.sample)))
    }
    api.blitCoverage(ctx, x, y, alpha, w, h, band.color, box, screen)
  }
}
