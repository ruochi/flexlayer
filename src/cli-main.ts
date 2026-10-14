import { createWriteStream, existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { stdout } from 'node:process'
import type { Writable } from 'node:stream'
import { mergeFrameIssues, sampleFrames, type SampleSpec } from './check-frames.js'
import { emitLayer } from './emit.js'
import type { Composition, FrameInput } from './frame.js'
import type { LoadedLayer } from './load-source.js'
import { formatIssueLine } from './report.js'
import { checkLayer, renderLayer, renderPreview } from './render.js'
import type { LayerNode } from './parse.js'
import type { LayerReport, Issue } from './types.js'

const CONTACT_LIMIT = 300

function usage(): never {
  console.error(`用法:
  flexlayer render <file> [<file>...] [-o out.png|dir] [--report out.json|dir] [--scale 1] [--scale 2] [--debug] [--preview out.png] [--emit out.layer|dir] [--frame N] [--frames dir] [--from N] [--to N] [--step N] [--rgba -|file] [--mesh-samples 1|2|4] [--no-script] [--typecheck] [--watch]
  flexlayer check <file> [<file>...] [--report out.json|dir] [--emit out.layer|dir] [--frame N] [--frames all|A-B|N] [--step N] [--no-script] [--no-typecheck] [--watch]
  flexlayer select …   转给 flexlayer-select。没安装时提示安装命令

.tsx / .jsx / .ts / .js 会先执行，得到和 .layer 相同的节点树。
类型检查只在 check 时做。render 要一起查类型就加 --typecheck。check 要跳过就加 --no-typecheck。
多个文件，或 render 写了多个 --scale，就在这一次进程里做完。同一份源只执行一次。
这时 -o、--report、--emit 是目录。多个 --scale 的文件名带 @1x、@2x。
--frame、--frames、--rgba、--preview、--watch 只用于一张图、一个倍率。
Composition 用 --frame N 渲染一帧；不写时，范围内帧数不超过 ${CONTACT_LIMIT} 就输出联系表。
--frames <目录> 边渲染边写出 PNG。--from、--to 含端点，--step 是步长。
--rgba - 把不预乘的原始像素写到标准输出，日志改走标准错误。写成文件路径则写入该文件。
check 不写 --frames 时抽查第 0 帧、中间一帧和最后一帧。--frames all 或 --frames 120-300 检查这一段。
--emit 把展开后的节点写回 .layer。
--preview 按文档里的 <preview> 另写一张选区预览，正常成片不包含它。
--no-script 不执行 <script>，canvas 保持透明。
--watch 在源文件和它引用的相对路径变化后再跑一遍。不和 --rgba、--frames 一起用。`)
  process.exit(2)
}

function parseArgs(argv: string[]) {
  const cmd = argv[0]
  if (cmd !== 'render' && cmd !== 'check') usage()
  const files: string[] = []
  let out: string | undefined
  let report: string | undefined
  let emit: string | undefined
  let framesArg: string | undefined
  let rgba: string | undefined
  let frame: number | undefined
  let from: number | undefined
  let to: number | undefined
  let step: number | undefined
  const scales: number[] = []
  let debug = false
  let preview: string | undefined
  let meshSamples: 1 | 2 | 4 | undefined
  let watchMode = false
  let noScript = false
  let typecheckFlag = false
  let noTypecheckFlag = false
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('-')) {
      files.push(a)
      continue
    }
    const next = () => {
      const value = argv[++i]
      // `--rgba -` 的值就是一个横线。别的横线开头的是下一个参数，不是值。
      if (value == null || (value.startsWith('-') && value !== '-')) usage()
      return value
    }
    if (a === '-o') out = next()
    else if (a === '--report') report = next()
    else if (a === '--scale') {
      const scale = Number(next())
      if (!Number.isFinite(scale) || scale <= 0) usage()
      if (!scales.includes(scale)) scales.push(scale)
    } else if (a === '--debug') debug = true
    else if (a === '--preview') preview = next()
    else if (a === '--emit') emit = next()
    else if (a === '--frames') framesArg = next()
    else if (a === '--rgba') rgba = next()
    else if (a === '--frame') frame = Number(next())
    else if (a === '--from') from = Number(next())
    else if (a === '--to') to = Number(next())
    else if (a === '--step') step = Number(next())
    else if (a === '--watch') watchMode = true
    else if (a === '--no-script') noScript = true
    else if (a === '--typecheck') typecheckFlag = true
    else if (a === '--no-typecheck') noTypecheckFlag = true
    else if (a === '--mesh-samples') {
      const n = Number(next())
      if (n !== 1 && n !== 2 && n !== 4) usage()
      meshSamples = n
    } else usage()
  }
  if (files.length === 0) usage()
  if (scales.length === 0) scales.push(1)
  if (typecheckFlag && noTypecheckFlag) usage()
  if (frame != null && (!Number.isInteger(frame) || frame < 0)) usage()
  if (from != null && (!Number.isInteger(from) || from < 0)) usage()
  if (to != null && (!Number.isInteger(to) || to < 0)) usage()
  if (step != null && (!Number.isInteger(step) || step < 1)) usage()
  if (cmd === 'check' && (rgba || from != null || to != null || preview)) usage()
  if (cmd === 'check' && scales.length > 1) usage()
  if (frame != null && (framesArg != null || rgba != null || from != null || to != null || step != null)) usage()
  if (cmd === 'render' && rgba != null && framesArg != null) usage()
  if (cmd === 'check' && step != null && framesArg == null) usage()
  if (watchMode && (rgba != null || framesArg != null)) usage()
  const batch = files.length > 1 || (cmd === 'render' && scales.length > 1)
  if (batch && watchMode) usage()
  if (cmd === 'render' && batch && (preview || framesArg || rgba != null || frame != null || from != null || to != null || step != null)) usage()
  const typecheck = cmd === 'check' ? !noTypecheckFlag : typecheckFlag
  return { cmd, files, out, report, emit, framesArg, rgba, frame, from, to, step, scales, debug, preview, meshSamples, watchMode, noScript, typecheck }
}

function frameInput(frame: number, fps: number): FrameInput {
  return { frame, fps, t: frame / fps }
}

function appendIssues(report: LayerReport, extra: Issue[]) {
  if (extra.length === 0) return
  report.issues = [...extra, ...report.issues]
}

let say = (line: string) => {
  console.log(line)
}

async function emitNode(node: Parameters<typeof emitLayer>[0], emit: string | undefined, report: LayerReport) {
  if (!emit) return
  const emitted = emitLayer(node)
  appendIssues(report, emitted.issues)
  await mkdir(dirname(resolve(emit)), { recursive: true })
  await writeFile(emit, emitted.source)
  say(`✓ ${emit}`)
}

let holdErrors = false

function failIfErrors(report: LayerReport): boolean {
  const failed = report.issues.some((issue) => issue.level === 'error')
  if (!holdErrors && failed) process.exit(1)
  return failed
}

function visibleIssues(report: LayerReport, showType: boolean): Issue[] {
  if (showType) return report.issues
  return report.issues.filter((issue) => issue.code !== 'type-error')
}

function printIssues(report: LayerReport, showType = true) {
  for (const issue of visibleIssues(report, showType)) say(formatIssueLine(issue))
}

function printCheckResult(report: LayerReport, showType = true) {
  printIssues(report, showType)
  if (visibleIssues(report, showType).length === 0) say('✓ 0 issues')
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
    throw new Error('没有安装 flexlayer-select。这个包不在 npm 上。在仓库里进入 packages/select，执行 npm install && npm run build')
  }
}

const WATCH_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.layer', '.fvg']

function resolveLocalImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  const candidates = [base, ...WATCH_EXTS.map((ext) => base + ext), ...WATCH_EXTS.map((ext) => join(base, `index${ext}`))]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // 还没写出来
    }
  }
  return null
}

function collectWatchFiles(file: string, seen = new Set<string>()): string[] {
  const abs = resolve(file)
  if (seen.has(abs)) return []
  seen.add(abs)
  let source = ''
  try {
    source = readFileSync(abs, 'utf8')
  } catch {
    return [abs]
  }
  const out = [abs]
  const re = /(?:from|import)\s*(?:\(\s*)?['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(re)) {
    const next = resolveLocalImport(abs, match[1]!)
    if (next) out.push(...collectWatchFiles(next, seen))
  }
  return out
}

function watchNames(files: string[], onChange: () => void): () => void {
  const byDir = new Map<string, Set<string>>()
  for (const file of files) {
    const dir = dirname(file)
    let names = byDir.get(dir)
    if (!names) {
      names = new Set()
      byDir.set(dir, names)
    }
    names.add(basename(file))
  }
  const watchers: FSWatcher[] = []
  for (const [dir, names] of byDir) {
    try {
      watchers.push(
        watch(dir, (_event, filename) => {
          if (filename && names.has(String(filename))) onChange()
        }),
      )
    } catch {
      // 目录暂时不在
    }
  }
  return () => {
    for (const watcher of watchers) watcher.close()
  }
}

type Parsed = ReturnType<typeof parseArgs>
type RunArgs = Omit<Parsed, 'files' | 'scales'> & {
  file: string
  scale: number
  /** 同一份源渲多个倍率时，类型错误只在第一张图上打印。报告里仍然都有。 */
  showType: boolean
}
type LoadedJob = { abs: string; loaded: LoadedLayer; typeIssues: Issue[] }

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])
let batchMode = false

function showPath(file: string): string {
  const abs = resolve(file)
  const rel = relative(process.cwd(), abs)
  if (!rel || rel.startsWith('..')) return abs
  return rel
}

function stem(file: string): string {
  const base = basename(file)
  const stripped = base.replace(/\.(tsx|jsx|ts|js|layer|fvg)$/i, '')
  return stripped || base
}

function batchPng(file: string, scale: number, out: string | undefined, multiScale: boolean): string {
  const name = `${stem(file)}${multiScale ? `@${scale}x` : ''}.png`
  if (out) return join(out, name)
  return join(dirname(resolve(file)), name)
}

function batchBeside(file: string, dir: string, ext: string): string {
  return join(dir, `${stem(file)}${ext}`)
}

function job(args: Parsed, file: string, scale: number, patch?: Partial<Pick<RunArgs, 'out' | 'report' | 'emit' | 'showType'>>): RunArgs {
  const { files: _files, scales: _scales, ...rest } = args
  return { ...rest, file, scale, showType: true, ...patch }
}

function isBatch(args: Parsed): boolean {
  return args.files.length > 1 || (args.cmd === 'render' && args.scales.length > 1)
}

function rejectFilePath(flag: string, value: string | undefined, extensions: string[]) {
  if (!value) return
  const lower = value.toLowerCase()
  const looksLikeFile = extensions.some((ext) => lower.endsWith(ext)) || (existsSync(value) && statSync(value).isFile())
  if (looksLikeFile) {
    console.error(`多张图时 ${flag} 是目录，例如 ${flag} out/`)
    process.exit(2)
  }
}

async function loadJob(file: string, typecheck: boolean): Promise<LoadedJob> {
  const abs = resolve(file)
  const ext = extname(abs).toLowerCase()
  let loaded: LoadedLayer
  if (CODE_EXT.has(ext)) {
    const { loadLayerFile } = await import('./load-source.js')
    loaded = await loadLayerFile(abs)
  } else {
    loaded = { kind: 'markup', source: await readFile(abs, 'utf8') }
  }
  let typeIssues: Issue[] = []
  if (typecheck && CODE_EXT.has(ext)) {
    const { typecheckLayerFile } = await import('./typecheck.js')
    typeIssues = typecheckLayerFile(abs)
  }
  return { abs, loaded, typeIssues }
}

function notComposition(abs: string): never {
  if (batchMode) throw new Error(`${showPath(abs)} 不是 Composition`)
  usage()
}

async function runAll(args: Parsed) {
  if (!isBatch(args)) {
    await run(job(args, args.files[0]!, args.scales[0] ?? 1))
    return
  }
  batchMode = true
  holdErrors = true
  rejectFilePath('-o', args.out, ['.png'])
  rejectFilePath('--report', args.report, ['.json'])
  rejectFilePath('--emit', args.emit, ['.layer'])
  if (args.cmd === 'render' && args.out) await mkdir(args.out, { recursive: true })
  if (args.report) await mkdir(args.report, { recursive: true })
  if (args.emit) await mkdir(args.emit, { recursive: true })
  let failed = false
  const scales = args.cmd === 'render' ? args.scales : [1]
  const multiScale = scales.length > 1
  for (const file of args.files) {
    say(`· ${showPath(file)}`)
    try {
      const loaded = await loadJob(file, args.typecheck)
      for (let i = 0; i < scales.length; i++) {
        const scale = scales[i]!
        const out = args.cmd === 'render' ? batchPng(file, scale, args.out, multiScale) : undefined
        const report = args.report
          ? args.cmd === 'render'
            ? join(args.report, `${stem(file)}${multiScale ? `@${scale}x` : ''}.json`)
            : batchBeside(file, args.report, '.json')
          : undefined
        const emit = args.emit && i === 0 ? batchBeside(file, args.emit, '.layer') : undefined
        const had = await execute(job(args, file, scale, { out, report, emit, showType: i === 0 }), loaded)
        if (had) failed = true
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
      failed = true
    }
  }
  if (failed) process.exit(1)
}

export async function main() {
  if (process.argv[2] === 'select') {
    await forwardSelect(process.argv.slice(3))
    return
  }
  const args = parseArgs(process.argv.slice(2))
  if (!args.watchMode) {
    await runAll(args)
    return
  }
  const file = args.files[0]!
  holdErrors = true
  let stop = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false
  const cycle = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await run(job(args, file, args.scales[0] ?? 1))
      say(`· watching ${file}`)
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
    } finally {
      running = false
      stop()
      stop = watchNames(collectWatchFiles(resolve(file)), () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void cycle()
        }, 80)
      })
      if (again) {
        again = false
        await cycle()
      }
    }
  }
  await cycle()
  await new Promise(() => {})
}

async function run(args: RunArgs): Promise<boolean> {
  return execute(args, await loadJob(args.file, args.typecheck))
}

async function execute(args: RunArgs, input: LoadedJob): Promise<boolean> {
  const { abs, loaded, typeIssues } = input
  const baseDir = dirname(abs)

  if (args.preview && loaded.kind === 'composition') throw new Error('--preview 只用于单帧 .layer 或 .tsx')
  if (args.frame != null && loaded.kind !== 'composition') notComposition(abs)
  if ((args.framesArg || args.rgba || args.from != null || args.to != null || args.step != null) && loaded.kind !== 'composition') notComposition(abs)
  if (args.emit && loaded.kind === 'markup') throw new Error('--emit 只用于 .tsx 等会展开的源文件')

  const attachFileIssues = (report: LayerReport) => {
    if (loaded.kind !== 'markup') appendIssues(report, loaded.issues)
    appendIssues(report, typeIssues)
  }

  if (args.cmd === 'check') {
    if (loaded.kind !== 'composition') {
      const node = loaded.kind === 'markup' ? loaded.source : loaded.node
      const report = await checkLayer(node, { baseDir, noScript: args.noScript })
      if (typeof node !== 'string') await emitNode(node, args.emit, report)
      attachFileIssues(report)
      printCheckResult(report, args.showType)
      if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
      return failIfErrors(report)
    }
    const duration = loaded.composition.durationInFrames
    if (args.frame != null && args.frame >= duration) {
      throw new Error(`--frame ${args.frame} 超出范围，这段共 ${duration} 帧`)
    }
    const sample = args.framesArg != null ? checkSample(args.framesArg, args.step) : args.frame
    const frames = sampleFrames(duration, sample)
    const parts: Array<{ frame: number; issues: Issue[] }> = []
    let report: LayerReport | undefined
    let emitAt: LayerNode | undefined
    for (const frame of frames) {
      const node = loaded.composition.component(frameInput(frame, loaded.composition.fps))
      const one = await checkLayer(node, { baseDir, noScript: args.noScript, t: frame / loaded.composition.fps, frame, fps: loaded.composition.fps })
      if (!report) report = one
      if (frame === (args.frame ?? 0)) emitAt = node
      parts.push({ frame, issues: one.issues })
    }
    report!.issues = mergeFrameIssues(parts)
    if (emitAt) await emitNode(emitAt, args.emit, report!)
    attachFileIssues(report!)
    printCheckResult(report!, args.showType)
    if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
    return failIfErrors(report!)
  }

  if (loaded.kind === 'composition') {
    const { createContactSheet, renderFrames } = await import('./frame.js')
    const comp: Composition = loaded.composition
    if (args.frame != null) {
      if (args.frame >= comp.durationInFrames) {
        throw new Error(`--frame ${args.frame} 超出范围，这段共 ${comp.durationInFrames} 帧`)
      }
      const input = frameInput(args.frame, comp.fps)
      const node = comp.component(input)
      const { png, report } = await renderLayer(node, {
        baseDir,
        scale: args.scale,
        debug: args.debug,
        t: input.t,
        frame: args.frame,
        fps: comp.fps,
        meshSamples: args.meshSamples,
        noScript: args.noScript,
      })
      attachFileIssues(report)
      await emitNode(node, args.emit, report)
      const outPath = outPng(abs, args.out)
      await writeFile(outPath, png)
      printIssues(report, args.showType)
      if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
      const failed = failIfErrors(report)
      say(`✓ ${outPath}  ${report.width}×${report.height}  第 ${args.frame} 帧`)
      return failed
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
    let report: LayerReport | undefined
    let count = 0
    for await (const rendered of renderFrames(comp, {
      baseDir,
      scale: args.scale,
      debug: args.debug,
      from: args.from,
      to: args.to,
      step: args.step,
      format: args.rgba ? 'rgba' : 'png',
      meshSamples: args.meshSamples,
      noScript: args.noScript,
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
    printIssues(report, args.showType)
    if (sheet) {
      const outPath = outPng(abs, args.out)
      await writeFile(outPath, sheet.toPng())
    }
    if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
    const failed = failIfErrors(report)
    if (args.framesArg) say(`✓ ${args.framesArg}  ${count} 帧`)
    if (args.rgba && !rgbaToStdout) say(`✓ ${args.rgba}  ${count} 帧原始像素`)
    if (sheet) say(`✓ ${outPng(abs, args.out)}  联系表  ${count} 帧`)
    return failed
  }

  const source = loaded.kind === 'markup' ? loaded.source : loaded.node
  const { png, report } = await renderLayer(source, { baseDir, scale: args.scale, debug: args.debug, meshSamples: args.meshSamples, noScript: args.noScript })
  if (loaded.kind === 'node') await emitNode(loaded.node, args.emit, report)
  attachFileIssues(report)
  const outPath = outPng(abs, args.out)
  await writeFile(outPath, png)
  if (args.preview) {
    const sheet = await renderPreview(source, { baseDir, scale: args.scale })
    if (!sheet) throw new Error('没有 <preview>。写成 <preview of="#id" show="overlay checker black white edges" />')
    await mkdir(dirname(resolve(args.preview)), { recursive: true })
    await writeFile(args.preview, sheet)
  }
  printIssues(report, args.showType)
  if (args.report) await writeFile(args.report, JSON.stringify(report, null, 2))
  const failed = failIfErrors(report)
  if (args.preview) say(`✓ ${args.preview}  选区预览`)
  say(`✓ ${outPath}  ${report.width}×${report.height}  ${report.elements.length} 个元素`)
  return failed
}
