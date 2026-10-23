/**
 * 在当前平台加载 native 插件，打印 engine 和一次最小绘制的哈希。
 * 没有对应平台的二进制时退出 0 并写明原因，避免把还没导出的 darwin / win32 当成失败。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(import.meta.url))
let native
try {
  native = require('../native/flexlayer-render/index.cjs')
} catch (error) {
  console.log(`addon-hash skip: ${error instanceof Error ? error.message : error}`)
  process.exit(0)
}
const engine = typeof native.engine === 'function' ? String(native.engine()) : 'unknown'
console.log(`engine ${engine}`)
if (typeof native.renderDrawList !== 'function') {
  console.log('addon-hash skip: this binary has no renderDrawList')
  process.exit(0)
}
const clip = new Float32Array([
  -0.5, -0.5, 0, 1,
  0.5, -0.5, 0, 1,
  0, 0.5, 0, 1,
])
const indices = new Uint32Array([0, 1, 2])
const rgba = native.renderDrawList(32, 32, clip, indices, [255, 0, 0, 255])
const sha = createHash('sha256').update(Buffer.from(rgba)).digest('hex')
console.log(`renderDrawList ${sha}`)
const expectedPath = fileURLToPath(new URL('../test/golden/drawlist.sha256', import.meta.url))
const expected = readFileSync(expectedPath, 'utf8').trim()
if (sha !== expected) {
  console.error(`addon-hash mismatch\n  got ${sha}\n  expected ${expected}`)
  process.exit(1)
}
