#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cutout, type Segmenter } from './cutout.js'
import { isPreset, type Preset } from './preset.js'

export type SelectHooks = {
  /** 单测注入分割结果，正式命令不传，走 BiRefNet。 */
  segment?: Segmenter
}

function usageText(): string {
  return `用法:
  flexlayer-select cutout <图片> [--preset portrait|product|flat]

cutout 抠出主体，写 photo.subject.png 和 photo.cutout.json。文字插在主体后面：原图、文字、subject.png 依次叠放。`
}

function takeFile(argv: string[]): { file: string; rest: string[] } {
  const file = argv[0]
  if (!file || file.startsWith('--')) throw new Error(usageText())
  return { file, rest: argv.slice(1) }
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

async function cutoutCommand(argv: string[], hooks: SelectHooks) {
  const { file, rest } = takeFile(argv)
  const presetFlag = flag(rest, 'preset')
  if (presetFlag.rest.length > 0) throw new Error(usageText())
  const preset = presetFlag.value ?? 'portrait'
  if (!isPreset(preset)) throw new Error(`preset 只能是 portrait、product 或 flat，收到 ${preset}`)
  const result = await cutout(resolve(file), { preset: preset as Preset, segment: hooks.segment })
  console.log(result.sandwich.trimEnd())
  console.log(result.subject)
  console.log(result.meta)
}

export async function runSelect(argv: string[], hooks: SelectHooks = {}): Promise<void> {
  const [cmd, ...rest] = argv
  if (cmd === 'cutout') {
    await cutoutCommand(rest, hooks)
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
