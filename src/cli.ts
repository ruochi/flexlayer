#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { mergeFrameIssues, sampleFrames } from './check-frames.js'
import { emitLayer } from './emit.js'
import type { FrameInput } from './frame.js'
import { renderComposition } from './frame.js'
import { loadLayerFile, type LoadedLayer } from './load-source.js'
import { formatIssueLine } from './report.js'
import { checkFvg, renderFvg } from './render.js'
import { typecheckLayerFile } from './typecheck.js'
import type { FvgNode } from './parse.js'
import type { FvgReport, Issue } from './types.js'

const CONTACT_LIMIT = 300

function usage(): never {
  console.error(`用法:
  flexlayer render <file.layer|file.tsx> [-o out.png] [--report out.json] [--scale 0.5] [--debug] [--emit out.layer] [--frame N] [--frames dir]
  flexlayer check <file.layer|file.tsx> [--report out.json] [--emit out.layer] [--frame N]

.tsx / .jsx / .ts / .js 会先执行，得到和 .layer 相同的节点树。
Composition 用 --frame N 渲染一帧；不写时，帧数不超过 ${CONTACT_LIMIT} 就输出联系表。
--frames <目录> 写出每一帧 PNG。--emit 把展开后的节点写回 .layer。`)
  process.exit(2)
}

function parseArgs(argv: string[]) {
  const cmd = argv[0]
  const file = argv[1]
  if (!cmd || !file || (cmd !== 'render' && cmd !== 'check')) usage()
  let out: string | undefined
  let report: string | undefined
  let emit: string | undefined
  let framesDir: string | undefined
  let frame: number | undefined
  let scale = 1
  let debug = false
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '-o') out = argv[++i]
    else if (a === '--report') report = argv[++i]
    else if (a === '--scale') scale = Number(argv[++i])
    else if (a === '--debug') debug = true
    else if (a === '--emit') emit = argv[++i]
    else if (a === '--frames') framesDir = argv[++i]
    else if (a === '--frame') frame = Number(argv[++i])
    else usage()
  }
  if (frame != null && (!Number.isInteger(frame) || frame < 0)) usage()
  if ((emit != null && !emit) || (framesDir != null && !framesDir) || (out != null && !out) || (report != null && !report)) usage()
  return { cmd, file, out, report, emit, framesDir, frame, scale, debug }
}

function frameInput(frame: number, fps: number): FrameInput {
  return { frame, fps, t: frame / fps }
}

function appendIssues(report: FvgReport, extra: Issue[]) {
  if (extra.length === 0) return
  report.issues = [...extra, ...report.issues]
}

async function emitNode(node: Parameters<typeof emitLayer>[0], emit: string | undefined, report: FvgReport) {
  if (!emit) return
  const emitted = emitLayer(node)
  appendIssues(report, emitted.issues)
  await mkdir(dirname(resolve(emit)), { recursive: true })
  await writeFile(emit, emitted.source)
  console.log(`✓ ${emit}`)
}

function failIfErrors(report: FvgReport) {
  const errors = report.issues.filter((issue) => issue.level === 'error').length
  if (errors > 0) process.exit(1)
}

function printIssues(report: FvgReport) {
  for (const issue of report.issues) console.log(formatIssueLine(issue))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const abs = resolve(args.file)
  const loaded: LoadedLayer = await loadLayerFile(abs)
  const baseDir = dirname(abs)
  const typeIssues = typecheckLayerFile(abs)

  if (args.frame != null && loaded.kind !== 'composition') usage()
  if (args.emit && loaded.kind === 'markup') throw new Error('--emit 只用于 .tsx 等会展开的源文件')

  const attachFileIssues = (report: FvgReport) => {
    if (loaded.kind !== 'markup') appendIssues(report, loaded.issues)
    appendIssues(report, typeIssues)
  }

  if (args.cmd === 'check') {
    if (loaded.kind === 'composition' && args.frame != null && args.frame >= loaded.composition.durationInFrames) {
      throw new Error(`--frame ${args.frame} 超出范围，这段共 ${loaded.composition.durationInFrames} 帧`)
    }
    if (loaded.kind !== 'composition') {
      const node = loaded.kind === 'markup' ? loaded.source : loaded.node
      const report = await checkFvg(node, { baseDir })
      if (typeof node !== 'string') await emitNode(node, args.emit, report)
      attachFileIssues(report)
      printIssues(report)
      if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
      failIfErrors(report)
      return
    }
    const frames = sampleFrames(loaded.composition.durationInFrames, args.frame)
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
    printIssues(report!)
    if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
    failIfErrors(report!)
    return
  }

  if (loaded.kind === 'composition') {
    const comp = loaded.composition
    const one = args.frame
    if (one == null && !args.framesDir && comp.durationInFrames > CONTACT_LIMIT) {
      throw new Error(`共 ${comp.durationInFrames} 帧。指定 --frame N 渲染一帧，或 --frames <目录> 导出全部`)
    }
    if (one != null && one >= comp.durationInFrames) {
      throw new Error(`--frame ${one} 超出范围，这段共 ${comp.durationInFrames} 帧`)
    }
    const outPath = args.out ?? abs.replace(/\.(tsx|jsx|ts|js|layer|fvg)$/i, '.png')
    if (one != null) {
      const input = frameInput(one, comp.fps)
      const node = comp.component(input)
      const { png, report } = await renderFvg(node, { baseDir, scale: args.scale, debug: args.debug, t: input.t })
      attachFileIssues(report)
      await emitNode(node, args.emit, report)
      await writeFile(outPath, png)
      printIssues(report)
      console.log(`✓ ${outPath}  ${report.width}×${report.height}  第 ${one} 帧`)
      if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
      failIfErrors(report)
    }
    if (args.framesDir || one == null) {
      const { frames, reports, contactSheet } = await renderComposition(comp, { baseDir, scale: args.scale })
      if (args.framesDir) {
        await mkdir(args.framesDir, { recursive: true })
        for (let i = 0; i < frames.length; i++) {
          const name = `frame-${String(i).padStart(4, '0')}.png`
          await writeFile(join(args.framesDir, name), frames[i]!)
        }
        console.log(`✓ ${args.framesDir}  ${frames.length} 帧`)
      }
      if (one == null) {
        const node = comp.component(frameInput(0, comp.fps))
        const report = reports[0]!
        attachFileIssues(report)
        await emitNode(node, args.emit, report)
        await writeFile(outPath, contactSheet)
        printIssues(report)
        console.log(`✓ ${outPath}  联系表  ${frames.length} 帧`)
        if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
        failIfErrors(report)
      }
    }
    return
  }

  const source = loaded.kind === 'markup' ? loaded.source : loaded.node
  const { png, report } = await renderFvg(source, { baseDir, scale: args.scale, debug: args.debug })
  if (loaded.kind === 'node') await emitNode(loaded.node, args.emit, report)
  attachFileIssues(report)
  const outPath = args.out ?? abs.replace(/\.(tsx|jsx|ts|js|layer|fvg)$/i, '.png')
  await writeFile(outPath, png)
  printIssues(report)
  console.log(`✓ ${outPath}  ${report.width}×${report.height}  ${report.elements.length} 个元素`)
  if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
  failIfErrors(report)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
