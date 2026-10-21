import { describe, expect, it } from 'vitest'
import { nodeVersionError } from './node-version.js'

describe('Node 版本', () => {
  it('18 指出是版本问题，20 和 22 通过', () => {
    const old = nodeVersionError('v18.20.4')
    expect(old).toContain('Node.js 20')
    expect(old).toContain('v18.20.4')
    expect(old).toContain('ERR_REQUIRE_ESM')
    expect(nodeVersionError('18.20.4')).toContain('v18.20.4')
    expect(nodeVersionError('v20.11.0')).toBeNull()
    expect(nodeVersionError('v22.14.0')).toBeNull()
  })
})
