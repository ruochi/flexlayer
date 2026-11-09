import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/release-verify.mjs', import.meta.url))

const NAMES = [
  'flexlayer-render.darwin-arm64.node',
  'flexlayer-render.linux-x64-gnu.node',
  'flexlayer-render.win32-x64-msvc.node',
]

const dirs: string[] = []

function artifacts(overrides: Record<string, { commit?: string; engine?: string; dirty?: boolean; body?: string }> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'flexlayer-release-'))
  dirs.push(root)
  for (const name of NAMES) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    const record = { commit: 'a'.repeat(40), engine: 'flexlayer-render/0.0.2+cap1080', dirty: false, ...overrides[name] }
    const { body, ...entry } = record
    writeFileSync(join(dir, 'build-entry.json'), JSON.stringify(entry))
    writeFileSync(join(dir, name), body ?? name)
  }
  return root
}

function run(root: string) {
  const out = join(root, 'BUILD.json')
  const result = spawnSync(process.execPath, [script, root, out], { encoding: 'utf8' })
  return { ...result, out }
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('release-verify', () => {
  it('三份同源时写出一份带指纹的清单', () => {
    const root = artifacts()
    const result = run(root)
    expect(result.status, result.stderr).toBe(0)
    const manifest = JSON.parse(readFileSync(result.out, 'utf8'))
    for (const name of NAMES) {
      expect(manifest.binaries[name].commit).toBe('a'.repeat(40))
      expect(manifest.binaries[name].sha256).toBe(
        createHash('sha256').update(name).digest('hex'),
      )
    }
  })

  it('提交不一致时失败', () => {
    const root = artifacts({ [NAMES[1]]: { commit: 'b'.repeat(40) } })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('commits')
  })

  it('engine 不一致时失败', () => {
    const root = artifacts({ [NAMES[2]]: { engine: 'flexlayer-render/0.0.2+cap1920' } })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('engines')
  })

  it('脏树构建的二进制被拒绝', () => {
    const root = artifacts({ [NAMES[0]]: { dirty: true } })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('dirty tree')
  })

  it('unlimited 档进不了公开仓', () => {
    const root = artifacts({ [NAMES[0]]: { engine: 'flexlayer-render/0.0.2+unlimited' } })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unlimited')
  })

  it('缺一份产物时失败，并说明缺哪份', () => {
    const root = artifacts()
    rmSync(join(root, NAMES[1]), { recursive: true, force: true })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(NAMES[1])
  })
})
