import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import type { GroupLayoutNode, ImageLayoutNode, LayoutNode, MaskOp, MaskOpReport } from './types.js'

const COMPOSITE: Record<MaskOp, CanvasRenderingContext2D['globalCompositeOperation']> = {
  add: 'source-over',
  subtract: 'destination-out',
  intersect: 'destination-in',
  xor: 'xor',
}

export type MaskComposeOptions = {
  width: number
  height: number
  shapes: LayoutNode[]
  /** 画布像素。羽化半径。 */
  feather: number
  invert: boolean
  /** 每次画一笔之前设好坐标系。 */
  prepare: (ctx: CanvasRenderingContext2D) => void
  /** 把形状画进已经设好变换的上下文。分组由合成自己处理。 */
  paintShape: (ctx: CanvasRenderingContext2D, shape: LayoutNode) => void
  /** 在已设好的变换上再叠这一组自己的变换。 */
  enterGroup: (ctx: CanvasRenderingContext2D, shape: GroupLayoutNode) => void
}

function round4(n: number): number {
  const rounded = Math.round(n * 10000) / 10000
  return Object.is(rounded, -0) ? 0 : rounded
}

function alphaOf(canvas: Canvas): Uint8ClampedArray {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!
  return alpha
}

function coverage(alpha: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 0; i < alpha.length; i++) sum += alpha[i]!
  return sum / 255
}

/** 两次方框模糊，近似羽化。只改 alpha。 */
function featherAlpha(canvas: Canvas, radius: number) {
  const r = Math.max(1, Math.round(radius / 2))
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  let alpha = alphaOf(canvas)
  for (let pass = 0; pass < 2; pass++) alpha = boxBlur(alpha, width, height, r)
  const image = ctx.getImageData(0, 0, width, height)
  for (let i = 0; i < alpha.length; i++) image.data[i * 4 + 3] = alpha[i]!
  ctx.putImageData(image, 0, 0)
}

function boxBlur(alpha: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const tmp = new Float32Array(alpha.length)
  const out = new Uint8ClampedArray(alpha.length)
  const div = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += alpha[y * width + Math.min(width - 1, Math.max(0, k))]!
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / div
      sum -= alpha[y * width + Math.min(width - 1, Math.max(0, x - radius))]!
      sum += alpha[y * width + Math.min(width - 1, Math.max(0, x + radius + 1))]!
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x]!
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / div)
      sum -= tmp[Math.min(height - 1, Math.max(0, y - radius)) * width + x]!
      sum += tmp[Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x]!
    }
  }
  return out
}

function invertAlpha(canvas: Canvas) {
  const ctx = canvas.getContext('2d')
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255 - image.data[i]!
  ctx.putImageData(image, 0, 0)
}

/** 把画出来的图片换成蒙版值：亮度或编号。 */
export function rewriteMaskImage(canvas: Canvas, node: ImageLayoutNode) {
  const pick = node.maskPick
  const channel = pick && !node.maskChannel ? 'luma' : node.maskChannel
  if (!channel && !pick) return
  const ctx = canvas.getContext('2d')
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  const chosen = pick ? new Set(pick) : null
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const a = data[i + 3]!
    let value = channel === 'luma' ? ((0.2126 * r + 0.7152 * g + 0.0722 * b) * a) / 255 : a
    if (chosen) value = chosen.has(Math.round(value)) ? 255 : 0
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = Math.max(0, Math.min(255, Math.round(value)))
  }
  ctx.putImageData(image, 0, 0)
}

function blit(dest: Canvas, src: Canvas, op: MaskOp) {
  const ctx = dest.getContext('2d')
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = COMPOSITE[op]
  ctx.drawImage(src, 0, 0)
  ctx.restore()
}

function compositeShapes(
  shapes: LayoutNode[],
  width: number,
  height: number,
  prepare: (ctx: CanvasRenderingContext2D) => void,
  options: MaskComposeOptions,
): { canvas: Canvas; steps: MaskOpReport[] } {
  const dest = createCanvas(width, height)
  const steps: MaskOpReport[] = []
  const total = width * height
  for (const shape of shapes) {
    const before = coverage(alphaOf(dest))
    const item = createCanvas(width, height)
    const ctx = item.getContext('2d')
    let inner: MaskOpReport[] = []
    if (shape.kind === 'group') {
      const nested = compositeShapes(shape.children, width, height, (child) => {
        prepare(child)
        options.enterGroup(child, shape)
      }, options)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(nested.canvas, 0, 0)
      inner = nested.steps
    } else {
      prepare(ctx)
      options.paintShape(ctx, shape)
      if (shape.kind === 'image' && (shape.maskChannel || shape.maskPick)) rewriteMaskImage(item, shape)
    }
    const op = shape.maskOp ?? 'add'
    blit(dest, item, op)
    const changed = total > 0 ? round4(Math.abs(coverage(alphaOf(dest)) - before) / total) : 0
    const step: MaskOpReport = { op, changed, path: shape.path }
    if (shape.source) step.source = shape.source
    steps.push(...inner, step)
  }
  return { canvas: dest, steps }
}

/** 按书写顺序把蒙版合成到一张画布上。返回值和画布同尺寸的 alpha。 */
export function compositeMask(options: MaskComposeOptions): { canvas: Canvas; alpha: Uint8ClampedArray; steps: MaskOpReport[] } {
  const composed = compositeShapes(options.shapes, options.width, options.height, options.prepare, options)
  return finish(composed, options)
}

function finish(
  composed: { canvas: Canvas; steps: MaskOpReport[] },
  options: MaskComposeOptions,
): { canvas: Canvas; alpha: Uint8ClampedArray; steps: MaskOpReport[] } {
  if (options.feather > 0.5) featherAlpha(composed.canvas, options.feather)
  if (options.invert) invertAlpha(composed.canvas)
  return { canvas: composed.canvas, alpha: alphaOf(composed.canvas), steps: composed.steps }
}
