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

export async function renderFvg(source: string | FvgNode, options: RenderOptions = {}): Promise<RenderResult> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  const png = await paintDocument(doc.root, {
    width: doc.width,
    height: doc.height,
    background: doc.background,
    scale: options.scale ?? 1,
    debug: options.debug ?? false,
    t: options.t ?? 0,
  })
  const report = buildReport(doc)
  return { png, report }
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
