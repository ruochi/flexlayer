#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cutout, type Segmenter } from './cutout.js'
import { foregroundMask, type DepthEstimator } from './foreground.js'
import { applyAnswers, cutoutMarkup, type Answer } from './markup.js'
import { isPreset, type Preset } from './preset.js'

export type SelectHooks = {
  /** 单测注入分割结果，正式命令不传，走 BiRefNet。 */
  segment?: Segmenter
  /** 单测注入远近图，正式命令不传，走 Depth Anything。 */
  depth?: DepthEstimator
}

function usageText(): string {
  return `用法:
  flexlayer-select mask <图片> [--point x,y ...] [--omit x,y ...] [--refine]
  flexlayer-select cutout <图片> [--preset portrait|product|flat]
  flexlayer-select apply <图片> [--add 3,5] [--subtract 9]

mask 取出前景遮罩，返回遮罩路径和这块前景的位置、大小。不写点时从伸进远处的尖往下长。--point 点在要留下的地方，--omit 点在不要的地方，都可以写多次。--refine 用抠图模型修边。
cutout 把主体、蒙版、编号区域和配方写到图片旁边。
apply 把编号题的答案写进 <mask>：--add 收进选区，--subtract 从选区去掉。`
}

function takeFile(argv: string[]): { file: string; rest: string[] } {
  const file = argv[0]
  if (!file || file.startsWith('--')) throw new Error(usageText())
  return { file, rest: argv.slice(1) }
}

function collect(argv: string[], name: string): { values: string[]; rest: string[] } {
  const rest: string[] = []
  const values: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token === `--${name}`) {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) throw new Error(`--${name} 后面要有值`)
      values.push(next)
      i += 1
      continue
    }
    rest.push(token)
  }
  return { values, rest }
}

function parsePoints(raws: string[]): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (const raw of raws) {
    const parts = raw.split(/[\s,]+/).filter(Boolean)
    if (parts.length < 2 || parts.length % 2 !== 0) throw new Error('点要写成 x,y')
    for (let i = 0; i < parts.length; i += 2) {
      const x = Number(parts[i])
      const y = Number(parts[i + 1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('点要写成 x,y')
      points.push({ x, y })
    }
  }
  return points
}

function flag(argv: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = []
  let value: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token === `--${name}`) {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) throw new Error(`--${name} 后面要有值`)
      value = next
      i += 1
      continue
    }
    rest.push(token)
  }
  return { value, rest }
}

function parseIds(raw: string | undefined): number[] {
  if (!raw) return []
  return raw.split(/[\s,]+/).filter(Boolean).map((part) => {
    const id = Number(part)
    if (!Number.isInteger(id) || id < 1 || id > 255) throw new Error(`编号要在 1 到 255 之间，收到 ${part}`)
    return id
  })
}

function stemOf(file: string): string {
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const dot = file.lastIndexOf('.')
  return dot > slash ? file.slice(0, dot) : file
}

async function cutoutCommand(argv: string[], hooks: SelectHooks) {
  const { file, rest } = takeFile(argv)
  const presetFlag = flag(rest, 'preset')
  if (presetFlag.rest.length > 0) throw new Error(usageText())
  const preset = presetFlag.value ?? 'portrait'
  if (!isPreset(preset)) throw new Error(`preset 只能是 portrait、product 或 flat，收到 ${preset}`)
  const result = await cutout(resolve(file), { preset: preset as Preset, segment: hooks.segment })
  console.log(result.markup.trimEnd())
  console.log(`questions ${result.questions.length}`)
  console.log(result.layer)
}

async function applyCommand(argv: string[]) {
  const { file, rest } = takeFile(argv)
  const addFlag = flag(rest, 'add')
  const subFlag = flag(addFlag.rest, 'subtract')
  if (subFlag.rest.length > 0) throw new Error(usageText())
  const answers: Answer[] = [
    ...parseIds(addFlag.value).map((id) => ({ id, op: 'add' as const })),
    ...parseIds(subFlag.value).map((id) => ({ id, op: 'subtract' as const })),
  ]
  const srcFile = resolve(file)
  const metaPath = `${stemOf(srcFile)}.cutout.json`
  const layerPath = `${stemOf(srcFile)}.cutout.layer`
  if (!existsSync(metaPath)) throw new Error(`没有配方 ${metaPath}。先运行 flexlayer-select cutout ${basename(srcFile)}`)
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { src?: string; width?: number; height?: number; shadow?: string }
  if (!meta.src || !meta.width || !meta.height) throw new Error(`配方缺了 src、width 或 height: ${metaPath}`)
  const markup = existsSync(layerPath)
    ? readFileSync(layerPath, 'utf8')
    : cutoutMarkup({ src: meta.src, width: meta.width, height: meta.height, shadow: Boolean(meta.shadow) })
  const next = applyAnswers(markup, answers, { src: meta.src, width: meta.width, height: meta.height })
  writeFileSync(layerPath, next)
  console.log(next.trimEnd())
  console.log(layerPath)
}

async function maskCommand(argv: string[], hooks: SelectHooks) {
  const { file, rest } = takeFile(argv)
  const pointFlag = collect(rest, 'point')
  const omitFlag = collect(pointFlag.rest, 'omit')
  const refine = omitFlag.rest.includes('--refine')
  const leftover = omitFlag.rest.filter((token) => token !== '--refine')
  if (leftover.length > 0) throw new Error(usageText())
  const result = await foregroundMask(resolve(file), {
    refine,
    points: parsePoints(pointFlag.values),
    omit: parsePoints(omitFlag.values),
    depth: hooks.depth,
    segment: hooks.segment,
  })
  console.log(JSON.stringify({
    mask: basename(result.mask),
    x: result.x,
    y: result.y,
    width: result.width,
    height: result.height,
    points: result.points,
    omit: result.omit,
  }, null, 2))
}

export async function runSelect(argv: string[], hooks: SelectHooks = {}): Promise<void> {
  const [cmd, ...rest] = argv
  if (cmd === 'mask') {
    await maskCommand(rest, hooks)
    return
  }
  if (cmd === 'cutout') {
    await cutoutCommand(rest, hooks)
    return
  }
  if (cmd === 'apply') {
    await applyCommand(rest)
    return
  }
  throw new Error(usageText())
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  runSelect(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
