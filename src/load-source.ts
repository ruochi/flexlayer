import { existsSync } from 'node:fs'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, isAbsolute, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import type { Composition } from './frame.js'
import type { FvgNode } from './parse.js'
import { formatSourceLoc } from './source-loc.js'
import { registerFontsFromDocument } from './fonts.js'
import { nondeterministicCalls, staticLayerFonts } from './syntax.js'
import type { Issue } from './types.js'

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])
const require = createRequire(import.meta.url)
const BUILTINS = new Set(builtinModules)

export type LoadedLayer =
  | { kind: 'markup'; source: string }
  | { kind: 'node'; node: FvgNode; issues: Issue[] }
  | { kind: 'composition'; composition: Composition; issues: Issue[] }

type ExecutedLayer = Exclude<LoadedLayer, { kind: 'markup' }>

function isNode(value: unknown): value is FvgNode {
  if (!value || typeof value !== 'object') return false
  const node = value as FvgNode
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

function absolutizeLocs(node: FvgNode, baseDir: string): void {
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

async function importCode(file: string): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), 'flexlayer-'))
  const outfile = join(dir, 'entry.mjs')
  try {
    await esbuild.build({
      absWorkingDir: dirname(file),
      entryPoints: [file],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      jsx: 'automatic',
      jsxDev: true,
      jsxImportSource: '@dc/flexlayer',
      plugins: [
        {
          name: 'flexlayer-jsx',
          setup(build) {
            build.onResolve({ filter: /^@dc\/flexlayer$/ }, () => ({ path: siblingModule('index') }))
            build.onResolve({ filter: /^@dc\/flexlayer\/jsx-runtime$/ }, () => ({ path: siblingModule('jsx-runtime') }))
            build.onResolve({ filter: /^@dc\/flexlayer\/jsx-dev-runtime$/ }, () => ({ path: siblingModule('jsx-dev-runtime') }))
            // 打包进临时文件后，裸包名从 /tmp 解析不到。改成绝对路径再标成外部依赖。
            build.onResolve({ filter: /^[^./]/ }, (args) => {
              if (args.path.startsWith('@dc/flexlayer')) return null
              if (args.path.startsWith('node:') || BUILTINS.has(args.path)) return { path: args.path, external: true }
              return { path: require.resolve(args.path), external: true }
            })
          },
        },
      ],
    })
    return (await import(pathToFileURL(outfile).href)) as Record<string, unknown>
  } catch (err) {
    const failure = err as { errors?: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }> }
    const first = failure.errors?.[0]
    if (first?.text) {
      const raw = first.location?.file || file
      const at = first.location?.line ? `:${first.location.line}:${first.location.column ?? 0}` : ''
      throw new Error(`${displayFile(locatedFile(raw, dirname(file)))}${at} ${first.text}`)
    }
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true })
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
  const loaded = withAbsoluteLocs(resolveExport(await importCode(file), file), file)
  const issues = nondeterministicIssues(source, file)
  return { ...loaded, issues }
}
