import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname
const skip = new Set(['node_modules', 'dist', '.git'])

function trackedFiles(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) trackedFiles(path, out)
    else if (/\.(ts|tsx|json|md|js|mjs)$/.test(name)) out.push(path)
  }
}

describe('包名', () => {
  it('是 flexlayer，源码里不再出现带作用域的旧包名', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string }
    expect(pkg.name).toBe('flexlayer')
    const files: string[] = []
    trackedFiles(root, files)
    const scoped = '@' + 'dc/flexlayer'
    const scopedPattern = '@' + 'dc\\/flexlayer'
    const hits = files.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return text.includes(scoped) || text.includes(scopedPattern)
    })
    expect(hits.map((file) => file.slice(root.length))).toEqual([])
  })
})
