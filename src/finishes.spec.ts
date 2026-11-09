import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EMISSIVE_FINISHES, FINISHES, FINISH_NAMES, isFinishName } from './finishes.js'

/**
 * The renderer sits beside this repository on a developer machine and under
 * `vendor/` in CI, so look in both rather than pinning one layout.
 */
function findRustMaterialSource(): string {
  const candidates = [
    new URL('../../flexlayer-render/src/material.rs', import.meta.url),
    new URL('../../vendor/flexlayer-render/src/material.rs', import.meta.url),
  ]
  for (const candidate of candidates) {
    const resolved = fileURLToPath(candidate)
    if (existsSync(resolved)) return resolved
  }
  throw new Error(`找不到 material.rs，试过：${candidates.map((c) => fileURLToPath(c)).join(', ')}`)
}

const rustPath = findRustMaterialSource()

/** 从 Rust 的 `MaterialPreset::X` 常量里抠出某个字段的字面量。 */
function rustPresetRoughness(constName: string): number {
  const source = readFileSync(rustPath, 'utf8')
  const start = source.indexOf(`pub const ${constName}: Self = Self {`)
  if (start < 0) throw new Error(`material.rs 里找不到 ${constName}`)
  const end = source.indexOf('};', start)
  const body = source.slice(start, end)
  const match = /roughness:\s*([0-9.]+)/.exec(body)
  if (!match) throw new Error(`${constName} 没有 roughness`)
  return Number(match[1])
}

describe('finish 预设表', () => {
  it('粗糙度跟 Rust 内核的 PRESETS 一致', () => {
    const rows: Array<[keyof typeof FINISHES, string]> = [
      ['matte', 'MATTE'],
      ['plastic', 'PLASTIC'],
      ['metal', 'METAL'],
      ['glass', 'GLASS_DEFAULT'],
      ['clay', 'CLAY'],
      ['mirror', 'MIRROR'],
      ['brushed', 'BRUSHED'],
    ]
    for (const [finish, constName] of rows) {
      expect({ finish, roughness: FINISHES[finish].roughness }).toEqual({
        finish,
        roughness: rustPresetRoughness(constName),
      })
    }
  })

  it('只有 lamp 和 neon 自发光', () => {
    expect([...EMISSIVE_FINISHES].sort()).toEqual(['lamp', 'neon'])
    for (const name of FINISH_NAMES) {
      const emissive = FINISHES[name].emissiveStrength > 0
      expect({ name, emissive }).toEqual({ name, emissive: EMISSIVE_FINISHES.has(name) })
    }
  })

  it('每个 finish 都有不透明的固有色', () => {
    for (const name of FINISH_NAMES) {
      expect({ name, color: FINISHES[name].color }).toEqual({
        name,
        color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      })
    }
  })

  it('名字校验只认表里的行', () => {
    for (const name of FINISH_NAMES) expect(isFinishName(name)).toBe(true)
    expect(isFinishName('gold')).toBe(false)
    expect(isFinishName('toString')).toBe(false)
  })
})
