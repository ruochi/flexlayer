import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { layerBaseDir } from './canvas.js'
import type { CreatedLayer } from './canvas.js'
import { fileHash } from './derive.js'
import type { PlacedLine } from './placed-text.js'

export type SceneBox = { x: number; y: number; width: number; height: number }

type SceneFile = {
  src?: string
  srcHash?: string
  width?: number
  height?: number
  flat?: boolean
  sky?: { y?: number; height?: number }
  subject?: SceneBox | null
  spire?: { x?: number; y?: number } | null
  roofY?: number | null
  skyline?: number[]
}

export type MeasuredLine = Pick<PlacedLine, 'y' | 'height' | 'baseline' | 'chars'>

export type TitleFit = {
  /** 标题层的 x。中间那个字对准主体的尖。 */
  x: number
  /** 标题层的 y。中间那个字被挡住的比例停在 cover。 */
  y: number
  /** 每个字被主体挡住的比例，0 到 1。 */
  covered: number[]
}

/** 字身里被主体挡住的比例。skyline[x] 是这一列主体的顶边。 */
export function titleCovered(
  line: MeasuredLine,
  skyline: number[],
  height: number,
  layerX: number,
  layerY: number,
  spacing = 0,
): number[] {
  return line.chars.map((char, index) => {
    const glyph = index === line.chars.length - 1 ? char.width : Math.max(1, char.width - spacing)
    const x0 = Math.round(layerX + char.x)
    const top = line.y + layerY
    const bottom = top + line.height
    let hidden = 0
    const x1 = x0 + Math.max(1, Math.round(glyph))
    for (let x = x0; x < x1; x++) {
      const edge = x >= 0 && x < skyline.length ? skyline[x]! : height
      hidden += Math.max(0, bottom - Math.max(edge, top))
    }
    return hidden / (Math.max(1, Math.round(glyph)) * Math.max(1, line.height))
  })
}

/**
 * 把一行字夹进两层之间。横向让中间的字对准尖，纵向往下移，直到这个字被挡住 cover。
 * cover 默认 0.2。没有尖时横轴居中，纵轴放在天空下沿。
 */
export function fitTitle(
  scene: { width: number; height: number; skyline: number[]; spire: { x: number; y: number } | null; sky: { height: number } },
  line: MeasuredLine,
  options?: { cover?: number; spacing?: number },
): TitleFit {
  if (line.chars.length === 0) throw new Error('这一行没有字')
  const cover = options?.cover ?? 0.2
  if (!(cover >= 0 && cover <= 0.8)) throw new Error('cover 要在 0 到 0.8 之间')
  const spacing = options?.spacing ?? 0
  const midIndex = Math.floor(line.chars.length / 2)
  const mid = line.chars[midIndex]!
  const glyph = midIndex === line.chars.length - 1 ? mid.width : Math.max(1, mid.width - spacing)
  const anchorX = scene.spire ? scene.spire.x : Math.round(scene.width / 2)
  const x = anchorX - (mid.x + glyph / 2)
  let y = Math.max(0, scene.sky.height - line.baseline)
  if (scene.spire) {
    for (let dy = 0; dy < scene.height; dy += 2) {
      y = dy
      const covered = titleCovered(line, scene.skyline, scene.height, x, dy, spacing)[midIndex] ?? 0
      if (covered >= cover) break
    }
  }
  return { x, y, covered: titleCovered(line, scene.skyline, scene.height, x, y, spacing) }
}

export type Scene = {
  src: string
  width: number
  height: number
  flat: boolean
  sky: { y: number; height: number }
  subject: SceneBox | null
  spire: { x: number; y: number } | null
  roofY: number | null
  skyline: number[]
  /** 标题层放在这个位置时，每个字被挡住多少。层要在 (0, 0) 量过。 */
  occlusion: (layer: CreatedLayer, x: number, y: number) => number[]
  /** 把在 (0, 0) 量过的标题层夹进两层之间。 */
  fit: (layer: CreatedLayer, options?: { cover?: number; spacing?: number }) => TitleFit
}

function scenePath(src: string, baseDir: string): { srcFile: string; file: string } | null {
  const trimmed = src.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  const srcFile = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  const slash = Math.max(srcFile.lastIndexOf('/'), srcFile.lastIndexOf('\\'))
  const dot = srcFile.lastIndexOf('.')
  const stem = dot > slash ? srcFile.slice(0, dot) : srcFile
  return { srcFile, file: `${stem}.scene.json` }
}

function lineOf(layer: CreatedLayer): MeasuredLine {
  const line = layer.text[0]?.lines[0]
  if (!line || line.chars.length === 0) throw new Error('这一层没有字')
  return line
}

/**
 * 读 `photo.scene.json`。分层在 flexlayer-select 里做，这里只拿数，用来把字夹进两层之间。
 * 文件没有、或原图哈希对不上时抛错。
 */
export function scene(src: string, options?: { baseDir?: string }): Scene {
  const baseDir = options?.baseDir ?? layerBaseDir()
  const paths = scenePath(src, baseDir)
  const name = basename(src.trim())
  if (!paths) throw new Error('scene 只接受本地图片')
  if (!existsSync(paths.file)) throw new Error(`没有 ${basename(paths.file)}。先运行 npx flexlayer-select layers ${name}`)
  const parsed = JSON.parse(readFileSync(paths.file, 'utf8')) as SceneFile
  if (!parsed.width || !parsed.height || !parsed.skyline || parsed.skyline.length !== parsed.width) {
    throw new Error(`${basename(paths.file)} 缺了宽高或天际线`)
  }
  if (existsSync(paths.srcFile)) {
    const current = fileHash(paths.srcFile)
    if (parsed.srcHash && parsed.srcHash !== current) {
      throw new Error(`原图改过了。重新运行 npx flexlayer-select layers ${name}`)
    }
  }
  const view: Omit<Scene, 'occlusion' | 'fit'> = {
    src: paths.srcFile,
    width: parsed.width,
    height: parsed.height,
    flat: Boolean(parsed.flat),
    sky: { y: parsed.sky?.y ?? 0, height: parsed.sky?.height ?? 0 },
    subject: parsed.subject ?? null,
    spire: parsed.spire?.x != null && parsed.spire.y != null ? { x: parsed.spire.x, y: parsed.spire.y } : null,
    roofY: parsed.roofY ?? null,
    skyline: parsed.skyline,
  }
  return {
    ...view,
    occlusion(layer, x, y) {
      return titleCovered(lineOf(layer), view.skyline, view.height, x, y)
    },
    fit(layer, fitOptions) {
      return fitTitle(view, lineOf(layer), fitOptions)
    },
  }
}
