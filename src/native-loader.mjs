import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let addonCache = null

function tryLoad(spec) {
  try {
    return require(spec)
  } catch {
    try {
      return require(join(spec, 'index.cjs'))
    } catch {
      return undefined
    }
  }
}

/** 沙箱里用注入的插件。否则和 `loadNativeRender` 同一套路径。 */
export async function getNativeAddon() {
  if (addonCache !== null) return addonCache
  if (globalThis.__flexlayerNativeAddon) {
    addonCache = globalThis.__flexlayerNativeAddon
    return addonCache
  }
  const here = dirname(fileURLToPath(import.meta.url))
  const vendored = join(here, '..', 'native', 'flexlayer-render', 'index.cjs')
  const fromEnv = process.env.FLEXLAYER_RENDER
  addonCache =
    (fromEnv && tryLoad(fromEnv)) ||
    tryLoad(vendored) ||
    tryLoad('flexlayer-render') ||
    tryLoad('@ruochi/flexlayer-render')
  return addonCache
}
