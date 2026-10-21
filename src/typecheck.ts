import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { formatSourceLoc } from './source-loc.js'
import type { Issue } from './types.js'

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])

/** `@types/node` 装成依赖时经常被提升到上层，不能写死在本包的 node_modules 里。 */
function nodeTypesDir(pkgRoot: string): string {
  const require = createRequire(import.meta.url)
  try {
    return dirname(require.resolve('@types/node/package.json'))
  } catch {
    return join(pkgRoot, 'node_modules/@types/node')
  }
}

/**
 * typeRoots 里若放进整个 `@types`，仓库外的文件也会认到本包装的 `@types/three`。
 * 这里只留 `node`，其它包仍从源文件所在目录往上找。
 */
function nodeOnlyTypeRoot(pkgRoot: string): string {
  const root = join(tmpdir(), 'flexlayer-type-roots')
  const link = join(root, 'node')
  mkdirSync(root, { recursive: true })
  if (!existsSync(link)) symlinkSync(nodeTypesDir(pkgRoot), link, 'dir')
  return root
}

function runtimePaths(): { baseUrl: string; paths: Record<string, string[]>; typeRoots: string[] } {
  const here = dirname(fileURLToPath(import.meta.url))
  const fromSource = existsSync(join(here, 'index.ts'))
  const dir = fromSource ? 'src' : 'dist'
  const ext = fromSource ? 'ts' : 'd.ts'
  const pkgRoot = dirname(here)
  return {
    baseUrl: pkgRoot,
    typeRoots: [nodeOnlyTypeRoot(pkgRoot)],
    paths: {
      flexlayer: [`${dir}/index.${ext}`],
      'flexlayer/jsx-runtime': [`${dir}/jsx-runtime.${ext}`],
      'flexlayer/jsx-dev-runtime': [`${dir}/jsx-dev-runtime.${ext}`],
      'flexlayer/three': [`${dir}/three.${ext}`],
    },
  }
}

/** 对 `.tsx` 等源文件跑一次类型检查。`.layer` 返回空数组。 */
export function typecheckLayerFile(file: string): Issue[] {
  if (!CODE_EXT.has(extname(file).toLowerCase())) return []
  const { baseUrl, paths, typeRoots } = runtimePaths()
  // 直接传给 createProgram 的 lib 是文件名，不是 tsconfig 里的 "ES2022"。
  // 标准库跟着 typescript 走。@types/node 用 createRequire 解析，装成依赖被提升时也能找到。
  // 裸包名从这份源文件所在目录往上找 node_modules，和运行时解析的起点一致。
  // typeRoots 只放 node，避免仓库外的文件认到本包装的其它 @types。
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: 'flexlayer',
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts'],
    types: ['node'],
    typeRoots,
    allowImportingTsExtensions: true,
    baseUrl,
    paths,
  }
  const host = ts.createCompilerHost(options)
  host.getCurrentDirectory = () => dirname(file)
  const program = ts.createProgram([file], options, host)
  const issues: Issue[] = []
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file) continue
    const diagName = diagnostic.file.fileName
    const diagFile = isAbsolute(diagName) ? diagName : resolve(dirname(file), diagName)
    if (resolve(diagFile) !== resolve(file)) continue
    let source: string | undefined
    if (diagnostic.start != null) {
      const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      source = formatSourceLoc({ file, line: pos.line + 1, column: pos.character + 1 })
    }
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    issues.push({
      level: 'error',
      code: 'type-error',
      path: 'layer',
      message,
      source,
    })
  }
  return issues
}
