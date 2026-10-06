import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { isAbsolute, resolve } from 'node:path'
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads'
import type { Box } from './types.js'

export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none'
export type ObjectPosition = { x: number; y: number }

const FITS = new Set<ObjectFit>(['fill', 'contain', 'cover', 'none'])

const NAMED_POSITION: Record<string, ObjectPosition> = {
  center: { x: 0.5, y: 0.5 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  'top-left': { x: 0, y: 0 },
  'top-right': { x: 1, y: 0 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-right': { x: 1, y: 1 },
  'left-top': { x: 0, y: 0 },
  'right-top': { x: 1, y: 0 },
  'left-bottom': { x: 0, y: 1 },
  'right-bottom': { x: 1, y: 1 },
}

const loaded = new Map<string, Canvas>()
const failed = new Set<string>()
let freshImageLoads = 0

/** 真正解码过的图片次数。已经在缓存里的不会再加。 */
export function freshImageLoadsCount(): number {
  return freshImageLoads
}

function percentOf(token: string): number | null {
  if (!token.endsWith('%')) return null
  const n = Number(token.slice(0, -1))
  if (!Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n / 100))
}

export function parseObjectFit(raw: string | undefined): { fit: ObjectFit; invalid: boolean } {
  if (raw == null || raw.trim() === '') return { fit: 'fill', invalid: false }
  const fit = raw.trim().toLowerCase() as ObjectFit
  if (FITS.has(fit)) return { fit, invalid: false }
  return { fit: 'fill', invalid: true }
}

/** 空值是 center。写错返回 null，由调用方警告并回退到 center。 */
export function parseObjectPosition(raw: string | undefined): ObjectPosition | null {
  if (raw == null || raw.trim() === '') return { x: 0.5, y: 0.5 }
  const text = raw.trim().toLowerCase()
  if (NAMED_POSITION[text]) return NAMED_POSITION[text]
  const parts = text.split(/[\s,]+/).filter(Boolean)
  if (parts.length !== 2) return null

  let x: number | undefined
  let y: number | undefined
  const free: string[] = []
  for (const part of parts) {
    if (part === 'left' || part === 'right') {
      if (x != null) return null
      x = part === 'left' ? 0 : 1
    } else if (part === 'top' || part === 'bottom') {
      if (y != null) return null
      y = part === 'top' ? 0 : 1
    } else {
      free.push(part)
    }
  }
  const take = (token: string): number | null => (token === 'center' ? 0.5 : percentOf(token))
  if (x == null && y == null) {
    if (free.length !== 2) return null
    const px = take(free[0]!)
    const py = take(free[1]!)
    if (px == null || py == null) return null
    return { x: px, y: py }
  }
  if (free.length > 1) return null
  if (free.length === 1) {
    const value = take(free[0]!)
    if (value == null) return null
    if (x == null) x = value
    else if (y == null) y = value
    else return null
  }
  return { x: x ?? 0.5, y: y ?? 0.5 }
}

/** 图片在内容盒子里的目标矩形。cover / none 可以画出盒子，绘制时再裁切。 */
export function fitImageRect(
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number,
  fit: ObjectFit,
  pos: ObjectPosition,
): { x: number; y: number; width: number; height: number } {
  if (boxW <= 0 || boxH <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  if (fit === 'fill' || imgW <= 0 || imgH <= 0) return { x: 0, y: 0, width: boxW, height: boxH }
  let width = imgW
  let height = imgH
  if (fit === 'contain' || fit === 'cover') {
    const scale = fit === 'cover' ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH)
    width = imgW * scale
    height = imgH * scale
  }
  return { x: (boxW - width) * pos.x, y: (boxH - height) * pos.y, width, height }
}

/** 裁进内容盒子之后的着墨，坐标相对元素外框。 */
export function imageInk(
  contentW: number,
  contentH: number,
  imgW: number,
  imgH: number,
  fit: ObjectFit,
  pos: ObjectPosition,
  offsetX: number,
  offsetY: number,
): Box {
  if (imgW <= 0 || imgH <= 0 || contentW <= 0 || contentH <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const dest = fitImageRect(contentW, contentH, imgW, imgH, fit, pos)
  const x = Math.max(0, dest.x)
  const y = Math.max(0, dest.y)
  const right = Math.min(contentW, dest.x + dest.width)
  const bottom = Math.min(contentH, dest.y + dest.height)
  if (right <= x || bottom <= y) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: offsetX + x, y: offsetY + y, width: right - x, height: bottom - y }
}

function resolveImageKey(src: string, baseDir: string): string {
  const trimmed = src.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || isAbsolute(trimmed)) return trimmed
  return resolve(baseDir, trimmed)
}

function downloadBytesSync(url: string): Buffer {
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const res = await fetch(${JSON.stringify(url)}); if (!res.ok) process.exit(2); process.stdout.write(new Uint8Array(await res.arrayBuffer()))`,
    ],
    { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

function imageBytesSync(key: string): Buffer {
  if (key.startsWith('data:')) {
    const comma = key.indexOf(',')
    const meta = key.slice(0, comma)
    const data = key.slice(comma + 1)
    if (meta.includes(';base64')) return Buffer.from(data, 'base64')
    return Buffer.from(decodeURIComponent(data))
  }
  if (/^https?:\/\//i.test(key)) return downloadBytesSync(key)
  return readFileSync(key)
}

const nap = new Int32Array(new SharedArrayBuffer(4))
let decoderPort: MessagePort | null = null
let decodeSeq = 0

function decoderPortOnce(): MessagePort {
  if (decoderPort) return decoderPort
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(
    `
    const { parentPort } = require('worker_threads')
    const { createCanvas, loadImage } = require('@napi-rs/canvas')
    parentPort.on('message', ({ port }) => {
      port.on('message', async ({ id, bytes }) => {
        try {
          const img = await loadImage(Buffer.from(bytes))
          const canvas = createCanvas(img.width, img.height)
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const data = ctx.getImageData(0, 0, img.width, img.height).data
          port.postMessage({ id, width: img.width, height: img.height, data })
        } catch (err) {
          port.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
        }
      })
    })
    `,
    { eval: true },
  )
  worker.postMessage({ port: port2 }, [port2])
  decoderPort = port1
  return port1
}

/** 在别的线程里解码，调用方一直等到像素就绪。同一进程只起一个解码线程。 */
function decodeImageSync(bytes: Buffer): Canvas {
  const port = decoderPortOnce()
  const id = ++decodeSeq
  port.postMessage({ id, bytes })
  const start = Date.now()
  while (Date.now() - start < 15000) {
    const got = receiveMessageOnPort(port)
    if (!got) {
      Atomics.wait(nap, 0, 0, 2)
      continue
    }
    const message = got.message as { id: number; width?: number; height?: number; data?: Uint8ClampedArray; error?: string }
    if (message.id !== id) continue
    if (message.error || message.width == null || message.height == null || !message.data) {
      throw new Error(message.error || '图片解码失败')
    }
    const canvas = createCanvas(message.width, message.height)
    const ctx = canvas.getContext('2d')
    const imageData = ctx.createImageData(message.width, message.height)
    imageData.data.set(message.data)
    ctx.putImageData(imageData, 0, 0)
    return canvas
  }
  throw new Error('图片解码超时')
}

/** 读进缓存。同一 src 在这个进程里只解码一次，失败也记住。 */
export function preloadLayerImageSync(src: string, baseDir: string): void {
  const key = resolveImageKey(src, baseDir)
  if (loaded.has(key) || failed.has(key)) return
  try {
    const canvas = decodeImageSync(imageBytesSync(key))
    if (canvas.width <= 0 && canvas.height <= 0) throw new Error('empty')
    loaded.set(key, canvas)
    freshImageLoads += 1
  } catch {
    failed.add(key)
  }
}

export function preloadLayerImagesSync(srcs: string[], baseDir: string): void {
  for (const src of srcs) {
    if (!src.trim()) continue
    preloadLayerImageSync(src, baseDir)
  }
}

/** 按路径、网址或 data URL 解码。同一 src 在一次进程里只加载一次。 */
export async function loadLayerImage(src: string, baseDir: string): Promise<Canvas> {
  const key = resolveImageKey(src, baseDir)
  const hit = loaded.get(key)
  if (hit) return hit
  preloadLayerImageSync(src, baseDir)
  const image = loaded.get(key)
  if (!image) throw new Error(`图片无法加载: ${src}`)
  return image
}

export type CachedImage = { status: 'ok'; image: Canvas } | { status: 'failed' } | { status: 'missing' }

/** 同步取已经准备好的图片。没预先加载是 missing，加载失败是 failed。 */
export function peekLayerImage(src: string, baseDir: string): CachedImage {
  const key = resolveImageKey(src, baseDir)
  const image = loaded.get(key)
  if (image) return { status: 'ok', image }
  if (failed.has(key)) return { status: 'failed' }
  return { status: 'missing' }
}

/** 渲染前或 canvas() 里把图片放进缓存。失败记下来，排版时再报 missing-image。 */
export async function preloadLayerImages(srcs: string[], baseDir: string): Promise<void> {
  preloadLayerImagesSync(srcs, baseDir)
}
