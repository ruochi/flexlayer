import { loadImage, type Image } from '@napi-rs/canvas'
import { isAbsolute, resolve } from 'node:path'
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

const cache = new Map<string, Promise<Image>>()
const loaded = new Map<string, Image>()
const failed = new Set<string>()

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

/** 按路径、网址或 data URL 解码。同一 src 在一次进程里只加载一次。 */
export async function loadLayerImage(src: string, baseDir: string): Promise<Image> {
  const key = resolveImageKey(src, baseDir)
  const hit = loaded.get(key)
  if (hit) return hit
  let pending = cache.get(key)
  if (!pending) {
    pending = loadImage(key)
      .then((image) => {
        loaded.set(key, image)
        failed.delete(key)
        return image
      })
      .catch((err: unknown) => {
        cache.delete(key)
        failed.add(key)
        throw err
      })
    cache.set(key, pending)
  }
  return pending
}

export type CachedImage = { status: 'ok'; image: Image } | { status: 'failed' } | { status: 'missing' }

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
  await Promise.all(
    srcs.map(async (src) => {
      if (!src.trim()) return
      try {
        await loadLayerImage(src, baseDir)
      } catch {
        failed.add(resolveImageKey(src, baseDir))
      }
    }),
  )
}
