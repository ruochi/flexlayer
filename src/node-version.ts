/** 和 README、package.json 的 engines 一致。yoga-layout 在更低版本上会报 ERR_REQUIRE_ESM。 */
export const MIN_NODE_MAJOR = 20

export function nodeVersionError(version = process.versions.node): string | null {
  const major = Number(String(version).replace(/^v/, '').split('.')[0])
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return null
  const shown = String(version).startsWith('v') ? version : `v${version}`
  return [
    `flexlayer 需要 Node.js ${MIN_NODE_MAJOR} 或更高版本，当前是 ${shown}。`,
    'Node 18 加载 yoga-layout 时会抛出 Top-level await … ERR_REQUIRE_ESM，那不是场景写错。',
    '请换到 Node 20 或更高，例如 nvm use 22。',
  ].join('\n')
}
