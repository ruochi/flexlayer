import { describe, expect, it } from 'vitest'
import { COMPANIONS, RELEASE, hostBinary, verifyAddon, verifyBuild, verifyDigest, verifyLayout } from '../scripts/addon-verify.mjs'

/** A manifest where all three release files agree. */
function manifest(overrides = {}) {
  const commit = 'f1075b772842e5c2c415bc387757019ea1375362'
  const binaries = {}
  for (const file of RELEASE) binaries[file] = { commit, engine: 'flexlayer-render/0.0.2+cap1080', sha256: `sha-${file}` }
  for (const [file, patch] of Object.entries(overrides)) binaries[file] = { ...binaries[file], ...patch }
  return { binaries }
}

const linux = 'flexlayer-render.linux-x64-gnu.node'
const darwin = 'flexlayer-render.darwin-arm64.node'

describe('addon-hash 的判定', () => {
  it('三份同源、engine 对得上时通过', () => {
    expect(verifyBuild(manifest())).toEqual([])
    expect(verifyAddon(manifest(), darwin, {
      engine: 'flexlayer-render/0.0.2+cap1080',
      hasRenderDrawList: true,
    })).toEqual([])
  })

  it('缺 BUILD.json 时失败，不会静默放过', () => {
    expect(verifyBuild(null)).toEqual(['addon-hash: cannot read BUILD.json'])
  })

  it('三份提交不一致时失败，并列出各自的提交', () => {
    const errors = verifyBuild(manifest({ [linux]: { commit: 'a33bf8f36f5540a51444bc831f903d3a76f2958a' } }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('not built from one commit')
    expect(errors[0]).toContain(linux)
    expect(errors[0]).toContain('a33bf8f36f5540a51444bc831f903d3a76f2958a')
  })

  it('少记一份提交时失败', () => {
    const errors = verifyBuild(manifest({ [linux]: { commit: '' } }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(`missing a commit for ${linux}`)
  })

  it('二进制来自脏树时失败', () => {
    const errors = verifyBuild(manifest({ [darwin]: { dirty: true } }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('dirty tree')
    expect(errors[0]).toContain(darwin)
  })

  it('二进制缺 renderDrawList 时失败', () => {
    expect(verifyAddon(manifest(), darwin, { engine: 'x', hasRenderDrawList: false }))
      .toEqual(['addon-hash: this binary has no renderDrawList'])
  })

  it('engine() 与 BUILD.json 不一致时失败', () => {
    const errors = verifyAddon(manifest({ [darwin]: { engine: 'flexlayer-render/0.0.1+cap1080' } }), darwin, {
      engine: 'flexlayer-render/0.0.2+cap1080',
      hasRenderDrawList: true,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('does not match BUILD.json')
  })

  it('BUILD.json 没记 engine 时不假装验证过', () => {
    expect(verifyAddon(manifest({ [darwin]: { engine: null } }), darwin, {
      engine: 'flexlayer-render/0.0.2+cap1080',
      hasRenderDrawList: true,
    })).toEqual([])
  })

  it('只认发布矩阵里的三份二进制', () => {
    expect(hostBinary('darwin', 'arm64')).toBe(darwin)
    expect(hostBinary('linux', 'x64')).toBe(linux)
    expect(hostBinary('win32', 'x64')).toBe('flexlayer-render.win32-x64-msvc.node')
    expect(hostBinary('linux', 'arm64')).toBe(null)
  })
})

describe('目录布局', () => {
  it('三份二进制、加载器、类型、清单和说明都在时通过', () => {
    expect(verifyLayout([...RELEASE, ...COMPANIONS])).toEqual([])
  })

  it('多出文件时失败，并指出文件名', () => {
    const errors = verifyLayout([...RELEASE, ...COMPANIONS, 'flexlayer-render.darwin-arm64.node.bak'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('unexpected file')
    expect(errors[0]).toContain('flexlayer-render.darwin-arm64.node.bak')
  })

  it('少一份时失败，并指出缺哪份', () => {
    const missing = RELEASE[0]
    const errors = verifyLayout([...RELEASE.slice(1), ...COMPANIONS])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('missing')
    expect(errors[0]).toContain(missing)
  })
})

describe('二进制指纹', () => {
  it('字节和清单一致时通过', () => {
    expect(verifyDigest(manifest(), darwin, `sha-${darwin}`)).toEqual([])
  })

  it('本机重编后字节变了就失败，即使 engine() 没变', () => {
    const errors = verifyDigest(manifest(), darwin, 'sha-rebuilt')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('not the binary BUILD.json describes')
  })

  it('清单没记指纹时不假装验证过', () => {
    const errors = verifyDigest(manifest({ [darwin]: { sha256: undefined } }), darwin, 'sha-anything')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('records no sha256')
  })
})
