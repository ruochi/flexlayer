import { getNativeAddon } from './native-loader.mjs'
const addon = await getNativeAddon()

/**
 * 面数不多的网格在渲染时加一条窄圆角。
 * 折棱、内收和带洞的盖子在原生插件里算。半径是厚度的 1/40。
 */

export type BevelGeometry = { positions: Float32Array; normals: Float32Array; indices: Uint32Array }

export function bevelRadius(depth: number): number {
  if (!addon) throw new Error('Native mesh-bevel addon not loaded - cannot call bevelRadius')
  return addon.bevelRadius(depth)
}

/** 面数少就返回带窄圆角的网格，否则返回 null，调用方继续用原来的网格。半径不写时用 z 向厚度的 1/40。 */
export function bevelFewFaces(srcPos: Float32Array, srcIdx: Uint32Array, radius?: number): BevelGeometry | null {
  if (!addon) throw new Error('Native mesh-bevel addon not loaded - cannot call bevelFewFaces')
  return addon.bevelFewFaces(srcPos, srcIdx, radius ?? null)
}
