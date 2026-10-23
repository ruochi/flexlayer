/**
 * Rough timings for the 3D path. Not a pass/fail budget.
 *   npx tsx scripts/bench-3d.mjs
 */
import { performance } from 'node:perf_hooks'
import { renderLayer } from '../src/render.ts'

const scenes = {
  'box-sphere-ground': `<layer width="1920" height="1080" background="#111" camera="900">
    <box x="760" y="640" width="280" height="180" depth="160" fill="#d7c4a3" />
    <sphere cx="1180" cy="620" r="90" fill="#c45a3a" material="metal" />
    <ground y="820" />
  </layer>`,
  'cards': `<layer width="1920" height="1080" background="#111" camera="900">
    <layer x="360" y="280" width="280" height="420" rotateY="-24" background="#204060"><h1 style="font-size:42px;color:#fff">A</h1></layer>
    <layer x="700" y="280" width="280" height="420" background="#603020"><h1 style="font-size:42px;color:#fff">B</h1></layer>
    <layer x="1040" y="280" width="280" height="420" rotateY="24" background="#206040"><h1 style="font-size:42px;color:#fff">C</h1></layer>
  </layer>`,
}

const memBefore = process.memoryUsage().rss
for (const [name, source] of Object.entries(scenes)) {
  const t0 = performance.now()
  const { png } = await renderLayer(source)
  const ms = performance.now() - t0
  console.log(`${name}  ${ms.toFixed(0)} ms  png ${png.length}`)
}
console.log(`rss delta ${(process.memoryUsage().rss - memBefore) / 1e6} MB`)
