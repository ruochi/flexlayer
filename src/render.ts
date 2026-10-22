import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { ensurePaintFeatures, paintDocument } from './paint.js'
import { packPaintTree } from './paint-tree.js'
import { loadNativeRender } from './native.js'
import { applyCanvasScripts } from './run-scripts.js'
import { renderPreviewSheet } from './preview.js'
import { buildReport } from './report.js'
import type { Issue, LayerDocument, LayerReport, RenderOptions } from './types.js'
import { initFontsForMeasure, setFontsCacheDir } from './fonts.js'
import type { LayerNode } from './parse.js'

export type RenderResult = {
  png: Buffer
  report: LayerReport
}

/** `format: 'rgba'`。像素不预乘，长度是 `width × height × 4`。 */
export type RgbaRenderResult = {
  rgba: Buffer
  width: number
  height: number
  report: LayerReport
}

/** 默认 `js`。`native` 把成片画进插件，公开档拒绝长边超过 1920 的交付像素。 */
export function painterMode(): 'native' | 'js' {
  return process.env.FLEXLAYER_PAINTER === 'native' ? 'native' : 'js'
}

function canvasRgba(canvas: Canvas): Buffer {
  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  return Buffer.from(image.data)
}

export type CanvasRenderResult = {
  canvas: Canvas
  report: LayerReport
}

type Prepared = {
  doc: LayerDocument
  baseDir: string
  options: RenderOptions
}

async function prepareDocument(source: string | LayerNode, options: RenderOptions): Promise<Prepared> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  await applyCanvasScripts(doc, {
    t: options.t ?? 0,
    frame: options.frame ?? 0,
    fps: options.fps ?? 0,
    scale: options.scale ?? 1,
    noScript: options.noScript,
  })
  return { doc, baseDir, options }
}

function paintNative(prepared: Prepared, wantRgba: boolean): { png: Buffer; rgba?: Buffer; width: number; height: number; report: LayerReport } {
  const native = loadNativeRender()
  if (!native?.render) {
    throw new Error('FLEXLAYER_PAINTER=native 需要带 render 的 flexlayer-render。在 flexlayer-render 里构建，并把 FLEXLAYER_RENDER 指到那个目录。')
  }
  const options = prepared.options
  const packed = packPaintTree(prepared.doc, {
    scale: options.scale ?? 1,
    debug: options.debug ?? false,
    frame: options.frame ?? 0,
    baseDir: prepared.baseDir,
    meshSamples: options.meshSamples,
    native,
  })
  const out = native.render(packed.json, packed.images, packed.rasters, wantRgba)
  const report = buildReport(prepared.doc, { frame: options.frame ?? 0, fps: options.fps ?? 0 })
  for (const issue of out.issues ?? []) report.issues.push(asIssue(issue))
  return {
    png: Buffer.from(out.png ?? []),
    rgba: out.rgba ? Buffer.from(out.rgba) : undefined,
    width: out.width,
    height: out.height,
    report,
  }
}

function asIssue(issue: { level: string; code: string; path: string; message: string; hint?: string }): Issue {
  const level = issue.level === 'warn' || issue.level === 'info' ? issue.level : 'error'
  return { level, code: issue.code, path: issue.path, message: issue.message, hint: issue.hint }
}

async function paintJs(prepared: Prepared): Promise<Canvas> {
  const options = prepared.options
  return paintDocument(prepared.doc.root, {
    width: prepared.doc.width,
    height: prepared.doc.height,
    background: prepared.doc.background,
    scale: options.scale ?? 1,
    debug: options.debug ?? false,
    t: options.t ?? 0,
    frame: options.frame ?? 0,
    fps: options.fps ?? 0,
    issues: prepared.doc.issues,
    meshSamples: options.meshSamples,
    meshCache: options.meshCache,
  })
}

/** 排版并画到画布上，不编码。调用方决定写成 PNG 还是原始像素。 */
export async function renderToCanvas(source: string | LayerNode, options: RenderOptions = {}): Promise<CanvasRenderResult> {
  const prepared = await prepareDocument(source, options)
  if (painterMode() === 'native') {
    const painted = paintNative(prepared, false)
    if (!painted.png.length) {
      const message = painted.report.issues.find((issue) => issue.level === 'error')?.message ?? '绘制失败'
      throw new Error(message)
    }
    const image = await loadImage(painted.png)
    const canvas = createCanvas(image.width, image.height)
    canvas.getContext('2d').drawImage(image, 0, 0)
    return { canvas, report: painted.report }
  }
  const canvas = await paintJs(prepared)
  return { canvas, report: buildReport(prepared.doc, { frame: options.frame ?? 0, fps: options.fps ?? 0 }) }
}

export async function renderLayer(source: string | LayerNode, options: RenderOptions & { format: 'rgba' }): Promise<RgbaRenderResult>
export async function renderLayer(source: string | LayerNode, options?: RenderOptions): Promise<RenderResult>
export async function renderLayer(source: string | LayerNode, options: RenderOptions = {}): Promise<RenderResult | RgbaRenderResult> {
  const prepared = await prepareDocument(source, options)
  if (painterMode() === 'native') {
    const painted = paintNative(prepared, options.format === 'rgba')
    if (options.format === 'rgba') {
      return { rgba: painted.rgba ?? Buffer.alloc(0), width: painted.width, height: painted.height, report: painted.report }
    }
    return { png: painted.png, report: painted.report }
  }
  const canvas = await paintJs(prepared)
  const report = buildReport(prepared.doc, { frame: options.frame ?? 0, fps: options.fps ?? 0 })
  if (options.format === 'rgba') {
    return { rgba: canvasRgba(canvas), width: canvas.width, height: canvas.height, report }
  }
  return { png: canvas.toBuffer('image/png'), report }
}

/** `<preview>` 拼成的图。文档里没有 preview 时返回 null。预览拼图仍走原来的绘制器。 */
export async function renderPreview(source: string | LayerNode, options: RenderOptions = {}): Promise<Buffer | null> {
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  await ensurePaintFeatures(doc.root)
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
  await applyCanvasScripts(doc, {
    t: options.t ?? 0,
    frame: options.frame ?? 0,
    fps: options.fps ?? 0,
    scale: options.scale ?? 1,
    noScript: options.noScript,
  })
  return buildReport(doc, { frame: options.frame ?? 0, fps: options.fps ?? 0 })
}
