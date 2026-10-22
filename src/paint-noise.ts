import { createCanvas, type CanvasRenderingContext2D, type SKRSContext2D } from '@napi-rs/canvas'
import type { LayoutNode, NoiseSpec } from './types.js'

type PaintCtx = SKRSContext2D

export type NoiseHost = {
  transformScale(ctx: CanvasRenderingContext2D): number
  drawNodeInk(ctx: CanvasRenderingContext2D, node: LayoutNode, spread: number, ink?: string): void
}

let host: NoiseHost | null = null

export function bindNoise(next: NoiseHost): void {
  host = next
}

export function paintNoise(ctx: PaintCtx, node: LayoutNode, noise: NoiseSpec, composite: 'soft-light' | 'source-over' = 'soft-light', frame = 0) {
  const api = host
  if (!api) throw new Error('噪点模块还没接上绘制')
  const w = Math.max(1, Math.ceil(node.width))
  const h = Math.max(1, Math.ceil(node.height))
  if (node.width <= 0 || node.height <= 0 || noise.amount <= 0) return
  const k = api.transformScale(ctx)
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
  // 确定性噪点：同一盒子、同一帧，纹理相同。@t 才把帧号混进种子。
  let seed = (Math.floor(node.x) * 73856093) ^ (Math.floor(node.y) * 19349663) ^ (w * 83492791) ^ (h * 39916801)
  if (noise.animate) seed = (seed ^ Math.imul(frame, 0x9e3779b1) ^ 0x85ebca6b) >>> 0
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
  api.drawNodeInk(clipCtx, node, 0, '#ffffff')
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(clip, 0, 0)
  ctx.save()
  ctx.globalCompositeOperation = composite
  ctx.drawImage(off, node.x, node.y, node.width, node.height)
  ctx.restore()
}
