import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 512 输入的轻量 ONNX。完整的 512 fp16 大约 470MB，解码器里的可变形卷积会同时摊开大约 3GB 的中间结果，
 * 900×1200 的图再叠着深度模型，进程会被系统杀掉。这一份大约 100MB，同一次前向的驻留大约 2GB。
 */
export const MODEL_ID = 'studioludens/birefnet-lite-512'

type RawImageLike = {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  channels: number
  resize: (width: number, height: number) => Promise<RawImageLike>
}

type TransformersModule = {
  env: { cacheDir?: string }
  AutoModel: {
    from_pretrained: (
      id: string,
      opts: { dtype: string; device?: string; session_options?: Record<string, unknown> },
    ) => Promise<{ (input: { input_image: unknown }): Promise<{ output_image: Array<{ sigmoid: () => { mul: (n: number) => { to: (dtype: string) => unknown } } }> }> }>
  }
  AutoProcessor: { from_pretrained: (id: string) => Promise<(image: RawImageLike) => Promise<{ pixel_values: unknown }>> }
  RawImage: {
    new (data: Uint8Array, width: number, height: number, channels: number): RawImageLike
    fromTensor: (tensor: unknown) => Promise<RawImageLike>
  }
}

let transformers: Promise<TransformersModule> | null = null
let loaded: Promise<{ model: Awaited<ReturnType<TransformersModule['AutoModel']['from_pretrained']>>; processor: Awaited<ReturnType<TransformersModule['AutoProcessor']['from_pretrained']>> }> | null = null

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

async function loadModel(mod: TransformersModule) {
  if (!loaded) {
    mod.env.cacheDir = join(homedir(), '.cache', 'flexlayer', 'models')
    loaded = Promise.all([
      mod.AutoModel.from_pretrained(MODEL_ID, {
        dtype: 'fp16',
        device: 'cpu',
        // 关掉内存池，前向结束后把中间结果还给系统。线程收成 1，避免每个线程再复制一份工作区。
        session_options: {
          enableCpuMemArena: false,
          intraOpNumThreads: 1,
          interOpNumThreads: 1,
          executionMode: 'sequential',
        },
      }),
      mod.AutoProcessor.from_pretrained(MODEL_ID),
    ])
      .then(([model, processor]) => ({ model, processor }))
      .catch((err: unknown) => {
        loaded = null
        throw err
      })
  }
  return loaded
}

/** BiRefNet 抠一张图，返回和原图一样大的 alpha，0 到 255。模型第一次用时下载到 ~/.cache/flexlayer/models。 */
export async function birefnetSegment(rgba: Uint8ClampedArray, width: number, height: number): Promise<Uint8ClampedArray> {
  const mod = await loadTransformers()
  const { model, processor } = await loadModel(mod)
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!
    rgb[j + 1] = rgba[i + 1]!
    rgb[j + 2] = rgba[i + 2]!
  }
  const image = new mod.RawImage(rgb, width, height, 3)
  const { pixel_values } = await processor(image)
  const { output_image } = await model({ input_image: pixel_values })
  const tensor = output_image[0]!.sigmoid().mul(255).to('uint8')
  let mask = await mod.RawImage.fromTensor(tensor)
  if (mask.width !== width || mask.height !== height) mask = await mask.resize(width, height)
  const alpha = new Uint8ClampedArray(width * height)
  const channels = mask.channels || 1
  if (channels === 1) {
    alpha.set(mask.data.subarray(0, alpha.length))
  } else {
    for (let i = 0; i < alpha.length; i++) alpha[i] = mask.data[i * channels]!
  }
  return alpha
}
