/**
 * Which `ruochi/flexlayer-render` ref the CI jobs build against.
 *
 *   node scripts/renderer-ref.mjs >> "$GITHUB_OUTPUT"
 *
 * Precedence:
 *   1. `RENDER_REF` when the repository variable pins one.
 *   2. `release/addons-*` → the commit `BUILD.json` records. A release branch
 *      exists only in this repository, so using its name would checkout
 *      nothing; the recorded commit is the tree the addons were built from.
 *   3. the pull request head branch, for paired quality branches.
 *   4. `main`.
 *
 * A paired branch only exists on the renderer while someone works on both
 * sides. The branch list is consulted so a merged-and-deleted branch falls
 * back to `main` instead of failing the checkout.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const defaultBuildPath = fileURLToPath(new URL('../native/flexlayer-render/BUILD.json', import.meta.url))

/**
 * `buildPath` and `hasRemoteBranch` are injectable so a test can drive every
 * branch without a renderer checkout and without network access.
 */
export function resolveRendererRef({
  pinned = '',
  headRef = '',
  buildPath = defaultBuildPath,
  hasRemoteBranch = localHasRemoteBranch,
} = {}) {
  if (pinned) return pinned

  if (headRef.startsWith('release/addons-')) {
    const manifest = JSON.parse(readFileSync(buildPath, 'utf8'))
    const commits = new Set(
      Object.values(manifest.binaries ?? {}).map((entry) => entry.commit).filter(Boolean),
    )
    if (commits.size !== 1) {
      throw new Error(`renderer-ref: BUILD.json names ${commits.size} commits, expected one`)
    }
    return [...commits][0]
  }

  if (headRef && headRef !== 'HEAD' && hasRemoteBranch(headRef)) return headRef
  return 'main'
}

function localHasRemoteBranch(branch) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const ref = resolveRendererRef({
    pinned: process.env.RENDER_REF ?? '',
    headRef: process.env.PR_HEAD_REF ?? '',
  })
  console.log(`ref=${ref}`)
}
