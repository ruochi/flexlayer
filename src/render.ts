import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { orderedFilters } from './filter.js'
import { packPaintTree } from './paint-tree.js'
import { loadNativeRender } from './native.js'
import { applyPixelFilters } from './paint.js'
import { applyCanvasScripts } from './run-scripts.js'
import { buildReport } from './report.js'
import type { GroundLayoutNode, Issue, LayerDocument, LayerLayoutNode, LayerReport, LayoutNode, RenderOptions } from './types.js'
import { initFontsForMeasure, setFontsCacheDir } from './fonts.js'
import type { LayerNode } from './parse.js'
import type { CyclesRunOptions } from './cycles.js'
import { findCameraLayer } from './cycles-export.js'
import type { CyclesExport } from './cycles-export.js'

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
  const doc = layoutSync(opened.root, assets, options.quality)
  applyDocumentQuality(doc.root, options.quality)
  await applyCanvasScripts(doc, {
    t: options.t ?? 0,
    frame: options.frame ?? 0,
    fps: options.fps ?? 0,
    scale: options.scale ?? 1,
    noScript: options.noScript,
  })
  return { doc, baseDir, options }
}

/** `--quality` 和根上的 quality 传给还没写质量档的镜头。镜头自己写了的不动。 */
export function inheritQuality(node: LayoutNode, quality: 'draft' | 'final' | undefined): void {
  if (!quality) return
  if (node.kind === 'layer') {
    if (node.perspective != null && node.quality == null) node.quality = quality
    for (const child of node.children) inheritQuality(child, quality)
    if (node.mask) for (const child of node.mask) inheritQuality(child, quality)
    return
  }
  if (node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) inheritQuality(child, quality)
  }
}

function applyDocumentQuality(root: LayerLayoutNode, override: 'draft' | 'final' | undefined): void {
  if (override) root.quality = override
  inheritQuality(root, override ?? root.quality)
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
        meshCache: options.meshCache,
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

async function paintNative(
  prepared: Prepared,
  wantRgba: boolean,
  skip3d = false,
): Promise<{ png: Buffer; rgba?: Buffer; width: number; height: number; report: LayerReport }> {
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
    meshCache: options.meshCache,
    native,
    skip3d,
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
      meshCache: item.options.meshCache,
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

/**
 * 超高质量档：排版、素材、脚本都和 native 走同一条路，只把最后一步换成
 * Cycles Standalone 的路径追踪。草稿和高质量两条已有路径完全不受影响。
 */
export type CyclesRenderResult = {
  png: Buffer
  width: number
  height: number
  report: LayerReport
  /** 外部渲染器的统计，日志用。 */
  scene: { counts: { meshes: number; triangles: number; lights: number; grounds: number; planes: number }; skipped: string[] }
  elapsedMs: number
}

/**
 * 文档里第一块「无 fill」的地面。
 *
 * 无 fill 的地面在光栅器里只留影子，Cycles 侧要靠两次渲染把它合出来，所以渲染前
 * 先确认有没有，并把它写的 `shadow-opacity` / `shadow-blur` 带下去。
 */
function shadowCatcherGround(doc: LayerDocument): GroundLayoutNode | null {
  const visit = (node: LayoutNode): GroundLayoutNode | null => {
    if (node.kind === 'ground' && node.fill == null) return node
    if (!('children' in node)) return null
    for (const child of node.children) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  return visit(doc.root)
}

export type CyclesRenderOptions = RenderOptions & CyclesRunOptions

export async function renderLayerWithCycles(
  source: string | LayerNode,
  options: CyclesRenderOptions = {} as CyclesRenderOptions,
): Promise<CyclesRenderResult> {
  const prepared = await prepareDocument(source, options)
  const { renderCycles } = await import('./cycles.js')
  const ground = shadowCatcherGround(prepared.doc)
  const height = prepared.doc.height
  const rendered = await renderCycles(prepared.doc, {
    ...options,
    width: prepared.options.scale && prepared.options.scale !== 1
      ? Math.round(prepared.doc.width * prepared.options.scale)
      : prepared.doc.width,
    height: prepared.options.scale && prepared.options.scale !== 1
      ? Math.round(height * prepared.options.scale)
      : height,
  })
  const report = buildReport(prepared.doc, {
    frame: prepared.options.frame ?? 0,
    fps: prepared.options.fps ?? 0,
  })
  for (const line of rendered.scene.skipped) {
    report.issues.push({ level: 'info', code: 'cycles-skipped', path: 'layer', message: line, hint: '这部分留给光栅路径合成' })
  }

  /* 二维层叠回 Cycles 结果。
   *
   * Cycles 只认相机层里的三维几何：标题、说明、按钮、分隔线这些都在相机层
   * 之外，路径追踪器根本不碰它们。所以再走一遍光栅路径，但把三维网格帧全部
   * 跳过（`skip3d`），背景设成透明，只留二维内容，最后原位叠到 Cycles 图上。
   *
   * 这样文字仍是光栅的矢量级清晰度，屏幕、键盘这类二维贴面也不会丢；
   * 三维部分则全权交给路径追踪。 */
  const png = await compositeCanvasLayers(prepared, rendered.png, rendered.width, rendered.height)
  return {
    png,
    width: rendered.width,
    height: rendered.height,
    report,
    scene: rendered.scene,
    elapsedMs: rendered.elapsedMs,
  }
}

/**
 * 把「只画二维」的一张透明底板叠到 Cycles 出的图上。
 *
 * 底板用和成片一致的像素尺寸，缺一层就直接返回原图，不让合成成为出图的
 * 单点故障。
 */
async function compositeCanvasLayers(
  prepared: Prepared,
  below: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const plate = await paintOverlayPlate(prepared, width, height)
  if (plate.length === 0) return below
  const base = await loadImage(below)
  const canvas = createCanvas(base.width, base.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(base, 0, 0)
  const top = await loadImage(plate)
  ctx.drawImage(top, 0, 0, base.width, base.height)
  return canvas.toBuffer('image/png')
}

/**
 * 只含二维层的透明底板。
 *
 * 三维全关在相机层里，二维文字、按钮、分隔线都在相机层之外。所以把相机层
 * 整块掏空、背景设成透明，跑一遍光栅就能得到「只有二维」的一张图，尺寸和
 * 成片一致，直接原位叠到 Cycles 结果上。
 */
async function paintOverlayPlate(
  prepared: Prepared,
  width: number,
  height: number,
): Promise<Buffer> {
  const camera = findCameraLayer(prepared.doc.root)
  if (!camera) return Buffer.alloc(0)
  const hollow = (node: LayoutNode): LayoutNode => {
    if (node === camera) {
      // 相机层保留定位（宽高、透视），但内容清空：三维和层内二维都不画，
      // 它们要么由 Cycles 出，要么本来就不可见。
      return { ...(node as LayerLayoutNode), children: [] }
    }
    if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
      return { ...node, children: node.children.map(hollow).filter(Boolean) } as LayoutNode
    }
    return node
  }
  /* 铺满画布的背景块（海报底色那种）不进底板。
   *
   * Cycles 已经把同一块背景连同灯光一起渲好；底板再画一遍会把三维全糊掉。
   * 判据是「铺满整幅画布」——这种块只可能是底色，不会是文字、按钮这类局部内容。 */
  const dropsBackdrop = (node: LayoutNode): boolean =>
    node.kind === 'shape' &&
    node.x <= 0.5 &&
    node.y <= 0.5 &&
    node.width >= width - 1 &&
    node.height >= height - 1
  const flat: LayerDocument = {
    ...prepared.doc,
    width,
    height,
    background: 'transparent',
    root: hollow({
      ...(prepared.doc.root as LayerLayoutNode),
      children: (prepared.doc.root as LayerLayoutNode).children.filter((c) => !dropsBackdrop(c)),
    }) as LayerLayoutNode,
  }
  const plate = await paintNative({ ...prepared, doc: flat }, false, true)
  if (process.env.FLEXLAYER_DUMP_PLATE) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.FLEXLAYER_DUMP_PLATE, plate.png)
  }
  return plate.png
}

/** 只导出 Cycles 场景，不渲染。 */
export async function exportLayerToCycles(
  source: string | LayerNode,
  target: string,
  options: CyclesRenderOptions = {} as CyclesRenderOptions,
): Promise<CyclesExport> {
  const prepared = await prepareDocument(source, options)
  const { writeCyclesScene } = await import('./cycles.js')
  return writeCyclesScene(prepared.doc, target, options)
}

/** `<preview>` 拼成的图。文档里没有 preview 时返回 null。拼图在插件里完成，同样受长边上限约束。 */
export async function renderPreview(source: string | LayerNode, options: RenderOptions = {}): Promise<Buffer | null> {
  painterMode()
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  await initFontsForMeasure({ fontsCacheDir: options.fontsCacheDir })
  const baseDir = options.baseDir ?? process.cwd()
  const opened = readLayerRoot(source)
  const assets = await prepareAssets(opened.root, baseDir, { fonts: opened.fonts })
  const doc = layoutSync(opened.root, assets, options.quality)
  applyDocumentQuality(doc.root, options.quality)
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
    meshCache: options.meshCache,
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
  const doc = layoutSync(opened.root, assets, options.quality)
  applyDocumentQuality(doc.root, options.quality)
  await applyCanvasScripts(doc, {
    t: options.t ?? 0,
    frame: options.frame ?? 0,
    fps: options.fps ?? 0,
    scale: options.scale ?? 1,
    noScript: options.noScript,
  })
  return buildReport(doc, { frame: options.frame ?? 0, fps: options.fps ?? 0 })
}
