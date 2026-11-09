/**
 * Validate the three capped artifacts a `release binaries` run uploaded and
 * write them as one BUILD.json.
 *
 *   node scripts/release-verify.mjs <artifact-root> <out-file>
 *
 * `<artifact-root>` is the directory `actions/download-artifact` wrote: one
 * subdirectory per addon name, each holding the `.node` and its
 * `build-entry.json`. The run fails when the three records name different
 * commits, report different engines, come from a dirty tree, or when any of
 * them is the unlimited channel. Only the capped channel may reach this
 * repository; the unlimited server build never leaves the private one.
 *
 * Each record also gets the binary's `sha256`. `engine()` is a string the
 * addon prints about itself, so two different builds can share it; the digest
 * is what `addon-hash` compares after the pull request lands.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RELEASE } from './addon-verify.mjs'

function fail(message) {
  console.error(`release-verify: ${message}`)
  process.exit(1)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const [artifactRoot, outFile] = process.argv.slice(2)
if (!artifactRoot || !outFile) fail('usage: node scripts/release-verify.mjs <artifact-root> <out-file>')

const root = resolve(artifactRoot)
const binaries = {}
for (const name of RELEASE) {
  let entry
  try {
    entry = JSON.parse(readFileSync(join(root, name, 'build-entry.json'), 'utf8'))
  } catch (error) {
    fail(`cannot read the record for ${name} (${error instanceof Error ? error.message : error})`)
  }
  if (!entry.commit) fail(`${name} names no commit`)
  if (entry.dirty) fail(`${name} was built from a dirty tree`)
  if (typeof entry.engine !== 'string' || entry.engine === '') fail(`${name} reports no engine()`)
  if (entry.engine.includes('+unlimited')) fail(`${name} is the unlimited channel (${entry.engine})`)
  let digest
  try {
    digest = sha256(join(root, name, name))
  } catch (error) {
    fail(`cannot read the binary for ${name} (${error instanceof Error ? error.message : error})`)
  }
  binaries[name] = { ...entry, sha256: digest }
}

const commits = new Set(Object.values(binaries).map((entry) => entry.commit))
if (commits.size !== 1) {
  fail(`the three addons came from ${commits.size} commits: ${[...commits].join(', ')}`)
}

const engines = new Set(Object.values(binaries).map((entry) => entry.engine))
if (engines.size !== 1) {
  fail(`the three addons report ${engines.size} engines: ${[...engines].join(', ')}`)
}

writeFileSync(resolve(outFile), `${JSON.stringify({ binaries }, null, 2)}\n`)
console.log(`capped addons from ${[...commits][0]} (${[...engines][0]})`)
