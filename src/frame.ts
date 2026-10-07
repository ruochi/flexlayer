import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas'
import type { FvgNode } from './parse.js'
import { prepareAssets } from './layout.js'
import { renderToCanvas } from './render.js'
import { setFontsCacheDir } from './fonts.js'
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

export type RenderCompositionOptions = Pick<RenderOptions, 'scale' | 'baseDir' | 'fontsCacheDir' | 'debug'>

export type RenderFramesOptions = RenderCompositionOptions & {
  /** 含这一帧。缺省为 0。 */
  from?: number
  /** 含这一帧。缺省为最后一帧。 */
  to?: number
  /** 缺省为 1。 */
  step?: number
  /** 缺省为 png。rgba 是不预乘的原始像素。 */
  format?: 'png' | 'rgba'
}

export type RenderedFrame = {
  frame: number
  t: number
  width: number
  height: number
  png?: Buffer
  rgba?: Buffer
  report: FvgReport
}

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

export type ContactSheet = {
  /** PNG 会先解码。调用次数不能超过创建时的 count。 */
  add(frame: Canvas | Buffer): Promise<void>
  toPng(): Buffer
}

function contactGrid(count: number, srcW: number, srcH: number) {
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  const fit = Math.min(1, CONTACT_CELL_MAX / Math.max(srcW, srcH), CONTACT_SHEET_MAX_WIDTH / (columns * srcW))
  const cellW = Math.max(1, Math.round(srcW * fit))
  const cellH = Math.max(1, Math.round(srcH * fit))
  return { columns, cellW, cellH }
}

function blankPng(): Buffer {
  const canvas = createCanvas(1, 1)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1, 1)
  return canvas.toBuffer('image/png')
}

/**
 * 逐帧往联系表里放。列数约为帧数的平方根，单元格只缩小不放大，空白为白色。
 * 单元格最长边不超过 480px，整张宽度不超过 3840px。
 */
export function createContactSheet(input: { count: number; width: number; height: number }): ContactSheet {
  if (!(input.count >= 1) || input.width <= 0 || input.height <= 0) {
    return {
      async add() {
        throw new Error('空的联系表不能再加帧')
      },
      toPng: blankPng,
    }
  }
  const { columns, cellW, cellH } = contactGrid(input.count, input.width, input.height)
  const rows = Math.ceil(input.count / columns)
  const canvas = createCanvas(columns * cellW, rows * cellH)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  let placed = 0
  return {
    async add(frame) {
      if (placed >= input.count) throw new Error('联系表已经放满')
      const col = placed % columns
      const row = Math.floor(placed / columns)
      const image = Buffer.isBuffer(frame) ? await loadImage(frame) : frame
      ctx.drawImage(image as Canvas, col * cellW, row * cellH, cellW, cellH)
      placed++
    },
    toPng() {
      return canvas.toBuffer('image/png')
    },
  }
}

/**
 * 把各帧 PNG 排成网格。列数约为帧数的平方根，单元格只缩小不放大，空白为白色。
 * 单元格最长边不超过 480px，整张宽度不超过 3840px。
 */
export async function contactSheetFromPngs(frames: Buffer[]): Promise<Buffer> {
  if (frames.length === 0) return blankPng()
  const first = await loadImage(frames[0]!)
  const sheet = createContactSheet({ count: frames.length, width: first.width, height: first.height })
  for (const frame of frames) await sheet.add(frame)
  return sheet.toPng()
}

function assertComposition(comp: Composition) {
  if (!(comp.fps > 0)) throw new Error('fps 必须大于 0')
  if (!(comp.durationInFrames >= 1) || !Number.isInteger(comp.durationInFrames)) {
    throw new Error('durationInFrames 至少为 1')
  }
}

function frameList(comp: Composition, options: RenderFramesOptions): number[] {
  assertComposition(comp)
  const last = comp.durationInFrames - 1
  const from = options.from ?? 0
  const to = options.to ?? last
  const step = options.step ?? 1
  if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(step) || step < 1 || from < 0 || to > last || from > to) {
    throw new Error(`帧范围 ${from}-${to} 步长 ${step} 超出 0-${last}`)
  }
  const frames: number[] = []
  for (let frame = from; frame <= to; frame += step) frames.push(frame)
  return frames
}

function canvasRgba(canvas: Canvas): Buffer {
  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  return Buffer.from(image.data)
}

/** 逐帧产出。`to` 含端点。字体和图片在第一帧之前准备一次。 */
export async function* renderFrames(
  comp: Composition,
  options: RenderFramesOptions = {},
): AsyncGenerator<RenderedFrame> {
  const baseDir = options.baseDir ?? process.cwd()
  if (options.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  // 字体、图片和 Yoga 在进程里只准备一次。后面的帧接着用，没见过的图再补上。
  await prepareAssets(null, baseDir)
  const format = options.format ?? 'png'
  for (const frame of frameList(comp, options)) {
    const t = frame / comp.fps
    const node = comp.component({ frame, fps: comp.fps, t })
    const { canvas, report } = await renderToCanvas(node, {
      t,
      frame,
      fps: comp.fps,
      scale: options.scale,
      debug: options.debug,
      baseDir,
      fontsCacheDir: options.fontsCacheDir,
    })
    const rendered: RenderedFrame = { frame, t, width: canvas.width, height: canvas.height, report }
    if (format === 'rgba') rendered.rgba = canvasRgba(canvas)
    else rendered.png = canvas.toBuffer('image/png')
    yield rendered
  }
}

export async function renderComposition(
  comp: Composition,
  options: RenderCompositionOptions = {},
): Promise<RenderCompositionResult> {
  assertComposition(comp)
  const scale = options.scale ?? 1
  const frames: Buffer[] = []
  const reports: FvgReport[] = []
  const sheet = createContactSheet({
    count: comp.durationInFrames,
    width: Math.max(1, Math.round(comp.width * scale)),
    height: Math.max(1, Math.round(comp.height * scale)),
  })
  for await (const rendered of renderFrames(comp, { ...options, format: 'png' })) {
    const png = rendered.png!
    frames.push(png)
    reports.push(rendered.report)
    await sheet.add(png)
  }
  return { frames, reports, contactSheet: sheet.toPng() }
}
