import { createCanvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'

let ctx: CanvasRenderingContext2D | null = null

export function getMeasureCtx(): CanvasRenderingContext2D {
  if (!ctx) {
    const c = createCanvas(1, 1)
    ctx = c.getContext('2d')
  }
  return ctx
}
