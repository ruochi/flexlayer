import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { analyzeImage } from 'flexlayer'
import { applyAnswers, cutoutMarkup, type Answer } from './markup.js'
import { maskRgba, readRgba, regionsRgba, shadowRgba, writePng } from './pixels.js'
import { applyPreset, isPreset, type Preset } from './preset.js'
import { buildRegions, type Question } from './regions.js'
import { birefnetSegment, MODEL_ID } from './segment.js'

export type Segmenter = (rgba: Uint8ClampedArray, width: number, height: number) => Uint8ClampedArray | Promise<Uint8ClampedArray>

export type CutoutOptions = {
  /** 默认 portrait。 */
  preset?: Preset
  /** 测试或别的模型可以换掉 BiRefNet。不传就下载并运行 ONNX。 */
  segment?: Segmenter
  /** 相对路径从这里找。默认是当前目录。 */
  baseDir?: string
}

export type CutoutAnalysis = {
  area: number
  pieces: number
  holes: number
  softEdge: number
}

export type CutoutResult = {
  src: string
  preset: Preset
  model: string
  width: number
  height: number
  subject: string
  mask: string
  regions: string
  meta: string
  questionsFile: string
  layer: string
  shadow?: string
  markup: string
  questions: Question[]
  analysis: CutoutAnalysis
}

function stemOf(file: string): string {
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const dot = file.lastIndexOf('.')
  return dot > slash ? file.slice(0, dot) : file
}

function outputs(srcFile: string) {
  const stem = stemOf(srcFile)
  return {
    subject: `${stem}.subject.png`,
    mask: `${stem}.mask.png`,
    regions: `${stem}.regions.png`,
    meta: `${stem}.cutout.json`,
    questions: `${stem}.questions.json`,
    layer: `${stem}.cutout.layer`,
    shadow: `${stem}.shadow.png`,
  }
}

/**
 * 抠出主体，写到原图旁边。渲染器只读这些文件，不在这里跑模型。
 * `photo.jpg` 得到 `photo.subject.png`、`photo.mask.png`、`photo.regions.png`、`photo.cutout.json`。
 */
export async function cutout(src: string, options: CutoutOptions = {}): Promise<CutoutResult> {
  const preset = options.preset ?? 'portrait'
  if (!isPreset(preset)) throw new Error(`preset 只能是 portrait、product 或 flat，收到 ${preset}`)
  const trimmed = src.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) throw new Error('cutout 只接受本地图片')
  const baseDir = options.baseDir ?? process.cwd()
  const srcFile = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  if (!existsSync(srcFile)) throw new Error(`读不到图片 ${srcFile}`)

  const { rgba, width, height } = await readRgba(srcFile)
  const segment = options.segment ?? birefnetSegment
  const matte = new Uint8ClampedArray(await segment(rgba, width, height))
  if (matte.length !== width * height) throw new Error('分割结果的像素数和原图不一致')
  const processed = applyPreset(preset, rgba, matte, width, height)
  const { ids, questions } = buildRegions(processed.alpha, width, height)
  const files = outputs(srcFile)
  const name = basename(srcFile)

  writePng(files.subject, processed.rgba, width, height)
  writePng(files.mask, maskRgba(processed.alpha), width, height)
  writePng(files.regions, regionsRgba(ids), width, height)
  if (processed.shadow) writePng(files.shadow, shadowRgba(processed.shadow), width, height)

  const analysisFull = analyzeImage(files.subject, { channel: 'alpha', baseDir: dirname(srcFile) })
  const analysis: CutoutAnalysis = {
    area: analysisFull.area,
    pieces: analysisFull.pieces,
    holes: analysisFull.holes,
    softEdge: analysisFull.softEdge,
  }
  const markup = cutoutMarkup({ src: name, width, height, shadow: processed.shadow != null })
  const model = options.segment ? 'segment' : MODEL_ID
  const meta = {
    src: name,
    srcHash: createHash('sha256').update(readFileSync(srcFile)).digest('hex'),
    model,
    preset,
    params: { preset },
    width,
    height,
    subject: basename(files.subject),
    mask: basename(files.mask),
    regions: basename(files.regions),
    questions: basename(files.questions),
    ...(processed.shadow ? { shadow: basename(files.shadow) } : {}),
    analysis,
  }
  writeFileSync(files.meta, `${JSON.stringify(meta, null, 2)}\n`)
  writeFileSync(files.questions, `${JSON.stringify({ src: name, regions: basename(files.regions), questions }, null, 2)}\n`)
  writeFileSync(files.layer, markup)

  return {
    src: srcFile,
    preset,
    model,
    width,
    height,
    subject: files.subject,
    mask: files.mask,
    regions: files.regions,
    meta: files.meta,
    questionsFile: files.questions,
    layer: files.layer,
    ...(processed.shadow ? { shadow: files.shadow } : {}),
    markup,
    questions,
    analysis,
  }
}

export function writeAnswers(result: CutoutResult, answers: Answer[]): string {
  const name = basename(result.src)
  const markup = applyAnswers(result.markup, answers, { src: name, width: result.width, height: result.height })
  writeFileSync(result.layer, markup)
  return markup
}
