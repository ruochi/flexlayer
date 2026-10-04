import { existsSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { formatSourceLoc } from './source-loc.js'
import type { Issue } from './types.js'

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])

function runtimePaths(): { baseUrl: string; paths: Record<string, string[]> } {
  const here = dirname(fileURLToPath(import.meta.url))
  const fromSource = existsSync(join(here, 'index.ts'))
  const dir = fromSource ? 'src' : 'dist'
  const ext = fromSource ? 'ts' : 'd.ts'
  return {
    baseUrl: dirname(here),
    paths: {
      '@dc/flexlayer': [`${dir}/index.${ext}`],
      '@dc/flexlayer/jsx-runtime': [`${dir}/jsx-runtime.${ext}`],
      '@dc/flexlayer/jsx-dev-runtime': [`${dir}/jsx-dev-runtime.${ext}`],
    },
  }
}

/** 对 `.tsx` 等源文件跑一次类型检查。`.layer` 返回空数组。 */
export function typecheckLayerFile(file: string): Issue[] {
  if (!CODE_EXT.has(extname(file).toLowerCase())) return []
  const { baseUrl, paths } = runtimePaths()
  // 直接传给 createProgram 的 lib 是文件名，不是 tsconfig 里的 "ES2022"。
  // 标准库从 typescript 安装目录加载，不依赖文件旁边有没有 node_modules/@types。
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@dc/flexlayer',
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts'],
    types: [],
    allowImportingTsExtensions: true,
    baseUrl,
    paths,
  }
  const host = ts.createCompilerHost(options)
  host.getCurrentDirectory = () => dirname(file)
  const program = ts.createProgram([file], options, host)
  const issues: Issue[] = []
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file || diagnostic.file.fileName !== file) continue
    let source: string | undefined
    if (diagnostic.start != null) {
      const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      source = formatSourceLoc({ file, line: pos.line + 1, column: pos.character + 1 })
    }
    let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (diagnostic.file && diagnostic.start != null && diagnostic.length) {
      const span = diagnostic.file.text.slice(diagnostic.start, diagnostic.start + diagnostic.length)
      if (span && !message.includes(span)) message = `${span}：${message}`
    }
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
