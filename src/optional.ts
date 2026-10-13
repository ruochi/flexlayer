import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const cache = new Map<string, unknown>()
const pending = new Map<string, Promise<unknown>>()

/**
 * 按绝对 URL 加载一次。
 * 异步入口用 import。同步入口若磁盘上已有编译结果，用 require；从 src 跑测试时 .js 还不在，返回 null。
 * 两种方式共用这一份缓存，避免同一模块装进两份。
 */
export async function loadOptional<T>(href: string): Promise<T> {
  const hit = cache.get(href)
  if (hit) return hit as T
  let job = pending.get(href) as Promise<T> | undefined
  if (!job) {
    job = import(href).then((mod) => {
      cache.set(href, mod)
      pending.delete(href)
      return mod as T
    })
    pending.set(href, job)
  }
  return job
}

export function loadOptionalSync<T>(href: string): T | null {
  const hit = cache.get(href)
  if (hit) return hit as T
  const path = fileURLToPath(href)
  if (!existsSync(path)) return null
  try {
    const mod = require(path) as T
    cache.set(href, mod)
    return mod
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ERR_REQUIRE_ESM' || code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return null
    throw err
  }
}

export function optionalHref(specifier: string, base: string): string {
  return new URL(specifier, base).href
}
