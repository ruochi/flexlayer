import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveRendererRef } from '../scripts/renderer-ref.mjs'

const dirs: string[] = []

function buildFile(binaries: Record<string, { commit: string }>) {
  const dir = mkdtempSync(join(tmpdir(), 'flexlayer-ref-'))
  dirs.push(dir)
  const file = join(dir, 'BUILD.json')
  writeFileSync(file, JSON.stringify({ binaries }))
  return file
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('CI 用哪个渲染器 ref', () => {
  it('仓库变量优先于一切', () => {
    expect(resolveRendererRef({ pinned: 'v1.2.3', headRef: 'release/addons-941901d' })).toBe('v1.2.3')
  })

  it('发布分支用 BUILD.json 记的提交，而不是分支名', () => {
    const buildPath = buildFile({
      'flexlayer-render.darwin-arm64.node': { commit: '941901d74bc84c3dc501553f902cee2aaf942808' },
    })
    expect(
      resolveRendererRef({
        headRef: 'release/addons-941901d',
        buildPath,
        hasRemoteBranch: () => true,
      }),
    ).toBe('941901d74bc84c3dc501553f902cee2aaf942808')
  })

  it('清单里三份提交不一致时失败，而不是挑一份', () => {
    const buildPath = buildFile({
      'flexlayer-render.darwin-arm64.node': { commit: 'a'.repeat(40) },
      'flexlayer-render.linux-x64-gnu.node': { commit: 'b'.repeat(40) },
    })
    expect(() => resolveRendererRef({ headRef: 'release/addons-aaaaaaa', buildPath }))
      .toThrow(/names 2 commits/)
  })

  it('配对分支存在时用它', () => {
    expect(
      resolveRendererRef({ headRef: 'cursor/3d-quality-8', hasRemoteBranch: () => true }),
    ).toBe('cursor/3d-quality-8')
  })

  it('配对分支已经删掉时退回 main', () => {
    expect(
      resolveRendererRef({ headRef: 'cursor/3d-quality-8', hasRemoteBranch: () => false }),
    ).toBe('main')
  })

  it('没有 PR 分支时用 main', () => {
    expect(resolveRendererRef({ headRef: '' })).toBe('main')
  })
})
