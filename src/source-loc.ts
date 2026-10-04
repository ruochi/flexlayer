import { isAbsolute, relative } from 'node:path'
import type { SourceLoc } from './parse.js'

/** 写成 `file:line:column`。在当前目录下的文件用相对路径。 */
export function formatSourceLoc(loc: SourceLoc, cwd = process.cwd()): string {
  let file = loc.file
  if (isAbsolute(file)) {
    const rel = relative(cwd, file)
    if (rel && !rel.startsWith('..')) file = rel
  }
  return `${file}:${loc.line}:${loc.column}`
}
