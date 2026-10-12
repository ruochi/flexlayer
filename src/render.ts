import type { Canvas } from '@napi-rs/canvas'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { paintDocument } from './paint.js'
import { renderPreviewSheet } from './preview.js'
import { buildReport } from './report.js'
import type { LayerReport, RenderOptions } from './types.js'
import { initFontsForMeasure, setFontsCacheDir } from './fonts.js'
import type { LayerNode } from './parse.js'

export type RenderResult = {
  png: Buffer
  report: LayerReport
}

export type CanvasRenderResult = {
  canvas: Canvas
  report: LayerReport
}

/** 排版并画到画布上，不编码。调用方决定写成 PNG 还是原始像素。 */
export async function renderToCanvas(source: string | LayerNode, options: RenderOptions = {}): Promise<CanvasRenderResult> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  const canvas = await paintDocument(doc.root, {
    width: doc.width,
    height: doc.height,
    background: doc.background,
    scale: options.scale ?? 1,
    debug: options.debug ?? false,
    t: options.t ?? 0,
    frame: options.frame ?? 0,
    fps: options.fps ?? 0,
    issues: doc.issues,
    meshSamples: options.meshSamples,
    meshCache: options.meshCache,
  })
  return { canvas, report: buildReport(doc) }
}

export async function renderLayer(source: string | LayerNode, options: RenderOptions = {}): Promise<RenderResult> {
  const { canvas, report } = await renderToCanvas(source, options)
  return { png: canvas.toBuffer('image/png'), report }
}

/** `<preview>` 拼成的图。文档里没有 preview 时返回 null。 */
export async function renderPreview(source: string | LayerNode, options: RenderOptions = {}): Promise<Buffer | null> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  const sheet = renderPreviewSheet(doc)
  return sheet ? sheet.toBuffer('image/png') : null
}

export async function checkLayer(source: string | LayerNode, options: RenderOptions = {}): Promise<LayerReport> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  return buildReport(doc)
}
