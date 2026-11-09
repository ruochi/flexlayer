/**
 * What `addon-hash.mjs` checks in `native/flexlayer-render/BUILD.json`, kept
 * free of node and of the native addon so a test can drive every branch.
 *
 * The gate is fail-closed on purpose. A binary built from a dirty tree, three
 * binaries from different commits, or an unreadable manifest all have to fail:
 * a green check that verified nothing is worse than a red one.
 */

export const RELEASE = [
  'flexlayer-render.darwin-arm64.node',
  'flexlayer-render.linux-x64-gnu.node',
  'flexlayer-render.win32-x64-msvc.node',
]

/** The generated loader, the committed types, the manifest, and the note beside the addons. */
export const COMPANIONS = ['index.cjs', 'index.d.ts', 'index.js', 'README.md', 'BUILD.json']

/** Which release file this host would load, or null off the release matrix. */
export function hostBinary(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'flexlayer-render.darwin-arm64.node'
  if (platform === 'linux' && arch === 'x64') return 'flexlayer-render.linux-x64-gnu.node'
  if (platform === 'win32' && arch === 'x64') return 'flexlayer-render.win32-x64-msvc.node'
  return null
}

/**
 * Errors a manifest carries on its own, with no binary loaded:
 * unreadable file, a missing commit, a dirty build, commits that disagree.
 */
export function verifyBuild(build) {
  if (!build || typeof build !== 'object') return ['addon-hash: cannot read BUILD.json']
  const binaries = build.binaries ?? {}
  const errors = []
  const commits = RELEASE.map((file) => binaries[file]?.commit ?? '')
  const missing = RELEASE.filter((_, i) => !commits[i])
  if (missing.length > 0) {
    errors.push(`addon-hash: BUILD.json is missing a commit for ${missing.join(', ')}`)
  }
  const dirty = RELEASE.filter((file) => binaries[file]?.dirty === true)
  if (dirty.length > 0) {
    errors.push(`addon-hash: these binaries were built from a dirty tree\n${dirty.map((file) => `  ${file}`).join('\n')}`)
  }
  if (new Set(commits.filter(Boolean)).size > 1) {
    errors.push(`addon-hash: the three binaries were not built from one commit\n${RELEASE.map((file, i) => `  ${file} ${commits[i] || '(none)'}`).join('\n')}`)
  }
  return errors
}

/**
 * The files beside the addons. A binary dropped in `native/` itself, a leftover
 * from the hand-copied era, or a half-written directory all load nothing and
 * `index.cjs` only ever looks in `native/flexlayer-render/`, so anything else
 * there is a mistake that must not reach a release.
 */
export function verifyLayout(dirNames) {
  const errors = []
  for (const name of dirNames) {
    if (!RELEASE.includes(name) && !COMPANIONS.includes(name)) {
      errors.push(`addon-hash: unexpected file in native/flexlayer-render: ${name}`)
    }
  }
  for (const name of [...RELEASE, ...COMPANIONS]) {
    if (!dirNames.includes(name)) {
      errors.push(`addon-hash: native/flexlayer-render is missing ${name}`)
    }
  }
  return errors
}

/**
 * A binary that no longer matches its record. `engine()` says what the build
 * was configured to do, not which bytes were copied, so a local rebuild beside
 * an untouched `BUILD.json` used to pass. The digest is the only thing that
 * catches that, and a missing digest is a failure rather than "not checked".
 */
export function verifyDigest(build, file, actual) {
  const recorded = file ? build?.binaries?.[file]?.sha256 ?? null : null
  if (!recorded) {
    return [`addon-hash: BUILD.json records no sha256 for ${file}`]
  }
  if (recorded !== actual) {
    return [`addon-hash: ${file} is not the binary BUILD.json describes\n  got ${actual}\n  expected ${recorded}`]
  }
  return []
}

/**
 * The loaded addon has to be the one the manifest describes. `engine` is empty
 * when the binary exposes no `engine()`; `recorded` is null when the manifest
 * has no engine for this file, which means "not checked here".
 */
export function verifyAddon(build, file, { engine, hasRenderDrawList }) {
  const errors = []
  if (!hasRenderDrawList) {
    errors.push('addon-hash: this binary has no renderDrawList')
    return errors
  }
  const recorded = file ? build?.binaries?.[file]?.engine ?? null : null
  if (recorded && recorded !== engine) {
    errors.push(`addon-hash: ${file} engine ${engine} does not match BUILD.json ${recorded}`)
  }
  return errors
}
