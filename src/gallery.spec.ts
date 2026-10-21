import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkLayer } from './render.js'
import { EFFECT_ATTRS } from './schema.js'

const root = fileURLToPath(new URL('..', import.meta.url))

function layerPaths(dir: string): string[] {
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.layer'))
    .map((name) => join(dir, name))
}

describe('效果图覆盖', () => {
  it('每个效果属性至少出现在一张 gallery 里', () => {
    const dir = new URL('../docs/gallery/', import.meta.url)
    const sources = readdirSync(dir)
      .filter((name) => name.endsWith('.layer'))
      .map((name) => readFileSync(new URL(name, dir), 'utf8'))
    const joined = sources.join('\n')
    for (const name of EFFECT_ATTRS) {
      expect(joined, name).toMatch(new RegExp(`(?:^|[\\s])${name}=`))
    }
  })

  it('gallery 与 examples 没有 error', async () => {
    const files = [...layerPaths('docs/gallery'), ...layerPaths('examples')]
    const failed: string[] = []
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8')
      const report = await checkLayer(source, { baseDir: dirname(join(root, file)) })
      const errors = report.issues.filter((issue) => issue.level === 'error')
      if (errors.length > 0) {
        failed.push(`${file}: ${errors.map((issue) => issue.code).join(', ')}`)
      }
    }
    expect(failed).toEqual([])
  })
})