import { createCanvas, type Canvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'

type DrawCtx = CanvasRenderingContext2D & {
  drawImage(...args: unknown[]): void
  imageSmoothingEnabled: boolean
}
import { labelParts } from './bitmap.js'
import { paintLayerIsolated, rasterizeMask } from './paint.js'
import type { FvgDocument, LayerLayoutNode, LayoutNode, PreviewSpec } from './types.js'

const LABEL = 16

function findLayer(node: LayoutNode, id: string): LayerLayoutNode | undefined {
  if (node.kind === 'layer' && node.id === id) return node
  if (node.kind === 'layer' || node.kind === 'flex' || node.kind === 'group') {
    for (const child of node.children) {
      const found = findLayer(child, id)
      if (found) return found
    }
  }
  return undefined
}

function checker(ctx: DrawCtx, width: number, height: number) {
  const cell = 8
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#d8d8d8' : '#f4f4f4'
      ctx.fillRect(x, y, cell, cell)
    }
  }
}

function grid(ctx: DrawCtx, width: number, height: number) {
  const step = Math.max(width, height) > 400 ? 100 : 40
  ctx.save()
  ctx.strokeStyle = '#00b7d4'
  ctx.fillStyle = '#00b7d4'
  ctx.lineWidth = 1
  ctx.font = '11px sans-serif'
  ctx.beginPath()
  for (let x = 0; x <= width; x += step) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, height)
    ctx.fillText(String(x), x + 2, 12)
  }
  for (let y = step; y <= height; y += step) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(width, y + 0.5)
    ctx.fillText(String(y), 2, y - 2)
  }
  ctx.stroke()
  ctx.restore()
}

type Panel = { title: string; canvas: Canvas }

function panelOf(title: string, paint: (ctx: DrawCtx, width: number, height: number) => void, width: number, height: number): Panel {
  const canvas = createCanvas(width, height)
  paint(canvas.getContext('2d') as DrawCtx, width, height)
  return { title, canvas }
}

function edgePanels(layer: LayerLayoutNode, content: Canvas): Panel[] {
  if (!layer.mask?.length || layer.width <= 0 || layer.height <= 0) return []
  const raster = rasterizeMask(layer.mask, layer.width, layer.height, {
    feather: layer.maskFeather,
    invert: layer.maskInvert,
  })
  if (!raster) return []
  const { alpha, width, height, scale } = raster
  const soft = new Uint8ClampedArray(alpha.length)
  for (let i = 0; i < alpha.length; i++) soft[i] = alpha[i]! >= 8 && alpha[i]! <= 247 ? 255 : 0
  const parts = labelParts(soft, width, height, 128).slice(0, 3)
  return parts.map((part, index) => {
    const pad = 8
    const x = Math.max(0, part.box.x / scale - pad)
    const y = Math.max(0, part.box.y / scale - pad)
    const w = Math.min(layer.width - x, part.box.width / scale + pad * 2)
    const h = Math.min(layer.height - y, part.box.height / scale + pad * 2)
    const zoom = Math.min(4, 160 / Math.max(w, h, 1))
    const canvas = createCanvas(Math.max(1, Math.ceil(w * zoom)), Math.max(1, Math.ceil(h * zoom)))
    const ctx = canvas.getContext('2d') as DrawCtx
    ctx.imageSmoothingEnabled = true
    ctx.fillStyle = '#111111'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(content, x, y, w, h, 0, 0, canvas.width, canvas.height)
    return { title: `edge ${index + 1}`, canvas }
  })
}

function panelsFor(spec: PreviewSpec, layer: LayerLayoutNode): Panel[] {
  const width = Math.max(1, Math.ceil(layer.width))
  const height = Math.max(1, Math.ceil(layer.height))
  const plain = paintLayerIsolated(layer, false)
  const cut = paintLayerIsolated(layer, true)
  const raster = layer.mask?.length
    ? rasterizeMask(layer.mask, layer.width, layer.height, { feather: layer.maskFeather, invert: layer.maskInvert })
    : null
  const out: Panel[] = []
  for (const show of spec.show) {
    if (show === 'overlay') {
      out.push(
        panelOf(
          'overlay',
          (ctx) => {
            ctx.drawImage(plain, 0, 0)
            if (raster) {
              const red = ctx.getImageData(0, 0, width, height)
              for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                  const sx = Math.min(raster.width - 1, Math.floor(x * raster.scale))
                  const sy = Math.min(raster.height - 1, Math.floor(y * raster.scale))
                  const keep = raster.alpha[sy * raster.width + sx]! / 255
                  const i = (y * width + x) * 4
                  const cover = (1 - keep) * 0.55
                  red.data[i] = Math.round(red.data[i]! * (1 - cover) + 220 * cover)
                  red.data[i + 1] = Math.round(red.data[i + 1]! * (1 - cover))
                  red.data[i + 2] = Math.round(red.data[i + 2]! * (1 - cover))
                  red.data[i + 3] = 255
                }
              }
              ctx.putImageData(red, 0, 0)
            }
            grid(ctx, width, height)
          },
          width,
          height,
        ),
      )
    } else if (show === 'checker' || show === 'black' || show === 'white') {
      out.push(
        panelOf(
          show,
          (ctx) => {
            if (show === 'checker') checker(ctx, width, height)
            else {
              ctx.fillStyle = show === 'black' ? '#000000' : '#ffffff'
              ctx.fillRect(0, 0, width, height)
            }
            ctx.drawImage(cut, 0, 0)
          },
          width,
          height,
        ),
      )
    } else if (show === 'edges') {
      out.push(...edgePanels(layer, cut))
    }
  }
  return out
}

/** 把文档里的 `<preview>` 拼成一张图。没有 preview 时返回 null。 */
export function renderPreviewSheet(doc: FvgDocument): Canvas | null {
  if (!doc.previews?.length) return null
  const rows: Panel[][] = []
  for (const spec of doc.previews) {
    const layer = findLayer(doc.root, spec.of)
    if (!layer) continue
    const panels = panelsFor(spec, layer)
    if (panels.length) rows.push(panels)
  }
  if (rows.length === 0) return null
  const rowWidths = rows.map((row) => row.reduce((sum, panel) => sum + panel.canvas.width, 0))
  const width = Math.max(...rowWidths)
  const height = rows.reduce((sum, row) => sum + LABEL + Math.max(...row.map((panel) => panel.canvas.height)), 0)
  const sheet = createCanvas(Math.max(1, width), Math.max(1, height))
  const ctx = sheet.getContext('2d') as DrawCtx
  ctx.fillStyle = '#1b1b1b'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  let y = 0
  for (const row of rows) {
    ctx.fillStyle = '#f4ecdf'
    ctx.font = '12px sans-serif'
    let x = 0
    for (const panel of row) {
      ctx.fillText(panel.title, x + 4, y + 12)
      x += panel.canvas.width
    }
    y += LABEL
    x = 0
    const rowH = Math.max(...row.map((panel) => panel.canvas.height))
    for (const panel of row) {
      ctx.drawImage(panel.canvas, x, y)
      x += panel.canvas.width
    }
    y += rowH
  }
  return sheet
}
