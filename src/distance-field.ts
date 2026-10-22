// Thin wrapper - uses host-injected addon in sandbox, direct import otherwise
import { getNativeAddon } from './native-loader.mjs'
const addon = await getNativeAddon()

export function distanceToSites(isSite: (index: number) => boolean, w: number, h: number, bias = 0): Float32Array {
  if (!addon) throw new Error('Native distance-field addon not loaded - cannot call distanceToSites')
  return addon.distanceToSites(isSite, w, h, bias)
}

export function inkDistanceField(maskData: Uint8ClampedArray, w: number, h: number): Float32Array {
  if (!addon) throw new Error('Native distance-field addon not loaded - cannot call inkDistanceField')
  return addon.inkDistanceField(maskData, w, h)
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (!addon) throw new Error('Native distance-field addon not loaded - cannot call smoothstep')
  return addon.smoothstep(edge0, edge1, x)
}

export function bandCoverage(d: number, inner: number, outer: number): number {
  if (!addon) throw new Error('Native distance-field addon not loaded - cannot call bandCoverage')
  return addon.bandCoverage(d, inner, outer)
}

export function outerEdgeFade(d: number, outer: number): number {
  if (!addon) throw new Error('Native distance-field addon not loaded - cannot call outerEdgeFade')
  return addon.outerEdgeFade(d, outer)
}
