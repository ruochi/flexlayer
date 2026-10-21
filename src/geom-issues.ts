/**
 * 几何函数遇到几何上的问题时不抛出，交出能用的结果，再记一条 warn。
 * 加载 `.tsx` 时打开收集，报告里带上调用处的源码位置。
 */
import { dirname, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatSourceLoc } from './source-loc.js'
import type { Issue } from './types.js'

export type GeomIssueCode =
  | 'fillet-too-large'
  | 'no-intersection'
  | 'offset-collapse'
  | 'empty-geometry'
  | 'not-a-curve'
  | 'curve-unsupported'

const HERE = dirname(fileURLToPath(import.meta.url))
const KEY = Symbol.for('flexlayer.geomIssues')
type Sink = { issues: Issue[]; seen: Set<string> }
const store = globalThis as typeof globalThis & { [KEY]?: Sink | null }

export function beginGeomIssues(): void {
  store[KEY] = { issues: [], seen: new Set() }
}

export function endGeomIssues(): Issue[] {
  const sink = store[KEY]
  store[KEY] = null
  return sink?.issues ?? []
}

export function geomIssue(code: GeomIssueCode, message: string, hint?: string): void {
  const sink = store[KEY]
  if (!sink) return
  const source = callSite()
  const key = `${code}\0${source ?? ''}\0${message}`
  if (sink.seen.has(key)) return
  sink.seen.add(key)
  const issue: Issue = { level: 'warn', code, path: 'layer', message }
  if (hint) issue.hint = hint
  if (source) issue.source = source
  sink.issues.push(issue)
}

const FRAME = /\(?((?:file:\/\/)?[^()\s]+):(\d+):(\d+)\)?$/
const CACHE = `${sep}.cache${sep}flexlayer${sep}code${sep}`

/** 第一个不在几何模块里的栈帧。打包缓存里的位置对作者没有意义，宁可不写。 */
function callSite(): string | undefined {
  const lines = (new Error().stack ?? '').split('\n').slice(1)
  for (const raw of lines) {
    const m = FRAME.exec(raw.trim())
    if (!m) continue
    let file = m[1]!
    if (file.startsWith('file://')) file = fileURLToPath(file)
    if (!isAbsolute(file)) continue
    if (dirname(file) === HERE && /[\\/]geom-[^\\/]+\.[cm]?[jt]s$/.test(file)) continue
    if (file.includes(CACHE)) return undefined
    return formatSourceLoc({ file, line: Number(m[2]), column: Number(m[3]) })
  }
  return undefined
}
