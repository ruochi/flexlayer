import type { LayerNode } from '../parse.js'
import { loadOptional, loadOptionalSync, optionalHref } from '../optional.js'
import type { FlexLayoutNode } from '../types.js'
import type { MathLayoutHost } from './layout.js'

type LayoutMath = (node: LayerNode, host: MathLayoutHost, rowAlign?: string) => FlexLayoutNode

const href = optionalHref('./layout.js', import.meta.url)
let impl: LayoutMath | null = null

export function mathReady(): boolean {
  return impl != null
}

async function load(): Promise<LayoutMath> {
  if (impl) return impl
  const mod = await loadOptional<typeof import('./layout.js')>(href)
  impl = mod.layoutMath
  return impl
}

/** 排版之前调用。OpenType 和 STIX 跟着这一次进来。 */
export async function ensureMathLayout(): Promise<void> {
  await load()
}

/** `layoutSync` / `canvas.create` 是同步的。模块已在异步入口装过时直接用；dist 里还可以 require。 */
export function ensureMathLayoutSync(): void {
  if (impl) return
  const mod = loadOptionalSync<typeof import('./layout.js')>(href)
  if (!mod?.layoutMath) throw new Error('公式模块还没加载')
  impl = mod.layoutMath
}

export function layoutMath(node: LayerNode, host: MathLayoutHost, rowAlign?: string): FlexLayoutNode {
  if (!impl) ensureMathLayoutSync()
  return impl!(node, host, rowAlign)
}
