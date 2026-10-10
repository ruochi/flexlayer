import { isAbsolute, resolve } from 'node:path'
import { contoursToPath, labelParts, round, SOLID, summarize, traceContours } from './bitmap.js'
import { layerBaseDir } from './canvas.js'
import { loadLayerImage } from './image.js'
import type { Box } from './types.js'

export type ImageChannel = 'alpha' | 'luma'

export type ImagePart = {
  /** 这一块实心像素占整张图的比例。 */
  area: number
  /** 外接矩形，图片像素。 */
  ink: Box
}

/** 一张图分析出来的数。坐标是图片像素，原点在左上角，y 向下。 */
export type ImageAnalysis = {
  src: string
  width: number
  height: number
  /** 实际分析的通道。 */
  channel: ImageChannel
  /** 图里有没有不透明度低于 255 的像素。 */
  hasAlpha: boolean
  /** 留下的比例，0 到 1。半透明按值折算。 */
  area: number
  /** 值大于 0 的外接矩形。整张为 0 时是 null。 */
  ink: Box | null
  /** 实心部分的八连通块个数。 */
  pieces: number
  /** 最大的几块，按面积从大到小，最多 64 块。总数看 `pieces`。 */
  parts: ImagePart[]
  /** 实心部分里的洞的个数。 */
  holes: number
  /** 软边的平均宽度，像素。硬边接近 0 到 1。 */
  softEdge: number
  /**
   * 实心部分的轮廓，图片像素。外圈和洞的绕向相反。
   * 写进 `<mask><path d /></mask>` 直接当蒙版；单独画出来时写 `<path d fill stroke="none">`，`path` 默认带描边。
   */
  d: string
}

export type AnalyzeImageOptions = {
  /** `auto`（默认）在图里有透明像素时看 alpha，否则看亮度。抠图结果用 alpha，黑白蒙版用 `luma`。 */
  channel?: ImageChannel | 'auto'
  /** 0 到 255，不低于它算实心。默认 128。 */
  threshold?: number
  /** 轮廓化简允许偏离的像素，默认 0.5。写 0 不化简。 */
  tolerance?: number
  /** 相对路径从这里找。默认是调用方源文件所在目录。 */
  baseDir?: string
}

const MAX_PARTS = 64
const cache = new Map<string, ImageAnalysis>()

function cacheKey(src: string, baseDir: string, channel: string, threshold: number, tolerance: number): string {
  const trimmed = src.trim()
  const where = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  return `${channel}|${threshold}|${tolerance}|${where}`
}

function expose(analysis: ImageAnalysis): ImageAnalysis {
  return structuredClone(analysis)
}

/**
 * 读一张图，量出留下的面积、碎片、洞、软边，并描出实心部分的轮廓 `d`。
 * 和 `glyph` 一样是程序接口：先拿到数和路径，再决定怎么摆、怎么裁。同一张图同一组参数只算一次。
 */
export async function analyzeImage(src: string, options: AnalyzeImageOptions = {}): Promise<ImageAnalysis> {
  const baseDir = options.baseDir ?? layerBaseDir()
  const threshold = options.threshold ?? SOLID
  const tolerance = options.tolerance ?? 0.5
  const wanted = options.channel ?? 'auto'
  if (!(threshold >= 1 && threshold <= 255)) throw new Error('threshold 要在 1 到 255 之间')
  if (!(tolerance >= 0) || !Number.isFinite(tolerance)) throw new Error('tolerance 要是不小于 0 的数')
  if (wanted !== 'auto' && wanted !== 'alpha' && wanted !== 'luma') throw new Error('channel 只能是 auto、alpha 或 luma')
  const key = cacheKey(src, baseDir, wanted, threshold, tolerance)
  const hit = cache.get(key)
  if (hit) return expose(hit)

  const image = await loadLayerImage(src, baseDir)
  const { width, height } = image
  const rgba = image.getContext('2d').getImageData(0, 0, width, height).data
  let hasAlpha = false
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! < 255) {
      hasAlpha = true
      break
    }
  }
  const channel: ImageChannel = wanted === 'auto' ? (hasAlpha ? 'alpha' : 'luma') : wanted
  const values = new Uint8ClampedArray(width * height)
  for (let p = 0; p < values.length; p++) {
    const a = rgba[p * 4 + 3]!
    values[p] =
      channel === 'alpha' ? a : ((0.2126 * rgba[p * 4]! + 0.7152 * rgba[p * 4 + 1]! + 0.0722 * rgba[p * 4 + 2]!) * a) / 255
  }

  const total = width * height
  const summary = summarize(values, width, height, threshold)
  const parts = labelParts(values, width, height, threshold)
  const contours = traceContours(values, width, height, threshold, tolerance)
  const analysis: ImageAnalysis = {
    src,
    width,
    height,
    channel,
    hasAlpha,
    area: total > 0 ? round(summary.coverage / total, 4) : 0,
    ink: summary.ink,
    pieces: parts.length,
    parts: parts.slice(0, MAX_PARTS).map((part) => ({ area: round(part.pixels / total, 4), ink: part.box })),
    holes: contours.filter((contour) => contour.area < 0).length,
    softEdge: round(summary.softEdge, 2),
    d: contoursToPath(contours),
  }
  cache.set(key, analysis)
  return expose(analysis)
}
