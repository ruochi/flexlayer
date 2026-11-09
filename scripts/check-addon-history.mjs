/**
 * Fail when a commit adds a `.node` file that is not one of the three release
 * addons, or when the tree carries a binary the manifest does not describe.
 *
 *   node scripts/check-addon-history.mjs            # this working tree
 *   node scripts/check-addon-history.mjs --range A..B  # a push
 *
 * History used to carry a `subdir/b.node` that turned out to be the
 * `+unlimited` server build, and 350 retired copies of the three addons. Both
 * are invisible to a normal review: a binary diffs as "Bin 20151488 -> ...".
 * This refuses the first and keeps the second from growing again.
 */
import { execFileSync } from 'node:child_process'
import { hostBinary, RELEASE, COMPANIONS } from './addon-verify.mjs'

const ADDON_DIR = 'native/flexlayer-render/'

function git(...args) {
  return execFileSync('git', [...args], { encoding: 'utf8' })
}

function tryGit(...args) {
  try {
    return git(...args)
  } catch {
    return null
  }
}

/**
 * `A...B` (three dots) diffs from the merge base, which is what a pull request
 * means: only what the branch added. `A..B` compares the two tips directly and
 * fails outright when one is not an ancestor of the other, which is exactly
 * the release-branch case.
 *
 * A first push reports an all-zero `before`, and a shallow runner may not have
 * both ends. Neither is a reason to fail: fall back to the index, and to HEAD's
 * parent, so a check that cannot see a range never blocks a merge.
 */
function changedAddons(range) {
  const candidates = []
  if (range) {
    const [left, right] = range.split('...');
    if (left && right && !/^0+$/.test(left)) {
      candidates.push(['diff', '--name-only', '--diff-filter=A', `${left}...${right}`])
    }
  }
  candidates.push(['diff', '--name-only', '--diff-filter=A', '--cached'])
  candidates.push(['diff', '--name-only', '--diff-filter=A', 'HEAD~1..HEAD'])

  for (const args of candidates) {
    const out = tryGit(...args)
    if (out !== null) {
      return out
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.node'))
    }
  }
  return []
}

const rangeIndex = process.argv.indexOf('--range')
const range = rangeIndex >= 0 ? process.argv[rangeIndex + 1] : null

const added = changedAddons(range)
const errors = []
for (const path of added) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!path.startsWith(ADDON_DIR) || !RELEASE.includes(name)) {
    errors.push(
      `addon-history: ${path} is not one of the three release addons.\n` +
      `  Only ${ADDON_DIR}{${RELEASE.join(', ')}} may carry a binary.`,
    )
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(added.length === 0
  ? 'addon-history: no unexpected binary added'
  : `addon-history: ${added.length} release addon(s) added`)
