/**
 * 在当前平台加载 native 插件，打印 engine 和一次最小绘制的哈希。
 * 缺 renderDrawList、二进制加载失败、BUILD.json 里三份提交不一致、
 * 某份二进制是从脏树构建的，或者这份二进制的 engine() 和 BUILD.json 对不上，都失败。
 *
 *   node scripts/addon-hash.mjs
 *   node scripts/addon-hash.mjs --print-engine
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { hostBinary, verifyAddon, verifyBuild } from './addon-verify.mjs'

const require = createRequire(fileURLToPath(import.meta.url))
const buildPath = fileURLToPath(new URL('../native/flexlayer-render/BUILD.json', import.meta.url))

function fail(message) {
  console.error(message)
  process.exit(1)
}

let build = null
let readError = ''
try {
  build = JSON.parse(readFileSync(buildPath, 'utf8'))
} catch (error) {
  readError = error instanceof Error ? error.message : String(error)
}
if (readError) fail(`addon-hash: cannot read BUILD.json (${readError})`)

const manifestErrors = verifyBuild(build)
if (manifestErrors.length > 0) fail(manifestErrors.join('\n'))

let native
try {
  native = require('../native/flexlayer-render/index.cjs')
} catch (error) {
  fail(`addon-hash: ${error instanceof Error ? error.message : error}`)
}
const engine = typeof native.engine === 'function' ? String(native.engine()) : ''
console.log(`engine ${engine || 'missing'}`)
if (process.argv.includes('--print-engine')) process.exit(0)

const file = hostBinary()
const addonErrors = verifyAddon(build, file, {
  engine,
  hasRenderDrawList: typeof native.renderDrawList === 'function',
})
if (addonErrors.length > 0) fail(addonErrors.join('\n'))

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
  fail(`addon-hash mismatch\n  got ${sha}\n  expected ${expected}`)
}
