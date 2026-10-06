import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initFontsForMeasure } from './fonts.js'
import { renderFvg } from './render.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')
const helloPath = join(pkgDir, 'examples', 'hello.layer')

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

describe('render hello.layer', () => {
  it('生成 PNG', async () => {
    const source = await readFile(helloPath, 'utf8')
    const { png, report } = await renderFvg(source, {
      baseDir: join(pkgDir, 'examples'),
      fontsCacheDir: join(homedir(), '.cache', 'flexlayer', 'fonts'),
    })
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(report.width).toBe(1080)
    expect(report.height).toBe(1920)
    expect(report.elements.length).toBeGreaterThan(0)
  })

  it('check 没有问题时打印 ✓ 0 issues', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-check-'))
    const file = join(dir, 'ok.layer')
    writeFileSync(file, `<layer width="40" height="40" background="#000"><rect x="0" y="0" width="10" height="10" fill="#fff" /></layer>`)
    const result = spawnSync(join(pkgDir, 'node_modules/.bin/tsx'), [join(pkgDir, 'src/cli.ts'), 'check', file], {
      cwd: pkgDir,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('✓ 0 issues')
  })
})
