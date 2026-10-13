import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { createCanvasSession, type CanvasDomIssue, type CanvasDomSpec } from './canvas-dom.mjs'
import type { CanvasLayoutNode, Issue, LayerDocument, LayoutNode } from './types.js'

const require = createRequire(import.meta.url)

export type ScriptRunOptions = {
  t?: number
  frame?: number
  fps?: number
  /** 等于渲染的 `--scale`，脚本里的 `devicePixelRatio`。 */
  scale?: number
  noScript?: boolean
}

type ExportedCanvas = { path: string; width: number; height: number; rgba: string }

function walkCanvases(node: LayoutNode, out: CanvasLayoutNode[]) {
  if (node.kind === 'canvas') out.push(node)
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) walkCanvases(child, out)
    if (node.kind === 'layer' && node.mask) {
      for (const child of node.mask) walkCanvases(child, out)
    }
  }
}

function isMusl(): boolean {
  if (process.platform !== 'linux') return false
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  return Boolean(report?.header && !report.header.glibcVersionRuntime)
}

function nativeBinding(): { canvasDir: string; nativeDir: string; nativeFile: string } {
  const canvasDir = dirname(require.resolve('@napi-rs/canvas'))
  const parent = dirname(canvasDir)
  const wantMusl = isMusl()
  const matches: Array<{ nativeDir: string; nativeFile: string }> = []
  for (const entry of readdirSync(parent)) {
    if (!entry.startsWith('canvas-')) continue
    const nativeDir = join(parent, entry)
    let file: string | undefined
    try {
      file = readdirSync(nativeDir).find((name) => name.endsWith('.node') && name.includes(process.platform) && name.includes(process.arch))
    } catch {
      continue
    }
    if (!file) continue
    matches.push({ nativeDir, nativeFile: join(nativeDir, file) })
  }
  const chosen =
    matches.find((item) => (wantMusl ? item.nativeFile.includes('musl') : item.nativeFile.includes('gnu') || !item.nativeFile.includes('musl'))) ??
    matches[0]
  if (!chosen) throw new Error('找不到 @napi-rs/canvas 的原生库')
  return { canvasDir, ...chosen }
}

function specOf(node: CanvasLayoutNode, rgba?: string): CanvasDomSpec {
  return {
    path: node.path,
    id: node.id,
    width: node.width,
    height: node.height,
    bitmapWidth: node.bitmapWidth,
    bitmapHeight: node.bitmapHeight,
    x: node.x,
    y: node.y,
    style: node.style,
    computed: node.computed,
    text: node.text,
    attrs: node.attr,
    ...(rgba ? { rgba } : {}),
  }
}

function toIssue(item: CanvasDomIssue): Issue {
  return {
    level: item.level,
    code: item.code,
    path: item.path,
    message: item.message,
    ...(item.hint ? { hint: item.hint } : {}),
    ...(item.source ? { source: item.source } : {}),
  }
}

function assignEncoded(nodes: CanvasLayoutNode[], exported: ExportedCanvas[]) {
  const byPath = new Map(exported.map((item) => [item.path, item]))
  for (const node of nodes) {
    const item = byPath.get(node.path)
    if (!item || item.width <= 0 || item.height <= 0) continue
    const canvas = createCanvas(item.width, item.height)
    const ctx = canvas.getContext('2d')
    const image = ctx.createImageData(item.width, item.height)
    image.data.set(Buffer.from(item.rgba, 'base64').subarray(0, image.data.length))
    ctx.putImageData(image, 0, 0)
    node.bitmap = canvas
  }
}

function assignLive(nodes: CanvasLayoutNode[], live: Array<{ path: string; canvas: CanvasLayoutNode['bitmap'] }>) {
  const byPath = new Map(live.map((item) => [item.path, item.canvas]))
  for (const node of nodes) {
    const bitmap = byPath.get(node.path)
    if (bitmap) node.bitmap = bitmap
  }
}

function runChild(payload: unknown): Promise<{ issues: CanvasDomIssue[]; canvases: ExportedCanvas[] }> {
  const host = fileURLToPath(new URL('./canvas-dom.mjs', import.meta.url))
  const { canvasDir, nativeDir, nativeFile } = nativeBinding()
  const major = Number(process.versions.node.split('.')[0])
  const permission = major >= 22 ? '--permission' : '--experimental-permission'
  const args = [
    permission,
    '--allow-addons',
    `--allow-fs-read=${host}`,
    `--allow-fs-read=${canvasDir}`,
    `--allow-fs-read=${nativeDir}`,
    host,
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(15_000),
      env: {
        PATH: process.env.PATH ?? '',
        NAPI_RS_NATIVE_LIBRARY_PATH: nativeFile,
      },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(chunk as Buffer))
    child.stderr.on('data', (chunk) => stderr.push(chunk as Buffer))
    child.on('error', reject)
    child.on('close', (code) => {
      const text = Buffer.concat(stdout).toString('utf8')
      if (code !== 0 || !text.trim()) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 500)
        reject(new Error(detail || `脚本进程退出 ${code}`))
        return
      }
      try {
        resolve(JSON.parse(text) as { issues: CanvasDomIssue[]; canvases: ExportedCanvas[] })
      } catch (err) {
        reject(err)
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

/** 排版之后、绘制之前跑脚本。字符串脚本在子进程里，闭包留在本进程。 */
export async function applyCanvasScripts(doc: LayerDocument, options: ScriptRunOptions = {}): Promise<void> {
  if (doc.scripts.length === 0) return
  if (options.noScript) {
    doc.issues.push({
      level: 'info',
      code: 'invalid-script',
      path: doc.scripts[0]!.path,
      message: '已跳过 script',
      hint: '去掉 --no-script 才会执行 <script>',
    })
    return
  }
  const nodes: CanvasLayoutNode[] = []
  walkCanvases(doc.root, nodes)
  const specs = nodes.map((node) => specOf(node))
  const sources: Record<string, string> = {}
  for (const script of doc.scripts) {
    if (script.source) sources[script.path] = script.source
  }
  const timeMs = (options.t ?? 0) * 1000
  const frame = options.frame ?? 0
  const inputBase = {
    canvases: specs,
    timeMs,
    fps: options.fps ?? 0,
    frame,
    dpr: options.scale ?? 1,
    seed: Math.imul(frame + 1, 0x9e3779b1) >>> 0,
    sources,
  }
  const strings = doc.scripts.filter((script) => script.body != null && script.body.trim() !== '')
  const fns = doc.scripts.filter((script) => script.fn)
  let exported: ExportedCanvas[] | undefined
  if (strings.length > 0) {
    try {
      const result = await runChild({
        ...inputBase,
        scripts: strings.map((script) => ({ path: script.path, body: script.body })),
      })
      for (const item of result.issues) doc.issues.push(toIssue(item))
      exported = result.canvases
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      doc.issues.push({
        level: 'error',
        code: 'invalid-script',
        path: strings[0]!.path,
        message: `script 运行出错: ${detail}`,
        hint: '检查脚本。其余内容仍会绘制',
        ...(strings[0]!.source ? { source: strings[0]!.source } : {}),
      })
      return
    }
  }
  if (fns.length === 0) {
    if (exported) assignEncoded(nodes, exported)
    return
  }
  const rgba = new Map((exported ?? []).map((item) => [item.path, item.rgba]))
  const session = createCanvasSession({
    ...inputBase,
    canvases: nodes.map((node) => specOf(node, rgba.get(node.path))),
  })
  session.installGlobals()
  try {
    for (const script of fns) session.runFn(script.fn!, script.path)
    session.flush()
  } finally {
    session.restoreGlobals()
  }
  for (const item of session.issues) doc.issues.push(toIssue(item))
  assignLive(nodes, session.live())
}
