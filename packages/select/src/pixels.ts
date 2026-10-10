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

/** 白底，alpha 就是选区。alpha 通道和亮度通道读出来是同一个值。 */
export function maskRgba(alpha: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(alpha.length * 4)
  for (let i = 0; i < alpha.length; i++) {
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = alpha[i]!
  }
  return rgba
}

/** 灰度值就是编号，0 是背景。不透明，给 pick 用最近邻读。 */
export function regionsRgba(ids: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(ids.length * 4)
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    rgba[i * 4] = id
    rgba[i * 4 + 1] = id
    rgba[i * 4 + 2] = id
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

/** 黑底，alpha 是影子的强度。 */
export function shadowRgba(alpha: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(alpha.length * 4)
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i]!
  return rgba
}
