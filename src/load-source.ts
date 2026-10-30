import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, extname, join, relative, isAbsolute, resolve, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { ensureAuthorSource } from './author-features.js'
import type { Composition } from './frame.js'
import type { LayerNode } from './parse.js'
import { setLayerBaseDir } from './canvas.js'
import { formatSourceLoc } from './source-loc.js'
import { beginGeomIssues, endGeomIssues } from './geom-issues.js'
import { resolveBare } from './resolve-bare.js'
import { registerFontsFromDocument } from './fonts.js'
import { nondeterministicCalls, staticLayerFonts } from './syntax.js'
import type { Issue } from './types.js'

/** 打包参数变了就加一，旧缓存作废。 */
const CODE_CACHE_REV = '4'
const CODE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs']

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])
const require = createRequire(import.meta.url)
const BUILTINS = new Set(builtinModules)
let tsxHooked = false

export type LoadedLayer =
  | { kind: 'markup'; source: string }
  | { kind: 'node'; node: LayerNode; issues: Issue[] }
  | { kind: 'composition'; composition: Composition; issues: Issue[] }

type ExecutedLayer = Exclude<LoadedLayer, { kind: 'markup' }>

function isNode(value: unknown): value is LayerNode {
  if (!value || typeof value !== 'object') return false
  const node = value as LayerNode
  return typeof node.tag === 'string' && node.attrs != null && typeof node.attrs === 'object' && Array.isArray(node.children)
}

function isComposition(value: unknown): value is Composition {
  if (!value || typeof value !== 'object') return false
  const comp = value as Composition
  return (
    typeof comp.component === 'function' &&
    typeof comp.width === 'number' &&
    typeof comp.height === 'number' &&
    typeof comp.fps === 'number' &&
    typeof comp.durationInFrames === 'number'
  )
}

function siblingModule(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const ts = join(here, `${name}.ts`)
  if (existsSync(ts)) return ts
  return join(here, `${name}.js`)
}

function displayFile(file: string): string {
  if (!isAbsolute(file)) return file
  const rel = relative(process.cwd(), file)
  return rel && !rel.startsWith('..') ? rel : file
}

function locatedFile(file: string, baseDir: string): string {
  return isAbsolute(file) ? file : resolve(baseDir, file)
}

function absolutizeLocs(node: LayerNode, baseDir: string): void {
  if (node.loc && !isAbsolute(node.loc.file)) node.loc.file = resolve(baseDir, node.loc.file)
  for (const child of node.children) {
    if (typeof child !== 'string') absolutizeLocs(child, baseDir)
  }
}

function nondeterministicIssues(source: string, file: string): Issue[] {
  return nondeterministicCalls(source, file).map((call) => ({
    level: 'warn' as const,
    code: 'nondeterministic' as const,
    path: 'layer',
    message: `用了 ${call.name}，同一帧可能得到不同的图`,
    hint: '改成由 frame、t 或传入的数据计算',
    source: formatSourceLoc({ file, line: call.line, column: call.column }),
  }))
}

function resolveExport(mod: Record<string, unknown>, file: string): ExecutedLayer {
  const shown = displayFile(file)
  const candidates = [mod.default, mod.composition]
  for (const value of candidates) {
    if (isComposition(value)) return { kind: 'composition', composition: value, issues: [] }
  }
  for (const value of candidates) {
    if (isNode(value)) return { kind: 'node', node: value, issues: [] }
  }
  const main = mod.default
  if (typeof main === 'function') {
    const rendered = main({})
    if (isNode(rendered)) return { kind: 'node', node: rendered, issues: [] }
    if (isComposition(rendered)) return { kind: 'composition', composition: rendered, issues: [] }
  }
  throw new Error(`${shown} 需要默认导出 <layer> 节点、返回该节点的函数，或 Composition（也可以命名导出 composition）`)
}

function flexlayerEntry(specifier: string): string {
  if (specifier === 'flexlayer') return siblingModule('index')
  const sub = specifier.slice('flexlayer/'.length).replace(/\.js$/, '')
  return siblingModule(sub)
}

async function importBundled(outfile: string): Promise<Record<string, unknown>> {
  if (!tsxHooked && siblingModule('index').endsWith('.ts')) {
    const { register: registerTsx } = await import('tsx/esm/api')
    registerTsx()
    tsxHooked = true
  }
  // 栈帧映射回源文件，几何问题和运行错误才能报出 `.tsx` 的行列。
  process.setSourceMapsEnabled(true)
  return (await import(pathToFileURL(outfile).href)) as Record<string, unknown>
}

function resolveCodeImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  const candidates = [base, ...CODE_EXTS.map((ext) => base + ext), ...CODE_EXTS.map((ext) => join(base, `index${ext}`))]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // 还没写出来
    }
  }
  return null
}

function localImportSpecs(source: string): string[] {
  const specs: string[] = []
  const re = /(?:from|import)\s*(?:\(\s*)?['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(re)) specs.push(match[1]!)
  return specs
}

/** 外部依赖被打成绝对路径。换一次安装位置就要换一个缓存，避免指向上次已删的目录。 */
function runtimeIdentity(): string {
  const parts = [
    flexlayerEntry('flexlayer'),
    flexlayerEntry('flexlayer/jsx-runtime'),
    flexlayerEntry('flexlayer/jsx-dev-runtime'),
  ]
  try {
    parts.push(require.resolve('@napi-rs/canvas'))
  } catch {
    // 没装上时打包自己会失败
  }
  return parts.join('\0')
}

function isMissingModule(err: unknown): boolean {
  return (err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND'
}

/** 入口、相对引用和当前 flexlayer 安装路径一起哈希。内容不变就复用上次打好的包。 */
function codeHash(file: string): string {
  const hash = createHash('sha256')
  hash.update(CODE_CACHE_REV)
  hash.update('\0runtime\0')
  hash.update(runtimeIdentity())
  const seen = new Set<string>()
  const walk = (current: string) => {
    const abs = resolve(current)
    if (seen.has(abs)) return
    seen.add(abs)
    let text = ''
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      return
    }
    hash.update('\0')
    hash.update(text)
    // `import.meta.url` is rewritten to the file's own absolute path, so the
    // same text in a different directory produces a different bundle. Keying on
    // contents alone reused a bundle that pointed at a directory which had been
    // deleted, and the import failed with ENOENT.
    hash.update('\0path\0')
    hash.update(abs)
    for (const spec of localImportSpecs(text)) {
      const next = resolveCodeImport(abs, spec)
      if (next) walk(next)
    }
  }
  walk(file)
  return hash.digest('hex').slice(0, 32)
}

async function importCode(file: string): Promise<Record<string, unknown>> {
  const dir = join(homedir(), '.cache', 'flexlayer', 'code', codeHash(file))
  const outfile = join(dir, 'entry.mjs')
  if (existsSync(outfile)) {
    try {
      return await importBundled(outfile)
    } catch (err) {
      if (!isMissingModule(err)) throw err
      await rm(dir, { recursive: true, force: true })
    }
  }
  await mkdir(dir, { recursive: true })
  try {
    await esbuild.build({
      absWorkingDir: dirname(file),
      entryPoints: [file],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      sourcemap: 'inline',
      jsx: 'automatic',
      jsxDev: true,
      jsxImportSource: 'flexlayer',
      // 打包后 import.meta.url 落在缓存目录，图片解码线程要从这里找到 canvas。
      banner: { js: `globalThis.__flexlayerCanvasEntry = ${JSON.stringify(require.resolve('@napi-rs/canvas'))}` },
      plugins: [
        {
          name: 'flexlayer-jsx',
          setup(build) {
            build.onResolve({ filter: /^flexlayer(\/.*)?$/ }, (args) => ({
              path: flexlayerEntry(args.path),
              external: true,
            }))
            // 用户文件里的 import.meta.url 保持指向源文件，而不是打包出来的临时文件。
            build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
              if (args.path.includes(`${sep}node_modules${sep}`)) return null
              const contents = await readFile(args.path, 'utf8')
              if (!contents.includes('import.meta.url')) return null
              const ext = extname(args.path).toLowerCase()
              const loader = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'ts' : ext === '.jsx' ? 'jsx' : 'js'
              return {
                contents: contents.replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(args.path).href)),
                loader,
              }
            })
            // 裸包名从导入它的文件往上找，并按 Node 的 import 条件取导出。
            // require.resolve 会落到 CJS 构建，和 three/addons 里的 ESM 不是同一个模块。
            build.onResolve({ filter: /^[^./]/ }, (args) => {
              if (args.path === 'flexlayer' || args.path.startsWith('flexlayer/')) {
                return null
              }
              if (args.path.startsWith('node:') || BUILTINS.has(args.path)) return { path: args.path, external: true }
              const parent = args.importer || file
              try {
                return { path: resolveBare(args.path, parent), external: true }
              } catch {
                return { errors: [{ text: `无法解析 ${args.path}` }] }
              }
            })
          },
        },
      ],
    })
    return await importBundled(outfile)
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    const failure = err as { errors?: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }> }
    const first = failure.errors?.[0]
    if (first?.text) {
      const raw = first.location?.file || file
      const at = first.location?.line ? `:${first.location.line}:${first.location.column ?? 0}` : ''
      throw new Error(`${displayFile(locatedFile(raw, dirname(file)))}${at} ${first.text}`)
    }
    throw err
  }
}

function withAbsoluteLocs(loaded: ExecutedLayer, file: string): ExecutedLayer {
  const baseDir = dirname(file)
  if (loaded.kind === 'node') {
    absolutizeLocs(loaded.node, baseDir)
    return loaded
  }
  const render = loaded.composition.component
  return {
    ...loaded,
    composition: {
      ...loaded.composition,
      component: (input) => {
        const node = render(input)
        if (isNode(node)) absolutizeLocs(node, baseDir)
        return node
      },
    },
  }
}

/** `.layer` 原样读出。`.tsx` / `.jsx` / `.ts` / `.js` 执行后得到节点或 Composition。 */
export async function loadLayerFile(file: string): Promise<LoadedLayer> {
  const source = await readFile(file, 'utf8')
  if (!CODE_EXT.has(extname(file).toLowerCase())) return { kind: 'markup', source }
  const fonts = staticLayerFonts(source, file)
  if (fonts.length > 0) await registerFontsFromDocument(fonts, dirname(file))
  setLayerBaseDir(dirname(file))
  await ensureAuthorSource(source)
  beginGeomIssues()
  let loaded: ExecutedLayer
  let geom: Issue[]
  try {
    loaded = withAbsoluteLocs(resolveExport(await importCode(file), file), file)
  } finally {
    geom = endGeomIssues()
  }
  const issues = [...nondeterministicIssues(source, file), ...geom]
  return { ...loaded, issues }
}
