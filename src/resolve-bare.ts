import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CONDITIONS = new Set(['node', 'import', 'default'])

/** 从导入方所在目录往上找包，并按 Node 的 import 条件取导出。 */
export function resolveBare(specifier: string, parentFile: string): string {
  const name = packageName(specifier)
  const sub = specifier.slice(name.length)
  let dir = dirname(parentFile)
  const seen = new Set<string>()
  while (!seen.has(dir)) {
    seen.add(dir)
    const root = join(dir, 'node_modules', name)
    if (existsSync(join(root, 'package.json'))) return resolvePackage(root, sub === '' ? '.' : `.${sub}`)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`无法解析 ${specifier}`)
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/')
  return parts[0] ?? specifier
}

function resolvePackage(root: string, target: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    exports?: unknown
    module?: string
    main?: string
  }
  const relative = pkg.exports != null ? matchExport(pkg.exports, target) : legacyMain(pkg, target)
  if (!relative) throw new Error(`无法解析 ${target}`)
  const file = join(root, relative)
  if (!existsSync(file)) throw new Error(`无法解析 ${target}`)
  return file
}

function legacyMain(pkg: { module?: string; main?: string }, target: string): string | null {
  if (target === '.') return pkg.module || pkg.main || 'index.js'
  return target.slice(2)
}

function matchExport(exports: unknown, target: string): string | null {
  if (typeof exports === 'string') return target === '.' ? exports : null
  if (Array.isArray(exports)) {
    for (const item of exports) {
      const hit = matchExport(item, target)
      if (hit) return hit
    }
    return null
  }
  if (!exports || typeof exports !== 'object') return null
  const record = exports as Record<string, unknown>
  const keys = Object.keys(record)
  if (!keys.some((key) => key.startsWith('.'))) {
    if (target !== '.') return null
    return applyConditions(record)
  }
  if (Object.prototype.hasOwnProperty.call(record, target)) return applyConditions(record[target])
  let best: { key: string; value: unknown } | null = null
  for (const key of keys) {
    if (!key.includes('*')) continue
    const star = key.indexOf('*')
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (target.startsWith(prefix) && target.endsWith(suffix) && target.length >= prefix.length + suffix.length) {
      if (!best || key.length > best.key.length) best = { key, value: record[key] }
    }
  }
  if (!best) return null
  const expanded = applyConditions(best.value)
  if (!expanded) return null
  return substitute(best.key, target, expanded)
}

function applyConditions(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value == null) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = applyConditions(item)
      if (hit) return hit
    }
    return null
  }
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key.startsWith('.'))) return null
  for (const key of Object.keys(record)) {
    if (!CONDITIONS.has(key)) continue
    const hit = applyConditions(record[key])
    if (hit) return hit
  }
  return null
}

function substitute(pattern: string, target: string, replacement: string): string {
  const star = pattern.indexOf('*')
  if (star < 0) return replacement
  const prefix = pattern.slice(0, star)
  const suffix = pattern.slice(star + 1)
  const captured = target.slice(prefix.length, target.length - suffix.length)
  return replacement.replace('*', captured)
}
