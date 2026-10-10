#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { stdout } from 'node:process'
import type { Writable } from 'node:stream'
import { mergeFrameIssues, sampleFrames, type SampleSpec } from './check-frames.js'
import { emitLayer } from './emit.js'
import type { Composition, FrameInput } from './frame.js'
import { createContactSheet, renderFrames } from './frame.js'
import { loadLayerFile, type LoadedLayer } from './load-source.js'
import { formatIssueLine } from './report.js'
import { checkFvg, renderFvg, renderPreview } from './render.js'
import { typecheckLayerFile } from './typecheck.js'
import type { FvgNode } from './parse.js'
import type { FvgReport, Issue } from './types.js'

const CONTACT_LIMIT = 300

function usage(): never {
  console.error(`用法:
  flexlayer render <file.layer|file.tsx> [-o out.png] [--report out.json] [--scale 0.5] [--debug] [--preview out.png] [--emit out.layer] [--frame N] [--frames dir] [--from N] [--to N] [--step N] [--rgba -|file]
  flexlayer check <file.layer|file.tsx> [--report out.json] [--emit out.layer] [--frame N] [--frames all|A-B|N] [--step N]
  flexlayer select …   转给 flexlayer-select。没安装时提示安装命令

.tsx / .jsx / .ts / .js 会先执行，得到和 .layer 相同的节点树。
Composition 用 --frame N 渲染一帧；不写时，范围内帧数不超过 ${CONTACT_LIMIT} 就输出联系表。
--frames <目录> 边渲染边写出 PNG。--from、--to 含端点，--step 是步长。
--rgba - 把不预乘的原始像素写到标准输出，日志改走标准错误。写成文件路径则写入该文件。
check 不写 --frames 时抽查第 0 帧、中间一帧和最后一帧。--frames all 或 --frames 120-300 检查这一段。
--emit 把展开后的节点写回 .layer。
--preview 按文档里的 <preview> 另写一张选区预览，正常成片不包含它。`)
  process.exit(2)
}

function parseArgs(argv: string[]) {
  const cmd = argv[0]
  const file = argv[1]
  if (!cmd || !file || (cmd !== 'render' && cmd !== 'check')) usage()
  let out: string | undefined
  let report: string | undefined
  let emit: string | undefined
  let framesArg: string | undefined
  let rgba: string | undefined
  let frame: number | undefined
  let from: number | undefined
  let to: number | undefined
  let step: number | undefined
  let scale = 1
  let debug = false
  let preview: string | undefined
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!
    const next = () => {
      const value = argv[++i]
      if (value == null) usage()
      return value
    }
    if (a === '-o') out = next()
    else if (a === '--report') report = next()
    else if (a === '--scale') scale = Number(next())
    else if (a === '--debug') debug = true
    else if (a === '--preview') preview = next()
    else if (a === '--emit') emit = next()
    else if (a === '--frames') framesArg = next()
    else if (a === '--rgba') rgba = next()
    else if (a === '--frame') frame = Number(next())
    else if (a === '--from') from = Number(next())
    else if (a === '--to') to = Number(next())
    else if (a === '--step') step = Number(next())
    else usage()
  }
  if (frame != null && (!Number.isInteger(frame) || frame < 0)) usage()
  if (from != null && (!Number.isInteger(from) || from < 0)) usage()
  if (to != null && (!Number.isInteger(to) || to < 0)) usage()
  if (step != null && (!Number.isInteger(step) || step < 1)) usage()
  if (!Number.isFinite(scale) || scale <= 0) usage()
  if (cmd === 'check' && (rgba || from != null || to != null || preview)) usage()
  if (frame != null && (framesArg != null || rgba != null || from != null || to != null || step != null)) usage()
  if (cmd === 'render' && rgba != null && framesArg != null) usage()
  if (cmd === 'check' && step != null && framesArg == null) usage()
  return { cmd, file, out, report, emit, framesArg, rgba, frame, from, to, step, scale, debug, preview }
}

function frameInput(frame: number, fps: number): FrameInput {
  return { frame, fps, t: frame / fps }
}

function appendIssues(report: FvgReport, extra: Issue[]) {
  if (extra.length === 0) return
  report.issues = [...extra, ...report.issues]
}

let say = (line: string) => {
  console.log(line)
}

async function emitNode(node: Parameters<typeof emitLayer>[0], emit: string | undefined, report: FvgReport) {
  if (!emit) return
  const emitted = emitLayer(node)
  appendIssues(report, emitted.issues)
  await mkdir(dirname(resolve(emit)), { recursive: true })
  await writeFile(emit, emitted.source)
  say(`✓ ${emit}`)
}

function failIfErrors(report: FvgReport) {
  const errors = report.issues.filter((issue) => issue.level === 'error').length
  if (errors > 0) process.exit(1)
}

function printIssues(report: FvgReport) {
  for (const issue of report.issues) say(formatIssueLine(issue))
}

function printCheckResult(report: FvgReport) {
  printIssues(report)
  if (report.issues.length === 0) say('✓ 0 issues')
}

function checkSample(spec: string, step: number | undefined): number | SampleSpec {
  if (spec === 'all') return { all: true, step }
  const range = /^(\d+)-(\d+)$/.exec(spec)
  if (range) return { range: [Number(range[1]), Number(range[2])], step }
  if (/^\d+$/.test(spec)) {
    if (step != null && step !== 1) usage()
    return Number(spec)
  }
  usage()
}

async function writeChunk(stream: Writable, chunk: Buffer) {
  if (stream.write(chunk)) return
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      stream.off('error', onError)
      resolve()
    }
    const onError = (err: Error) => {
      stream.off('drain', onDrain)
      reject(err)
    }
    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}

function outPng(abs: string, out: string | undefined) {
  return out ?? abs.replace(/\.(tsx|jsx|ts|js|layer|fvg)$/i, '.png')
}

async function forwardSelect(argv: string[]) {
  const name = 'flexlayer-select'
  try {
    const mod = (await import(name)) as { runSelect?: (argv: string[]) => Promise<void> }
    if (!mod.runSelect) throw new Error('flexlayer-select 没有 runSelect')
    await mod.runSelect(argv)
  } catch (err) {
    const missing = err instanceof Error && /flexlayer-select|Cannot find package|ERR_MODULE_NOT_FOUND/.test(`${err.message} ${(err as NodeJS.ErrnoException).code ?? ''}`)
    if (!missing) throw err
    throw new Error('没有安装 flexlayer-select。在仓库里进入 packages/select 执行 npm install，或 npm install flexlayer-select')
  }
}

async function main() {
  if (process.argv[2] === 'select') {
    await forwardSelect(process.argv.slice(3))
    return
  }
  const args = parseArgs(process.argv.slice(2))
  const abs = resolve(args.file)
  const loaded: LoadedLayer = await loadLayerFile(abs)
  const baseDir = dirname(abs)
  const typeIssues = typecheckLayerFile(abs)

  if (args.preview && loaded.kind === 'composition') throw new Error('--preview 只用于单帧 .layer 或 .tsx')
  if (args.frame != null && loaded.kind !== 'composition') usage()
  if ((args.framesArg || args.rgba || args.from != null || args.to != null || args.step != null) && loaded.kind !== 'composition') usage()
  if (args.emit && loaded.kind === 'markup') throw new Error('--emit 只用于 .tsx 等会展开的源文件')

  const attachFileIssues = (report: FvgReport) => {
    if (loaded.kind !== 'markup') appendIssues(report, loaded.issues)
    appendIssues(report, typeIssues)
  }

  if (args.cmd === 'check') {
    if (loaded.kind !== 'composition') {
      const node = loaded.kind === 'markup' ? loaded.source : loaded.node
      const report = await checkFvg(node, { baseDir })
      if (typeof node !== 'string') await emitNode(node, args.emit, report)
      attachFileIssues(report)
      printCheckResult(report)
      if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
      failIfErrors(report)
      return
    }
    const duration = loaded.composition.durationInFrames
    if (args.frame != null && args.frame >= duration) {
      throw new Error(`--frame ${args.frame} 超出范围，这段共 ${duration} 帧`)
    }
    const sample = args.framesArg != null ? checkSample(args.framesArg, args.step) : args.frame
    const frames = sampleFrames(duration, sample)
    const parts: Array<{ frame: number; issues: Issue[] }> = []
    let report: FvgReport | undefined
    let emitAt: FvgNode | undefined
    for (const frame of frames) {
      const node = loaded.composition.component(frameInput(frame, loaded.composition.fps))
      const one = await checkFvg(node, { baseDir })
      if (!report) report = one
      if (frame === (args.frame ?? 0)) emitAt = node
      parts.push({ frame, issues: one.issues })
    }
    report!.issues = mergeFrameIssues(parts)
    if (emitAt) await emitNode(emitAt, args.emit, report!)
    attachFileIssues(report!)
    printCheckResult(report!)
    if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
    failIfErrors(report!)
    return
  }

  if (loaded.kind === 'composition') {
    const comp: Composition = loaded.composition
    if (args.frame != null) {
      if (args.frame >= comp.durationInFrames) {
        throw new Error(`--frame ${args.frame} 超出范围，这段共 ${comp.durationInFrames} 帧`)
      }
      const input = frameInput(args.frame, comp.fps)
      const node = comp.component(input)
      const { png, report } = await renderFvg(node, {
        baseDir,
        scale: args.scale,
        debug: args.debug,
        t: input.t,
        frame: args.frame,
        fps: comp.fps,
      })
      attachFileIssues(report)
      await emitNode(node, args.emit, report)
      const outPath = outPng(abs, args.out)
      await writeFile(outPath, png)
      printIssues(report)
      say(`✓ ${outPath}  ${report.width}×${report.height}  第 ${args.frame} 帧`)
      if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
      failIfErrors(report)
      return
    }

    const rgbaToStdout = args.rgba === '-'
    if (rgbaToStdout) say = (line) => console.error(line)
    const from = args.from ?? 0
    const to = args.to ?? comp.durationInFrames - 1
    const step = args.step ?? 1
    const span = Math.floor((to - from) / step) + 1
    if (!args.framesArg && !args.rgba && span > CONTACT_LIMIT) {
      throw new Error(`共 ${span} 帧。指定 --frame N 渲染一帧，--frames <目录> 导出 PNG，或 --rgba - 输出原始像素`)
    }
    const pixelW = Math.max(1, Math.round(comp.width * args.scale))
    const pixelH = Math.max(1, Math.round(comp.height * args.scale))
    if (args.rgba) console.error(`ffmpeg -f rawvideo -pix_fmt rgba -s ${pixelW}x${pixelH} -r ${comp.fps} -i -`)
    const wantSheet = !args.rgba && span <= CONTACT_LIMIT
    const sheet = wantSheet ? createContactSheet({ count: span, width: pixelW, height: pixelH }) : null
    if (args.framesArg) await mkdir(args.framesArg, { recursive: true })

    let rgbaFile: ReturnType<typeof createWriteStream> | undefined
    let rgbaStream: Writable | undefined
    if (args.rgba) {
      if (rgbaToStdout) rgbaStream = stdout
      else {
        await mkdir(dirname(resolve(args.rgba)), { recursive: true })
        rgbaFile = createWriteStream(args.rgba)
        rgbaStream = rgbaFile
      }
    }

    const parts: Array<{ frame: number; issues: Issue[] }> = []
    let report: FvgReport | undefined
    let count = 0
    for await (const rendered of renderFrames(comp, {
      baseDir,
      scale: args.scale,
      debug: args.debug,
      from: args.from,
      to: args.to,
      step: args.step,
      format: args.rgba ? 'rgba' : 'png',
    })) {
      if (rendered.rgba && rgbaStream) await writeChunk(rgbaStream, rendered.rgba)
      if (args.framesArg && rendered.png) {
        const name = `frame-${String(rendered.frame).padStart(4, '0')}.png`
        await writeFile(join(args.framesArg, name), rendered.png)
      }
      if (sheet && rendered.png) await sheet.add(rendered.png)
      if (!report) report = rendered.report
      parts.push({ frame: rendered.frame, issues: rendered.report.issues })
      count++
    }
    if (rgbaFile) {
      await new Promise<void>((resolve, reject) => {
        rgbaFile!.once('error', reject)
        rgbaFile!.end(() => resolve())
      })
    }
    if (!report) throw new Error('没有可渲染的帧')
    report.issues = mergeFrameIssues(parts)
    attachFileIssues(report)
    const emitFrame = args.from ?? 0
    if (args.emit && emitFrame <= to) {
      await emitNode(comp.component(frameInput(emitFrame, comp.fps)), args.emit, report)
    }
    printIssues(report)
    if (args.framesArg) say(`✓ ${args.framesArg}  ${count} 帧`)
    if (args.rgba && !rgbaToStdout) say(`✓ ${args.rgba}  ${count} 帧原始像素`)
    if (sheet) {
      const outPath = outPng(abs, args.out)
      await writeFile(outPath, sheet.toPng())
      say(`✓ ${outPath}  联系表  ${count} 帧`)
    }
    if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
    failIfErrors(report)
    return
  }

  const source = loaded.kind === 'markup' ? loaded.source : loaded.node
  const { png, report } = await renderFvg(source, { baseDir, scale: args.scale, debug: args.debug })
  if (loaded.kind === 'node') await emitNode(loaded.node, args.emit, report)
  attachFileIssues(report)
  const outPath = outPng(abs, args.out)
  await writeFile(outPath, png)
  if (args.preview) {
    const sheet = await renderPreview(source, { baseDir, scale: args.scale })
    if (!sheet) throw new Error('没有 <preview>。写成 <preview of="#id" show="overlay checker black white edges" />')
    await mkdir(dirname(resolve(args.preview)), { recursive: true })
    await writeFile(args.preview, sheet)
    say(`✓ ${args.preview}  选区预览`)
  }
  printIssues(report)
  say(`✓ ${outPath}  ${report.width}×${report.height}  ${report.elements.length} 个元素`)
  if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
  failIfErrors(report)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
