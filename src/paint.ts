import {
  createCanvas,
  type Canvas,
  type CanvasRenderingContext2D,
  type ImageData,
} from '@napi-rs/canvas'

type PaintCtx = CanvasRenderingContext2D & {
  canvas: Canvas
  filter: string
  drawImage(...args: unknown[]): void
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData
  putImageData(imageData: ImageData, dx: number, dy: number): void
  createImageData(sw: number, sh: number): ImageData
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { addColorStop(offset: number, color: string): void }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number }
  imageSmoothingEnabled: boolean
}
import { applyCanvasFont } from './fonts.js'
import { backdropFilters, filtersPad, getFilter, orderedFilters } from './filter.js'
import { fitImageRect } from './image.js'
import { canvasPaint, isGradient } from './gradient.js'
import { gradientStyle, isGradientPaint, type GradientBox } from './gradientField.js'
import { applyToBox, aroundPivot, IDENTITY, intersectBox, invert, multiply, originOffset, translated, type Matrix } from './matrix.js'
import { invalidDrawIssue } from './draw-tag.js'
import { openSvgPath } from './path.js'
import { cameraItems, projectOnLayer } from './camera.js'
import { ownsMeshScene, renderMeshLayer, type MeshFrame } from './mesh.js'
import { behindCamera, cameraSceneCustom, drawTexturedPlane, has3dPose, hasPerspective, PERSPECTIVE_AA, planeDepth, posePoint, project, resolveSamples, type Perspective } from './perspective.js'
import { compositeMask } from './mask-compose.js'
import { outerInkStrokeReach } from './style.js'
import { layoutScale, viewMatrix } from './view.js'
import { unionBoxes, type AppliedFilter, type Box,
  GlassSpec,
  GlowSpec,
  ImageLayoutNode,
  InkStrokeSpec,
  LayerLayoutNode,
  LayoutNode,
  type MaskOpReport,
  LineLayoutNode,
  NoiseSpec,
  OverlaySpec,
  ShadowSpec,
  ShapeLayoutNode,
  TextLayoutNode,
  type Issue,
} from './types.js'
import type { DrawElSnapshot } from './types.js'

export type PaintOptions = {
  width: number
  height: number
  background: string
  scale: number
  debug: boolean
  t: number
  frame?: number
  fps?: number
  /** 绘制时 `<draw>` 抛错写到这里，不中断其余内容。 */
  issues?: Issue[]
  /** 网格超采样。1、2 或 4，缺省 4。 */
  meshSamples?: 1 | 2 | 4
  /** 网格场景缓存上限，字节。false 关闭。 */
  meshCache?: number | false
}

type PaintState = {
  canvasWidth: number
  canvasHeight: number
  meshFrames?: Map<LayerLayoutNode, MeshFrame>
  frame: number
  fps: number
  issues: Issue[]
  /** 平面位图的超采样倍数。blur 按这个倍数画进位图，缩回后仍是作者写的半径。 */
  supersample?: number
}

const SILHOUETTE = '#000000'

function paintOf(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  pad = 0,
) {
  if (isGradientPaint(value)) {
    const box: GradientBox = { x, y, width: w, height: h }
    return gradientStyle(ctx, value, box, pad)
  }
  return canvasPaint(ctx, value, x, y, w, h)
}

function shapePad(node: ShapeLayoutNode): number {
  return node.stroke !== 'none' && node.strokeWidth > 0 ? node.strokeWidth / 2 + 2 : 1
}

function linePad(node: LineLayoutNode): number {
  const stroked = node.stroke !== 'none' && node.strokeWidth > 0
  if (!stroked) return 1
  let pad = node.strokeWidth / 2 + 2
  return pad
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rx: number, ry = rx) {
  // 只写一个半径时两角一样，收成圆角胶囊。分别写了 rx、ry 才按椭圆角各自钳制。
  // 圆弧用平台的 arc / ellipse。二次贝塞尔在半径等于半边时画不成正圆。
  const same = Math.abs(rx - ry) < 0.01
  const rrx = same ? Math.min(Math.max(rx, 0), w / 2, h / 2) : Math.min(Math.max(rx, 0), w / 2)
  const rry = same ? rrx : Math.min(Math.max(ry, 0), h / 2)
  if (rrx <= 0.01 && rry <= 0.01) {
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    return
  }
  if (Math.abs(w - h) < 0.05 && Math.abs(rrx * 2 - w) < 0.05 && Math.abs(rry * 2 - h) < 0.05) {
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + rrx, y)
  ctx.lineTo(x + w - rrx, y)
  ctx.ellipse(x + w - rrx, y + rry, Math.max(rrx, 0.01), Math.max(rry, 0.01), 0, -Math.PI / 2, 0)
  ctx.lineTo(x + w, y + h - rry)
  ctx.ellipse(x + w - rrx, y + h - rry, Math.max(rrx, 0.01), Math.max(rry, 0.01), 0, 0, Math.PI / 2)
  ctx.lineTo(x + rrx, y + h)
  ctx.ellipse(x + rrx, y + h - rry, Math.max(rrx, 0.01), Math.max(rry, 0.01), 0, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + rry)
  ctx.ellipse(x + rrx, y + rry, Math.max(rrx, 0.01), Math.max(rry, 0.01), 0, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}

function drawBoxChrome(ctx: CanvasRenderingContext2D, node: LayoutNode) {
  if (node.background && node.background !== 'transparent') {
    ctx.fillStyle = paintOf(ctx, node.background, node.x, node.y, node.width, node.height)
    if (node.borderRadius && node.borderRadius > 0) {
      roundRectPath(ctx, node.x, node.y, node.width, node.height, node.borderRadius)
      ctx.fill()
    } else {
      ctx.fillRect(node.x, node.y, node.width, node.height)
    }
  }
  if (node.border && node.border.width > 0) {
    ctx.strokeStyle = node.border.color
    ctx.lineWidth = node.border.width
    if (node.borderRadius && node.borderRadius > 0) {
      roundRectPath(ctx, node.x, node.y, node.width, node.height, node.borderRadius)
      ctx.stroke()
    } else {
      ctx.strokeRect(node.x + node.border.width / 2, node.y + node.border.width / 2, node.width - node.border.width, node.height - node.border.width)
    }
  }
}

function drawImageNode(ctx: CanvasRenderingContext2D, node: ImageLayoutNode, recolor?: string) {
  const bw = node.border?.width ?? 0
  const boxX = node.x + node.padding.left + bw
  const boxY = node.y + node.padding.top + bw
  const boxW = node.width - node.padding.left - node.padding.right - bw * 2
  const boxH = node.height - node.padding.top - node.padding.bottom - bw * 2
  const bitmap = node.bitmap
  if (!bitmap || boxW <= 0 || boxH <= 0) return
  const dest = fitImageRect(boxW, boxH, bitmap.width, bitmap.height, node.objectFit, node.objectPosition)
  ctx.save()
  if (node.borderRadius && node.borderRadius > 0) {
    roundRectPath(ctx, node.x, node.y, node.width, node.height, node.borderRadius)
    ctx.clip()
  }
  ctx.beginPath()
  ctx.rect(boxX, boxY, boxW, boxH)
  ctx.clip()
  const paint = ctx as PaintCtx
  if (node.maskPick) paint.imageSmoothingEnabled = false
  if (recolor) {
    const tw = Math.max(1, Math.ceil(boxW))
    const th = Math.max(1, Math.ceil(boxH))
    const off = createCanvas(tw, th)
    const octx = off.getContext('2d') as PaintCtx
    octx.drawImage(bitmap, dest.x, dest.y, dest.width, dest.height)
    octx.globalCompositeOperation = 'source-in'
    octx.fillStyle = recolor
    octx.fillRect(0, 0, tw, th)
    paint.drawImage(off, boxX, boxY, boxW, boxH)
  } else {
    paint.drawImage(bitmap, boxX + dest.x, boxY + dest.y, dest.width, dest.height)
  }
  ctx.restore()
}

type PaintBox = { x: number; y: number; width: number; height: number }

/** 单行蒙版的设备像素上限。更大时退回直接填充，避免一张离屏盖住整页。 */
const TEXT_MASK_LIMIT = 8192

function samePaint(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim() === (b ?? '').trim()
}

/** 写在文字盒子上的 fill 按整段盒子取样；行内自己的 fill 用调用方给出的行盒。 */
function textPaintBox(node: TextLayoutNode, paint: string, fragment: PaintBox): PaintBox {
  const declared = node.style.fill?.trim()
  if (declared && samePaint(declared, paint) && node.width > 0 && node.height > 0) {
    return { x: node.x, y: node.y, width: node.width, height: node.height }
  }
  return fragment
}

function runBox(
  segments: Array<{ x: number; width: number; style: { color: string; background?: string; fill?: string } }>,
  index: number,
  valueAt: (style: { color: string; background?: string; fill?: string }) => string | undefined,
  contentX: number,
  offsetX: number,
  lineTop: number,
  lineHeight: number,
): PaintBox {
  const value = valueAt(segments[index]!.style)
  let start = index
  while (start > 0 && samePaint(valueAt(segments[start - 1]!.style), value)) start--
  let end = index + 1
  while (end < segments.length && samePaint(valueAt(segments[end]!.style), value)) end++
  let minX = Infinity
  let maxX = -Infinity
  for (let i = start; i < end; i++) {
    const x = contentX + offsetX + segments[i]!.x
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x + segments[i]!.width)
  }
  return {
    x: Number.isFinite(minX) ? minX : contentX + offsetX,
    y: lineTop,
    width: Math.max((Number.isFinite(maxX) ? maxX : minX + 1) - minX, 1),
    height: Math.max(lineHeight, 1),
  }
}

/**
 * 渐变不要直接交给 fillText。倍率不是 1 时，着色器会把字画偏，并且缩成大约一半。
 * 字形先画成实色蒙版，渐变只铺在矩形上，再按设备像素 1:1 贴回当前画布。
 */
function fillTextPaint(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  color: string,
  box: PaintBox,
  fontSize: number,
) {
  if (!text || !isGradient(color)) {
    ctx.fillStyle = color
    ctx.fillText(text, x, baseline)
    return
  }
  const metrics = ctx.measureText(text)
  const pad = Math.max(4, fontSize * 0.2)
  const left = metrics.actualBoundingBoxLeft
  const right = metrics.actualBoundingBoxRight > 0 ? metrics.actualBoundingBoxRight : metrics.width
  const ascent = metrics.actualBoundingBoxAscent > 0 ? metrics.actualBoundingBoxAscent : fontSize * 0.8
  const descent = metrics.actualBoundingBoxDescent > 0 ? metrics.actualBoundingBoxDescent : fontSize * 0.2
  const gx = x - left - pad
  const gy = baseline - ascent - pad
  const gw = Math.max(1, left + right + pad * 2)
  const gh = Math.max(1, ascent + descent + pad * 2)
  const paint = ctx as PaintCtx
  const tr = paint.getTransform()
  const corners: Array<[number, number]> = [
    [gx, gy],
    [gx + gw, gy],
    [gx + gw, gy + gh],
    [gx, gy + gh],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [px, py] of corners) {
    const dx = tr.a * px + tr.c * py + tr.e
    const dy = tr.b * px + tr.d * py + tr.f
    minX = Math.min(minX, dx)
    minY = Math.min(minY, dy)
    maxX = Math.max(maxX, dx)
    maxY = Math.max(maxY, dy)
  }
  const ox = Math.floor(minX) - 1
  const oy = Math.floor(minY) - 1
  const dw = Math.ceil(maxX) - ox + 1
  const dh = Math.ceil(maxY) - oy + 1
  if (!(dw > 0) || !(dh > 0) || dw > TEXT_MASK_LIMIT || dh > TEXT_MASK_LIMIT || dw * dh > 8_000_000) {
    ctx.fillStyle = paintOf(ctx, color, box.x, box.y, Math.max(box.width, 1), Math.max(box.height, 1))
    ctx.fillText(text, x, baseline)
    return
  }
  const mask = createCanvas(dw, dh)
  const mctx = mask.getContext('2d')
  mctx.setTransform(tr.a, tr.b, tr.c, tr.d, tr.e - ox, tr.f - oy)
  mctx.font = ctx.font
  mctx.fontVariationSettings = ctx.fontVariationSettings
  mctx.letterSpacing = ctx.letterSpacing
  mctx.textAlign = ctx.textAlign
  mctx.textBaseline = ctx.textBaseline
  mctx.direction = ctx.direction
  mctx.fillStyle = '#000000'
  mctx.fillText(text, x, baseline)

  const off = createCanvas(dw, dh)
  const octx = off.getContext('2d')
  octx.setTransform(tr.a, tr.b, tr.c, tr.d, tr.e - ox, tr.f - oy)
  octx.fillStyle = paintOf(octx, color, box.x, box.y, Math.max(box.width, 1), Math.max(box.height, 1))
  octx.fillRect(gx, gy, gw, gh)
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(mask, 0, 0)

  ctx.save()
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    paint.drawImage(off, ox, oy)
  } finally {
    ctx.restore()
  }
}

function drawTextNode(ctx: CanvasRenderingContext2D, node: TextLayoutNode, inkColor?: string) {
  const border = node.border?.width ?? 0
  const contentX = node.x + node.padding.left + border
  const contentY = node.y + node.padding.top + border
  const innerW = node.width - node.padding.left - node.padding.right - border * 2
  for (const line of node.textLayout.lines) {
    let offsetX = 0
    if (node.textAlign === 'center') offsetX = (innerW - line.width) / 2
    if (node.textAlign === 'right') offsetX = innerW - line.width
    const lineTop = contentY + line.y
    for (let segIndex = 0; segIndex < line.segments.length; segIndex++) {
      const seg = line.segments[segIndex]!
      const x = contentX + offsetX + seg.x
      const glyphRun = runBox(line.segments, segIndex, (style) => style.fill?.trim() || style.color, contentX, offsetX, lineTop, line.height)
      const backgroundRun = runBox(line.segments, segIndex, (style) => style.background, contentX, offsetX, lineTop, line.height)
      const background = seg.style.background
      if (!inkColor && background && background !== 'transparent' && background !== 'none' && seg.width > 0 && line.height > 0) {
        ctx.fillStyle = paintOf(ctx, background, backgroundRun.x, backgroundRun.y, backgroundRun.width, backgroundRun.height)
        ctx.fillRect(x, lineTop, seg.width, line.height)
      }
      if (!seg.text) continue
      applyCanvasFont(ctx, seg.style.fontFamily, seg.style.fontWeight, seg.style.fontSize, seg.style.fontStyle)
      ctx.letterSpacing = `${seg.style.letterSpacing}px`
      const color = inkColor ?? seg.style.fill ?? seg.style.color
      const box = inkColor ? glyphRun : textPaintBox(node, color, glyphRun)
      fillTextPaint(ctx, seg.text, x, contentY + line.baselineY, color, box, seg.style.fontSize)
      if (seg.style.underline) {
        const y = contentY + line.baselineY + Math.max(1, seg.style.fontSize * 0.12)
        ctx.strokeStyle =
          !inkColor && isGradient(color) ? paintOf(ctx, color, box.x, box.y, Math.max(box.width, 1), Math.max(box.height, 1)) : color
        ctx.lineWidth = Math.max(1, seg.style.fontSize / 16)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + seg.width, y)
        ctx.stroke()
      }
    }
  }
  for (const image of node.inlines ?? []) {
    const placed = { ...image, x: node.x + image.x, y: node.y + image.y }
    drawBoxChrome(ctx, placed)
    drawImageNode(ctx, placed)
  }
}

function strokeDashed(ctx: CanvasRenderingContext2D, dash: number[] | undefined, draw: () => void) {
  if (dash?.length) ctx.setLineDash(dash)
  draw()
  if (dash?.length) ctx.setLineDash([])
}

function drawShape(ctx: CanvasRenderingContext2D, node: ShapeLayoutNode) {
  const x = node.x
  const y = node.y
  const pad = shapePad(node)
  if (node.shape === 'rect') {
    const rx = node.rx ?? 0
    const ry = node.ry ?? rx
    if (rx > 0 || ry > 0) {
      roundRectPath(ctx, x, y, node.width, node.height, rx, ry)
      if (node.fill !== 'none') {
        ctx.fillStyle = paintOf(ctx, node.fill, node.x, node.y, node.width, node.height, pad)
        ctx.fill()
      }
      if (node.stroke !== 'none') {
        ctx.strokeStyle = paintOf(ctx, node.stroke, node.x, node.y, node.width, node.height, pad)
        ctx.lineWidth = node.strokeWidth
        strokeDashed(ctx, node.dash, () => ctx.stroke())
      }
    } else {
      if (node.fill !== 'none') {
        ctx.fillStyle = paintOf(ctx, node.fill, node.x, node.y, node.width, node.height, pad)
        ctx.fillRect(x, y, node.width, node.height)
      }
      if (node.stroke !== 'none') {
        ctx.strokeStyle = paintOf(ctx, node.stroke, node.x, node.y, node.width, node.height, pad)
        ctx.lineWidth = node.strokeWidth
        strokeDashed(ctx, node.dash, () => ctx.strokeRect(x, y, node.width, node.height))
      }
    }
  } else if (node.shape === 'circle') {
    ctx.beginPath()
    ctx.arc(x + node.width / 2, y + node.height / 2, node.r ?? node.width / 2, 0, Math.PI * 2)
    if (node.fill !== 'none') {
      ctx.fillStyle = paintOf(ctx, node.fill, node.x, node.y, node.width, node.height, pad)
      ctx.fill()
    }
    if (node.stroke !== 'none') {
      ctx.strokeStyle = paintOf(ctx, node.stroke, node.x, node.y, node.width, node.height, pad)
      ctx.lineWidth = node.strokeWidth
      strokeDashed(ctx, node.dash, () => ctx.stroke())
    }
  } else {
    ctx.beginPath()
    ctx.ellipse(
      x + node.width / 2,
      y + node.height / 2,
      node.rxEllipse ?? node.width / 2,
      node.ry ?? node.height / 2,
      0,
      0,
      Math.PI * 2,
    )
    if (node.fill !== 'none') {
      ctx.fillStyle = paintOf(ctx, node.fill, node.x, node.y, node.width, node.height, pad)
      ctx.fill()
    }
    if (node.stroke !== 'none') {
      ctx.strokeStyle = paintOf(ctx, node.stroke, node.x, node.y, node.width, node.height, pad)
      ctx.lineWidth = node.strokeWidth
      strokeDashed(ctx, node.dash, () => ctx.stroke())
    }
  }
}

function drawLine(ctx: CanvasRenderingContext2D, node: LineLayoutNode, silhouette = false, spread = 0) {
  ctx.save()
  ctx.translate(node.x, node.y)
  const stroked = node.stroke !== 'none' && node.strokeWidth > 0
  const lineWidth = silhouette ? Math.max(0.5, node.strokeWidth + spread * 2) : node.strokeWidth
  const pad = linePad(node)
  if (silhouette) {
    ctx.strokeStyle = SILHOUETTE
    ctx.fillStyle = SILHOUETTE
    ctx.lineWidth = lineWidth
  } else if (stroked) {
    ctx.strokeStyle = paintOf(ctx, node.stroke, 0, 0, node.width, node.height, pad)
    ctx.fillStyle = paintOf(ctx, node.stroke, 0, 0, node.width, node.height, pad)
    ctx.lineWidth = node.strokeWidth
  }
  ctx.lineCap = node.strokeLinecap ?? 'round'
  ctx.lineJoin = node.strokeLinejoin ?? 'round'
  if (node.dash?.length) ctx.setLineDash(node.dash)
  const g = node.geometry
  if (g.kind === 'line') {
    if (!stroked) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(g.x1, g.y1)
    ctx.lineTo(g.x2, g.y2)
    ctx.stroke()
  } else if (g.kind === 'polyline') {
    if (g.points.length < 2 || !stroked) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(g.points[0]!.x, g.points[0]!.y)
    for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i]!.x, g.points[i]!.y)
    ctx.stroke()
  } else if (g.kind === 'polygon') {
    if (g.points.length < 3) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(g.points[0]!.x, g.points[0]!.y)
    for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i]!.x, g.points[i]!.y)
    ctx.closePath()
    if (node.fill !== 'none') {
      if (!silhouette) ctx.fillStyle = paintOf(ctx, node.fill, 0, 0, node.width, node.height, pad)
      ctx.fill()
    }
    if (stroked) ctx.stroke()
  } else if (g.kind === 'path') {
    const opened = openSvgPath(g.d)
    if ('error' in opened) {
      ctx.restore()
      return
    }
    const p = opened.path
    if (node.fill !== 'none') {
      if (!silhouette) ctx.fillStyle = paintOf(ctx, node.fill, 0, 0, node.width, node.height, pad)
      ctx.fill(p)
    }
    if (stroked) ctx.stroke(p)
  } else {
    // 未知线条类型
  }
  ctx.restore()
}

function drawDebugOverlay(ctx: CanvasRenderingContext2D, node: LayoutNode) {
  ctx.save()
  const k = transformScale(ctx)
  ctx.strokeStyle = 'rgba(0, 120, 255, 0.85)'
  ctx.lineWidth = 1 / k
  ctx.strokeRect(node.x + 0.5 / k, node.y + 0.5 / k, node.width, node.height)
  ctx.strokeStyle = 'rgba(255, 40, 40, 0.85)'
  ctx.strokeRect(node.x + node.ink.x + 0.5 / k, node.y + node.ink.y + 0.5 / k, node.ink.width, node.ink.height)
  ctx.restore()
}

function buildDrawEl(node: LayoutNode, t: number, state: PaintState): DrawElSnapshot {
  return {
    tag: node.tag,
    id: node.id,
    text: node.text,
    attr: node.attr,
    style: node.style,
    computed: node.computed,
    w: node.width,
    h: node.height,
    data: node.data,
    t,
    frame: state.frame,
    fps: state.fps,
  }
}

function runElementDraw(ctx: CanvasRenderingContext2D, node: LayoutNode, t: number, state: PaintState) {
  if (!node.draw) return
  ctx.save()
  ctx.translate(node.x, node.y)
  try {
    node.draw(ctx, buildDrawEl(node, t, state))
  } catch (err) {
    state.issues.push(invalidDrawIssue(node, err))
  }
  ctx.restore()
}

/** 绕 origin 旋转、缩放。支点用当前坐标系里的绝对位置，子绘制仍使用 node.x/node.y。 */
function applyNodeTransform(ctx: CanvasRenderingContext2D, node: LayoutNode) {
  if (node.rotate === 0 && node.scaleX === 1 && node.scaleY === 1) return
  const o = originOffset(node.origin, node.width, node.height)
  const px = node.x + o.x
  const py = node.y + o.y
  ctx.translate(px, py)
  ctx.rotate((node.rotate * Math.PI) / 180)
  ctx.scale(node.scaleX, node.scaleY)
  ctx.translate(-px, -py)
}

function drawBoxSilhouette(ctx: CanvasRenderingContext2D, node: LayoutNode, spread: number, ink = SILHOUETTE) {
  const x = node.x - spread
  const y = node.y - spread
  const w = node.width + spread * 2
  const h = node.height + spread * 2
  if (w <= 0 || h <= 0) return
  const radius = Math.max(0, (node.borderRadius ?? 0) + spread)
  ctx.fillStyle = ink
  if (radius > 0) {
    roundRectPath(ctx, x, y, w, h, radius)
    ctx.fill()
  } else ctx.fillRect(x, y, w, h)
}

function drawShapeSilhouette(ctx: CanvasRenderingContext2D, node: ShapeLayoutNode, spread: number, ink = SILHOUETTE) {
  const hasFill = node.fill !== 'none'
  const hasStroke = node.stroke !== 'none' && node.strokeWidth > 0
  if (!hasFill && !hasStroke) return
  ctx.save()
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  if (hasFill) {
    if (node.shape === 'rect') {
      const x = node.x - spread
      const y = node.y - spread
      const w = node.width + spread * 2
      const h = node.height + spread * 2
      if (w > 0 && h > 0) {
        const radius = Math.max(0, (node.rx ?? node.borderRadius ?? 0) + spread)
        if (radius > 0) {
          roundRectPath(ctx, x, y, w, h, radius)
          ctx.fill()
        } else ctx.fillRect(x, y, w, h)
      }
    } else if (node.shape === 'circle') {
      const radius = (node.r ?? node.width / 2) + spread
      if (radius > 0) {
        ctx.beginPath()
        ctx.arc(node.x + node.width / 2, node.y + node.height / 2, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      const rx = (node.rxEllipse ?? node.width / 2) + spread
      const ry = (node.ry ?? node.height / 2) + spread
      if (rx > 0 && ry > 0) {
        ctx.beginPath()
        ctx.ellipse(node.x + node.width / 2, node.y + node.height / 2, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  if (hasStroke) {
    ctx.lineWidth = Math.max(0.5, node.strokeWidth + spread * 2)
    if (node.dash?.length) ctx.setLineDash(node.dash)
    if (node.shape === 'rect') {
      const r = node.rx ?? node.borderRadius ?? 0
      if (r > 0) {
        roundRectPath(ctx, node.x, node.y, node.width, node.height, r)
        ctx.stroke()
      } else ctx.strokeRect(node.x, node.y, node.width, node.height)
    } else if (node.shape === 'circle') {
      const radius = node.r ?? node.width / 2
      if (radius > 0) {
        ctx.beginPath()
        ctx.arc(node.x + node.width / 2, node.y + node.height / 2, radius, 0, Math.PI * 2)
        ctx.stroke()
      }
    } else {
      const rx = node.rxEllipse ?? node.width / 2
      const ry = node.ry ?? node.height / 2
      if (rx > 0 && ry > 0) {
        ctx.beginPath()
        ctx.ellipse(node.x + node.width / 2, node.y + node.height / 2, rx, ry, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

function drawEffect(
  ctx: CanvasRenderingContext2D,
  state: PaintState,
  node: LayoutNode,
  effect: { dx: number; dy: number; blur: number; spread: number; color: string },
  drawSilhouette: (spread: number) => void,
  blend: 'source-over' | 'screen' = 'source-over',
) {
  const matrix = (ctx as CanvasRenderingContext2D & { getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } }).getTransform()
  const k = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1
  const devX = matrix.a * effect.dx + matrix.c * effect.dy
  const devY = matrix.b * effect.dx + matrix.d * effect.dy
  const far =
    2 * (state.canvasWidth + state.canvasHeight) +
    4 * k * (node.width + node.height + Math.abs(effect.spread) + effect.blur) +
    Math.abs(devX)
  ctx.save()
  ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - far, matrix.f)
  ctx.globalCompositeOperation = blend
  ctx.shadowColor = effect.color
  ctx.shadowBlur = effect.blur * k
  ctx.shadowOffsetX = devX + far
  ctx.shadowOffsetY = devY
  drawSilhouette(effect.spread)
  ctx.restore()
}

function shadowEffect(shadow: ShadowSpec) {
  return { dx: shadow.x, dy: shadow.y, blur: shadow.blur, spread: shadow.spread, color: shadow.color }
}

/** 三维场景的画面当成一层墨迹，好让写在这层上的阴影跟着已经画出来的物体。 */
function drawMeshFrameInk(ctx: CanvasRenderingContext2D, node: LayerLayoutNode, state: PaintState) {
  const frame = state.meshFrames?.get(node)
  if (!frame || frame.width <= 0 || frame.height <= 0) return
  const k = transformScale(ctx)
  const tw = Math.max(1, Math.ceil(frame.width * k))
  const th = Math.max(1, Math.ceil(frame.height * k))
  const off = createCanvas(tw, th)
  const octx = off.getContext('2d')
  octx.drawImage(frame.canvas as unknown as Canvas, 0, 0, tw, th)
  octx.globalCompositeOperation = 'source-in'
  octx.fillStyle = SILHOUETTE
  octx.fillRect(0, 0, tw, th)
  ;(ctx as PaintCtx).drawImage(off, node.x + frame.x, node.y + frame.y, frame.width, frame.height)
}

/** 外阴影和外发光的墨迹。layer / flex 跟着子树，不跟着空的布局盒子。 */
function drawOuterInk(ctx: CanvasRenderingContext2D, state: PaintState, node: LayoutNode, spread: number) {
  if (node.kind === 'layer' && state.meshFrames?.has(node)) {
    drawNodeInk(ctx, node, spread)
    drawMeshFrameInk(ctx, node, state)
    return
  }
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    drawSubtreeInk(ctx, node, spread, SILHOUETTE, state)
    return
  }
  drawNodeInk(ctx, node, spread)
}

function paintGlow(ctx: CanvasRenderingContext2D, state: PaintState, node: LayoutNode, glow: GlowSpec, drawSilhouette: (spread: number) => void) {
  const wide = { dx: 0, dy: 0, blur: glow.blur, spread: glow.spread, color: glow.color }
  drawEffect(ctx, state, node, wide, drawSilhouette, 'screen')
  drawEffect(ctx, state, node, { ...wide, blur: Math.max(2, glow.blur * 0.35) }, drawSilhouette, 'screen')
}

/**
 * 效果用的着墨轮廓：跟真实画出来的像素走，不跟布局盒子。
 * 文字 = 背景 chrome（若有）+ 字形；形状/线 = 几何墨迹；layer/flex = 仅自身背景/边框。
 * layer / flex 的外阴影和外发光不走这里，改走子树，见 drawOuterInk。
 */
function drawNodeInk(ctx: CanvasRenderingContext2D, node: LayoutNode, spread: number, ink = SILHOUETTE) {
  if (node.kind === 'line') {
    drawLine(ctx, node, true, spread)
    return
  }
  if (node.kind === 'shape') {
    drawShapeSilhouette(ctx, node, spread, ink)
    return
  }
  if (node.kind === 'text' || node.kind === 'image') {
    if (node.background && node.background !== 'transparent') drawBoxSilhouette(ctx, node, spread, ink)
    const drawRaw = (target: PaintCtx) => {
      if (node.kind === 'text') drawTextNode(target, node, ink)
      else drawImageNode(target, node, ink)
    }
    // 字形和图片 alpha 不能靠几何外扩。spread 为 0 时仍直接画，避免和以前有像素差。
    if (Math.abs(spread) < 1e-3) drawRaw(ctx as PaintCtx)
    else paintDilatedInk(ctx as PaintCtx, spread, ink, leafInkBounds(node), drawRaw)
    return
  }
  if (node.kind === 'custom') {
    if ((node.background && node.background !== 'transparent') || (node.border && node.border.width > 0)) {
      drawBoxSilhouette(ctx, node, spread, ink)
    }
    return
  }
  if ((node.background && node.background !== 'transparent') || (node.border && node.border.width > 0)) {
    drawBoxSilhouette(ctx, node, spread, ink)
  }
}

/** layer overlay：自身 chrome + 子树着墨（子元素局部坐标）。不看这一层自己的 mask。 */
function drawUnmaskedSubtree(
  ctx: CanvasRenderingContext2D,
  node: LayoutNode,
  spread: number,
  ink = SILHOUETTE,
  state?: PaintState,
) {
  if (node.kind === 'group') {
    ctx.save()
    ctx.transform(node.svg.a, node.svg.b, node.svg.c, node.svg.d, node.svg.e, node.svg.f)
    for (const ch of node.children) drawSubtreeInk(ctx, ch, spread, ink, state)
    ctx.restore()
    return
  }
  drawNodeInk(ctx, node, spread, ink)
  if (node.kind === 'layer' && state?.meshFrames?.has(node)) drawMeshFrameInk(ctx, node, state)
  if (node.kind !== 'layer' && node.kind !== 'flex') return
  const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
  const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
  ctx.save()
  ctx.translate(node.x + insetX, node.y + insetY)
  for (const ch of node.children) drawSubtreeInk(ctx, ch, spread, ink, state)
  ctx.restore()
}

/**
 * 蒙版留下的轮廓。先画没裁过的子树，再套 mask，最后按 spread 胀缩。
 * 父层的描边和阴影跟着这块轮廓，不跟着没抠过的矩形。
 */
function drawMaskedLayerInk(
  ctx: CanvasRenderingContext2D,
  node: LayerLayoutNode,
  spread: number,
  ink = SILHOUETTE,
  state?: PaintState,
) {
  const masks = node.mask
  if (!masks || masks.length === 0) {
    drawUnmaskedSubtree(ctx, node, spread, ink, state)
    return
  }
  const k = Math.max(transformScale(ctx), 1e-3)
  const w = Math.max(1, Math.ceil(node.width * k))
  const h = Math.max(1, Math.ceil(node.height * k))
  const canvas = createCanvas(w, h)
  const octx = canvas.getContext('2d') as PaintCtx
  octx.setTransform(k, 0, 0, k, -node.x * k, -node.y * k)
  drawUnmaskedSubtree(octx, node, 0, '#ffffff', state)
  applyLayerMask(
    canvas,
    masks,
    k,
    0,
    0,
    { canvasWidth: w, canvasHeight: h, frame: 0, fps: 30, issues: [] },
    node.maskFeather ?? 0,
    node.maskInvert ?? false,
  )
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.globalCompositeOperation = 'source-in'
  octx.fillStyle = ink
  octx.fillRect(0, 0, w, h)
  const blit = (dctx: PaintCtx) => {
    dctx.drawImage(canvas, node.x, node.y, node.width, node.height)
  }
  if (Math.abs(spread) < 1e-3) blit(ctx as PaintCtx)
  else paintDilatedInk(ctx as PaintCtx, spread, ink, { x: node.x, y: node.y, width: node.width, height: node.height }, blit)
}

/** layer overlay：自身 chrome + 子树着墨。写了 mask 的层用蒙版之后的轮廓。 */
function drawSubtreeInk(
  ctx: CanvasRenderingContext2D,
  node: LayoutNode,
  spread: number,
  ink = SILHOUETTE,
  state?: PaintState,
) {
  if (node.kind === 'layer' && node.mask && node.mask.length > 0) {
    drawMaskedLayerInk(ctx, node, spread, ink, state)
    return
  }
  drawUnmaskedSubtree(ctx, node, spread, ink, state)
}

function transformScale(ctx: CanvasRenderingContext2D): number {
  const matrix = (
    ctx as CanvasRenderingContext2D & { getTransform(): { a: number; b: number; c: number; d: number } }
  ).getTransform()
  return Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1
}

function paintInnerEffect(
  ctx: PaintCtx,
  node: LayoutNode,
  effect: { x: number; y: number; blur: number; spread: number; color: string },
  blend: 'source-over' | 'screen',
) {
  if (node.width <= 0 || node.height <= 0) return
  const k = transformScale(ctx)
  const pad = Math.ceil(effect.blur * 2 + Math.abs(effect.spread) + Math.abs(effect.x) + Math.abs(effect.y) + 4)
  const twLogic = Math.max(1, Math.ceil(node.width + pad * 2))
  const thLogic = Math.max(1, Math.ceil(node.height + pad * 2))
  const tw = Math.max(1, Math.ceil(twLogic * k))
  const th = Math.max(1, Math.ceil(thLogic * k))

  const fill = createCanvas(tw, th)
  const fctx = fill.getContext('2d') as PaintCtx
  fctx.setTransform(k, 0, 0, k, 0, 0)
  fctx.translate(-node.x + pad, -node.y + pad)
  drawNodeInk(fctx, node, Math.max(0, effect.spread), effect.color)

  const cut = createCanvas(tw, th)
  const cctx = cut.getContext('2d') as PaintCtx
  cctx.setTransform(k, 0, 0, k, 0, 0)
  cctx.translate(-node.x + pad, -node.y + pad)
  drawNodeInk(cctx, node, -Math.max(0, effect.spread), '#000000')

  const cutSoft = createCanvas(tw, th)
  const sctx = cutSoft.getContext('2d') as PaintCtx
  if (effect.blur > 0) sctx.filter = `blur(${effect.blur * k}px)`
  // 反向偏移：正 y 的内阴影落在底部内侧
  sctx.drawImage(cut, -effect.x * k, -effect.y * k)
  sctx.filter = 'none'

  fctx.setTransform(1, 0, 0, 1, 0, 0)
  fctx.globalCompositeOperation = 'destination-out'
  fctx.drawImage(cutSoft, 0, 0)

  // 内效果也按墨迹 alpha 裁切，避免文字落成方块阴影
  const clip = createCanvas(tw, th)
  const clipCtx = clip.getContext('2d') as PaintCtx
  clipCtx.setTransform(k, 0, 0, k, 0, 0)
  clipCtx.translate(-node.x + pad, -node.y + pad)
  drawNodeInk(clipCtx, node, 0, '#ffffff')
  fctx.globalCompositeOperation = 'destination-in'
  fctx.drawImage(clip, 0, 0)

  ctx.save()
  ctx.globalCompositeOperation = blend
  ctx.drawImage(fill, node.x - pad, node.y - pad, twLogic, thLogic)
  ctx.restore()
}

/** layer 专用：按子树墨迹裁切后叠加纯色/渐变。 */
function paintOverlay(ctx: PaintCtx, node: LayoutNode, overlay: OverlaySpec, state?: PaintState) {
  if (node.width <= 0 || node.height <= 0 || overlay.opacity <= 0) return
  const w = Math.max(1, Math.ceil(node.width))
  const h = Math.max(1, Math.ceil(node.height))
  const k = transformScale(ctx)
  const tw = Math.max(1, Math.ceil(w * k))
  const th = Math.max(1, Math.ceil(h * k))
  const off = createCanvas(tw, th)
  const octx = off.getContext('2d') as PaintCtx
  octx.setTransform(k, 0, 0, k, 0, 0)
  octx.fillStyle = paintOf(octx, overlay.paint, 0, 0, node.width, node.height)
  octx.fillRect(0, 0, node.width, node.height)

  const clip = createCanvas(tw, th)
  const clipCtx = clip.getContext('2d') as PaintCtx
  clipCtx.setTransform(k, 0, 0, k, 0, 0)
  clipCtx.translate(-node.x, -node.y)
  drawSubtreeInk(clipCtx, node, 0, '#ffffff', state)
  // 内描边落在本体内，从蒙版里挖掉，避免渐变 overlay 染到描边。
  eraseInnerStrokes(clipCtx, node, state)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(clip, 0, 0)

  ctx.save()
  ctx.globalAlpha *= overlay.opacity
  ctx.globalCompositeOperation = overlay.blend
  ctx.drawImage(off, node.x, node.y, node.width, node.height)
  ctx.restore()
}

function paintNoise(ctx: PaintCtx, node: LayoutNode, noise: NoiseSpec, composite: 'soft-light' | 'source-over' = 'soft-light') {
  const w = Math.max(1, Math.ceil(node.width))
  const h = Math.max(1, Math.ceil(node.height))
  if (node.width <= 0 || node.height <= 0 || noise.amount <= 0) return
  const k = transformScale(ctx)
  const tw = Math.max(1, Math.ceil(w * k))
  const th = Math.max(1, Math.ceil(h * k))
  const off = createCanvas(tw, th)
  const octx = off.getContext('2d') as PaintCtx
  const img = octx.createImageData(tw, th)
  const data = img.data
  let colorR = 255
  let colorG = 255
  let colorB = 255
  if (noise.color) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(noise.color.trim())
    if (m) {
      const hex = m[1]!
      if (hex.length === 3) {
        colorR = Number.parseInt(hex[0]! + hex[0]!, 16)
        colorG = Number.parseInt(hex[1]! + hex[1]!, 16)
        colorB = Number.parseInt(hex[2]! + hex[2]!, 16)
      } else {
        colorR = Number.parseInt(hex.slice(0, 2), 16)
        colorG = Number.parseInt(hex.slice(2, 4), 16)
        colorB = Number.parseInt(hex.slice(4, 6), 16)
      }
    }
  }
  // 确定性噪点：同一输入同一纹理
  let seed = (Math.floor(node.x) * 73856093) ^ (Math.floor(node.y) * 19349663) ^ (w * 83492791) ^ (h * 39916801)
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let i = 0; i < data.length; i += 4) {
    const n = next()
    data[i] = Math.round(colorR * n)
    data[i + 1] = Math.round(colorG * n)
    data[i + 2] = Math.round(colorB * n)
    data[i + 3] = Math.round(255 * noise.amount)
  }
  octx.putImageData(img, 0, 0)
  // 按墨迹 alpha 裁切，文字不会整块铺噪点
  const clip = createCanvas(tw, th)
  const clipCtx = clip.getContext('2d') as PaintCtx
  clipCtx.setTransform(k, 0, 0, k, 0, 0)
  clipCtx.translate(-node.x, -node.y)
  drawNodeInk(clipCtx, node, 0, '#ffffff')
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(clip, 0, 0)
  ctx.save()
  ctx.globalCompositeOperation = composite
  ctx.drawImage(off, node.x, node.y, node.width, node.height)
  ctx.restore()
}

function layerMaskOf(node: LayoutNode): LayoutNode[] | undefined {
  if (node.kind !== 'layer' || !node.mask || node.mask.length === 0) return undefined
  return node.mask
}

/** 把父画布已有像素拷进当前离屏，供 glass / backdrop-blur 取样。 */
function copyParentUnderlay(parent: PaintCtx, dest: PaintCtx) {
  const inv = invert(parent.getTransform())
  if (!inv) return
  const combined = multiply(dest.getTransform(), inv)
  dest.save()
  dest.setTransform(combined.a, combined.b, combined.c, combined.d, combined.e, combined.f)
  dest.drawImage(parent.canvas, 0, 0)
  dest.restore()
}

function maskComposite(
  width: number,
  height: number,
  shapes: LayoutNode[],
  prepare: (ctx: CanvasRenderingContext2D) => void,
  feather: number,
  invert: boolean,
  t: number,
  state: PaintState,
) {
  return compositeMask({
    width,
    height,
    shapes,
    feather,
    invert,
    prepare,
    paintShape: (ctx, shape) => paintNode(ctx, shape, false, t, state),
    enterGroup: (ctx, shape) => {
      applyNodeTransform(ctx, shape)
      ctx.transform(shape.svg.a, shape.svg.b, shape.svg.c, shape.svg.d, shape.svg.e, shape.svg.f)
    },
  })
}

/** 形状和图片按 op 合成，再用 destination-in 只保留 alpha。 */
function applyLayerMask(
  canvas: Canvas,
  shapes: LayoutNode[],
  k: number,
  origin: number,
  t: number,
  state: PaintState,
  feather = 0,
  invert = false,
) {
  const pw = canvas.width
  const ph = canvas.height
  if (pw <= 0 || ph <= 0) return
  const mask = maskComposite(
    pw,
    ph,
    shapes,
    (ctx) => ctx.setTransform(k, 0, 0, k, origin * k, origin * k),
    feather * k,
    invert,
    t,
    state,
  )
  const cctx = canvas.getContext('2d') as PaintCtx
  cctx.save()
  cctx.setTransform(1, 0, 0, 1, 0, 0)
  cctx.globalAlpha = 1
  cctx.globalCompositeOperation = 'destination-in'
  cctx.drawImage(mask.canvas, 0, 0)
  cctx.restore()
}

export type MaskRaster = {
  /** 位图的像素宽高。 */
  width: number
  height: number
  /** 一个位图像素等于多少个 layer 局部像素的倒数。大图会缩小来画。 */
  scale: number
  /** 每个像素的 alpha，逐行排列。 */
  alpha: Uint8ClampedArray
}

const MASK_RASTER_LIMIT = 4_000_000

/** 和绘制时同一套形状和图片，在 layer 布局盒里画成 alpha 位图。原点是 layer 左上角。 */
export function rasterizeMask(
  shapes: LayoutNode[],
  width: number,
  height: number,
  options: { feather?: number; invert?: boolean } = {},
): (MaskRaster & { steps: MaskOpReport[] }) | null {
  if (!(width > 0) || !(height > 0)) return null
  const scale = Math.min(1, Math.sqrt(MASK_RASTER_LIMIT / (width * height)))
  const pw = Math.max(1, Math.ceil(width * scale))
  const ph = Math.max(1, Math.ceil(height * scale))
  const state: PaintState = { canvasWidth: pw, canvasHeight: ph, frame: 0, fps: 30, issues: [] }
  const mask = maskComposite(
    pw,
    ph,
    shapes,
    (ctx) => ctx.setTransform(scale, 0, 0, scale, 0, 0),
    (options.feather ?? 0) * scale,
    options.invert ?? false,
    0,
    state,
  )
  return { width: pw, height: ph, scale, alpha: mask.alpha, steps: mask.steps }
}

function nodeDeviceBounds(ctx: PaintCtx, node: LayoutNode, padDevice: number) {
  const matrix = ctx.getTransform()
  const corners = [
    { x: node.x, y: node.y },
    { x: node.x + node.width, y: node.y },
    { x: node.x, y: node.y + node.height },
    { x: node.x + node.width, y: node.y + node.height },
  ].map((p) => ({
    x: matrix.a * p.x + matrix.c * p.y + matrix.e,
    y: matrix.b * p.x + matrix.d * p.y + matrix.f,
  }))
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)) - padDevice))
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)) - padDevice))
  const maxX = Math.min(ctx.canvas.width, Math.ceil(Math.max(...corners.map((p) => p.x)) + padDevice))
  const maxY = Math.min(ctx.canvas.height, Math.ceil(Math.max(...corners.map((p) => p.y)) + padDevice))
  return { matrix, minX, minY, maxX, maxY, sw: maxX - minX, sh: maxY - minY }
}

function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = x - Math.floor(x)
  const fy = y - Math.floor(y)
  const i00 = (y0 * w + x0) * 4
  const i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4
  const i11 = (y1 * w + x1) * 4
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const v0 = data[i00 + c]! * (1 - fx) + data[i10 + c]! * fx
    const v1 = data[i01 + c]! * (1 - fx) + data[i11 + c]! * fx
    out[c] = v0 * (1 - fy) + v1 * fy
  }
  return out
}

function paintBackdropBlur(ctx: PaintCtx, node: LayoutNode, radius: number) {
  if (radius <= 0 || node.width <= 0 || node.height <= 0) return
  const { matrix, minX, minY, sw, sh } = nodeDeviceBounds(ctx, node, 0)
  if (sw <= 0 || sh <= 0) return
  const snapshot = ctx.getImageData(minX, minY, sw, sh)
  const src = createCanvas(sw, sh)
  ;(src.getContext('2d') as PaintCtx).putImageData(snapshot, 0, 0)
  const blurred = createCanvas(sw, sh)
  const bctx = blurred.getContext('2d') as PaintCtx
  const k = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1
  bctx.filter = `blur(${radius * k}px)`
  bctx.drawImage(src, 0, 0)
  bctx.filter = 'none'
  // 按墨迹 alpha 贴回，文字/异形不会整块毛玻璃
  const mask = createCanvas(sw, sh)
  const mctx = mask.getContext('2d') as PaintCtx
  mctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - minX, matrix.f - minY)
  drawNodeInk(mctx, node, 0, '#ffffff')
  bctx.globalCompositeOperation = 'destination-in'
  bctx.drawImage(mask, 0, 0)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(blurred, minX, minY)
  ctx.restore()
}

const EDT_INF = 1e20

/** Felzenszwalb 一维平方距离变换。墨迹膨胀、描边和玻璃共用。 */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -EDT_INF
  z[1] = EDT_INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = EDT_INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const dq = q - v[k]!
    d[q] = dq * dq + f[v[k]!]!
  }
}

/** 种子为 0、其余为 EDT_INF 的网格，原地写成到最近种子的平方距离。 */
function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]!
  }
}

/**
 * 每个像素到最近种子的欧氏距离。
 * bias 从开方结果里减去：玻璃用 0.5，让距离落到像素边界而不是像素中心。
 */
function distanceToSites(isSite: (index: number) => boolean, w: number, h: number, bias = 0): Float32Array {
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = isSite(i) ? 0 : EDT_INF
  edt2d(grid, w, h)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const g = grid[i]!
    out[i] = g > 0 ? Math.max(0, Math.sqrt(g) - bias) : 0
  }
  return out
}

/** 墨迹内部每个像素到最近墨迹边缘的欧氏距离（设备像素） */
function inkDistanceField(maskData: Uint8ClampedArray, w: number, h: number): Float32Array {
  return distanceToSites((i) => maskData[i * 4 + 3]! < 128, w, h, 0.5)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 描边环带。d 为到墨迹边界的距离；在 outer 处约 1px 做 smoothstep。 */
function bandCoverage(d: number, inner: number, outer: number): number {
  if (!(outer > inner) || d <= 0 || d >= outer + 0.5) return 0
  const outerA = 1 - smoothstep(outer - 0.5, outer + 0.5, d)
  const innerA = inner <= 0 ? 1 : smoothstep(inner - 0.5, inner + 0.5, d)
  return outerA * innerA
}

const RASTER_MAX_SIDE = 8192

function rasterizeUser(bounds: Box, draw: (ctx: PaintCtx) => void): { canvas: Canvas; x: number; y: number } | null {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((n) => Number.isFinite(n))) return null
  const x = Math.floor(bounds.x)
  const y = Math.floor(bounds.y)
  const w = Math.ceil(bounds.x + bounds.width) - x
  const h = Math.ceil(bounds.y + bounds.height) - y
  if (w < 1 || h < 1 || w > RASTER_MAX_SIDE || h > RASTER_MAX_SIDE) return null
  const canvas = createCanvas(w, h)
  const octx = canvas.getContext('2d') as PaintCtx
  octx.translate(-x, -y)
  draw(octx)
  return { canvas, x, y }
}

type Mat2 = { a: number; b: number; c: number; d: number; e: number; f: number }

/** 旋转或错切会把正的覆盖蒙版转成台阶。这种变换改在屏幕像素里栅格化，并超采样后再平均。 */
function transformTurns(matrix: { b: number; c: number }): boolean {
  return Math.abs(matrix.b) > 1e-4 || Math.abs(matrix.c) > 1e-4
}

/** 描边这棵子树里有旋转时，正着算距离再贴回去会在斜边上出台阶。 */
function inkNeedsScreen(node: LayoutNode): boolean {
  if (Math.abs(node.rotate) > 1e-4) return true
  if (node.kind === 'group' && (Math.abs(node.svg.b) > 1e-4 || Math.abs(node.svg.c) > 1e-4)) return true
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    return node.children.some(inkNeedsScreen)
  }
  return false
}

function rasterizeOnScreen(
  matrix: Mat2,
  bounds: Box,
  draw: (ctx: PaintCtx) => void,
): { canvas: Canvas; x: number; y: number; scale: number; sample: number; dw: number; dh: number } | null {
  if (![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f, bounds.x, bounds.y, bounds.width, bounds.height].every((n) => Number.isFinite(n))) {
    return null
  }
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x, bounds.y + bounds.height],
    [bounds.x + bounds.width, bounds.y + bounds.height],
  ].map(([px, py]) => ({
    x: matrix.a * px + matrix.c * py + matrix.e,
    y: matrix.b * px + matrix.d * py + matrix.f,
  }))
  const x = Math.floor(Math.min(...corners.map((p) => p.x))) - 1
  const y = Math.floor(Math.min(...corners.map((p) => p.y))) - 1
  const dw = Math.ceil(Math.max(...corners.map((p) => p.x))) + 1 - x
  const dh = Math.ceil(Math.max(...corners.map((p) => p.y))) + 1 - y
  if (dw < 1 || dh < 1 || dw > RASTER_MAX_SIDE || dh > RASTER_MAX_SIDE) return null
  let sample = PERSPECTIVE_AA
  while (sample > 1 && (dw * sample > RASTER_MAX_SIDE || dh * sample > RASTER_MAX_SIDE)) sample /= 2
  const canvas = createCanvas(Math.max(1, Math.round(dw * sample)), Math.max(1, Math.round(dh * sample)))
  const octx = canvas.getContext('2d') as PaintCtx
  octx.setTransform(
    matrix.a * sample,
    matrix.b * sample,
    matrix.c * sample,
    matrix.d * sample,
    (matrix.e - x) * sample,
    (matrix.f - y) * sample,
  )
  draw(octx)
  const scale = (Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1) * sample
  return { canvas, x, y, scale, sample, dw, dh }
}

type ScreenBlit = {
  /** 覆盖蒙版在屏幕像素的超采样网格上。渐变仍按用户坐标，经这个矩阵变过去。 */
  matrix: Mat2
  cover: Box
  sample: number
  dw: number
  dh: number
}

/** 把覆盖蒙版染成颜色或渐变，再画回。渐变坐标用元素盒子。`screen` 时按屏幕像素 1:1 贴，不再转一次。 */
function blitCoverage(
  ctx: PaintCtx,
  originX: number,
  originY: number,
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  color: string,
  gradientBox: Box | null,
  screen?: ScreenBlit,
) {
  let any = false
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i]! > 0) {
      any = true
      break
    }
  }
  if (!any) return
  const mask = createCanvas(w, h)
  const mctx = mask.getContext('2d') as PaintCtx
  const img = mctx.createImageData(w, h)
  const px = img.data
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i]!
    if (a === 0) continue
    const o = i * 4
    px[o] = 255
    px[o + 1] = 255
    px[o + 2] = 255
    px[o + 3] = a
  }
  mctx.putImageData(img, 0, 0)
  const colored = createCanvas(w, h)
  const cctx = colored.getContext('2d') as PaintCtx
  if (gradientBox && isGradient(color)) {
    if (screen) {
      const m = screen.matrix
      const s = screen.sample
      cctx.setTransform(m.a * s, m.b * s, m.c * s, m.d * s, (m.e - originX) * s, (m.f - originY) * s)
    } else cctx.translate(-originX, -originY)
    cctx.fillStyle = paintOf(
      cctx,
      color,
      gradientBox.x,
      gradientBox.y,
      Math.max(1, gradientBox.width),
      Math.max(1, gradientBox.height),
    )
    if (screen) {
      const cover = screen.cover
      cctx.fillRect(cover.x - 4, cover.y - 4, cover.width + 8, cover.height + 8)
    } else cctx.fillRect(originX, originY, w, h)
    cctx.setTransform(1, 0, 0, 1, 0, 0)
  } else {
    cctx.fillStyle = color
    cctx.fillRect(0, 0, w, h)
  }
  cctx.globalCompositeOperation = 'destination-in'
  cctx.drawImage(mask, 0, 0)
  const smoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  if (screen) {
    const image =
      colored.width === screen.dw && colored.height === screen.dh
        ? colored
        : resolveSamples(colored, screen.dw, screen.dh)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(image, originX, originY)
    ctx.restore()
  } else ctx.drawImage(colored, originX, originY)
  ctx.imageSmoothingEnabled = smoothing
}

/** 按墨迹 alpha 膨胀（spread > 0）或收缩（spread < 0）。只在墨迹外框加 |spread| 的范围内做距离变换。 */
function paintDilatedInk(
  ctx: PaintCtx,
  spread: number,
  color: string,
  bounds: Box,
  drawRaw: (ctx: PaintCtx) => void,
) {
  if (Math.abs(spread) < 1e-3) {
    drawRaw(ctx)
    return
  }
  const pad = Math.ceil(Math.abs(spread)) + 2
  const raster = rasterizeUser(
    { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 },
    drawRaw,
  )
  if (!raster) {
    drawRaw(ctx)
    return
  }
  const { canvas, x, y } = raster
  const w = canvas.width
  const h = canvas.height
  const data = (canvas.getContext('2d') as PaintCtx).getImageData(0, 0, w, h).data
  const inkAt = (i: number) => data[i * 4 + 3]! >= 128
  const alpha = new Uint8ClampedArray(w * h)
  if (spread > 0) {
    const outside = distanceToSites(inkAt, w, h, 0)
    for (let i = 0; i < w * h; i++) {
      if (inkAt(i)) {
        alpha[i] = 255
        continue
      }
      const d = outside[i]!
      if (d <= 0 || d >= spread + 0.5) continue
      alpha[i] = Math.round(255 * (1 - smoothstep(spread - 0.5, spread + 0.5, d)))
    }
  } else {
    const inside = distanceToSites((i) => !inkAt(i), w, h, 0)
    const radius = -spread
    for (let i = 0; i < w * h; i++) {
      if (!inkAt(i)) continue
      alpha[i] = Math.round(255 * smoothstep(radius - 0.5, radius + 0.5, inside[i]!))
    }
  }
  blitCoverage(ctx, x, y, alpha, w, h, color, null)
}

function leafInkBounds(node: LayoutNode): Box {
  const slop = 4
  const b =
    node.ink.width > 0.5 && node.ink.height > 0.5
      ? { x: node.x + node.ink.x, y: node.y + node.ink.y, width: node.ink.width, height: node.ink.height }
      : { x: node.x, y: node.y, width: Math.max(1, node.width), height: Math.max(1, node.height) }
  return { x: b.x - slop, y: b.y - slop, width: b.width + slop * 2, height: b.height + slop * 2 }
}

/** 子元素在父级内容坐标里的墨迹。旋转和缩放绕它自己的 origin，不含父级的平移。 */
function placedChildInk(node: LayoutNode, state?: PaintState): Box | null {
  const local = groupInkBounds(node, state)
  if (!local) return null
  if (node.rotate === 0 && node.scaleX === 1 && node.scaleY === 1) return local
  const origin = originOffset(node.origin, node.width, node.height)
  return applyToBox(aroundPivot(node.x + origin.x, node.y + origin.y, node.rotate, node.scaleX, node.scaleY), local)
}

/**
 * `<g>` 不另画一圈效果。这里把子路径变到父级内容坐标，供外层 layer 的描边和阴影用。
 * SVG `transform` 已经含在结果里，不再加 `g` 自己的布局原点。
 */
function groupContentInk(node: LayoutNode & { kind: 'group' }, state?: PaintState): Box | null {
  const parts: Box[] = []
  for (const ch of node.children) {
    const local = placedChildInk(ch, state)
    if (!local) continue
    parts.push(applyToBox(node.svg, local))
  }
  if (parts.length === 0) return null
  let acc = parts[0]!
  for (let i = 1; i < parts.length; i++) acc = unionBoxes(acc, parts[i]!)
  return { x: acc.x - 2, y: acc.y - 2, width: acc.width + 4, height: acc.height + 4 }
}

/** 子树墨迹外框，坐标系与 drawInkMask 一致（含本节点的 x/y，不含本节点自己的旋转）。 */
function groupInkBounds(node: LayoutNode, state?: PaintState): Box | null {
  if (node.kind === 'group') return groupContentInk(node, state)
  if (node.kind !== 'layer' && node.kind !== 'flex') return leafInkBounds(node)
  const parts: Box[] = []
  const add = (b: Box | null) => {
    if (!b || b.width <= 0 || b.height <= 0) return
    parts.push(b)
  }
  if ((node.background && node.background !== 'transparent') || (node.border && node.border.width > 0)) {
    add({ x: node.x, y: node.y, width: node.width, height: node.height })
  }
  if (node.kind === 'layer') {
    const frame = state?.meshFrames?.get(node)
    if (frame && frame.width > 0 && frame.height > 0) {
      add({ x: node.x + frame.x, y: node.y + frame.y, width: frame.width, height: frame.height })
    }
  }
  const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
  const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
  for (const ch of node.children) {
    const transformed = placedChildInk(ch, state)
    if (!transformed) continue
    add({
      x: transformed.x + node.x + insetX,
      y: transformed.y + node.y + insetY,
      width: transformed.width,
      height: transformed.height,
    })
  }
  if (parts.length === 0) return null
  let acc = parts[0]!
  for (let i = 1; i < parts.length; i++) acc = unionBoxes(acc, parts[i]!)
  return { x: acc.x - 2, y: acc.y - 2, width: acc.width + 4, height: acc.height + 4 }
}

/** 画本节点墨迹。Layer / flex 合并子树；`<g>` 只把子路径变进这棵子树，不单独描边。 */
function drawInkMask(ctx: PaintCtx, node: LayoutNode, isTop: boolean, state?: PaintState) {
  if (node.kind === 'layer' && node.mask && node.mask.length > 0) {
    ctx.save()
    if (!isTop) {
      applyNodeTransform(ctx, node)
      ctx.globalAlpha *= node.opacity
    }
    drawMaskedLayerInk(ctx, node, 0, '#ffffff')
    ctx.restore()
    return
  }
  ctx.save()
  if (!isTop) {
    applyNodeTransform(ctx, node)
    ctx.globalAlpha *= node.opacity
  }
  if (node.kind === 'group') {
    ctx.transform(node.svg.a, node.svg.b, node.svg.c, node.svg.d, node.svg.e, node.svg.f)
    for (const ch of node.children) drawInkMask(ctx, ch, false, state)
  } else if (node.kind === 'layer' || node.kind === 'flex') {
    drawNodeInk(ctx, node, 0, '#ffffff')
    if (node.kind === 'layer' && state?.meshFrames?.has(node)) drawMeshFrameInk(ctx, node, state)
    const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
    const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
    ctx.translate(node.x + insetX, node.y + insetY)
    for (const ch of node.children) drawInkMask(ctx, ch, false, state)
  } else {
    drawNodeInk(ctx, node, 0, '#ffffff')
  }
  ctx.restore()
}

/**
 * 阴影 / 光晕的轮廓 = 本体 ∪ 外侧描边，再按 spread 胀缩。
 * layer、flex、g 上的描边先合并子树再膨胀，重叠的字不会各留一圈。
 */
function drawEffectInk(ctx: CanvasRenderingContext2D, node: LayoutNode, spread: number, state?: PaintState) {
  const extra = outerInkStrokeReach(node.inkStroke)
  if ((node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') && extra > 0) {
    const bounds = groupInkBounds(node, state)
    if (!bounds) return
    paintDilatedInk(ctx as PaintCtx, spread + extra, SILHOUETTE, bounds, (octx) => drawInkMask(octx, node, true, state))
    return
  }
  if (state) drawOuterInk(ctx, state, node, spread + extra)
  else drawNodeInk(ctx, node, spread + extra)
}

type StrokeBand = { inner: number; outer: number; color: string; side: 'out' | 'in' }

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

function paintInkStrokes(
  ctx: PaintCtx,
  node: LayoutNode,
  phase: 'outer' | 'inner',
  source?: { bounds: Box; draw: (ctx: PaintCtx) => void },
  state?: PaintState,
) {
  const layers = node.inkStroke
  if (!layers?.length) return
  const bands = collectStrokeBands(layers, phase)
  if (bands.length === 0) return
  const subtree = node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group'
  const base = source?.bounds ?? (subtree ? groupInkBounds(node, state) : leafInkBounds(node))
  if (!base || base.width <= 0 || base.height <= 0) return
  const reach = phase === 'outer' ? outerInkStrokeReach(layers) : 2
  const pad = Math.ceil(Math.max(reach, 2)) + 2
  const user: Box = { x: base.x - pad, y: base.y - pad, width: base.width + pad * 2, height: base.height + pad * 2 }
  const draw = (octx: PaintCtx) => {
    if (source) source.draw(octx)
    else if (subtree) drawInkMask(octx, node, true, state)
    else drawNodeInk(octx, node, 0, '#ffffff')
  }
  const matrix = ctx.getTransform()
  const turned = transformTurns(matrix) || inkNeedsScreen(node) ? rasterizeOnScreen(matrix, user, draw) : null
  const axis = turned ? null : rasterizeUser(user, draw)
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
  for (const band of bands) {
    const field = band.side === 'out' ? outside : inside
    if (!field) continue
    const inner = band.inner * scale
    const outer = band.outer * scale
    const alpha = new Uint8ClampedArray(w * h)
    for (let i = 0; i < w * h; i++) {
      let cover = bandCoverage(field[i]!, inner, outer)
      if (cover <= 0) continue
      if (band.side === 'in') cover *= src[i * 4 + 3]! / 255
      const a = Math.round(255 * cover)
      if (a > 0) alpha[i] = a
    }
    // 填充的抗锯齿边要压在描边上。旋转后这条边不落在像素网格上，垫进大约 1 个屏幕像素，黑底才不会从缝里露出来。
    if (turned && band.side === 'out') tuckStrokeUnderInk(alpha, src, w, h, Math.max(1, Math.round(turned.sample)))
    blitCoverage(ctx, x, y, alpha, w, h, band.color, box, screen)
  }
}

/** 与 drawSubtreeInk 同一套坐标，把内侧描边从 overlay 蒙版里挖掉。 */
function eraseInnerStrokes(ctx: PaintCtx, node: LayoutNode, state?: PaintState) {
  if (node.inkStroke?.some((layer) => layer.position !== 'outside')) {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    paintInkStrokes(ctx, node, 'inner', undefined, state)
    ctx.restore()
  }
  if (node.kind === 'group') {
    ctx.save()
    ctx.transform(node.svg.a, node.svg.b, node.svg.c, node.svg.d, node.svg.e, node.svg.f)
    for (const ch of node.children) eraseInnerStrokes(ctx, ch, state)
    ctx.restore()
    return
  }
  if (node.kind !== 'layer' && node.kind !== 'flex') return
  const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
  const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
  ctx.save()
  ctx.translate(node.x + insetX, node.y + insetY)
  for (const ch of node.children) eraseInnerStrokes(ctx, ch, state)
  ctx.restore()
}

/** 可分离盒式模糊，用来抹平二值距离场的台阶，让法线方向连续 */
function boxBlurField(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const span = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))]!
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / span
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]!
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / span
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
    }
  }
  return out
}

const GLASS_PROFILE_STEPS = 256

/**
 * 边缘弧面的向内位移表：t∈[0,1]（0=边缘，1=弧面内沿）→ 位移（设备像素）。
 * shift = S·(1-t)²：内沿处位移与斜率都归零，和平坦中心无缝衔接；
 * S ≤ bezel/2 时 d + shift(d) 单调，背景在边缘被连续放大而不会翻折或拉成一条线。
 */
function glassShiftTable(bezel: number, glass: GlassSpec): Float32Array {
  const maxShift = bezel * 0.5 * Math.min(1, Math.max(0, glass.refraction))
  const table = new Float32Array(GLASS_PROFILE_STEPS + 1)
  for (let i = 0; i <= GLASS_PROFILE_STEPS; i++) {
    const u = 1 - i / GLASS_PROFILE_STEPS
    table[i] = maxShift * u * u
  }
  return table
}

/**
 * iOS Liquid Glass：墨迹距离场 → 边缘凸弧面 Snell 折射（中心平坦不变形）→ 色散 → 朝光边缘高光。
 * `blur` 为 0 时背景完全清晰，只有折射。
 * `drawShadow` 在取样之后、玻璃落版之前画，投影不会透过玻璃被看到。
 */
function paintGlass(ctx: PaintCtx, node: LayoutNode, glass: GlassSpec, drawShadow?: () => void) {
  if (node.width <= 0 || node.height <= 0) {
    drawShadow?.()
    return
  }
  const k = transformScale(ctx)
  const samplePad = Math.ceil(glass.blur * 2 * k) + 2
  const { matrix, minX, minY, sw, sh } = nodeDeviceBounds(ctx, node, samplePad)
  if (sw <= 0 || sh <= 0) {
    drawShadow?.()
    return
  }

  const snapshot = ctx.getImageData(minX, minY, sw, sh)
  let srcData = snapshot.data
  if (glass.blur > 0) {
    const src = createCanvas(sw, sh)
    ;(src.getContext('2d') as PaintCtx).putImageData(snapshot, 0, 0)
    const blurred = createCanvas(sw, sh)
    const bctx = blurred.getContext('2d') as PaintCtx
    bctx.filter = `blur(${glass.blur * k}px) saturate(1.15) brightness(1.04)`
    bctx.drawImage(src, 0, 0)
    bctx.filter = 'none'
    srcData = bctx.getImageData(0, 0, sw, sh).data
  }

  const mask = createCanvas(sw, sh)
  const mctx = mask.getContext('2d') as PaintCtx
  mctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - minX, matrix.f - minY)
  drawNodeInk(mctx, node, 0, '#ffffff')
  const maskData = mctx.getImageData(0, 0, sw, sh).data

  const rawDist = inkDistanceField(maskData, sw, sh)
  let inradius = 0
  for (let i = 0; i < rawDist.length; i++) if (rawDist[i]! > inradius) inradius = rawDist[i]!
  const dist = boxBlurField(rawDist, sw, sh, Math.max(1, Math.round(1.5 * k)))

  const bezelLogic = Math.min(64, Math.max(3, Math.min(node.width, node.height) * glass.bezel))
  const bezel = Math.max(1, Math.min(bezelLogic * k, inradius))
  const shiftTable = glassShiftTable(bezel, glass)
  if (process.env.GLASS_DEBUG) console.log({ sw, sh, inradius, bezel, k, mid: rawDist[Math.floor(sh / 2) * sw + Math.floor(sw / 2)], table: [shiftTable[0], shiftTable[64], shiftTable[128], shiftTable[192], shiftTable[256]] })
  const disp = glass.dispersion
  const lineWidth = Math.max(0.8, 1.1 * k)
  const lightX = -0.55
  const lightY = -0.835

  const out = createCanvas(sw, sh)
  const octx = out.getContext('2d') as PaintCtx
  const outImg = octx.createImageData(sw, sh)
  const outData = outImg.data

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x
      const mi = i * 4
      const a = maskData[mi + 3]!
      if (a < 1) continue
      const d = rawDist[i]!
      if (d >= bezel) {
        outData[mi] = srcData[mi]!
        outData[mi + 1] = srcData[mi + 1]!
        outData[mi + 2] = srcData[mi + 2]!
        outData[mi + 3] = (srcData[mi + 3]! * a) / 255
        continue
      }
      const gx = dist[Math.min(sw - 1, x + 1) + y * sw]! - dist[Math.max(0, x - 1) + y * sw]!
      const gy = dist[x + Math.min(sh - 1, y + 1) * sw]! - dist[x + Math.max(0, y - 1) * sw]!
      const gl = Math.hypot(gx, gy)
      const nx = gl > 1e-6 ? gx / gl : 0
      const ny = gl > 1e-6 ? gy / gl : 0
      const t = d / bezel
      const shift = shiftTable[Math.min(GLASS_PROFILE_STEPS, Math.round(t * GLASS_PROFILE_STEPS))]!

      let r: number
      let g: number
      let b: number
      let sa: number
      if (disp > 0) {
        const sr = shift * (1 + disp)
        const sb = shift * (1 - disp)
        const cr = sampleBilinear(srcData, sw, sh, x + nx * sr, y + ny * sr)
        const cg = sampleBilinear(srcData, sw, sh, x + nx * shift, y + ny * shift)
        const cb = sampleBilinear(srcData, sw, sh, x + nx * sb, y + ny * sb)
        r = cr[0]
        g = cg[1]
        b = cb[2]
        sa = cg[3]
      } else {
        ;[r, g, b, sa] = sampleBilinear(srcData, sw, sh, x + nx * shift, y + ny * shift)
      }

      if (glass.specular > 0) {
        // 外法线 = -梯度；朝光一侧亮，对侧有一道较弱的回光
        const facing = -(nx * lightX + ny * lightY)
        const lit = Math.pow(Math.max(0, facing), 1.3) + 0.45 * Math.pow(Math.max(0, -facing), 1.3) + 0.12
        const u = 1 - t
        const line = Math.exp(-d / lineWidth)
        const hl = Math.min(1, (0.85 * line + 0.3 * u * u * u) * lit * glass.specular)
        r += (255 - r) * hl
        g += (255 - g) * hl
        b += (255 - b) * hl
        sa += (255 - sa) * hl
      }
      outData[mi] = r
      outData[mi + 1] = g
      outData[mi + 2] = b
      outData[mi + 3] = (sa * a) / 255
    }
  }
  octx.putImageData(outImg, 0, 0)

  const tint = glass.tint ?? (glass.variant === 'thick' ? '#ffffff2a' : glass.variant === 'regular' ? '#ffffff14' : undefined)
  if (tint) {
    octx.save()
    octx.globalCompositeOperation = 'source-atop'
    octx.fillStyle = tint
    octx.fillRect(0, 0, sw, sh)
    octx.restore()
  }

  drawShadow?.()
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(out, minX, minY)
  ctx.restore()
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
function planeBitmapPad(node: LayoutNode): number {
  let pad = outwardPad(node)
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) pad = Math.max(pad, planeBitmapPad(child))
  }
  return pad > 0 ? Math.ceil(pad + 2) : 0
}

function paintChildBitmap(
  child: LayoutNode,
  k: number,
  t: number,
  state: PaintState,
  samples = 1,
): { canvas: Canvas; pad: number; logicalWidth: number; logicalHeight: number; localX: number; localY: number } {
  const pad = planeBitmapPad(child)
  const frame = child.kind === 'layer' ? state.meshFrames?.get(child) : undefined
  const extraL = frame ? Math.max(0, Math.ceil(-frame.x)) : 0
  const extraT = frame ? Math.max(0, Math.ceil(-frame.y)) : 0
  const extraR = frame ? Math.max(0, Math.ceil(frame.x + frame.width - child.width)) : 0
  const extraB = frame ? Math.max(0, Math.ceil(frame.y + frame.height - child.height)) : 0
  const localX = -(pad + extraL)
  const localY = -(pad + extraT)
  const logicalWidth = child.width + pad * 2 + extraL + extraR
  const logicalHeight = child.height + pad * 2 + extraT + extraB
  const w = Math.max(1, Math.ceil(logicalWidth * k))
  const h = Math.max(1, Math.ceil(logicalHeight * k))
  const canvas = createCanvas(w, h)
  const octx = canvas.getContext('2d') as PaintCtx
  // 位图是平面局部像素。rotate / scale 交给 posePoint，避免和投影各转一次。
  octx.setTransform(k, 0, 0, k, (-child.x - localX) * k, (-child.y - localY) * k)
  const previous = state.supersample
  state.supersample = samples
  paintNode(octx, child, false, t, state, true)
  state.supersample = previous
  return { canvas, pad, logicalWidth, logicalHeight, localX, localY }
}

function paintPerspectiveChildren(ctx: PaintCtx, node: LayerLayoutNode, debug: boolean, t: number, state: PaintState) {
  const perspective = node.perspective!
  const vx = node.width / 2
  const vy = node.height / 2
  const k = transformScale(ctx)
  const ordered = node.children
    .map((child, index) => ({ child, index, depth: planeDepth(child) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
  for (const { child, depth } of ordered) {
    if (child.width <= 0 || child.height <= 0) continue
    if (behindCamera(depth, perspective)) continue
    if (!has3dPose(child)) {
      paintNode(ctx, child, debug, t, state)
      continue
    }
    const { canvas: bitmap, localX, localY, logicalWidth, logicalHeight } = paintChildBitmap(child, k * PERSPECTIVE_AA, t, state, PERSPECTIVE_AA)
    const at = (u: number, v: number) => {
      const p = posePoint(child, u + localX, v + localY)
      return project(vx, vy, perspective, p)
    }
    drawTexturedPlane(ctx, bitmap, logicalWidth, logicalHeight, at)
    if (debug) strokeProjectedQuad(ctx, child, vx, vy, perspective)
  }
}

function paintProjectedChildren(ctx: PaintCtx, node: LayerLayoutNode, debug: boolean, t: number, state: PaintState) {
  const perspective = node.perspective!
  const k = transformScale(ctx)
  const planes = cameraItems(node)
    .filter((item) => item.kind !== 'mesh')
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
  for (const item of planes) {
    const child = item.kind === 'chrome' ? ({ ...item.node, children: [] } as LayoutNode) : item.node
    if (child.width <= 0 || child.height <= 0) continue
    if (item.behind) continue
    if (!item.posed) {
      paintNode(ctx, child, debug, t, state)
      continue
    }
    const { canvas: bitmap, localX, localY, logicalWidth, logicalHeight } = paintChildBitmap(child, k * PERSPECTIVE_AA, t, state, PERSPECTIVE_AA)
    const at = (u: number, v: number) => projectOnLayer(node, item.toLayer, u + localX, v + localY)
    drawTexturedPlane(ctx, bitmap, logicalWidth, logicalHeight, at)
    if (debug) {
      const pts = [
        [0, 0],
        [child.width, 0],
        [child.width, child.height],
        [0, child.height],
      ]
        .map(([u, v]) => projectOnLayer(node, item.toLayer, u!, v!))
      if (pts.every((point) => point != null)) {
        ctx.save()
        ctx.strokeStyle = 'rgba(0, 210, 90, 0.95)'
        ctx.lineWidth = 1.5 / transformScale(ctx)
        ctx.beginPath()
        ctx.moveTo(pts[0]!.x, pts[0]!.y)
        for (const point of pts.slice(1)) ctx.lineTo(point!.x, point!.y)
        ctx.closePath()
        ctx.stroke()
        ctx.restore()
      }
    }
  }
}

function strokeProjectedQuad(
  ctx: PaintCtx,
  child: LayoutNode,
  vx: number,
  vy: number,
  perspective: Perspective,
) {
  const locals: Array<[number, number]> = [
    [0, 0],
    [child.width, 0],
    [child.width, child.height],
    [0, child.height],
  ]
  const pts = []
  for (const [u, v] of locals) {
    const q = project(vx, vy, perspective, posePoint(child, u, v))
    if (!q) return
    pts.push(q)
  }
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 210, 90, 0.95)'
  ctx.lineWidth = 1.5 / transformScale(ctx)
  ctx.beginPath()
  ctx.moveTo(pts[0]!.x, pts[0]!.y)
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

function paintBody(ctx: PaintCtx, node: LayoutNode, debug: boolean, t: number, state: PaintState) {
  if (node.kind === 'text') {
    drawBoxChrome(ctx, node)
    drawTextNode(ctx, node)
  } else if (node.kind === 'image') {
    drawBoxChrome(ctx, node)
    drawImageNode(ctx, node)
  } else if (node.kind === 'shape') {
    drawShape(ctx, node)
  } else if (node.kind === 'line') {
    drawLine(ctx, node)
  } else if (node.kind === 'custom') {
    drawBoxChrome(ctx, node)
  } else if (node.kind === 'group') {
    ctx.save()
    ctx.transform(node.svg.a, node.svg.b, node.svg.c, node.svg.d, node.svg.e, node.svg.f)
    for (const ch of node.children) paintNode(ctx, ch, debug, t, state)
    ctx.restore()
  } else if (node.kind === 'flex' || node.kind === 'layer') {
    drawBoxChrome(ctx, node)
    ctx.save()
    const inset = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
    const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
    ctx.translate(node.x + inset, node.y + insetY)
    if (node.kind === 'layer' && (node.overflow === 'hidden' || node.view)) {
      ctx.beginPath()
      ctx.rect(0, 0, node.width, node.height)
      ctx.clip()
    }
    if (node.kind === 'layer' && node.view) {
      const mapping = viewMatrix(node.width, node.height, node.view)
      ctx.transform(mapping.a, mapping.b, mapping.c, mapping.d, mapping.e, mapping.f)
    }
    const meshFrame = node.kind === 'layer' ? state.meshFrames?.get(node) : undefined
    if (meshFrame && meshFrame.width > 0 && meshFrame.height > 0) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(meshFrame.canvas, meshFrame.x, meshFrame.y, meshFrame.width, meshFrame.height)
    } else if (meshFrame) {
      // 投影落在可见范围外，这一层不再走二维透视。
    } else if (node.kind === 'layer' && hasPerspective(node.perspective) && (cameraSceneCustom(node) || node.children.some(has3dPose))) {
      if (cameraSceneCustom(node)) paintProjectedChildren(ctx, node, debug, t, state)
      else paintPerspectiveChildren(ctx, node, debug, t, state)
    } else {
      for (const ch of node.children) paintNode(ctx, ch, debug, t, state)
    }
    ctx.restore()
  }
}

function paintNodeEffectsAndBody(
  ctx: PaintCtx,
  node: LayoutNode,
  debug: boolean,
  t: number,
  state: PaintState,
  opts: { sampleBackdrop: boolean; skipNoise?: boolean; skipOwnOuter?: boolean },
) {
  // glass 未写 shadow 时补一层柔和投影，接近系统控件浮起感
  const drawShadow = () => {
    if (node.shadow) {
      drawEffect(ctx, state, node, shadowEffect(node.shadow), (spread) => drawEffectInk(ctx, node, spread, state))
    } else if (node.glass) {
      const depth = node.glass.variant === 'thick' ? 18 : node.glass.variant === 'clear' ? 12 : 14
      drawEffect(
        ctx,
        state,
        node,
        { dx: 0, dy: depth * 0.35, blur: depth, spread: 0, color: '#0000002e' },
        (spread) => drawEffectInk(ctx, node, spread, state),
      )
    }
  }
  // glass / backdrop-blur 采样背后像素，只能在主画布上做一次
  if (opts.sampleBackdrop && node.glass) {
    paintGlass(ctx, node, node.glass, drawShadow)
  } else {
    if (opts.sampleBackdrop && node.backdropBlur) paintBackdropBlur(ctx, node, node.backdropBlur)
    if (!opts.skipOwnOuter) drawShadow()
  }
  if (!opts.skipOwnOuter && node.glow) paintGlow(ctx, state, node, node.glow, (spread) => drawEffectInk(ctx, node, spread, state))
  if (!opts.skipOwnOuter) paintInkStrokes(ctx, node, 'outer', undefined, state)
  paintBody(ctx, node, debug, t, state)
  paintInkStrokes(ctx, node, 'inner', undefined, state)
  if (node.innerShadow) {
    paintInnerEffect(ctx, node, node.innerShadow, 'source-over')
  }
  if (node.innerGlow) {
    paintInnerEffect(
      ctx,
      node,
      { x: 0, y: 0, blur: node.innerGlow.blur, spread: node.innerGlow.spread, color: node.innerGlow.color },
      'screen',
    )
    paintInnerEffect(
      ctx,
      node,
      {
        x: 0,
        y: 0,
        blur: Math.max(2, node.innerGlow.blur * 0.35),
        spread: node.innerGlow.spread,
        color: node.innerGlow.color,
      },
      'screen',
    )
  }
  if (node.overlay) paintOverlay(ctx, node, node.overlay, state)
  if (node.noise && !opts.skipNoise) paintNoise(ctx, node, node.noise)
  runElementDraw(ctx, node, t, state)
}

/**
 * 按注册顺序跑像素滤镜。origin 是盒子左上角在缓冲里的逻辑坐标，k 是逻辑到像素的缩放。
 * 遮罩按盒子铺，alpha 是强度。
 */
function applyPixelFilters(
  canvas: Canvas,
  filters: AppliedFilter[],
  k: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
) {
  if (filters.length === 0) return
  const pw = canvas.width
  const ph = canvas.height
  if (pw <= 0 || ph <= 0) return
  const cctx = canvas.getContext('2d') as PaintCtx
  const image = cctx.getImageData(0, 0, pw, ph)
  const frame = { x: originX * k, y: originY * k, width: width * k, height: height * k }
  for (const item of filters) {
    const apply = getFilter(item.name)?.apply
    if (!apply) continue
    let mask: Uint8ClampedArray | undefined
    if (item.mask) {
      const m = createCanvas(pw, ph)
      const mctx = m.getContext('2d') as PaintCtx
      mctx.setTransform(k, 0, 0, k, originX * k, originY * k)
      mctx.fillStyle = paintOf(mctx, item.mask, 0, 0, width, height)
      mctx.fillRect(-originX, -originY, pw / k, ph / k)
      mask = mctx.getImageData(0, 0, pw, ph).data
    }
    const before = mask ? image.data.slice() : undefined
    apply({ data: image.data, width: pw, height: ph, frame, mask }, item.spec)
    if (before && mask) {
      const data = image.data
      for (let i = 0; i < data.length; i += 4) {
        const m = mask[i + 3]! / 255
        if (m >= 1) continue
        data[i] = before[i]! + (data[i]! - before[i]!) * m
        data[i + 1] = before[i + 1]! + (data[i + 1]! - before[i + 1]!) * m
        data[i + 2] = before[i + 2]! + (data[i + 2]! - before[i + 2]!) * m
        data[i + 3] = before[i + 3]! + (data[i + 3]! - before[i + 3]!) * m
      }
    }
  }
  cctx.putImageData(image, 0, 0)
}

function canvasFilterCss(node: LayoutNode, samples = 1): string {
  const parts: string[] = []
  if ((node.blur ?? 0) > 0) parts.push(`blur(${node.blur! * samples}px)`)
  for (const item of orderedFilters(node.filters, 'canvas')) {
    const css = getFilter(item.name)?.canvasFilter?.(item.spec)
    if (css) parts.push(css)
  }
  return parts.join(' ')
}

function hasOwnOuter(node: LayoutNode): boolean {
  if (node.shadow || node.glow) return true
  return node.inkStroke?.some((layer) => layer.position === 'outside' || layer.position === 'center') ?? false
}

/** 蒙版裁完之后，用留下的轮廓画这一层自己的阴影、光晕和外侧描边。 */
function compositeMaskedOuter(
  body: Canvas,
  node: LayoutNode,
  k: number,
  effectPad: number,
  tw: number,
  th: number,
  state: PaintState,
): Canvas {
  const sil = createCanvas(body.width, body.height)
  const sctx = sil.getContext('2d')
  sctx.drawImage(body, 0, 0)
  sctx.globalCompositeOperation = 'source-in'
  sctx.fillStyle = SILHOUETTE
  sctx.fillRect(0, 0, sil.width, sil.height)
  const out = createCanvas(body.width, body.height)
  const octx = out.getContext('2d') as PaintCtx
  octx.setTransform(k, 0, 0, k, 0, 0)
  octx.translate(-node.x + effectPad, -node.y + effectPad)
  const bounds = { x: node.x - effectPad, y: node.y - effectPad, width: tw, height: th }
  const drawSil = (spread: number) => {
    const blit = (dctx: PaintCtx) => {
      dctx.drawImage(sil, node.x - effectPad, node.y - effectPad, tw, th)
    }
    if (Math.abs(spread) < 1e-3) blit(octx)
    else paintDilatedInk(octx, spread, SILHOUETTE, bounds, blit)
  }
  if (node.shadow) drawEffect(octx, state, node, shadowEffect(node.shadow), drawSil)
  if (node.glow) paintGlow(octx, state, node, node.glow, drawSil)
  paintInkStrokes(octx, node, 'outer', {
    bounds,
    draw: (dctx) => {
      dctx.drawImage(sil, node.x - effectPad, node.y - effectPad, tw, th)
    },
  })
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.drawImage(body, 0, 0)
  return out
}

function paintWithLayerFilter(ctx: PaintCtx, node: LayoutNode, debug: boolean, t: number, state: PaintState) {
  const blur = node.blur ?? 0
  const pixel = orderedFilters(node.filters, 'pixel')
  const filter = canvasFilterCss(node, state.supersample ?? 1)
  const masks = layerMaskOf(node)
  const strokeReach = outerInkStrokeReach(node.inkStroke)
  const pad = Math.ceil(blur * 2 + 4 + filtersPad(node.filters))
  const shadowPad = node.shadow
    ? node.shadow.blur * 2 + node.shadow.spread + strokeReach + Math.max(Math.abs(node.shadow.x), Math.abs(node.shadow.y))
    : 0
  const glowPad = node.glow ? node.glow.blur * 2 + node.glow.spread + strokeReach : 0
  let effectPad = Math.max(pad, Math.ceil(shadowPad), Math.ceil(glowPad), Math.ceil(strokeReach))
  if (masks && node.glass) effectPad = Math.max(effectPad, Math.ceil(node.glass.blur * 2 + 8))
  if (masks && node.backdropBlur) effectPad = Math.max(effectPad, Math.ceil(node.backdropBlur * 2 + 4))
  const tw = Math.max(1, Math.ceil(node.width + effectPad * 2))
  const th = Math.max(1, Math.ceil(node.height + effectPad * 2))
  const k = transformScale(ctx)
  const off = createCanvas(Math.max(1, Math.ceil(tw * k)), Math.max(1, Math.ceil(th * k)))
  const octx = off.getContext('2d') as PaintCtx
  octx.setTransform(k, 0, 0, k, 0, 0)
  octx.translate(-node.x + effectPad, -node.y + effectPad)
  // 有 mask 时玻璃必须画进离屏，采样仍来自主画布，最后和阴影、模糊一起被裁掉
  const sampleHere = masks != null && (node.glass != null || node.backdropBlur != null)
  const deferOuter = masks != null && node.glass == null && hasOwnOuter(node)
  if (sampleHere) copyParentUnderlay(ctx, octx)
  // 有像素滤镜时颗粒在调色之后再叠，不被染色。蒙版层自己的外扩效果等裁完再画。
  paintNodeEffectsAndBody(octx, node, debug, t, state, {
    sampleBackdrop: sampleHere,
    skipNoise: pixel.length > 0,
    skipOwnOuter: deferOuter,
  })
  if (pixel.length) applyPixelFilters(off, pixel, k, effectPad, effectPad, node.width, node.height)
  if (!masks) {
    ctx.save()
    ctx.filter = filter || 'none'
    ctx.drawImage(off, node.x - effectPad, node.y - effectPad, tw, th)
    ctx.filter = 'none'
    ctx.restore()
    if (pixel.length && node.noise) paintNoise(ctx, node, node.noise)
    return
  }
  let target = off
  if (filter) {
    target = createCanvas(off.width, off.height)
    const fctx = target.getContext('2d') as PaintCtx
    fctx.setTransform(k, 0, 0, k, 0, 0)
    fctx.filter = filter
    fctx.drawImage(off, 0, 0, tw, th)
    fctx.filter = 'none'
  }
  if (pixel.length && node.noise) {
    const nctx = target.getContext('2d') as PaintCtx
    nctx.save()
    nctx.setTransform(k, 0, 0, k, 0, 0)
    nctx.translate(-node.x + effectPad, -node.y + effectPad)
    paintNoise(nctx, node, node.noise)
    nctx.restore()
  }
  applyLayerMask(target, masks, k, effectPad, t, state, node.kind === 'layer' ? node.maskFeather ?? 0 : 0, node.kind === 'layer' ? node.maskInvert ?? false : false)
  if (deferOuter) target = compositeMaskedOuter(target, node, k, effectPad, tw, th, state)
  ctx.save()
  ctx.filter = 'none'
  ctx.drawImage(target, node.x - effectPad, node.y - effectPad, tw, th)
  ctx.restore()
}

function paintNode(
  ctx: CanvasRenderingContext2D,
  node: LayoutNode,
  debug: boolean,
  t: number,
  state: PaintState,
  skipTransform = false,
) {
  const pctx = ctx as PaintCtx
  pctx.save()
  pctx.globalAlpha *= node.opacity
  if (!skipTransform) applyNodeTransform(pctx, node)
  if (node.blend && node.blend !== 'source-over') {
    pctx.globalCompositeOperation = node.blend
  }
  const hasMask = layerMaskOf(node) != null
  const useLayerFilter = (node.blur != null && node.blur > 0) || (node.filters != null && node.filters.length > 0) || hasMask
  if (useLayerFilter) {
    // 先在主画布采样玻璃/背景模糊，再把本体效果离屏糊上。有 mask 时改在离屏里采样，好让 mask 一并裁掉。
    if (!hasMask) {
      if (node.glass) paintGlass(pctx, node, node.glass)
      else if (node.backdropBlur) paintBackdropBlur(pctx, node, node.backdropBlur)
    }
    paintWithLayerFilter(pctx, node, debug, t, state)
  } else {
    paintNodeEffectsAndBody(pctx, node, debug, t, state, { sampleBackdrop: true })
  }
  if (debug) drawDebugOverlay(pctx, node)
  pctx.restore()
}

function nodePose(node: LayoutNode): Matrix {
  if (node.rotate === 0 && node.scaleX === 1 && node.scaleY === 1) return IDENTITY
  const o = originOffset(node.origin, node.width, node.height)
  return aroundPivot(node.x + o.x, node.y + o.y, node.rotate, node.scaleX, node.scaleY)
}

/** 文档画布和沿途裁剪，换算到这一层绘制网格时的坐标。 */
function meshVisibleRect(docWidth: number, docHeight: number, root: LayerLayoutNode, target: LayerLayoutNode): Box {
  let found: Box | null = null
  const visit = (node: LayoutNode, parent: Matrix, clip: Box) => {
    if (found) return
    const posed = multiply(parent, nodePose(node))
    const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
    const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
    const preView = node.kind === 'group' ? posed : multiply(posed, translated(node.x + insetX, node.y + insetY))
    let nextClip = clip
    if (node.kind === 'layer' && (node.overflow === 'hidden' || node.view)) {
      nextClip = intersectBox(clip, applyToBox(preView, { x: 0, y: 0, width: node.width, height: node.height }))
    }
    let content = preView
    if (node.kind === 'layer' && node.view) content = multiply(preView, viewMatrix(node.width, node.height, node.view))
    if (node.kind === 'group') content = multiply(posed, node.svg)
    if (node === target && node.kind === 'layer') {
      const inv = invert(content)
      found = inv ? applyToBox(inv, nextClip) : { x: 0, y: 0, width: node.width, height: node.height }
      return
    }
    if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
      for (const child of node.children) visit(child, content, nextClip)
    }
  }
  visit(root, IDENTITY, { x: 0, y: 0, width: docWidth, height: docHeight })
  return found ?? { x: 0, y: 0, width: target.width, height: target.height }
}

async function prepareMeshFrames(
  root: LayerLayoutNode,
  scale: number,
  t: number,
  clock: { frame: number; fps: number },
  issues: Issue[],
  docWidth: number,
  docHeight: number,
  mesh: { samples?: 1 | 2 | 4; cacheBytes?: number | false },
): Promise<Map<LayerLayoutNode, MeshFrame>> {
  const frames = new Map<LayerLayoutNode, MeshFrame>()
  const state: PaintState = { canvasWidth: 0, canvasHeight: 0, frame: clock.frame, fps: clock.fps, issues, meshFrames: frames }
  const visit = async (node: LayoutNode, parentK: number) => {
    const k = parentK * layoutScale(node)
    if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
      for (const child of node.children) await visit(child, k)
    }
    if (node.kind !== 'layer' || !ownsMeshScene(node)) return
    const frame = renderMeshLayer(
      node,
      k,
      (peeled) => paintChildBitmap(peeled, Math.max(k, 1e-3) * 2, t, state, 2),
      {
        clip: meshVisibleRect(docWidth, docHeight, root, node),
        samples: mesh.samples,
        cacheBytes: mesh.cacheBytes,
      },
    )
    if (frame) frames.set(node, frame)
  }
  await visit(root, scale)
  return frames
}

/** 把这一层画在自己的布局盒里，原点是左上角。`masked` 为假时不套蒙版。 */
export function paintLayerIsolated(node: LayerLayoutNode, masked: boolean): Canvas {
  const width = Math.max(1, Math.ceil(node.width))
  const height = Math.max(1, Math.ceil(node.height))
  const canvas = createCanvas(width, height)
  const state: PaintState = { canvasWidth: width, canvasHeight: height, frame: 0, fps: 30, issues: [] }
  const clone: LayerLayoutNode = { ...node, x: 0, y: 0, mask: masked ? node.mask : undefined }
  paintNode(canvas.getContext('2d'), clone, false, 0, state)
  return canvas
}

export async function paintDocument(
  root: LayerLayoutNode,
  opts: PaintOptions,
): Promise<Canvas> {
  const w = Math.round(opts.width * opts.scale)
  const h = Math.round(opts.height * opts.scale)
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const issues = opts.issues ?? []
  const state: PaintState = {
    canvasWidth: w,
    canvasHeight: h,
    frame: opts.frame ?? 0,
    fps: opts.fps ?? 0,
    issues,
    meshFrames: await prepareMeshFrames(root, opts.scale, opts.t, { frame: opts.frame ?? 0, fps: opts.fps ?? 0 }, issues, opts.width, opts.height, {
      samples: opts.meshSamples,
      cacheBytes: opts.meshCache,
    }),
  }
  const rootPaintsBackground =
    root.background != null &&
    root.background !== 'transparent' &&
    root.x === 0 &&
    root.y === 0 &&
    root.width >= opts.width &&
    root.height >= opts.height
  if (!rootPaintsBackground && opts.background !== 'transparent') {
    if (isGradient(opts.background)) {
      ctx.save()
      ctx.scale(opts.scale, opts.scale)
      ctx.fillStyle = paintOf(ctx, opts.background, 0, 0, opts.width, opts.height)
      ctx.fillRect(0, 0, opts.width, opts.height)
      ctx.restore()
    } else {
      ctx.fillStyle = opts.background
      ctx.fillRect(0, 0, w, h)
    }
  }
  // 根 layer 上 includeBackdrop 的像素滤镜作用于整幅画布，连同画布底色。grade 是其中之一。
  const backdrop = backdropFilters(root.filters)
  const kept = (root.filters ?? []).filter((item) => !(item.includeBackdrop && item.kind === 'pixel'))
  const body: LayerLayoutNode = backdrop.length
    ? {
        ...root,
        filters: kept.length ? kept : undefined,
        grade: backdrop.some((item) => item.name === 'grade') ? undefined : root.grade,
        gradeMask: backdrop.some((item) => item.name === 'grade') ? undefined : root.gradeMask,
        noise: undefined,
      }
    : root
  ctx.save()
  ctx.scale(opts.scale, opts.scale)
  paintNode(ctx, body, opts.debug, opts.t, state)
  ctx.restore()
  if (backdrop.length) {
    applyPixelFilters(canvas, backdrop, opts.scale, 0, 0, opts.width, opts.height)
    if (root.noise) {
      const pctx = ctx as PaintCtx
      if (root.mask && root.mask.length > 0) {
        const off = createCanvas(w, h)
        const octx = off.getContext('2d') as PaintCtx
        octx.scale(opts.scale, opts.scale)
        octx.globalAlpha *= root.opacity
        applyNodeTransform(octx, root)
        paintNoise(octx, root, root.noise, 'source-over')
        const masked = maskComposite(
          w,
          h,
          root.mask,
          (ctx) => {
            ctx.scale(opts.scale, opts.scale)
            applyNodeTransform(ctx, root)
          },
          (root.maskFeather ?? 0) * opts.scale,
          root.maskInvert ?? false,
          opts.t,
          state,
        )
        octx.save()
        octx.setTransform(1, 0, 0, 1, 0, 0)
        octx.globalAlpha = 1
        octx.globalCompositeOperation = 'destination-in'
        octx.drawImage(masked.canvas, 0, 0)
        octx.restore()
        pctx.save()
        pctx.setTransform(1, 0, 0, 1, 0, 0)
        pctx.globalCompositeOperation = 'soft-light'
        pctx.drawImage(off, 0, 0)
        pctx.restore()
      } else {
        pctx.save()
        pctx.scale(opts.scale, opts.scale)
        pctx.globalAlpha *= root.opacity
        applyNodeTransform(pctx, root)
        paintNoise(pctx, root, root.noise)
        pctx.restore()
      }
    }
  }
  return canvas
}
