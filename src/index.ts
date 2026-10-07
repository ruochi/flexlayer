export { renderFvg, checkFvg, renderLayer, checkLayer, type RenderResult } from './render.js'
export { canvas, create, type CreatedLayer, type PlacedChar, type PlacedLine, type PlacedText } from './canvas.js'
export { registerComponent, arrowComponent, type ComponentFn, type ComponentProps } from './components.js'
export { glyph, type Glyph, type GlyphInk, type GlyphOptions } from './glyph.js'
export { getFilter, listFilters, registerFilter, unregisterFilter } from './filter.js'
export type { FilterParseResult, FilterPixels, LayerFilter } from './filter.js'
export { renderComposition, renderFrames, createContactSheet, contactSheetFromPngs, interpolate, spring, sequence, random, noise, Easing } from './frame.js'
export type {
  Composition,
  FrameInput,
  RenderCompositionOptions,
  RenderCompositionResult,
  RenderFramesOptions,
  RenderedFrame,
  ContactSheet,
  SpringConfig,
  Extrapolate,
} from './frame.js'
export { mergeFrameIssues, sampleFrames } from './check-frames.js'
export type { SampleSpec } from './check-frames.js'
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
export { resources, palettes, images, grades, glass, blends } from './resources.js'
export type { FontResource, ImageResource } from './resources.js'
