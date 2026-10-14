import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { lstatSync, readlinkSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
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

function addGrant(grants: Set<string>, target: string) {
  // realpath 只给最终目录。加载器会对链上每一跳做 realpathSync，中间那一跳没放行也会被拒。
  let current = target
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    grants.add(current)
    let link: string
    try {
      link = readlinkSync(current)
    } catch {
      break
    }
    current = isAbsolute(link) ? link : join(dirname(current), link)
  }
  try {
    grants.add(realpathSync(target))
  } catch {
    // 逻辑路径可以还不存在。权限检查用的是解析前的那条，不能只留 realpath。
  }
}

function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink()
  } catch {
    return false
  }
}

/** 和 Node `WildcardIfDir` 一样：`stat` 跟着符号链接走，目录才算目录。 */
function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile()
  } catch {
    return false
  }
}

/** 顺着 Node `realpath` 的每一跳，把遇到的符号链接本身放进名单。一跳解析完再走下一截。 */
function grantSymlinkHops(grants: Set<string>, target: string) {
  if (!isAbsolute(target) || target.includes('*')) return
  const parts = target.split('/').filter(Boolean)
  let resolved = '/'
  for (const part of parts) {
    const through = join(resolved, part)
    if (!isSymlink(through)) {
      resolved = through
      continue
    }
    grants.add(through)
    // 目录符号链接会被收成 `链接/*`，realpath 打在链接自己身上时对不上，得放行它的父目录。
    const parent = dirname(through)
    if (parent !== '/' && parent !== through) grants.add(parent)
    let link = readlinkSync(through)
    if (!isAbsolute(link)) link = join(dirname(through), link)
    resolved = link
    const seen = new Set<string>()
    while (isSymlink(resolved) && !seen.has(resolved)) {
      seen.add(resolved)
      grants.add(resolved)
      const linkParent = dirname(resolved)
      if (linkParent !== '/' && linkParent !== resolved) grants.add(linkParent)
      let next = readlinkSync(resolved)
      if (!isAbsolute(next)) next = join(dirname(resolved), next)
      resolved = next
    }
  }
}

/**
 * 交给 `--allow-fs-read` 的路径。空字符串和单独的 `*` 不能进名单。
 * 已经存在的目录，Node 自己收成 `目录/*`；再写一条 `目录/*` 就是同一条前缀插第二次。
 * `**` 不是递归通配，第二个 `*` 会把前一条再插一遍。
 */
function keepGrant(grant: string): boolean {
  if (!isAbsolute(grant) || grant === '/') return false
  if (grant === '*' || grant.includes('**')) return false
  if (grant.endsWith('/*')) {
    const dir = grant.slice(0, -2)
    if (!dir || dir === '/' || dir.includes('*') || isDirectory(dir)) return false
    return true
  }
  return !grant.includes('*')
}

/**
 * `realpathSync` 要先读到路径上的符号链接本身。只放行链接里面的文件时，
 * 这一跳仍会报 Access to this API has been restricted。
 * 链接必须排在穿过它的子路径前面，否则 Node 会把链接折成真实路径，名单里等于没有这条链接。
 */
function orderedGrants(grants: Set<string>): string[] {
  for (const target of [...grants]) grantSymlinkHops(grants, target)
  return [...grants].filter(keepGrant).sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
}

/** 从脚本宿主往上，列出 node_modules 里这个包的逻辑路径。符号链接和真实目录都要。 */
function logicalPackages(host: string, name: string): string[] {
  const found: string[] = []
  let dir = dirname(host)
  while (true) {
    found.push(join(dir, 'node_modules', name))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return found
}

/**
 * Node 20 解析 ESM 时，从宿主文件往上每一级都要读 `package.json`。
 * 这一级还不存在也要放行：权限检查在 stat 之前，没放行就报
 * Access to this API has been restricted，子进程退出，画布是空的。
 * 读到已经存在的那一份就停，再往上不是这个包。
 */
function grantPackageScope(grants: Set<string>, startFile: string) {
  const seen = new Set<string>()
  const walk = (file: string) => {
    let dir = dirname(file)
    while (dir && !seen.has(dir)) {
      seen.add(dir)
      const pkg = join(dir, 'package.json')
      addGrant(grants, pkg)
      if (isFile(pkg)) break
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  walk(startFile)
  try {
    const real = realpathSync(startFile)
    if (real !== startFile) walk(real)
  } catch {
    // 宿主路径可以还没落盘。
  }
}

function scriptFailure(stderr: string, code: number | null): string {
  const text = stderr.trim()
  const resource = text.match(/resource: '([^']+)'/)?.[1]
  const message = text.match(/^Error: .+$/m)?.[0]
  if (message && resource) return `${message}（${resource}）`
  if (message) return message
  if (text) return text.slice(0, 500)
  return `脚本进程退出 ${code}`
}

/**
 * 子进程要读到的路径。`require.resolve` 给的是真实目录，ESM 加载器读的是
 * `node_modules` 上的符号链接。只放行一边时，读 `package.json` 会报
 * Access to this API has been restricted。链接的父目录如果自己也是符号链接，
 * `realpathSync` 同样要先读到那一跳。Node 20 还要读宿主往上每一级的 `package.json`。
 */
export function scriptReadGrants(host: string): string[] {
  const { canvasDir, nativeDir, nativeFile } = nativeBinding()
  const grants = new Set<string>()
  addGrant(grants, host)
  grantPackageScope(grants, host)
  for (const dir of [canvasDir, nativeDir, ...logicalPackages(host, '@napi-rs/canvas'), ...logicalPackages(host, join('@napi-rs', basename(nativeDir)))]) {
    addGrant(grants, dir)
    addGrant(grants, join(dir, 'package.json'))
    // 存在的目录 Node 会收成 `dir/*`，文件已经能读。再写 `dir/*` 或 `dir/**`，
    // Node 20 把同一条前缀插第二次，空前缀打到叶子上，断言 !path_prefix.empty()。
    // 目录还不存在时不会自动加通配，只补一条 `dir/*`。`**` 不是递归通配。
    if (dir && dir !== '/' && !isDirectory(dir)) grants.add(`${dir}/*`)
  }
  addGrant(grants, nativeFile)
  return orderedGrants(grants)
}

export function scriptChildArgs(host: string): string[] {
  const major = Number(process.versions.node.split('.')[0])
  const permission = major >= 22 ? '--permission' : '--experimental-permission'
  return [permission, '--allow-addons', ...scriptReadGrants(host).map((grant) => `--allow-fs-read=${grant}`), host]
}

function runChild(payload: unknown): Promise<{ issues: CanvasDomIssue[]; canvases: ExportedCanvas[] }> {
  const host = fileURLToPath(new URL('./canvas-dom.mjs', import.meta.url))
  const { nativeFile } = nativeBinding()
  const args = scriptChildArgs(host)
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      NAPI_RS_NATIVE_LIBRARY_PATH: nativeFile,
    }
    // 不把整份环境交进去。HOME 只为了 os.homedir；不放行家目录的读权限。
    if (process.env.HOME) env.HOME = process.env.HOME
    if (process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(15_000),
      env,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(chunk as Buffer))
    child.stderr.on('data', (chunk) => stderr.push(chunk as Buffer))
    child.on('error', reject)
    child.on('close', (code) => {
      const text = Buffer.concat(stdout).toString('utf8')
      if (code !== 0 || !text.trim()) {
        reject(new Error(scriptFailure(Buffer.concat(stderr).toString('utf8'), code)))
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
