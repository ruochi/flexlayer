import {
  createCanvas,
  Path2D,
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
}
import { applyCanvasFont } from './fonts.js'
import { fitImageRect } from './image.js'
import { applyGrade } from './grade.js'
import { canvasPaint, isGradient } from './gradient.js'
import { gradientStyle, isGradientPaint, type GradientBox } from './gradientField.js'
import { invert, multiply, originOffset } from './matrix.js'
import { ownsMeshScene, renderMeshLayer } from './mesh.js'
import { drawTexturedPlane, has3dPose, PERSPECTIVE_AA, planeDepth, posePoint, project } from './perspective.js'
import { colorFilterToCss } from './style.js'
import type {
  GlassSpec,
  GlowSpec,
  GradeSpec,
  ImageLayoutNode,
  LayerLayoutNode,
  LayoutNode,
  LineLayoutNode,
  NoiseSpec,
  OverlaySpec,
  ShadowSpec,
  ShapeLayoutNode,
  TextLayoutNode,
} from './types.js'
import type { DrawElSnapshot } from './types.js'

export type PaintOptions = {
  width: number
  height: number
  background: string
  scale: number
  debug: boolean
  t: number
}

type PaintState = { canvasWidth: number; canvasHeight: number; meshFrames?: Map<LayerLayoutNode, Canvas> }

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
  if (node.geometry.kind === 'arrow') {
    const head = node.geometry.head ?? Math.max(12, node.strokeWidth * 4)
    pad = Math.max(pad, head + 2)
  }
  return pad
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
  ctx.lineTo(x + rad, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad)
  ctx.lineTo(x, y + rad)
  ctx.quadraticCurveTo(x, y, x + rad, y)
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

function drawTextNode(ctx: CanvasRenderingContext2D, node: TextLayoutNode, inkColor?: string) {
  const contentX = node.x + node.padding.left + (node.border?.width ?? 0)
  const contentY = node.y + node.padding.top + (node.border?.width ?? 0)
  for (const line of node.textLayout.lines) {
    let offsetX = 0
    if (node.textAlign === 'center') offsetX = (node.width - node.padding.left - node.padding.right - (node.border?.width ?? 0) * 2 - line.width) / 2
    if (node.textAlign === 'right') offsetX = node.width - node.padding.left - node.padding.right - (node.border?.width ?? 0) * 2 - line.width
    for (const seg of line.segments) {
      applyCanvasFont(ctx, seg.style.fontFamily, seg.style.fontWeight, seg.style.fontSize)
      ctx.fillStyle = inkColor ?? seg.style.color
      ctx.letterSpacing = `${seg.style.letterSpacing}px`
      ctx.fillText(seg.text, contentX + offsetX + seg.x, contentY + line.baselineY)
    }
  }
}

function drawShape(ctx: CanvasRenderingContext2D, node: ShapeLayoutNode) {
  const x = node.x
  const y = node.y
  const pad = shapePad(node)
  if (node.shape === 'rect') {
    const r = node.rx ?? 0
    if (r > 0) {
      roundRectPath(ctx, x, y, node.width, node.height, r)
      if (node.fill !== 'none') {
        ctx.fillStyle = paintOf(ctx, node.fill, node.x, node.y, node.width, node.height, pad)
        ctx.fill()
      }
      if (node.stroke !== 'none') {
        ctx.strokeStyle = paintOf(ctx, node.stroke, node.x, node.y, node.width, node.height, pad)
        ctx.lineWidth = node.strokeWidth
        ctx.stroke()
      }
    } else {
      if (node.fill !== 'none') {
        ctx.fillStyle = paintOf(ctx, node.fill, node.x, node.y, node.width, node.height, pad)
        ctx.fillRect(x, y, node.width, node.height)
      }
      if (node.stroke !== 'none') {
        ctx.strokeStyle = paintOf(ctx, node.stroke, node.x, node.y, node.width, node.height, pad)
        ctx.lineWidth = node.strokeWidth
        ctx.strokeRect(x, y, node.width, node.height)
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
      ctx.stroke()
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
      ctx.stroke()
    }
  }
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, head: number) {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6))
  ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
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
  const g = node.geometry
  if (g.kind === 'line' || g.kind === 'arrow') {
    if (!stroked) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(g.x1, g.y1)
    ctx.lineTo(g.x2, g.y2)
    ctx.stroke()
    if (g.kind === 'arrow') {
      const head = g.head ?? Math.max(12, node.strokeWidth * 4)
      drawArrowHead(ctx, g.x1, g.y1, g.x2, g.y2, head)
    }
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
    const p = new Path2D(g.d)
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
  ctx.strokeStyle = 'rgba(0, 120, 255, 0.85)'
  ctx.lineWidth = 1
  ctx.strokeRect(node.x + 0.5, node.y + 0.5, node.width, node.height)
  ctx.strokeStyle = 'rgba(255, 40, 40, 0.85)'
  ctx.strokeRect(node.x + node.ink.x + 0.5, node.y + node.ink.y + 0.5, node.ink.width, node.ink.height)
  ctx.restore()
}

function buildDrawEl(node: LayoutNode, t: number): DrawElSnapshot {
  return {
    tag: node.tag,
    id: node.id,
    text: node.text,
    attr: node.attr,
    style: node.style,
    computed: node.computed,
    w: node.width,
    h: node.height,
    t,
  }
}

function runElementDraw(ctx: CanvasRenderingContext2D, node: LayoutNode, t: number) {
  if (!node.draw) return
  ctx.save()
  ctx.translate(node.x, node.y)
  node.draw(ctx, buildDrawEl(node, t))
  ctx.restore()
}

/** 绕 origin 旋转、缩放。支点用当前坐标系里的绝对位置，子绘制仍使用 node.x/node.y。 */
function applyNodeTransform(ctx: CanvasRenderingContext2D, node: LayoutNode) {
  if (node.rotate === 0 && node.scale === 1) return
  const o = originOffset(node.origin, node.width, node.height)
  const px = node.x + o.x
  const py = node.y + o.y
  ctx.translate(px, py)
  ctx.rotate((node.rotate * Math.PI) / 180)
  ctx.scale(node.scale, node.scale)
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
  ctx.fillStyle = ink
  if (node.shape === 'rect') {
    const x = node.x - spread
    const y = node.y - spread
    const w = node.width + spread * 2
    const h = node.height + spread * 2
    if (w <= 0 || h <= 0) return
    const radius = Math.max(0, (node.rx ?? node.borderRadius ?? 0) + spread)
    if (radius > 0) {
      roundRectPath(ctx, x, y, w, h, radius)
      ctx.fill()
    } else ctx.fillRect(x, y, w, h)
    return
  }
  if (node.shape === 'circle') {
    const radius = (node.r ?? node.width / 2) + spread
    if (radius <= 0) return
    ctx.beginPath()
    ctx.arc(node.x + node.width / 2, node.y + node.height / 2, radius, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const rx = (node.rxEllipse ?? node.width / 2) + spread
  const ry = (node.ry ?? node.height / 2) + spread
  if (rx <= 0 || ry <= 0) return
  ctx.beginPath()
  ctx.ellipse(node.x + node.width / 2, node.y + node.height / 2, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
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

function paintGlow(ctx: CanvasRenderingContext2D, state: PaintState, node: LayoutNode, glow: GlowSpec, drawSilhouette: (spread: number) => void) {
  const wide = { dx: 0, dy: 0, blur: glow.blur, spread: glow.spread, color: glow.color }
  drawEffect(ctx, state, node, wide, drawSilhouette, 'screen')
  drawEffect(ctx, state, node, { ...wide, blur: Math.max(2, glow.blur * 0.35) }, drawSilhouette, 'screen')
}

/**
 * 效果用的着墨轮廓：跟真实画出来的像素走，不跟布局盒子。
 * 文字 = 背景 chrome（若有）+ 字形；形状/线 = 几何墨迹；layer/flex = 仅自身背景/边框。
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
  if (node.kind === 'text') {
    if (node.background && node.background !== 'transparent') drawBoxSilhouette(ctx, node, spread, ink)
    drawTextNode(ctx, node, ink)
    return
  }
  if (node.kind === 'image') {
    if (node.background && node.background !== 'transparent') drawBoxSilhouette(ctx, node, spread, ink)
    drawImageNode(ctx, node, ink)
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

/** layer overlay：自身 chrome + 子树着墨（子元素局部坐标）。 */
function drawSubtreeInk(ctx: CanvasRenderingContext2D, node: LayoutNode, spread: number, ink = SILHOUETTE) {
  drawNodeInk(ctx, node, spread, ink)
  if (node.kind !== 'layer' && node.kind !== 'flex') return
  const insetX = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
  const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
  ctx.save()
  ctx.translate(node.x + insetX, node.y + insetY)
  for (const ch of node.children) drawSubtreeInk(ctx, ch, spread, ink)
  ctx.restore()
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
function paintOverlay(ctx: PaintCtx, node: LayoutNode, overlay: OverlaySpec) {
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
  drawSubtreeInk(clipCtx, node, 0, '#ffffff')
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

/** 形状和图片按书写顺序画进透明缓冲，再用 destination-in 只保留 alpha。 */
function applyLayerMask(canvas: Canvas, shapes: LayoutNode[], k: number, origin: number, t: number, state: PaintState) {
  const pw = canvas.width
  const ph = canvas.height
  if (pw <= 0 || ph <= 0) return
  const mask = createCanvas(pw, ph)
  const mctx = mask.getContext('2d') as PaintCtx
  mctx.setTransform(k, 0, 0, k, origin * k, origin * k)
  for (const shape of shapes) paintNode(mctx, shape, false, t, state)
  const cctx = canvas.getContext('2d') as PaintCtx
  cctx.save()
  cctx.setTransform(1, 0, 0, 1, 0, 0)
  cctx.globalAlpha = 1
  cctx.globalCompositeOperation = 'destination-in'
  cctx.drawImage(mask, 0, 0)
  cctx.restore()
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

/** Felzenszwalb 一维平方距离变换 */
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

/** 墨迹内部每个像素到最近墨迹边缘的欧氏距离（设备像素） */
function inkDistanceField(maskData: Uint8ClampedArray, w: number, h: number): Float32Array {
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = maskData[i * 4 + 3]! >= 128 ? EDT_INF : 0
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
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = grid[i]! > 0 ? Math.max(0, Math.sqrt(grid[i]!) - 0.5) : 0
  return out
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
  if (node.kind === 'layer' || node.kind === 'flex') {
    for (const child of node.children) pad = Math.max(pad, planeBitmapPad(child))
  }
  return pad > 0 ? Math.ceil(pad + 2) : 0
}

function paintChildBitmap(
  child: LayoutNode,
  k: number,
  t: number,
  state: PaintState,
): { canvas: Canvas; pad: number; logicalWidth: number; logicalHeight: number } {
  const pad = planeBitmapPad(child)
  const logicalWidth = child.width + pad * 2
  const logicalHeight = child.height + pad * 2
  const w = Math.max(1, Math.ceil(logicalWidth * k))
  const h = Math.max(1, Math.ceil(logicalHeight * k))
  const canvas = createCanvas(w, h)
  const octx = canvas.getContext('2d') as PaintCtx
  // 位图是平面局部像素。rotate / scale 交给 posePoint，避免和投影各转一次。
  octx.setTransform(k, 0, 0, k, (-child.x + pad) * k, (-child.y + pad) * k)
  paintNode(octx, child, false, t, state, true)
  return { canvas, pad, logicalWidth, logicalHeight }
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
    if (depth >= perspective) continue
    if (!has3dPose(child)) {
      paintNode(ctx, child, debug, t, state)
      continue
    }
    const { canvas: bitmap, pad, logicalWidth, logicalHeight } = paintChildBitmap(child, k * PERSPECTIVE_AA, t, state)
    const at = (u: number, v: number) => {
      const p = posePoint(child, u - pad, v - pad)
      return project(vx, vy, perspective, p)
    }
    drawTexturedPlane(ctx, bitmap, logicalWidth, logicalHeight, at)
    if (debug) strokeProjectedQuad(ctx, child, vx, vy, perspective)
  }
}

function strokeProjectedQuad(
  ctx: PaintCtx,
  child: LayoutNode,
  vx: number,
  vy: number,
  perspective: number,
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
  ctx.lineWidth = 1.5
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
  } else if (node.kind === 'flex' || node.kind === 'layer') {
    drawBoxChrome(ctx, node)
    ctx.save()
    const inset = node.kind === 'flex' ? node.padding.left + (node.border?.width ?? 0) : 0
    const insetY = node.kind === 'flex' ? node.padding.top + (node.border?.width ?? 0) : 0
    ctx.translate(node.x + inset, node.y + insetY)
    if (node.kind === 'layer' && node.overflow === 'hidden') {
      ctx.beginPath()
      ctx.rect(0, 0, node.width, node.height)
      ctx.clip()
    }
    const meshFrame = node.kind === 'layer' ? state.meshFrames?.get(node) : undefined
    if (meshFrame) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(meshFrame, 0, 0, node.width, node.height)
    } else if (node.kind === 'layer' && node.perspective != null && node.perspective > 0 && node.children.some(has3dPose)) {
      paintPerspectiveChildren(ctx, node, debug, t, state)
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
  opts: { sampleBackdrop: boolean; skipNoise?: boolean },
) {
  // glass 未写 shadow 时补一层柔和投影，接近系统控件浮起感
  const drawShadow = () => {
    if (node.shadow) {
      drawEffect(ctx, state, node, shadowEffect(node.shadow), (spread) => drawNodeInk(ctx, node, spread))
    } else if (node.glass) {
      const depth = node.glass.variant === 'thick' ? 18 : node.glass.variant === 'clear' ? 12 : 14
      drawEffect(
        ctx,
        state,
        node,
        { dx: 0, dy: depth * 0.35, blur: depth, spread: 0, color: '#0000002e' },
        (spread) => drawNodeInk(ctx, node, spread),
      )
    }
  }
  // glass / backdrop-blur 采样背后像素，只能在主画布上做一次
  if (opts.sampleBackdrop && node.glass) {
    paintGlass(ctx, node, node.glass, drawShadow)
  } else {
    if (opts.sampleBackdrop && node.backdropBlur) paintBackdropBlur(ctx, node, node.backdropBlur)
    drawShadow()
  }
  if (node.glow) paintGlow(ctx, state, node, node.glow, (spread) => drawNodeInk(ctx, node, spread))
  paintBody(ctx, node, debug, t, state)
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
  if (node.overlay) paintOverlay(ctx, node, node.overlay)
  if (node.noise && !opts.skipNoise) paintNoise(ctx, node, node.noise)
  runElementDraw(ctx, node, t)
}

/**
 * 对整块像素缓冲调色。origin 是盒子左上角在缓冲里的逻辑坐标，k 是逻辑到像素的缩放。
 * 遮罩按盒子铺，alpha 是强度。
 */
function gradeCanvas(
  canvas: Canvas,
  spec: GradeSpec,
  maskPaint: string | undefined,
  k: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
) {
  const pw = canvas.width
  const ph = canvas.height
  if (pw <= 0 || ph <= 0) return
  const cctx = canvas.getContext('2d') as PaintCtx
  const image = cctx.getImageData(0, 0, pw, ph)
  let mask: Uint8ClampedArray | undefined
  if (maskPaint) {
    const m = createCanvas(pw, ph)
    const mctx = m.getContext('2d') as PaintCtx
    mctx.setTransform(k, 0, 0, k, originX * k, originY * k)
    mctx.fillStyle = paintOf(mctx, maskPaint, 0, 0, width, height)
    mctx.fillRect(-originX, -originY, pw / k, ph / k)
    mask = mctx.getImageData(0, 0, pw, ph).data
  }
  applyGrade(image.data, pw, ph, spec, { x: originX * k, y: originY * k, width: width * k, height: height * k }, mask)
  cctx.putImageData(image, 0, 0)
}

function paintWithLayerFilter(ctx: PaintCtx, node: LayoutNode, debug: boolean, t: number, state: PaintState) {
  const blur = node.blur ?? 0
  const filterCss = node.colorFilter?.length ? colorFilterToCss(node.colorFilter) : ''
  const masks = layerMaskOf(node)
  const pad = Math.ceil(blur * 2 + 4)
  const shadowPad = node.shadow
    ? node.shadow.blur * 2 + node.shadow.spread + Math.max(Math.abs(node.shadow.x), Math.abs(node.shadow.y))
    : 0
  const glowPad = node.glow ? node.glow.blur * 2 + node.glow.spread : 0
  let effectPad = Math.max(pad, Math.ceil(shadowPad), Math.ceil(glowPad))
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
  if (sampleHere) copyParentUnderlay(ctx, octx)
  // 有 grade 时颗粒在调色之后再叠，不被染色
  paintNodeEffectsAndBody(octx, node, debug, t, state, { sampleBackdrop: sampleHere, skipNoise: node.grade != null })
  if (node.grade) gradeCanvas(off, node.grade, node.gradeMask, k, effectPad, effectPad, node.width, node.height)
  const parts: string[] = []
  if (blur > 0) parts.push(`blur(${blur}px)`)
  if (filterCss) parts.push(filterCss)
  const filter = parts.join(' ')
  if (!masks) {
    ctx.save()
    ctx.filter = filter || 'none'
    ctx.drawImage(off, node.x - effectPad, node.y - effectPad, tw, th)
    ctx.filter = 'none'
    ctx.restore()
    if (node.grade && node.noise) paintNoise(ctx, node, node.noise)
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
  if (node.grade && node.noise) {
    const nctx = target.getContext('2d') as PaintCtx
    nctx.save()
    nctx.setTransform(k, 0, 0, k, 0, 0)
    nctx.translate(-node.x + effectPad, -node.y + effectPad)
    paintNoise(nctx, node, node.noise)
    nctx.restore()
  }
  applyLayerMask(target, masks, k, effectPad, t, state)
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
  const useLayerFilter =
    (node.blur != null && node.blur > 0) ||
    (node.colorFilter != null && node.colorFilter.length > 0) ||
    node.grade != null ||
    hasMask
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

async function prepareMeshFrames(root: LayerLayoutNode, scale: number, t: number): Promise<Map<LayerLayoutNode, Canvas>> {
  const frames = new Map<LayerLayoutNode, Canvas>()
  const state: PaintState = { canvasWidth: 0, canvasHeight: 0, meshFrames: frames }
  const visit = async (node: LayoutNode) => {
    if (node.kind === 'layer' || node.kind === 'flex') {
      for (const child of node.children) await visit(child)
    }
    if (node.kind !== 'layer' || !ownsMeshScene(node)) return
    const canvas = await renderMeshLayer(node, scale, (peeled) => paintChildBitmap(peeled, Math.max(scale, 1e-3) * 2, t, state))
    if (canvas) frames.set(node, canvas)
  }
  await visit(root)
  return frames
}

export async function paintDocument(
  root: LayerLayoutNode,
  opts: PaintOptions,
): Promise<Buffer> {
  const w = Math.round(opts.width * opts.scale)
  const h = Math.round(opts.height * opts.scale)
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const state: PaintState = {
    canvasWidth: w,
    canvasHeight: h,
    meshFrames: await prepareMeshFrames(root, opts.scale, opts.t),
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
  // 根 layer 的 grade 作用于整幅画布，连同画布底色
  const rootGrade = root.grade
  const body: LayerLayoutNode = rootGrade ? { ...root, grade: undefined, gradeMask: undefined, noise: undefined } : root
  ctx.save()
  ctx.scale(opts.scale, opts.scale)
  paintNode(ctx, body, opts.debug, opts.t, state)
  ctx.restore()
  if (rootGrade) {
    gradeCanvas(canvas, rootGrade, root.gradeMask, opts.scale, 0, 0, opts.width, opts.height)
    if (root.noise) {
      const pctx = ctx as PaintCtx
      if (root.mask && root.mask.length > 0) {
        const off = createCanvas(w, h)
        const octx = off.getContext('2d') as PaintCtx
        octx.scale(opts.scale, opts.scale)
        octx.globalAlpha *= root.opacity
        applyNodeTransform(octx, root)
        paintNoise(octx, root, root.noise, 'source-over')
        const mask = createCanvas(w, h)
        const mctx = mask.getContext('2d') as PaintCtx
        mctx.scale(opts.scale, opts.scale)
        applyNodeTransform(mctx, root)
        for (const shape of root.mask) paintNode(mctx, shape, false, opts.t, state)
        octx.save()
        octx.setTransform(1, 0, 0, 1, 0, 0)
        octx.globalAlpha = 1
        octx.globalCompositeOperation = 'destination-in'
        octx.drawImage(mask, 0, 0)
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
  return canvas.toBuffer('image/png')
}
