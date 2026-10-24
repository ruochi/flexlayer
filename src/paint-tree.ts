import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { fontFileFor, registeredFontFiles } from './fonts.js'
import { checkMarkPath, markStandIn } from './glyph.js'
import { readImageBytes } from './image.js'
import { absoluteNodeMatrix, isIdentity, originOffset } from './matrix.js'
import { ownsMeshScene, renderMeshLayer, type MeshRaster } from './mesh.js'
import { meshVisibleRect } from './paint.js'
import type { NativeRender } from './native.js'
import { contentInsets } from './style.js'
import { planLinePaint, runOpacity, segmentNeedsPaint } from './text.js'
import type { LayerDocument, LayerLayoutNode, LayoutNode, TextLayoutNode } from './types.js'

export type PackedImage = { id: string; bytes: Buffer }
export type PackedRaster = { id: string; width: number; height: number; rgba: Buffer }

export type PackedPaint = {
  json: string
  images: PackedImage[]
  rasters: PackedRaster[]
}

type PackOptions = {
  scale: number
  debug: boolean
  frame: number
  baseDir: string
  meshSamples?: 1 | 2 | 4
  native: NativeRender
}

/**
 * 把排版结果收成插件能画的纯数据。
 * 图片是原文字节，脚本画布是 RGBA，网格帧也是 RGBA。字体只传文件路径。
 */
export function packPaintTree(doc: LayerDocument, options: PackOptions): PackedPaint {
  const images: PackedImage[] = []
  const rasters: PackedRaster[] = []
  const fonts = new Map<string, string>()
  const imageIds = new Map<string, string>()
  let imageSeq = 0
  let rasterSeq = 0

  const rememberFont = (family: string | undefined, weight: number | undefined) => {
    if (!family) return
    try {
      const file = fontFileFor(family, weight ?? 400)
      fonts.set(family, file.path)
      fonts.set(file.family, file.path)
    } catch {
      // 缺字体时绘制回退到已加载的第一款。
    }
  }

  const walkFonts = (node: LayoutNode) => {
    if (node.kind === 'text') {
      for (const line of node.textLayout.lines) {
        for (const seg of line.segments) rememberFont(seg.style.fontFamily, seg.style.fontWeight)
      }
    }
    if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
      for (const child of node.children) walkFonts(child)
      if (node.kind === 'layer' && node.mask) for (const child of node.mask) walkFonts(child)
    }
  }
  walkFonts(doc.root)
  for (const file of registeredFontFiles()) fonts.set(file.family, file.path)

  const takeImage = (src: string, naturalWidth: number, naturalHeight: number) => {
    const cached = imageIds.get(src)
    if (cached) return { id: cached, naturalWidth, naturalHeight }
    const bytes = readImageBytes(src, options.baseDir)
    const id = `img${++imageSeq}`
    imageIds.set(src, id)
    images.push({ id, bytes })
    return { id, naturalWidth, naturalHeight }
  }

  const takeRaster = (canvas: Canvas) => {
    const id = `ras${++rasterSeq}`
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    rasters.push({ id, width: canvas.width, height: canvas.height, rgba: Buffer.from(data.data) })
    return id
  }

  const rasterPlane = (node: LayoutNode): MeshRaster => {
    const flat = flattenPlane(node)
    const width = Math.max(1, Math.ceil(flat.width || 1))
    const height = Math.max(1, Math.ceil(flat.height || 1))
    const host = flat.kind === 'layer' ? flat : hostOf(flat, width, height)
    const root = packNode(host, true)
    const sub = JSON.stringify({
      width,
      height,
      background: 'transparent',
      scale: 1,
      debug: false,
      frame: options.frame,
      fonts: [...fonts.entries()].map(([family, path]) => ({ family, path })),
      root,
    })
    const out = options.native.render?.(sub, images, rasters, true)
    const canvas = createCanvas(Math.max(1, out?.width || width), Math.max(1, out?.height || height))
    if (out?.rgba && out.rgba.length >= canvas.width * canvas.height * 4) {
      const ctx = canvas.getContext('2d')
      const image = ctx.createImageData(canvas.width, canvas.height)
      image.data.set(out.rgba)
      ctx.putImageData(image, 0, 0)
    }
    return {
      canvas,
      pad: 0,
      logicalWidth: node.width,
      logicalHeight: node.height,
      localX: 0,
      localY: 0,
    }
  }

  const packNode = (node: LayoutNode, skipMesh: boolean): Record<string, unknown> => {
    const out: Record<string, unknown> = {
      kind: node.kind,
      path: node.path,
      ...(node.id ? { id: node.id } : {}),
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      opacity: node.opacity,
      ...(node.maskOp ? { maskOp: node.maskOp } : {}),
      rotate: node.rotate,
      rotateX: node.rotateX ?? 0,
      rotateY: node.rotateY ?? 0,
      z: node.z ?? 0,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
    }
    const origin = originOffset(node.origin, node.width, node.height)
    out.originX = origin.x
    out.originY = origin.y
    const pose = absoluteNodeMatrix(node)
    if (!isIdentity(pose)) out.pose = [pose.a, pose.b, pose.c, pose.d, pose.e, pose.f]
    if (node.overflow) out.overflow = node.overflow
    if (node.background) out.background = paintValue(node.background)
    if (node.border) out.border = node.border
    if (node.borderRadius) out.borderRadius = node.borderRadius
    if (node.corners) out.corners = node.corners
    if (node.padding) out.padding = node.padding
    if (node.blend) out.blend = node.blend
    if (node.blur) out.blur = node.blur
    if (node.backdropBlur) out.backdropBlur = node.backdropBlur
    if (node.glass) out.glass = node.glass
    if (node.noise) out.noise = node.noise
    if (node.overlay) out.overlay = node.overlay
    if (node.grade) out.grade = node.grade
    if (node.kind === 'layer' && node.gradeMask) out.gradeMask = node.gradeMask
    if (node.shadow) out.shadow = node.shadow
    if (node.shadowList) out.shadowList = node.shadowList
    if (node.glow) out.glow = node.glow
    if (node.innerShadow) out.innerShadow = node.innerShadow
    if (node.innerShadowList) out.innerShadowList = node.innerShadowList
    if (node.innerGlow) out.innerGlow = node.innerGlow
    if (node.inkStroke) out.inkStroke = node.inkStroke
    if (node.colorFilter?.length) out.colorFilters = node.colorFilter
    if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'shape' || node.kind === 'text' || node.kind === 'image') {
      if (node.backdropFilter?.length) out.backdropFilter = node.backdropFilter
    }
    if (node.kind === 'shape') {
      out.shape = node.shape
      out.fill = paintValue(node.fill)
      out.stroke = paintValue(node.stroke)
      out.strokeWidth = node.strokeWidth
      if (node.rx != null) out.rx = node.rx
      if (node.ry != null) out.ry = node.ry
      if (node.r != null) out.r = node.r
      if (node.rxEllipse != null) out.rxEllipse = node.rxEllipse
      if (node.dash) out.dash = node.dash
      if (node.dashOffset != null) out.dashOffset = node.dashOffset
    } else if (node.kind === 'line') {
      out.geometry = node.geometry
      out.fill = paintValue(node.fill)
      out.stroke = paintValue(node.stroke)
      out.strokeWidth = node.strokeWidth
      if (node.strokeLinecap) out.strokeLinecap = node.strokeLinecap
      if (node.strokeLinejoin) out.strokeLinejoin = node.strokeLinejoin
      if (node.dash) out.dash = node.dash
      if (node.dashOffset != null) out.dashOffset = node.dashOffset
      if (node.attr['fill-rule']) out.attr = { 'fill-rule': node.attr['fill-rule'] }
    } else if (node.kind === 'text') {
      out.textDraws = textDraws(node)
      out.inlines = (node.inlines ?? []).map((image) => packNode({ ...image, x: node.x + image.x, y: node.y + image.y }, true))
    } else if (node.kind === 'image') {
      const src = node.attr.src
      if (src) {
        try {
          const naturalW = node.bitmap && 'width' in node.bitmap ? node.bitmap.width : node.width
          const naturalH = node.bitmap && 'height' in node.bitmap ? node.bitmap.height : node.height
          const taken = takeImage(src, naturalW, naturalH)
          out.imageId = taken.id
          out.naturalWidth = taken.naturalWidth
          out.naturalHeight = taken.naturalHeight
        } catch {
          // 缺图已经在排版报告里。
        }
      }
      out.objectFit = node.objectFit
      out.objectPosition = node.objectPosition
      if (node.maskPick) out.maskPick = node.maskPick
      if (node.maskChannel) out.maskChannel = node.maskChannel
    } else if (node.kind === 'canvas' && node.bitmap) {
      out.rasterId = takeRaster(node.bitmap)
    } else if (node.kind === 'mesh' || node.kind === 'ground') {
      const fill = node.kind === 'mesh' ? node.fill : node.fill
      if (fill) out.fill = paintValue(fill)
    } else if (node.kind === 'group') {
      out.svg = node.svg
      out.children = node.children.map((child) => packNode(child, skipMesh))
    } else if (node.kind === 'layer' || node.kind === 'flex') {
      if (node.kind === 'layer') {
        if (node.view) out.view = node.view
        if (node.perspective != null) out.perspective = node.perspective
        if (node.vanishX) out.vanishX = node.vanishX
        if (node.vanishY) out.vanishY = node.vanishY
        if (node.maskFeather) out.maskFeather = node.maskFeather
        if (node.maskInvert) out.maskInvert = true
        if (node.mask?.length) out.mask = node.mask.map((child) => packNode(child, true))
        if (!skipMesh && options.native.render && (ownsMeshScene(node) || node.dof)) {
          const clip = meshVisibleRect(doc.width, doc.height, doc.root, node)
          const frame = renderMeshLayer(node, options.scale, rasterPlane, { samples: options.meshSamples, clip })
          if (frame && frame.width > 0 && frame.height > 0) {
            out.meshFrame = {
              rasterId: takeRaster(frame.canvas),
              x: frame.x,
              y: frame.y,
              width: frame.width,
              height: frame.height,
            }
          }
        }
      }
      if (!out.meshFrame) out.children = node.children.map((child) => packNode(child, skipMesh))
    }
    return out
  }

  const root = packNode(doc.root, false)
  return {
    json: JSON.stringify({
      width: doc.width,
      height: doc.height,
      background: doc.background,
      scale: options.scale,
      debug: options.debug,
      frame: options.frame,
      fonts: [...fonts.entries()].map(([family, path]) => ({ family, path })),
      root,
    }),
    images,
    rasters,
  }
}

function paintValue(value: string | null | undefined): string | undefined {
  if (value == null) return undefined
  return value
}

function textDraws(node: TextLayoutNode) {
  const draws: Array<Record<string, unknown>> = []
  const inset = contentInsets(node.padding, node.border)
  const contentX = node.x + inset.left
  const contentY = node.y + inset.top
  const innerW = node.width - inset.left - inset.right
    for (const line of node.textLayout.lines) {
    let offsetX = 0
    if (node.textAlign === 'center') offsetX = (innerW - line.width) / 2
    if (node.textAlign === 'right') offsetX = innerW - line.width
    const lineTop = contentY + line.y
    for (let index = 0; index < line.segments.length; ) {
      const seg = line.segments[index]!
      if (!segmentNeedsPaint(seg.style)) {
        const glyphRun = runSpan(line.segments, index, (style) => style.fill?.trim() || style.color, contentX, offsetX, lineTop, line.height)
        const backgroundRun = runSpan(line.segments, index, (style) => style.background, contentX, offsetX, lineTop, line.height)
        const color = seg.style.fill ?? seg.style.color
        const box = textPaintBox(node, color, glyphRun)
        draws.push({
          ...plainDraw(seg, contentX + offsetX + seg.x, contentY + line.baselineY, line.y, line.height, contentY),
          ...glyphPathField(seg.text, seg.style),
          paintX: box.x,
          paintY: box.y,
          paintW: box.width,
          paintH: box.height,
          bgPaintX: backgroundRun.x,
          bgPaintY: backgroundRun.y,
          bgPaintW: backgroundRun.width,
          bgPaintH: backgroundRun.height,
        })
        index += 1
        continue
      }
      let end = index + 1
      while (end < line.segments.length && segmentNeedsPaint(line.segments[end]!.style)) end += 1
      const groups = planLinePaint(line.segments.slice(index, end), line.baselineY, line.y, line.height)
      const ox = contentX + offsetX
      for (const group of groups) {
        for (const piece of group.pieces) {
          const background = piece.style.background
          draws.push({
            text: piece.text,
            ...glyphPathField(piece.text, piece.style),
            origin: [ox, contentY],
            matrix: group.moves ? [group.matrix.a, group.matrix.b, group.matrix.c, group.matrix.d, group.matrix.e, group.matrix.f] : undefined,
            x: piece.x,
            baseline: line.baselineY,
            width: piece.width,
            fontFamily: piece.style.fontFamily,
            fontSize: piece.style.fontSize,
            fontWeight: piece.style.fontWeight,
            color: paintValue(piece.style.fill ?? piece.style.color),
            letterSpacing: piece.style.letterSpacing ?? 0,
            underline: piece.style.underline === true,
            opacity: runOpacity(piece.style),
            background: background && background !== 'transparent' && background !== 'none' ? paintValue(background) : undefined,
            bgX: piece.x,
            bgY: line.y,
            bgW: piece.width,
            bgH: line.height,
          })
        }
      }
      index = end
    }
  }
  return draws
}

function samePaint(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim() === (b ?? '').trim()
}

type PaintBox = { x: number; y: number; width: number; height: number }

/** 写在文字盒子上的 fill 按整段盒子取样；行内自己的 fill 用同一颜料连在一起的那一段。 */
function textPaintBox(node: TextLayoutNode, paint: string, fragment: PaintBox): PaintBox {
  const declared = node.style.fill?.trim()
  if (declared && samePaint(declared, paint) && node.width > 0 && node.height > 0) {
    return { x: node.x, y: node.y, width: node.width, height: node.height }
  }
  return fragment
}

function runSpan(
  segments: TextLayoutNode['textLayout']['lines'][number]['segments'],
  index: number,
  valueAt: (style: TextLayoutNode['textLayout']['lines'][number]['segments'][number]['style']) => string | undefined,
  contentX: number,
  offsetX: number,
  lineTop: number,
  lineHeight: number,
): PaintBox {
  const value = valueAt(segments[index]!.style)
  let start = index
  while (start > 0 && samePaint(valueAt(segments[start - 1]!.style), value)) start--
  let end = index + 1
  while (end < segments.length && samePaint(valueAt(segments[end]!.style), value)) end++
  let minX = Infinity
  let maxX = -Infinity
  for (let i = start; i < end; i++) {
    const x = contentX + offsetX + segments[i]!.x
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x + segments[i]!.width)
  }
  const left = Number.isFinite(minX) ? minX : contentX + offsetX
  const right = Number.isFinite(maxX) ? maxX : left + 1
  return { x: left, y: lineTop, width: Math.max(right - left, 1), height: Math.max(lineHeight, 1) }
}

function glyphPathField(
  text: string,
  style: { fontFamily: string; fontWeight: number; fontSize: number },
): { glyphPath?: string } {
  if (text !== '\u2713' || !markStandIn(text, style.fontFamily, style.fontWeight)?.check) return {}
  return { glyphPath: checkMarkPath(style.fontSize).d }
}

function plainDraw(
  seg: TextLayoutNode['textLayout']['lines'][number]['segments'][number],
  x: number,
  baseline: number,
  lineY: number,
  lineHeight: number,
  contentY: number,
) {
  const background = seg.style.background
  return {
    text: seg.text,
    x,
    baseline,
    width: seg.width,
    fontFamily: seg.style.fontFamily,
    fontSize: seg.style.fontSize,
    fontWeight: seg.style.fontWeight,
    color: paintValue(seg.style.fill ?? seg.style.color),
    letterSpacing: seg.style.letterSpacing ?? 0,
    underline: seg.style.underline === true,
    opacity: runOpacity(seg.style),
    background: background && background !== 'transparent' && background !== 'none' ? paintValue(background) : undefined,
    bgX: x,
    bgY: contentY + lineY,
    bgW: seg.width,
    bgH: lineHeight,
  }
}

function flattenPlane(node: LayoutNode): LayoutNode {
  return { ...node, x: 0, y: 0, rotate: 0, rotateX: 0, rotateY: 0, z: 0, scaleX: 1, scaleY: 1, motion: undefined }
}

function hostOf(node: LayoutNode, width: number, height: number): LayerLayoutNode {
  return {
    ...node,
    kind: 'layer',
    tag: 'layer',
    x: 0,
    y: 0,
    width,
    height,
    children: [flattenPlane(node)],
    perspective: undefined,
    mask: undefined,
  } as LayerLayoutNode
}
