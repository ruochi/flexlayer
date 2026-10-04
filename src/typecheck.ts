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
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@dc/flexlayer',
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ['ES2022'],
    baseUrl,
    paths,
  })
  const issues: Issue[] = []
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file || diagnostic.file.fileName !== file) continue
    let source: string | undefined
    if (diagnostic.start != null) {
      const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      source = formatSourceLoc({ file, line: pos.line + 1, column: pos.character + 1 })
    }
    issues.push({
      level: 'error',
      code: 'type-error',
      path: 'layer',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      source,
    })
  }
  return issues
}
