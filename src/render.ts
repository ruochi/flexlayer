import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { orderedFilters } from './filter.js'
import { packPaintTree } from './paint-tree.js'
import { loadNativeRender } from './native.js'
import { applyPixelFilters } from './paint.js'
import { applyCanvasScripts } from './run-scripts.js'
import { buildReport } from './report.js'
import type { Issue, LayerDocument, LayerLayoutNode, LayerReport, LayoutNode, RenderOptions } from './types.js'
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

/** 出图只走插件。`FLEXLAYER_PAINTER=js` 直接报错，不再退回 JS 绘制器。 */
export function painterMode(): 'native' {
  const mode = process.env.FLEXLAYER_PAINTER
  if (mode != null && mode !== '' && mode !== 'native') {
    throw new Error('JS 绘制器已移除。出图只走带上限的插件。')
  }
  return 'native'
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

function hasCustomPixel(node: LayoutNode): boolean {
  if (orderedFilters(node.filters, 'pixel').some((item) => item.name !== 'grade')) return true
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    return node.children.some(hasCustomPixel)
  }
  return false
}

/** 插件不跑后加的 pixel 滤镜。grade 已经在插件里。其余滤镜按层离屏再叠回去。 */
async function stampCustomFilters(canvas: Canvas, node: LayoutNode, prepared: Prepared, scale: number) {
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) await stampCustomFilters(canvas, child, prepared, scale)
  }
  const pixel = orderedFilters(node.filters, 'pixel').filter((item) => item.name !== 'grade')
  if (pixel.length === 0 || !(node.width > 0) || !(node.height > 0)) return
  const backdrop = pixel.filter((item) => item.includeBackdrop && node === prepared.doc.root)
  const local = pixel.filter((item) => !backdrop.includes(item))
  if (local.length > 0) {
    const native = loadNativeRender()
    if (native?.render) {
      const sub: LayerDocument = {
        ...prepared.doc,
        width: node.width,
        height: node.height,
        background: 'transparent',
        root: { ...(node as LayerLayoutNode), x: 0, y: 0 },
      }
      const options = prepared.options
      const packed = packPaintTree(sub, {
        scale,
        debug: options.debug ?? false,
        frame: options.frame ?? 0,
        baseDir: prepared.baseDir,
        meshSamples: options.meshSamples,
        native,
      })
      const out = native.render(packed.json, packed.images, packed.rasters, false)
      if (out.png && out.png.length > 0 && out.width > 0 && out.height > 0) {
        const image = await loadImage(out.png)
        const off = createCanvas(image.width, image.height)
        off.getContext('2d').drawImage(image, 0, 0)
        applyPixelFilters(off, local, scale, 0, 0, node.width, node.height)
        canvas.getContext('2d').drawImage(off, node.x * scale, node.y * scale)
      }
    }
  }
  if (backdrop.length > 0) applyPixelFilters(canvas, backdrop, scale, node.x, node.y, node.width, node.height)
}

async function paintNative(prepared: Prepared, wantRgba: boolean): Promise<{ png: Buffer; rgba?: Buffer; width: number; height: number; report: LayerReport }> {
  const native = loadNativeRender()
  if (!native?.render) {
    throw new Error('出图需要带 render 的 flexlayer-render。在 flexlayer-render 里构建，并把 FLEXLAYER_RENDER 指到那个目录。')
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
  let png = Buffer.from(out.png ?? [])
  let rgba = out.rgba ? Buffer.from(out.rgba) : undefined
  if (png.length > 0 && hasCustomPixel(prepared.doc.root)) {
    const image = await loadImage(png)
    const canvas = createCanvas(image.width, image.height)
    canvas.getContext('2d').drawImage(image, 0, 0)
    await stampCustomFilters(canvas, prepared.doc.root, prepared, options.scale ?? 1)
    png = canvas.toBuffer('image/png')
    if (wantRgba) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      rgba = Buffer.from(pixels.data)
    }
  }
  return {
    png,
    rgba,
    width: out.width,
    height: out.height,
    report,
  }
}

/** 一批帧一次交给插件。图片跟每一帧自己的打包走。 */
export async function renderFrameBatch(
  items: Array<{ source: string | LayerNode; options: RenderOptions }>,
  wantRgba: boolean,
): Promise<Array<{ png?: Buffer; rgba?: Buffer; width: number; height: number; report: LayerReport }>> {
  const native = loadNativeRender()
  if (!native?.renderFrames) {
    throw new Error('多帧出图需要带 renderFrames 的 flexlayer-render。')
  }
  const prepared: Prepared[] = []
  for (const item of items) prepared.push(await prepareDocument(item.source, item.options))
  const packed = prepared.map((item) =>
    packPaintTree(item.doc, {
      scale: item.options.scale ?? 1,
      debug: item.options.debug ?? false,
      frame: item.options.frame ?? 0,
      baseDir: item.baseDir,
      meshSamples: item.options.meshSamples,
      native,
    }),
  )
  const outs = native.renderFrames(
    packed.map((item) => ({ json: item.json, images: item.images, rasters: item.rasters })),
    wantRgba,
  )
  return outs.map((out, index) => {
    const item = prepared[index]!
    const report = buildReport(item.doc, { frame: item.options.frame ?? 0, fps: item.options.fps ?? 0 })
    for (const issue of out.issues ?? []) report.issues.push(asIssue(issue))
    return {
      png: out.png ? Buffer.from(out.png) : undefined,
      rgba: out.rgba ? Buffer.from(out.rgba) : undefined,
      width: out.width,
      height: out.height,
      report,
    }
  })
}

function asIssue(issue: { level: string; code: string; path: string; message: string; hint?: string }): Issue {
  const level = issue.level === 'warn' || issue.level === 'info' ? issue.level : 'error'
  return { level, code: issue.code, path: issue.path, message: issue.message, hint: issue.hint }
}

/** 排版并画到画布上，不编码。像素来自插件交回的 PNG。 */
export async function renderToCanvas(source: string | LayerNode, options: RenderOptions = {}): Promise<CanvasRenderResult> {
  painterMode()
  const prepared = await prepareDocument(source, options)
  const painted = await paintNative(prepared, false)
  if (!painted.png.length) {
    const message = painted.report.issues.find((issue) => issue.level === 'error')?.message ?? '绘制失败'
    throw new Error(message)
  }
  const image = await loadImage(painted.png)
  const canvas = createCanvas(image.width, image.height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  return { canvas, report: painted.report }
}

export async function renderLayer(source: string | LayerNode, options: RenderOptions & { format: 'rgba' }): Promise<RgbaRenderResult>
export async function renderLayer(source: string | LayerNode, options?: RenderOptions): Promise<RenderResult>
export async function renderLayer(source: string | LayerNode, options: RenderOptions = {}): Promise<RenderResult | RgbaRenderResult> {
  painterMode()
  const prepared = await prepareDocument(source, options)
  const painted = await paintNative(prepared, options.format === 'rgba')
  if (options.format === 'rgba') {
    return { rgba: painted.rgba ?? Buffer.alloc(0), width: painted.width, height: painted.height, report: painted.report }
  }
  return { png: painted.png, report: painted.report }
}

/** `<preview>` 拼成的图。文档里没有 preview 时返回 null。拼图在插件里完成，同样受长边上限约束。 */
export async function renderPreview(source: string | LayerNode, options: RenderOptions = {}): Promise<Buffer | null> {
  painterMode()
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets)
  const native = loadNativeRender()
  if (!native?.previewSheet || !native.render) {
    throw new Error('预览拼图需要带 previewSheet 的 flexlayer-render。')
  }
  const packed = packPaintTree(doc, {
    scale: options.scale ?? 1,
    debug: options.debug ?? false,
    frame: options.frame ?? 0,
    baseDir,
    meshSamples: options.meshSamples,
    native,
  })
  const tree = JSON.parse(packed.json) as { previews?: Array<{ of: string; show: string[] }> }
  tree.previews = (doc.previews ?? []).map((spec) => ({ of: spec.of, show: spec.show }))
  const out = native.previewSheet(JSON.stringify(tree), packed.images, packed.rasters)
  const error = out.issues?.find((item) => item.level === 'error')
  if (error) throw new Error(error.message)
  if (!out.png || out.png.length === 0 || !out.width) return null
  return Buffer.from(out.png)
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
