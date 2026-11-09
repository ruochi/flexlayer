/**
 * The three committed addons and their manifest, checked without loading the
 * native module.
 *
 *   node scripts/addon-integrity.mjs
 *
 * `addon-hash.mjs` can only `require` the host binary; one Linux runner sees
 * nothing about the darwin or win32 files. This script reads all three as
 * bytes and compares each against the `sha256` the release verifier wrote, so
 * a binary dropped in by hand, or a `git checkout` that restored an older
 * file, fails everywhere.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE, verifyBuild, verifyLayout } from './addon-verify.mjs'

const nativeDir = fileURLToPath(new URL('../native/flexlayer-render', import.meta.url))
const buildPath = join(nativeDir, 'BUILD.json')

function fail(errors) {
  console.error(errors.join('\n'))
  process.exit(1)
}

if (!existsSync(nativeDir)) fail([`addon-integrity: ${nativeDir} does not exist`])

const layoutErrors = verifyLayout(readdirSync(nativeDir))
if (layoutErrors.length > 0) fail(layoutErrors)

let build
try {
  build = JSON.parse(readFileSync(buildPath, 'utf8'))
} catch (error) {
  fail([`addon-integrity: cannot read BUILD.json (${error instanceof Error ? error.message : error})`])
}

const manifestErrors = verifyBuild(build)
if (manifestErrors.length > 0) fail(manifestErrors)

const errors = []
for (const name of RELEASE) {
  const recorded = build.binaries[name]?.sha256
  if (!recorded) {
    errors.push(`addon-integrity: BUILD.json records no sha256 for ${name}`)
    continue
  }
  const actual = createHash('sha256').update(readFileSync(join(nativeDir, name))).digest('hex')
  if (actual !== recorded) {
    errors.push(`addon-integrity: ${name} is not the binary BUILD.json describes\n  got ${actual}\n  expected ${recorded}`)
  }
}
if (errors.length > 0) fail(errors)

console.log(`addon-integrity: ${RELEASE.length} addons match ${build.binaries[RELEASE[0]].commit.slice(0, 7)}`)
