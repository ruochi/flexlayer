import type { Canvas } from '@napi-rs/canvas'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { paintDocument } from './paint.js'
import { buildReport } from './report.js'
import type { FvgReport, RenderOptions } from './types.js'
import { initFontsForMeasure, setFontsCacheDir } from './fonts.js'
import type { FvgNode } from './parse.js'

export type RenderResult = {
  png: Buffer
  report: FvgReport
}

export type CanvasRenderResult = {
  canvas: Canvas
  report: FvgReport
}

/** 排版并画到画布上，不编码。调用方决定写成 PNG 还是原始像素。 */
export async function renderToCanvas(source: string | FvgNode, options: RenderOptions = {}): Promise<CanvasRenderResult> {
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
  })
  return { canvas, report: buildReport(doc) }
}

export async function renderFvg(source: string | FvgNode, options: RenderOptions = {}): Promise<RenderResult> {
  const { canvas, report } = await renderToCanvas(source, options)
  return { png: canvas.toBuffer('image/png'), report }
}

export async function checkFvg(source: string | FvgNode, options: RenderOptions = {}): Promise<FvgReport> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  return buildReport(doc)
}

/** 与 renderFvg / checkFvg 相同，推荐新名字 */
export const renderLayer = renderFvg
export const checkLayer = checkFvg
