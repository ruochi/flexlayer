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
