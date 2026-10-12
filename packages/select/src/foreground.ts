import { existsSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { estimateDepth, releaseDepth } from './depth.js'
import { maskRgba, readRgba, writePng } from './pixels.js'
import { birefnetSegment } from './segment.js'
import { splitLayers, type KeepPoint } from './split.js'
import type { Segmenter } from './cutout.js'

export type DepthEstimator = (rgba: Uint8ClampedArray, width: number, height: number) => Uint8ClampedArray | Promise<Uint8ClampedArray>

export type ForegroundOptions = {
  /** 测试可以换掉深度模型。不传就下载并运行 Depth Anything V2 Small。 */
  depth?: DepthEstimator
  /** 和 refine 一起用。不传就跑 BiRefNet。 */
  segment?: Segmenter
  /** 边用抠图模型，深度只去掉远处粘上的部分。 */
  refine?: boolean
  /**
   * 要留下的地方，可以多个。不传就从伸进远处的尖往下长。
   * 沿着深度连着的一块长出去，近端停在地面以上。
   */
  points?: KeepPoint[]
  /**
   * 不要的地方，可以多个。落在要留的这块里面时，离它更近的去掉。
   * 没有正向点时，从自动遮罩里挖掉点到的那一块。
   */
  omit?: KeepPoint[]
  baseDir?: string
}

export type ForegroundMask = {
  /** 遮罩文件。白的地方是前景，alpha 和亮度是同一个值。 */
  mask: string
  /** 前景左边缘。没有前景时是 null。 */
  x: number | null
  /** 前景上边缘。没有前景时是 null。 */
  y: number | null
  /** 前景宽度。没有前景时是 null。 */
  width: number | null
  /** 前景高度。没有前景时是 null。 */
  height: number | null
  /** 这次点中要留下的位置。没点时是空数组。 */
  points: Array<[number, number]>
  /** 这次点中不要的位置。没点时是空数组。 */
  omit: Array<[number, number]>
}

function stemOf(file: string): string {
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const dot = file.lastIndexOf('.')
  return dot > slash ? file.slice(0, dot) : file
}

/**
 * 取出前景遮罩，写到原图旁边，并返回这块前景的位置和大小。
 * `photo.jpg` 得到 `photo.foreground.png` 和 `photo.foreground.json`。
 */
export async function foregroundMask(src: string, options: ForegroundOptions = {}): Promise<ForegroundMask> {
  const points = options.points ?? []
  const omit = options.omit ?? []
  const trimmed = src.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) throw new Error('mask 只接受本地图片')
  const baseDir = options.baseDir ?? process.cwd()
  const srcFile = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  if (!existsSync(srcFile)) throw new Error(`读不到图片 ${srcFile}`)

  const { rgba, width, height } = await readRgba(srcFile)
  const depthOf = options.depth ?? estimateDepth
  const depth = new Uint8ClampedArray(await depthOf(rgba, width, height))
  if (depth.length !== width * height) throw new Error('深度图的像素数和原图不一致')
  let matte: Uint8ClampedArray | undefined
  if (options.refine) {
    await releaseDepth()
    const segment = options.segment ?? birefnetSegment
    matte = new Uint8ClampedArray(await segment(rgba, width, height))
    if (matte.length !== width * height) throw new Error('分割结果的像素数和原图不一致')
  }
  const split = splitLayers({ depth, width, height, matte, points, omit })
  const stem = stemOf(srcFile)
  const mask = `${stem}.foreground.png`
  const recorded = points.map((point) => [point.x, point.y] as [number, number])
  const omitted = omit.map((point) => [point.x, point.y] as [number, number])
  const record = {
    mask: basename(mask),
    x: split.box?.x ?? null,
    y: split.box?.y ?? null,
    width: split.box?.width ?? null,
    height: split.box?.height ?? null,
    points: recorded,
    omit: omitted,
  }
  writePng(mask, maskRgba(split.alpha), width, height)
  writeFileSync(`${stem}.foreground.json`, `${JSON.stringify(record, null, 2)}\n`)
  return { mask, x: record.x, y: record.y, width: record.width, height: record.height, points: recorded, omit: omitted }
}
