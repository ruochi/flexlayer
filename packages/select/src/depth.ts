import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Depth Anything V2 Small 的 4 位量化，Apache-2.0。大约 19MB。
 * 整数版在这个 CPU 运行时上跑不起来，fp16 大约 50MB，这里不用。
 */
export const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small'
export const DEPTH_DTYPE = 'q4f16'

type RawImageLike = {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  channels: number
  resize: (width: number, height: number) => Promise<RawImageLike>
}

type DepthOutput = { depth: RawImageLike }

type TransformersModule = {
  env: { cacheDir?: string }
  pipeline: (task: string, model: string, opts: { dtype: string }) => Promise<(image: RawImageLike) => Promise<DepthOutput>>
  RawImage: new (data: Uint8Array, width: number, height: number, channels: number) => RawImageLike
}

let transformers: Promise<TransformersModule> | null = null
let loaded: Promise<(image: RawImageLike) => Promise<DepthOutput>> | null = null

async function loadTransformers(): Promise<TransformersModule> {
  if (!transformers) {
    const name = '@huggingface/transformers'
    transformers = import(name).then((mod) => mod as TransformersModule).catch((err: unknown) => {
      transformers = null
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package|Cannot find module|@huggingface\/transformers/.test(message)) {
        throw new Error('没有安装 @huggingface/transformers。在 packages/select 执行 npm install，或 npm install @huggingface/transformers')
      }
      throw err
    })
  }
  return transformers
}

async function loadPipeline(mod: TransformersModule) {
  if (!loaded) {
    mod.env.cacheDir = join(homedir(), '.cache', 'flexlayer', 'models')
    loaded = mod.pipeline('depth-estimation', DEPTH_MODEL_ID, { dtype: DEPTH_DTYPE }).catch((err: unknown) => {
      loaded = null
      throw err
    })
  }
  return loaded
}

/** 放掉深度模型。修边要再载入抠图模型，两份会话叠在一起会把 900×1200 的进程撑爆。 */
export async function releaseDepth(): Promise<void> {
  const pending = loaded
  loaded = null
  if (!pending) return
  try {
    const pipe = await pending
    const dispose = (pipe as { dispose?: () => Promise<void> }).dispose
    if (dispose) await dispose.call(pipe)
  } catch {
    // 加载失败时没有会话要放。
  }
}

/** 远近图，和原图一样大。0 是最远，255 是最近。模型第一次用时下载到 ~/.cache/flexlayer/models。 */
export async function estimateDepth(rgba: Uint8ClampedArray, width: number, height: number): Promise<Uint8ClampedArray> {
  const mod = await loadTransformers()
  const pipe = await loadPipeline(mod)
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!
    rgb[j + 1] = rgba[i + 1]!
    rgb[j + 2] = rgba[i + 2]!
  }
  const out = await pipe(new mod.RawImage(rgb, width, height, 3))
  let depth = out.depth
  if (depth.width !== width || depth.height !== height) depth = await depth.resize(width, height)
  const values = new Uint8ClampedArray(width * height)
  const channels = depth.channels || 1
  if (channels === 1) values.set(depth.data.subarray(0, values.length))
  else for (let i = 0; i < values.length; i++) values[i] = depth.data[i * channels]!
  return values
}
