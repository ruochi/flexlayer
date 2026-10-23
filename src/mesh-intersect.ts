// Thin wrapper - uses host-injected addon in sandbox, direct import otherwise
import { getNativeAddon } from './native-loader.mjs'
const addon = await getNativeAddon()

export type Vec3 = { x: number; y: number; z: number }
export type Segment = { a: Vec3; b: Vec3 }

export function triTriSegment(a0: Vec3, a1: Vec3, a2: Vec3, b0: Vec3, b1: Vec3, b2: Vec3): Segment | null {
  if (!addon) throw new Error('Native mesh-intersect addon not loaded - cannot call triTriSegment')
  return addon.triTriSegment(a0, a1, a2, b0, b1, b2) ?? null
}

export function meshIntersections(
  vertsA: readonly Vec3[],
  indicesA: ArrayLike<number>,
  vertsB: readonly Vec3[],
  indicesB: ArrayLike<number>,
): Segment[] {
  if (!addon) throw new Error('Native mesh-intersect addon not loaded - cannot call meshIntersections')
  const indA = indicesA instanceof Uint32Array ? indicesA : new Uint32Array(indicesA)
  const indB = indicesB instanceof Uint32Array ? indicesB : new Uint32Array(indicesB)
  return addon.meshIntersections(Array.from(vertsA), indA, Array.from(vertsB), indB)
}
