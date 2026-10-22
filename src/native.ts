import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const requireNative = createRequire(import.meta.url)
const vendored = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'flexlayer-render')

export type NativePaintIssue = {
  level: string
  code: string
  path: string
  message: string
  hint: string
}

export type NativeRenderOut = {
  png?: Buffer | null
  rgba?: Buffer | null
  width: number
  height: number
  issues: NativePaintIssue[]
}

/** 预编译渲染器交给 Node 的入口。`render` 在插件里画完，只交回像素。 */
export type NativeRender = {
  engine: () => string
  solidPng: (width: number, height: number, color: string) => Buffer
  render?: (
    json: string,
    images: Array<{ id: string; bytes: Buffer }>,
    rasters: Array<{ id: string; width: number; height: number; rgba: Buffer }>,
    wantRgba: boolean,
  ) => NativeRenderOut
  renderFrames?: (
    frames: Array<{
      json: string
      images?: Array<{ id: string; bytes: Buffer }>
      rasters?: Array<{ id: string; width: number; height: number; rgba: Buffer }>
    }>,
    wantRgba: boolean,
  ) => NativeRenderOut[]
  previewSheet?: (
    json: string,
    images: Array<{ id: string; bytes: Buffer }>,
    rasters: Array<{ id: string; width: number; height: number; rgba: Buffer }>,
  ) => NativeRenderOut
  contactSheet?: (pngs: Buffer[]) => Buffer
}

/**
 * 加载预编译渲染器。
 * `FLEXLAYER_RENDER` 指向包目录或 `.node` 文件时只试那一处。
 * 没设置时先试本包里的 `native/flexlayer-render`，再试包名 `flexlayer-render` 和 `@ruochi/flexlayer-render`。
 * 找不到、加载失败、或没有 `engine` 和 `solidPng` 时返回 null。
 */
export function loadNativeRender(): NativeRender | null {
  const fromEnv = process.env.FLEXLAYER_RENDER
  if (fromEnv) return tryLoad(fromEnv)
  return tryLoad(vendored) ?? tryLoad('flexlayer-render') ?? tryLoad('@ruochi/flexlayer-render')
}

function tryLoad(spec: string): NativeRender | null {
  try {
    return asNative(requireNative(spec))
  } catch {
    try {
      return asNative(requireNative(join(spec, 'index.cjs')))
    } catch {
      return null
    }
  }
}

function asNative(mod: unknown): NativeRender | null {
  if (!mod || typeof mod !== 'object') return null
  const engine = (mod as { engine?: unknown }).engine
  const solidPng = (mod as { solidPng?: unknown }).solidPng
  if (typeof engine !== 'function' || typeof solidPng !== 'function') return null
  return mod as NativeRender
}
