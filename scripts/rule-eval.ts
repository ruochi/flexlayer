/**
 * 统计 eval/runs/<variant> 里模型写出的场景。
 * 用法：npx tsx scripts/rule-eval.ts <variant> [--engine <dir>]
 * --engine 从那棵目录加载 render.ts 和 load-source.ts，用来对 main 打分。
 * 只有带 pixel 探针的场景才渲染。
 * 每个文件进三档之一：检查干净且画对、检查报了问题、检查干净但画面错。
 */
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const SCENE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.layer'])
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

type Box = { x: number; y: number; width: number; height: number }
type Issue = { level: string; code: string; message?: string }
type ElementHit = {
  id?: string
  box?: Box
  ink?: Box
  quad?: unknown
  points?: unknown[]
}
type Report = { width: number; height: number; elements: ElementHit[]; issues: Issue[] }
type Loaded =
  | { kind: 'markup'; source: string; issues: Issue[] }
  | { kind: 'node'; node: unknown; issues: Issue[] }
  | { kind: 'composition'; composition: { component: (frame: { frame: number; fps: number; t: number }) => unknown }; issues: Issue[] }
  | { kind: string; issues?: Issue[] }

type Probe =
  | { op: 'inkCenter'; id: string; x: number; y: number; tol: number }
  | { op: 'pixel'; x: number; y: number; is: 'ink' | 'background' }
  | { op: 'drawn3d'; id: string }
  | { op: 'inCanvas'; id: string }

type Engine = {
  checkLayer: (source: string | unknown, options?: { baseDir?: string }) => Promise<Report>
  renderLayer: (source: string | unknown, options?: { baseDir?: string }) => Promise<{ png: Buffer }>
  loadLayerFile: (file: string) => Promise<Loaded>
}

async function loadEngine(dir: string): Promise<Engine> {
  const root = resolve(dir)
  const render = await import(pathToFileURL(join(root, 'src/render.ts')).href)
  const load = await import(pathToFileURL(join(root, 'src/load-source.ts')).href)
  return { checkLayer: render.checkLayer, renderLayer: render.renderLayer, loadLayerFile: load.loadLayerFile }
}

async function sceneFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sceneFiles(path)))
    else if (SCENE_EXT.has(extname(entry.name).toLowerCase())) out.push(path)
  }
  return out.sort()
}

function stemOf(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}

function parseColor(raw: string | undefined): [number, number, number, number] {
  if (!raw) return [0, 0, 0, 0]
  const text = raw.trim().toLowerCase()
  if (text === '' || text === 'transparent' || text === 'none') return [0, 0, 0, 0]
  let hex = text.startsWith('#') ? text.slice(1) : text
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((ch) => ch + ch).join('')
  if (hex.length !== 6 && hex.length !== 8) return [0, 0, 0, 0]
  const n = Number.parseInt(hex, 16)
  if (!Number.isFinite(n)) return [0, 0, 0, 0]
  if (hex.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
  return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function backgroundOf(loaded: Loaded): [number, number, number, number] {
  if (loaded.kind === 'markup') {
    const match = loaded.source.match(/<layer\b[^>]*\sbackground="([^"]*)"/)
    return parseColor(match?.[1])
  }
  if (loaded.kind === 'node') {
    const node = loaded.node as { attrs?: { background?: string } }
    return parseColor(node.attrs?.background)
  }
  return [0, 0, 0, 0]
}

function findEl(report: Report, id: string): ElementHit | undefined {
  return report.elements.find((el) => el.id === id)
}

function centerOf(ink: Box): { x: number; y: number } {
  return { x: ink.x + ink.width / 2, y: ink.y + ink.height / 2 }
}

function inside(el: ElementHit, width: number, height: number): boolean {
  const ink = el.ink
  const box = el.box
  const target = ink && ink.width > 0 && ink.height > 0 ? ink : box
  if (!target || (target.width <= 0 && target.height <= 0)) return false
  const right = target.x + Math.max(0, target.width)
  const bottom = target.y + Math.max(0, target.height)
  return target.x >= -1 && target.y >= -1 && right <= width + 1 && bottom <= height + 1
}

function enteredCamera(el: ElementHit, report: Report): boolean {
  if (el.quad) return true
  if (Array.isArray(el.points) && el.points.length > 0) return true
  const ink = el.ink
  const box = el.box
  if (ink && box && ink.width > 0 && ink.height > 0) {
    const projected =
      Math.abs(ink.x - box.x) > 0.5 ||
      Math.abs(ink.y - box.y) > 0.5 ||
      Math.abs(ink.width - box.width) > 0.5 ||
      Math.abs(ink.height - box.height) > 0.5
    if (projected) return true
  }
  const sceneHasCamera = report.elements.some((other) => other.quad || (Array.isArray(other.points) && other.points.length > 0))
  return sceneHasCamera && !!ink && ink.width > 0 && ink.height > 0
}

function probeFails(
  probes: Probe[],
  report: Report,
  pixels: Uint8ClampedArray | null,
  bg: [number, number, number, number],
): string[] {
  const fails: string[] = []
  for (const probe of probes) {
    if (probe.op === 'pixel') {
      if (!pixels) {
        fails.push(`pixel (${probe.x},${probe.y}) 没有渲染`)
        continue
      }
      const i = (probe.y * report.width + probe.x) * 4
      const px: [number, number, number, number] = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0]
      const delta = Math.max(Math.abs(px[0] - bg[0]), Math.abs(px[1] - bg[1]), Math.abs(px[2] - bg[2]), Math.abs(px[3] - bg[3]))
      const isBg = delta <= 12
      if (probe.is === 'ink' && isBg) fails.push(`pixel (${probe.x},${probe.y}) 仍是背景`)
      if (probe.is === 'background' && !isBg) fails.push(`pixel (${probe.x},${probe.y}) 不是背景`)
      continue
    }
    const el = findEl(report, probe.id)
    if (!el?.ink) {
      fails.push(`找不到 id="${probe.id}"`)
      continue
    }
    if (probe.op === 'inkCenter') {
      const c = centerOf(el.ink)
      const dist = Math.hypot(c.x - probe.x, c.y - probe.y)
      if (dist > probe.tol) fails.push(`inkCenter ${probe.id} 在 (${c.x.toFixed(0)},${c.y.toFixed(0)})，要在 (${probe.x},${probe.y}) ±${probe.tol}`)
    } else if (probe.op === 'inCanvas') {
      if (!inside(el, report.width, report.height)) fails.push(`inCanvas ${probe.id} 的着墨超出画布`)
    } else if (probe.op === 'drawn3d') {
      if (!enteredCamera(el, report)) fails.push(`drawn3d ${probe.id} 没有 quad 或 points，没有进镜头`)
    }
  }
  return fails
}

type Bucket = 'right' | 'problem' | 'wrong'

async function scoreFile(
  engine: Engine,
  file: string,
  probes: Probe[],
): Promise<{ bucket: Bucket; line: string }> {
  let loaded: Loaded
  try {
    loaded = await engine.loadLayerFile(file)
  } catch (err) {
    return { bucket: 'problem', line: `${file}: 检查抛错 (${err instanceof Error ? err.message : String(err)})` }
  }
  const sample = loaded.kind === 'composition' ? loaded.composition.component({ frame: 0, fps: 30, t: 0 }) : null
  const source = loaded.kind === 'markup' ? loaded.source : loaded.kind === 'node' ? loaded.node : sample
  if (source == null || typeof source === 'string' && loaded.kind === 'composition') {
    return { bucket: 'problem', line: `${file}: 检查抛错 (空帧)` }
  }
  let report: Report
  try {
    report = await engine.checkLayer(source, { baseDir: file })
  } catch (err) {
    return { bucket: 'problem', line: `${file}: 检查抛错 (${err instanceof Error ? err.message : String(err)})` }
  }
  const issues = [...(loaded.issues ?? []), ...report.issues]
  const problem = issues.filter((issue) => issue.level === 'error' || issue.level === 'warn')
  let pixels: Uint8ClampedArray | null = null
  if (probes.some((probe) => probe.op === 'pixel')) {
    try {
      const { png } = await engine.renderLayer(source, { baseDir: file })
      const img = await loadImage(png)
      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      pixels = ctx.getImageData(0, 0, img.width, img.height).data
    } catch (err) {
      const fails = [`渲染抛错 (${err instanceof Error ? err.message : String(err)})`]
      if (problem.length === 0) return { bucket: 'wrong', line: `${file}: ${fails.join('; ')}` }
    }
  }
  const fails = pixels || !probes.some((probe) => probe.op === 'pixel') ? probeFails(probes, report, pixels, backgroundOf(loaded)) : ['渲染失败']
  if (problem.length > 0) {
    const brief = problem.map((issue) => `${issue.level}:${issue.code}`).join(', ')
    const extra = fails.length ? `; 画面: ${fails.join('; ')}` : ''
    return { bucket: 'problem', line: `${file}: ${brief}${extra}` }
  }
  if (fails.length > 0) return { bucket: 'wrong', line: `${file}: ${fails.join('; ')}` }
  return { bucket: 'right', line: file }
}

function section(title: string, lines: string[]): string {
  const body = lines.length === 0 ? ['- —'] : lines.map((line) => `- ${line}`)
  return [`### ${title}`, '', ...body, ''].join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  let variant = ''
  let engineDir = repoRoot
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--engine') engineDir = resolve(args[++i] ?? '')
    else if (arg) variant = arg
  }
  if (!variant) {
    console.error('usage: npx tsx scripts/rule-eval.ts <variant> [--engine <dir>]')
    process.exit(1)
  }
  const engine = await loadEngine(engineDir)
  const probes = JSON.parse(await readFile(join(repoRoot, 'eval/expect.json'), 'utf8')) as Record<string, Probe[]>
  const files = await sceneFiles(join(repoRoot, 'eval/runs', variant))
  const byStem = new Map(files.map((file) => [stemOf(file), file]))
  const right: string[] = []
  const problem: string[] = []
  const wrong: string[] = []
  const missing: string[] = []
  for (const id of Object.keys(probes).sort()) {
    const file = byStem.get(id)
    if (!file) {
      missing.push(id)
      continue
    }
    const scored = await scoreFile(engine, file, probes[id] ?? [])
    if (scored.bucket === 'right') right.push(scored.line)
    else if (scored.bucket === 'problem') problem.push(scored.line)
    else wrong.push(scored.line)
  }
  const md = [
    `# ${variant}`,
    '',
    `engine: ${engineDir}`,
    `files: ${files.length}`,
    `clean and right: ${right.length}`,
    `check reports a problem: ${problem.length}`,
    `check clean but picture wrong: ${wrong.length}`,
    missing.length ? `missing scenes: ${missing.join(', ')}` : '',
    '',
    section('clean and right', right),
    section('check reports a problem', problem),
    section('check clean but picture wrong', wrong),
  ]
    .filter((line) => line !== '')
    .join('\n')
  process.stdout.write(`${md}\n`)
}

main()
