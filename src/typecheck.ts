import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { formatSourceLoc } from './source-loc.js'
import type { Issue } from './types.js'

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])

/** `@types/node` 装成依赖时经常被提升到上层，不能写死在本包的 node_modules 里。 */
function nodeTypeRoot(pkgRoot: string): string {
  const require = createRequire(import.meta.url)
  try {
    return dirname(dirname(require.resolve('@types/node/package.json')))
  } catch {
    return join(pkgRoot, 'node_modules/@types')
  }
}

function runtimePaths(): { baseUrl: string; paths: Record<string, string[]>; typeRoots: string[] } {
  const here = dirname(fileURLToPath(import.meta.url))
  const fromSource = existsSync(join(here, 'index.ts'))
  const dir = fromSource ? 'src' : 'dist'
  const ext = fromSource ? 'ts' : 'd.ts'
  const pkgRoot = dirname(here)
  return {
    baseUrl: pkgRoot,
    typeRoots: [nodeTypeRoot(pkgRoot)],
    paths: {
      'flexlayer': [`${dir}/index.${ext}`],
      'flexlayer/jsx-runtime': [`${dir}/jsx-runtime.${ext}`],
      'flexlayer/jsx-dev-runtime': [`${dir}/jsx-dev-runtime.${ext}`],
    },
  }
}

/** 对 `.tsx` 等源文件跑一次类型检查。`.layer` 返回空数组。 */
export function typecheckLayerFile(file: string): Issue[] {
  if (!CODE_EXT.has(extname(file).toLowerCase())) return []
  const { baseUrl, paths, typeRoots } = runtimePaths()
  // 直接传给 createProgram 的 lib 是文件名，不是 tsconfig 里的 "ES2022"。
  // 标准库跟着 typescript 走。@types/node 用 createRequire 解析，装成依赖被提升时也能找到。
  // 不看 .tsx 旁边有没有 node_modules。
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
