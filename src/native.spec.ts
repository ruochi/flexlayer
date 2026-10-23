import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadNativeRender } from './native.js'

const prev = process.env.FLEXLAYER_RENDER

afterEach(() => {
  if (prev === undefined) delete process.env.FLEXLAYER_RENDER
  else process.env.FLEXLAYER_RENDER = prev
})

describe('预编译渲染器', () => {
  it('在有对应二进制的机器上能加载', () => {
    delete process.env.FLEXLAYER_RENDER
    const dir = fileURLToPath(new URL('../native/flexlayer-render', import.meta.url))
    const gnu = join(dir, 'flexlayer-render.linux-x64-gnu.node')
    if (process.platform !== 'linux' || process.arch !== 'x64' || !existsSync(gnu)) {
      expect(readdirSync(dir).some((name) => name.endsWith('.node'))).toBe(true)
      return
    }
    const native = loadNativeRender()
    expect(native).not.toBeNull()
    expect(native!.engine()).toMatch(/^flexlayer-render\/0\.0\.2\+cap1080$/)
    expect(typeof native!.render).toBe('function')
    expect(typeof native!.previewSheet).toBe('function')
    expect(typeof native!.renderFrames).toBe('function')
    expect(typeof native!.renderStylePng).toBe('function')
    expect(typeof native!.renderScenePng).toBe('function')
    expect(Buffer.from(native!.solidPng(2, 2, '#ffffff')).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  })

  it('公开目录里只有这一次的二进制', () => {
    const dir = fileURLToPath(new URL('../native/flexlayer-render', import.meta.url))
    const names = readdirSync(dir)
    expect(names).toEqual(expect.arrayContaining([
      'flexlayer-render.linux-x64-gnu.node',
      'flexlayer-render.darwin-arm64.node',
      'flexlayer-render.win32-x64-msvc.node',
    ]))
    expect(names.some((name) => name.endsWith('.rs') || name === 'Cargo.toml' || name === 'Cargo.lock')).toBe(false)
  })

  it('从 FLEXLAYER_RENDER 读出 engine 和 solidPng', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-native-'))
    const file = join(dir, 'index.js')
    writeFileSync(
      file,
      `module.exports = {
        engine() { return 'flexlayer-render/test' },
        solidPng() { return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
      }`,
    )
    try {
      process.env.FLEXLAYER_RENDER = file
      const native = loadNativeRender()
      expect(native).not.toBeNull()
      expect(native!.engine()).toBe('flexlayer-render/test')
      expect(Buffer.from(native!.solidPng(1, 1, '#000')).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('导出对不上时当作没有渲染器', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-native-'))
    const file = join(dir, 'index.js')
    writeFileSync(file, 'module.exports = { engine() { return "x" } }')
    try {
      process.env.FLEXLAYER_RENDER = file
      expect(loadNativeRender()).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('路径不存在时当作没有渲染器', () => {
    process.env.FLEXLAYER_RENDER = join(tmpdir(), 'flexlayer-render-missing.node')
    expect(loadNativeRender()).toBeNull()
  })
})
