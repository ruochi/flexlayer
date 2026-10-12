import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { canvas, fitTitle, h } from 'flexlayer'
import { estimateDepth, DEPTH_MODEL_ID } from './depth.js'
import { readRgba, writePng } from './pixels.js'
import { birefnetSegment, MODEL_ID } from './segment.js'
import { splitLayers, type SplitResult } from './split.js'
import type { Segmenter } from './cutout.js'

export type DepthEstimator = (rgba: Uint8ClampedArray, width: number, height: number) => Uint8ClampedArray | Promise<Uint8ClampedArray>

export type LayersOptions = {
  /** 测试可以换掉深度模型。不传就下载并运行 Depth Anything V2 Small。 */
  depth?: DepthEstimator
  /** 和 --refine 一起用。不传就跑 BiRefNet。 */
  segment?: Segmenter
  /** 边用抠图模型，深度只去掉远处粘上的部分。 */
  refine?: boolean
  /** 写进两层之间的标题。不写就只有照片和主体。 */
  title?: string
  /** 中间那个字被挡住的比例，默认 0.2。 */
  cover?: number
  baseDir?: string
}

export type LayersResult = {
  src: string
  flat: boolean
  refine: boolean
  width: number
  height: number
  depthFile: string
  subject: string
  plate: string
  scene: string
  meta: string
  layer: string
  markup: string
  split: SplitResult
}

function stemOf(file: string): string {
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const dot = file.lastIndexOf('.')
  return dot > slash ? file.slice(0, dot) : file
}

function depthRgba(depth: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(depth.length * 4)
  for (let i = 0; i < depth.length; i++) {
    const value = depth[i]!
    rgba[i * 4] = value
    rgba[i * 4 + 1] = value
    rgba[i * 4 + 2] = value
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

function place(split: SplitResult, width: number, height: number, title: string, cover: number): { x: number; y: number; size: number; covered: number[] } {
  const fontSize = Math.max(16, Math.round(height * 0.236))
  const spacing = fontSize * 0.08
  const style = `font-size:${fontSize}px; font-weight:700; letter-spacing:0.08em; white-space:nowrap; line-height:1; fill:linear-gradient(to bottom, #fff6dc, #f1c472 70%, #d9963a)`
  const probe = canvas.create(h('layer', { x: '0', y: '0', 'font-family': 'Song' }, h('h1', { style }, title)))
  const line = probe.text[0]?.lines[0]
  if (!line) throw new Error('标题没有排出来')
  const fit = fitTitle(
    { width, height, skyline: split.skyline, spire: split.spire, sky: split.sky },
    line,
    { cover, spacing },
  )
  return { ...fit, size: fontSize }
}

function markupOf(name: string, split: SplitResult, width: number, height: number, title?: { text: string; x: number; y: number; size: number }): string {
  const full = `style="width:${width}px; height:${height}px"`
  const lines = [
    `<layer width="${width}" height="${height}" background="#05060c" safe="0">`,
    `  <img src="${name}" ${full} />`,
  ]
  if (title) {
    const band = Math.round(title.y + title.size * 1.4)
    lines.push(`  <rect x="0" y="0" width="${width}" height="${band}" fill="linear-gradient(to bottom, #05060c00 30%, #05060cb0 70%, #05060c00)" />`)
    lines.push(`  <layer x="${Math.round(title.x)}" y="${Math.round(title.y)}" font-family="Song" glow="50 #f1c47233">`)
    lines.push(`    <h1 style="font-size:${title.size}px; font-weight:700; letter-spacing:0.08em; white-space:nowrap; line-height:1; fill:linear-gradient(to bottom, #fff6dc, #f1c472 70%, #d9963a)">${escapeText(title.text)}</h1>`)
    lines.push('  </layer>')
  }
  if (!split.flat) {
    const stem = stemOf(name)
    lines.push('  <layer id="subject" glow="36 #ffbf5a55">')
    lines.push(`    <img src="${stem}.subject.png" ${full} />`)
    lines.push('  </layer>')
  }
  lines.push('</layer>', '')
  return lines.join('\n')
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 分成背景和主体两层，写到原图旁边。
 * `photo.jpg` 得到 `photo.depth.png`、`photo.subject.png`、`photo.plate.png`、`photo.scene.json`、`photo.layers.layer`。
 */
export async function layers(src: string, options: LayersOptions = {}): Promise<LayersResult> {
  const trimmed = src.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) throw new Error('layers 只接受本地图片')
  const cover = options.cover ?? 0.2
  if (!(cover >= 0 && cover <= 0.8)) throw new Error('cover 要在 0 到 0.8 之间')
  const baseDir = options.baseDir ?? process.cwd()
  const srcFile = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  if (!existsSync(srcFile)) throw new Error(`读不到图片 ${srcFile}`)

  const { rgba, width, height } = await readRgba(srcFile)
  const depthOf = options.depth ?? estimateDepth
  const depth = new Uint8ClampedArray(await depthOf(rgba, width, height))
  if (depth.length !== width * height) throw new Error('深度图的像素数和原图不一致')
  let matte: Uint8ClampedArray | undefined
  if (options.refine) {
    const segment = options.segment ?? birefnetSegment
    matte = new Uint8ClampedArray(await segment(rgba, width, height))
    if (matte.length !== width * height) throw new Error('分割结果的像素数和原图不一致')
  }
  const split = splitLayers({ rgba, depth, width, height, matte })
  const stem = stemOf(srcFile)
  const name = basename(srcFile)
  const files = {
    depth: `${stem}.depth.png`,
    subject: `${stem}.subject.png`,
    plate: `${stem}.plate.png`,
    scene: `${stem}.scene.json`,
    meta: `${stem}.cutout.json`,
    layer: `${stem}.layers.layer`,
  }
  writePng(files.depth, depthRgba(depth), width, height)
  writePng(files.subject, split.subject, width, height)
  writePng(files.plate, split.plate, width, height)

  const scene = {
    src: name,
    srcHash: createHash('sha256').update(readFileSync(srcFile)).digest('hex'),
    width,
    height,
    flat: split.flat,
    sky: split.sky,
    subject: split.subjectBox,
    spire: split.spire,
    roofY: split.roofY,
    skyline: split.skyline,
  }
  writeFileSync(files.scene, `${JSON.stringify(scene)}\n`)
  const placed = options.title?.trim() ? place(split, width, height, options.title.trim(), cover) : undefined
  const markup = markupOf(name, split, width, height, placed && options.title ? { text: options.title.trim(), ...placed } : undefined)
  writeFileSync(files.layer, markup)
  const meta = {
    src: name,
    srcHash: scene.srcHash,
    tool: 'layers',
    preset: 'layers',
    model: options.refine ? `${options.segment ? 'segment' : MODEL_ID}+${options.depth ? 'depth' : DEPTH_MODEL_ID}` : (options.depth ? 'depth' : DEPTH_MODEL_ID),
    refine: Boolean(options.refine),
    width,
    height,
    flat: split.flat,
    subject: basename(files.subject),
    plate: basename(files.plate),
    depth: basename(files.depth),
    scene: basename(files.scene),
  }
  writeFileSync(files.meta, `${JSON.stringify(meta, null, 2)}\n`)

  return {
    src: srcFile,
    flat: split.flat,
    refine: Boolean(options.refine),
    width,
    height,
    depthFile: files.depth,
    subject: files.subject,
    plate: files.plate,
    scene: files.scene,
    meta: files.meta,
    layer: files.layer,
    markup,
    split,
  }
}
