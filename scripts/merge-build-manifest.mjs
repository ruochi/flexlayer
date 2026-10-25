/**
 * Merge the three per-platform manifests the native CI job uploads into
 * `native/flexlayer-render/BUILD.json`.
 *
 *   node scripts/merge-build-manifest.mjs darwin.json linux.json win32.json
 *
 * The merge refuses to write when the records disagree or a build came from a
 * dirty tree, so a release manifest is the one thing `addon-hash` can accept.
 * Binaries the merge has no record for stay out of the file, which makes the
 * next `addon-hash` fail on the missing commit instead of passing silently.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RELEASE, verifyBuild } from './addon-verify.mjs'

const out = fileURLToPath(new URL('../native/flexlayer-render/BUILD.json', import.meta.url))

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/merge-build-manifest.mjs <manifest.json>...')
  process.exit(1)
}

const binaries = {}
for (const file of files) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  for (const [name, record] of Object.entries(parsed.binaries ?? {})) {
    if (binaries[name]) {
      console.error(`merge-build-manifest: ${name} appears twice`)
      process.exit(1)
    }
    binaries[name] = record
  }
}

const unknown = Object.keys(binaries).filter((name) => !RELEASE.includes(name))
if (unknown.length > 0) {
  console.error(`merge-build-manifest: not a release binary: ${unknown.join(', ')}`)
  process.exit(1)
}

const merged = { binaries }
const errors = verifyBuild(merged)
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`)
console.log(`wrote ${out}`)
