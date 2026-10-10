import { labelParts, round, summarize } from './bitmap.js'
import { rasterizeMask } from './paint.js'
import type { Box, LayoutNode } from './types.js'

/**
 * `<mask>` 画成位图之后量出来的数。坐标相对这一层布局盒左上角，单位是这一层的局部像素。
 * 只看布局盒里面，探出盒子的形状不算。
 */
export type MaskStats = {
  /** 留下的比例，0 到 1。半透明按 alpha 折算。 */
  area: number
  /** alpha 大于 0 的外接矩形。全部藏起来时是 null。 */
  ink: Box | null
  /** alpha 不低于一半的连通块个数，八连通。一块都没有时是 0。 */
  pieces: number
  /** 软边的平均宽度，像素。硬边接近 0 到 1，羽化越宽越大。没有边时是 0。 */
  softEdge: number
}

/** 先把 mask 画成位图，再量。layer 布局盒为空时返回 null。 */
export function maskStats(shapes: LayoutNode[], width: number, height: number): MaskStats | null {
  const raster = rasterizeMask(shapes, width, height)
  if (!raster) return null
  const { alpha, width: pw, height: ph, scale } = raster
  const summary = summarize(alpha, pw, ph)
  const ink = summary.ink
    ? {
        x: round(summary.ink.x / scale, 3),
        y: round(summary.ink.y / scale, 3),
        width: round(Math.min(width, (summary.ink.x + summary.ink.width) / scale) - summary.ink.x / scale, 3),
        height: round(Math.min(height, (summary.ink.y + summary.ink.height) / scale) - summary.ink.y / scale, 3),
      }
    : null
  return {
    area: round(summary.coverage / (pw * ph), 4),
    ink,
    pieces: labelParts(alpha, pw, ph).length,
    softEdge: round(summary.softEdge / scale, 2),
  }
}
