import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { sandwichMarkup } from './markup.js'
import { readRgba, writePng } from './pixels.js'
import { applyPreset, isPreset, type Preset } from './preset.js'
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

export type CutoutResult = {
  src: string
  preset: Preset
  model: string
  width: number
  height: number
  subject: string
  meta: string
  /** 三层插字写法：原图、留空、主体。 */
  sandwich: string
}

function stemOf(file: string): string {
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const dot = file.lastIndexOf('.')
  return dot > slash ? file.slice(0, dot) : file
}

/**
 * 抠出主体，写到原图旁边。渲染器只读这些文件，不在这里跑模型。
 * `photo.jpg` 得到 `photo.subject.png` 和 `photo.cutout.json`。
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
  const subject = `${stemOf(srcFile)}.subject.png`
  const metaPath = `${stemOf(srcFile)}.cutout.json`
  const name = basename(srcFile)

  writePng(subject, processed.rgba, width, height)
  const model = options.segment ? 'segment' : MODEL_ID
  const meta = {
    src: name,
    srcHash: createHash('sha256').update(readFileSync(srcFile)).digest('hex'),
    model,
    preset,
    params: { preset },
    width,
    height,
    subject: basename(subject),
  }
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`)

  return {
    src: srcFile,
    preset,
    model,
    width,
    height,
    subject,
    meta: metaPath,
    sandwich: sandwichMarkup({ src: name, subject: basename(subject), width, height }),
  }
}
