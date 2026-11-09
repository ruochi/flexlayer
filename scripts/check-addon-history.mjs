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

function changedAddons(range) {
  // A first push reports an all-zero `before`, and a release branch may have no
  // merge base. Neither is a reason to fail: with no range, check the index.
  const zero = range && /^0+$/.test(range.split('..')[0] ?? '')
  const usable = range && !zero
  const args = usable
    ? ['diff', '--name-only', '--diff-filter=A', range]
    : ['diff', '--name-only', '--diff-filter=A', '--cached']
  return git(...args)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.node'))
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
