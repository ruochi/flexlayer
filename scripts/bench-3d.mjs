/**
 * 3D 路径的耗时。写出 JSON，供后续阶段比预算。
 *   npx tsx scripts/bench-3d.mjs
 *   npx tsx scripts/bench-3d.mjs --out /tmp/bench-3d.json
 */
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayerFile } from '../src/load-source.ts'
import { renderLayer } from '../src/render.ts'

const scenes = {
  // A box is `<rect depth>`. `<box>` is not a tag, and a scene that used it
  // rendered nothing while still spending its budget.
  'box-sphere-ground': `<layer width="960" height="540" background="#111" camera="900">
    <rect x="300" y="320" width="180" height="120" depth="100" fill="#d7c4a3" />
    <sphere cx="620" cy="300" r="70" fill="#c45a3a" material="metal" />
    <ground y="420" />
  </layer>`,
  'torus-ground': `<layer width="960" height="540" background="#111" camera="900">
    <torus cx="480" cy="280" r="120" tube="36" fill="#d7c4a3" material="plastic" />
    <ground y="420" />
  </layer>`,
  'torus': `<layer width="960" height="540" background="#111" camera="900">
    <torus cx="480" cy="270" r="120" tube="36" fill="#d7c4a3" material="plastic" />
  </layer>`,
  'strokes': `<layer width="640" height="360" background="#fff" camera="800">
    <rect x="80" y="160" width="120" height="80" depth="70" fill="#d7c4a3" stroke="#1c1915" stroke-width="2" hidden="#9a8f80" />
    <sphere cx="320" cy="180" r="50" fill="#c45a3a" stroke="#1c1915" stroke-width="2" />
    <rect x="460" y="150" width="90" height="70" depth="60" fill="#7dce8a" stroke="#1c1915" stroke-width="2" hidden="#9a8f80" />
  </layer>`,
  'cards': `<layer width="960" height="540" background="#111" camera="900">
    <layer x="80" y="80" width="200" height="300" rotateY="-24"><rect x="0" y="0" width="200" height="300" fill="#204060" /><h1 style="font-size:42px;color:#fff">A</h1></layer>
    <layer x="340" y="80" width="200" height="300"><rect x="0" y="0" width="200" height="300" fill="#603020" /><h1 style="font-size:42px;color:#fff">B</h1></layer>
    <layer x="600" y="80" width="200" height="300" rotateY="24"><rect x="0" y="0" width="200" height="300" fill="#206040" /><h1 style="font-size:42px;color:#fff">C</h1></layer>
  </layer>`,
}

const outFlag = process.argv.indexOf('--out')
const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : ''

/**
 * The first render of a scene pays a one-time cost that the budgets are not
 * about: V8 compiles the builder path for the tags that scene uses, and the
 * native side touches fresh heap. Each scene is rendered once and thrown away,
 * then the second render is the number `check-budget` sees.
 *
 * That warmup render is also the only cheap place to prove the scene is real.
 * A tag the parser rejects draws nothing and still costs time, which would let
 * a budget pass on an empty picture.
 */
const rows = []
for (const [name, source] of Object.entries(scenes)) {
  const warm = await renderLayer(source)
  const errors = (warm.report.issues ?? []).filter((issue) => issue.level === 'error')
  if (errors.length > 0) {
    throw new Error(`${name}: ${errors.map((issue) => `${issue.code} at ${issue.path}`).join(', ')}`)
  }
  const before = process.memoryUsage().rss
  const t0 = performance.now()
  const { png } = await renderLayer(source)
  const ms = performance.now() - t0
  const rss = Math.max(0, process.memoryUsage().rss - before)
  const sha256 = createHash('sha256').update(png).digest('hex')
  rows.push({ name, ms: Math.round(ms), pngBytes: png.length, rssBytes: rss, sha256 })
  console.log(`${name}  ${ms.toFixed(0)} ms  png ${png.length}  rss ${Math.round(rss / 1e6)} MB`)
}

const macbook = fileURLToPath(new URL('../examples/macbook-pro.tsx', import.meta.url))
const loaded = await loadLayerFile(macbook)
if (loaded.kind !== 'node') throw new Error('macbook-pro.tsx 没有导出一个 layer')
await renderLayer(loaded.node, { baseDir: dirname(macbook) })
const beforeMac = process.memoryUsage().rss
const tMac = performance.now()
const mac = await renderLayer(loaded.node, { baseDir: dirname(macbook) })
rows.push({
  name: 'macbook-pro',
  ms: Math.round(performance.now() - tMac),
  pngBytes: mac.png.length,
  rssBytes: Math.max(0, process.memoryUsage().rss - beforeMac),
  sha256: createHash('sha256').update(mac.png).digest('hex'),
})
console.log(`macbook-pro  ${rows.at(-1).ms} ms  png ${mac.png.length}`)

const report = { at: new Date().toISOString(), scenes: rows }
const text = JSON.stringify(report, null, 2)
if (outPath) writeFileSync(outPath, text)
else process.stdout.write(`\n${text}\n`)
