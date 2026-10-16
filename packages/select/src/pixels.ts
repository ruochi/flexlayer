import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export async function readRgba(file: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const image = await loadImage(file)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, image.width, image.height).data
  return { rgba: new Uint8ClampedArray(data), width: image.width, height: image.height }
}

export function writePng(file: string, rgba: Uint8ClampedArray, width: number, height: number) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(width, height)
  image.data.set(rgba)
  ctx.putImageData(image, 0, 0)
  writeFileSync(file, canvas.toBuffer('image/png'))
}
