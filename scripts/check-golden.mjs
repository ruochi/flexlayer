/**
 * Re-render the draft kernel golden and fail when mean FLIP is above 0.02.
 *   npx tsx scripts/check-golden.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const golden = fileURLToPath(new URL('../test/golden/kernel-draft.png', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'flexlayer-golden-'))
const scene = join(dir, 'scene.layer')
const out = join(dir, 'out.png')
writeFileSync(
  scene,
  `<layer width="64" height="48" background="#111111" camera="200"><sphere cx="32" cy="24" r="14" fill="#c45a3a" material="metal 0.2" /></layer>\n`,
)
const render = spawnSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'src/cli.ts'), 'render', scene, '-o', out], {
  cwd: root,
  encoding: 'utf8',
})
if (render.status !== 0) {
  console.error(render.stderr || render.stdout)
  process.exit(render.status ?? 1)
}
const flip = spawnSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'scripts/flip-diff.ts'), golden, out], {
  cwd: root,
  encoding: 'utf8',
})
if (flip.status !== 0) {
  console.error(flip.stderr || flip.stdout)
  process.exit(flip.status ?? 1)
}
const mean = Number(String(flip.stdout).trim().split('\n').at(-1))
console.log(`kernel-draft flip ${mean}`)
if (!(mean <= 0.02)) {
  console.error(`golden flip ${mean} is above 0.02`)
  process.exit(1)
}
