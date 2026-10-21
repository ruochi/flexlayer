export { createCanvas, loadImage } from '@napi-rs/canvas'
export { applyCanvasFont, DEFAULT_FONT_FAMILY, initFonts, registerFontPath } from './fonts.js'
export { renderLayer, checkLayer, type RenderResult, type RgbaRenderResult } from './render.js'
export { loadNativeRender, type NativeRender } from './native.js'
export { layer, create, type CreatedLayer, type MeshEdgeKind, type MeshPoint, type MeshProjectedEdge, type PlacedChar, type PlacedElement, type PlacedLine, type PlacedMask, type PlacedText } from './canvas.js'
export { registerComponent, arrowComponent, type ComponentFn, type ComponentProps } from './components.js'
export { glyph, type Glyph, type GlyphInk, type GlyphOptions } from './glyph.js'
export { Path2D } from './geom-path.js'
export { buffer, union, difference, intersection, symDifference, area, contains, bounds } from './geom-region.js'
export type { BufferOptions, Bounds, CapStyle, JoinStyle, PointLike } from './geom-region.js'
export { fillet, chamfer, offset, blend, trim, extend, join, reverse, intersections, closestPoint, pointAt, tangentAt, length } from './geom-curve.js'
export type { BlendOptions, OffsetOptions } from './geom-curve.js'
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
export { formatSampleCoverage, mergeFrameIssues, planSample, sampleFrames } from './check-frames.js'
export type { SamplePlan, SampleSpec } from './check-frames.js'
export { parseLayer } from './parse.js'
export { zoomView } from './view.js'
export { h } from './h.js'
export { emitLayer } from './emit.js'
export { formatSourceLoc } from './source-loc.js'
export type { SourceLoc } from './parse.js'
export { buildReport, formatIssueLine } from './report.js'
export type {
  LayerReport,
  RenderOptions,
  Issue,
  ElementReport,
  MaskReport,
  DrawComputedStyle,
  SKRSContext2D,
} from './types.js'
export type { LayerNode, LayerChild } from './parse.js'
export { resources, palettes, images, grades, glass, blends, recommendedFonts } from './resources.js'
export type { FontResource, ImageResource, FontRecommendation, RecommendedFont } from './resources.js'
