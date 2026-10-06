import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { FvgNode } from './parse.js'
import { renderFvg } from './render.js'
import type { FvgReport, RenderOptions } from './types.js'

export type FrameInput = {
  frame: number
  fps: number
  t: number
}

export type Composition = {
  id: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  component: (input: FrameInput) => FvgNode
}

export type RenderCompositionOptions = Pick<RenderOptions, 'scale' | 'baseDir' | 'fontsCacheDir' | 'meshEngine'>

export type RenderCompositionResult = {
  frames: Buffer[]
  reports: FvgReport[]
  contactSheet: Buffer
}

export type Extrapolate = 'clamp' | 'extend'

/** 线性映射。默认两端钳制，不外推。 */
export function interpolate(
  value: number,
  inputRange: [number, number],
  outputRange: [number, number],
  options?: { extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate },
): number {
  const [in0, in1] = inputRange
  const [out0, out1] = outputRange
  if (in0 === in1) return value <= in0 ? out0 : out1
  let progress = (value - in0) / (in1 - in0)
  const left = options?.extrapolateLeft ?? 'clamp'
  const right = options?.extrapolateRight ?? 'clamp'
  if (progress < 0 && left === 'clamp') progress = 0
  if (progress > 1 && right === 'clamp') progress = 1
  return out0 + progress * (out1 - out0)
}

export type SpringConfig = {
  mass?: number
  damping?: number
  stiffness?: number
}

/** 阻尼弹簧，从 0 趋近 1。`frame <= 0` 时为 0。 */
export function spring(args: { frame: number; fps: number; config?: SpringConfig }): number {
  if (!(args.fps > 0)) throw new Error('fps 必须大于 0')
  if (args.frame <= 0) return 0
  const mass = args.config?.mass ?? 1
  const damping = args.config?.damping ?? 10
  const stiffness = args.config?.stiffness ?? 100
  if (!(mass > 0) || !(stiffness > 0) || damping < 0) throw new Error('弹簧参数无效')
  const t = args.frame / args.fps
  const omega0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  let offset: number
  if (Math.abs(zeta - 1) < 1e-6) {
    offset = (1 + omega0 * t) * Math.exp(-omega0 * t)
  } else if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
    const decay = Math.exp(-zeta * omega0 * t)
    const b = (zeta * omega0) / omegaD
    offset = decay * (Math.cos(omegaD * t) + b * Math.sin(omegaD * t))
  } else {
    const disc = Math.sqrt(zeta * zeta - 1)
    const r1 = -omega0 * (zeta - disc)
    const r2 = -omega0 * (zeta + disc)
    const c1 = r2 / (r2 - r1)
    const c2 = 1 - c1
    offset = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t)
  }
  return 1 - offset
}

/**
 * 当前帧落在 `[from, from + durationInFrames)` 内时，用减去 `from` 后的局部时间调用 `render`。
 * 区间外返回 `null`，`h()` 会丢掉 `null` 子节点。
 */
export function sequence<T>(
  input: FrameInput,
  range: { from: number; durationInFrames: number },
  render: (local: FrameInput) => T | null,
): T | null {
  const localFrame = input.frame - range.from
  if (localFrame < 0 || localFrame >= range.durationInFrames) return null
  return render({
    frame: localFrame,
    fps: input.fps,
    t: localFrame / input.fps,
  })
}

const CONTACT_CELL_MAX = 480
const CONTACT_SHEET_MAX_WIDTH = 3840

/**
 * 把各帧 PNG 排成网格。列数约为帧数的平方根，单元格只缩小不放大，空白为白色。
 * 单元格最长边不超过 480px，整张宽度不超过 3840px。
 */
export async function contactSheetFromPngs(frames: Buffer[]): Promise<Buffer> {
  if (frames.length === 0) {
    const canvas = createCanvas(1, 1)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
    return canvas.toBuffer('image/png')
  }
  const images = await Promise.all(frames.map((frame) => loadImage(frame)))
  const srcW = images[0]!.width
  const srcH = images[0]!.height
  const columns = Math.ceil(Math.sqrt(frames.length))
  const rows = Math.ceil(frames.length / columns)
  const fit = Math.min(1, CONTACT_CELL_MAX / Math.max(srcW, srcH), CONTACT_SHEET_MAX_WIDTH / (columns * srcW))
  const cellW = Math.max(1, Math.round(srcW * fit))
  const cellH = Math.max(1, Math.round(srcH * fit))
  const canvas = createCanvas(columns * cellW, rows * cellH)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < images.length; i++) {
    const col = i % columns
    const row = Math.floor(i / columns)
    ctx.drawImage(images[i]!, col * cellW, row * cellH, cellW, cellH)
  }
  return canvas.toBuffer('image/png')
}

export async function renderComposition(
  comp: Composition,
  options: RenderCompositionOptions = {},
): Promise<RenderCompositionResult> {
  if (!(comp.fps > 0)) throw new Error('fps 必须大于 0')
  if (!(comp.durationInFrames >= 1) || !Number.isInteger(comp.durationInFrames)) {
    throw new Error('durationInFrames 至少为 1')
  }
  const frames: Buffer[] = []
  const reports: FvgReport[] = []
  for (let frame = 0; frame < comp.durationInFrames; frame++) {
    const t = frame / comp.fps
    const input: FrameInput = { frame, fps: comp.fps, t }
    const node = comp.component(input)
    const { png, report } = await renderFvg(node, {
      t,
      scale: options.scale,
      baseDir: options.baseDir,
      fontsCacheDir: options.fontsCacheDir,
      meshEngine: options.meshEngine,
    })
    frames.push(png)
    reports.push(report)
  }
  const contactSheet = await contactSheetFromPngs(frames)
  return { frames, reports, contactSheet }
}
