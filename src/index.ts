export { renderFvg, checkFvg, renderLayer, checkLayer, type RenderResult } from './render.js'
export { renderComposition, interpolate, spring, sequence } from './frame.js'
export type {
  Composition,
  FrameInput,
  RenderCompositionOptions,
  RenderCompositionResult,
  SpringConfig,
  Extrapolate,
} from './frame.js'
export { parseFvg } from './parse.js'
export { h } from './h.js'
export { emitLayer } from './emit.js'
export { formatSourceLoc } from './source-loc.js'
export type { SourceLoc } from './parse.js'
export { buildReport, formatIssueLine } from './report.js'
export type {
  FvgReport,
  RenderOptions,
  Issue,
  ElementReport,
  DrawFn,
  DrawElSnapshot,
  DrawComputedStyle,
} from './types.js'
export type { FvgNode, FvgChild } from './parse.js'
