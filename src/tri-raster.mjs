// Thin wrapper - uses host-injected addon in sandbox, direct import otherwise
import { getNativeAddon } from './native-loader.mjs'
const addon = await getNativeAddon()

export const MESH_SAMPLES = addon?.getMeshSamples?.() ?? 4

export function walkTriangle(width, height, ax, ay, bx, by, cx, cy, visit) {
  if (!addon) throw new Error('Native tri-raster addon not loaded - cannot call walkTriangle')
  return addon.walkTriangle(width, height, ax, ay, bx, by, cx, cy, visit)
}

export function resolveGrid(color, sw, dw, dh, samples, dst) {
  if (!addon) throw new Error('Native tri-raster addon not loaded - cannot call resolveGrid')
  return addon.resolveGrid(color, sw, dw, dh, samples, dst)
}

export function fakeDraw(color, depth, input) {
  if (!addon?.fakeDraw) throw new Error('Native fakeDraw is not available')
  return addon.fakeDraw(color, depth, input)
}

export function webglDraw(draw) {
  if (!addon?.webglDraw) return { pixels: new Uint8ClampedArray(), covered: false }
  return addon.webglDraw(draw)
}

export function fakeClear(color, depth, input) {
  if (!addon?.fakeClear) throw new Error('Native fakeClear is not available')
  return addon.fakeClear(color, depth, input)
}

export function preprocessShader(src) {
  if (!addon?.preprocessShader) throw new Error('Native preprocessShader is not available')
  return addon.preprocessShader(src)
}

export function parseShaderProgram(vertexSrc, fragmentSrc) {
  if (!addon?.parseShaderProgram) throw new Error('Native parseShaderProgram is not available')
  return addon.parseShaderProgram(vertexSrc, fragmentSrc)
}
