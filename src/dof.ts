import { createCanvas } from '@napi-rs/canvas'
import type { DofSpec } from './types.js'
import { circleOfConfusionNative, compositeDof, planDepthOfField } from './rasterize-native.js'

/**
 * 薄透镜弥散圆。depth = focal - z，z 是镜头空间里朝观众为正的坐标。
 * aperture 是无限远处的半径。depth 趋近 0 时用 maxBlur 封顶。
 */
export function circleOfConfusion(focal: number, z: number, dof: DofSpec, sharp = false): number {
  return circleOfConfusionNative(focal, z, dof.aperture, dof.focus, dof.maxBlur, sharp)
}

export type DofImage = {
  pixels: Uint8ClampedArray
  width: number
  height: number
  /** 四边留出的像素。0 表示没糊，调用方继续用原来的画布。 */
  pad: number
}

/**
 * 糊单独一个物体。整张表面一起进各级高斯，再按每个像素自己的半径取样。
 * 切成深度条再叠会在斜面上留缝，被挡住的颜色也已经不在这张图里。
 * 多个物体从远到近各糊一次再叠，近处的糊边才盖住远处。
 */
export function applyDepthOfField(input: {
  pixels: Uint8ClampedArray
  width: number
  height: number
  depth: Float32Array
  sharp: Uint8Array
  focal: number
  dof: DofSpec
  pixelScale: number
}): DofImage {
  const { pixels, width, height, depth, sharp, focal, dof, pixelScale } = input
  const plan = planDepthOfField(
    pixels,
    width,
    height,
    depth,
    sharp,
    focal,
    dof.aperture,
    dof.focus,
    dof.maxBlur,
    pixelScale,
  )
  if (plan.pad === 0) return { pixels, width, height, pad: 0 }
  if (plan.uniform) {
    return {
      pixels: blurStraight(plan.base, plan.width, plan.height, plan.meanSigma),
      width: plan.width,
      height: plan.height,
      pad: plan.pad,
    }
  }
  const levels = plan.sigmas.map((sigma: number) => (sigma < 0.45 ? plan.base : blurStraight(plan.base, plan.width, plan.height, sigma)))
  return {
    pixels: compositeDof(plan.nearest, plan.coc, levels, plan.sigmas, width, height, plan.pad, plan.width, plan.height, pixelScale),
    width: plan.width,
    height: plan.height,
    pad: plan.pad,
  }
}

/** 画布模糊读回来的是直通颜色，调用方按直通叠回去。 */
function blurStraight(pixels: Uint8ClampedArray, width: number, height: number, sigma: number): Uint8ClampedArray {
  if (!(sigma >= 0.45)) return pixels
  const src = createCanvas(width, height)
  const sctx = src.getContext('2d')
  const image = sctx.createImageData(width, height)
  image.data.set(pixels)
  sctx.putImageData(image, 0, 0)
  const out = createCanvas(width, height)
  const octx = out.getContext('2d')
  octx.filter = `blur(${sigma.toFixed(3)}px)`
  octx.drawImage(src, 0, 0)
  return octx.getImageData(0, 0, width, height).data
}
