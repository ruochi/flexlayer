/**
 * Cycles Standalone 后端。
 *
 * 导出器写出场景 XML，这里把它交给外部 `cycles` 可执行文件跑完，再读回 PNG。
 * 二进制不随包分发：先看 `FLEXLAYER_CYCLES`，再看 PATH 上的 `cycles`。
 * 找不到二进制时报一条可照做的错，原生 draft / final 两条路完全不受影响。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { exportCyclesScene, type CyclesEngineOptions, type CyclesExport } from './cycles-export.js'
import type { LayerDocument } from './types.js'

export type CyclesRender = {
  png: Buffer
  width: number
  height: number
  /** 导出得到的场景统计，方便日志里核对。 */
  scene: Pick<CyclesExport, 'counts' | 'skipped'>
  /** 实际用掉的秒数。 */
  elapsedMs: number
  /** 二进制的绝对路径，日志用。 */
  binary: string
  /** 参与阴影合成的像素数。0 表示这次没有假地板。 */
}

export type CyclesRunOptions = CyclesEngineOptions & {
  /** 画布尺寸，缺省用文档尺寸。 */
  width?: number
  height?: number
  /** 超时，毫秒。缺省 30 分钟。 */
  timeoutMs?: number
  /** 传了就不再找二进制。 */
  binary?: string
  /** 保留临时目录，调试场景文件时用。 */
  keepFiles?: boolean
}

export class CyclesUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CyclesUnavailableError'
  }
}

/** 找 Cycles 可执行文件：环境变量优先，其次是 PATH。没有就返回 null。 */
export function findCyclesBinary(explicit?: string): string | null {
  const fromOption = explicit ?? process.env.FLEXLAYER_CYCLES
  if (fromOption && fromOption.trim() !== '') {
    const path = fromOption.trim()
    return existsSync(path) ? path : null
  }
  const name = process.platform === 'win32' ? 'cycles.exe' : 'cycles'
  const entries = (process.env.PATH ?? '').split(delimiter).filter((entry) => entry.length > 0)
  for (const entry of entries) {
    const candidate = join(entry, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function unavailableMessage(): string {
  return [
    '找不到 Cycles Standalone 的 cycles 可执行文件。',
    '它是独立渲染器，不需要装 Blender：在 flexlayer-render 里运行 `npm run build:cycles`，',
    '或自己 `git clone https://projects.blender.org/blender/cycles && make update && make`，',
    '然后用 FLEXLAYER_CYCLES 指到 install/cycles（或把 cycles 放进 PATH）。',
  ].join('')
}

/** 解析 PNG 的宽高，不做解码。只认 IHDR。 */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null
  const tag = bytes.toString('ascii', 12, 16)
  if (tag !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function runOnce(binary: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Cycles 渲染超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > 1 << 20) stdout = stdout.slice(-(1 << 20))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 1 << 20) stderr = stderr.slice(-(1 << 20))
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** 把导出好的场景写成文件、跑 Cycles、读回 PNG。 */
export async function renderCycles(doc: LayerDocument, options: CyclesRunOptions): Promise<CyclesRender> {
  const binary = findCyclesBinary(options.binary)
  if (!binary) throw new CyclesUnavailableError(unavailableMessage())

  const scene = exportCyclesScene(doc, options)
  const dir = await mkdtemp(join(tmpdir(), 'flexlayer-cycles-'))
  const scenePath = join(dir, 'scene.xml')
  const outPath = join(dir, 'out.png')
  const started = Date.now()
  try {
    await writeFile(scenePath, scene.xml, 'utf8')
    // 贴图在内存里，`image_texture` 要的是相对场景文件的磁盘路径，所以先落盘。
    for (const image of scene.images) {
      await writeFile(join(dir, image.name), image.bytes)
    }
    const renderOnce = async (sceneFile: string, target: string): Promise<Buffer> => {
      const args = [
        '--samples', String(Math.max(1, options.samples)),
        '--device', options.device,
        '--width', String(scene.width),
        '--height', String(scene.height),
        '--output', target,
        sceneFile,
      ]
      const result = await runOnce(binary, args, options.timeoutMs ?? 30 * 60 * 1000)
      if (result.code !== 0) {
        const tail = (result.stderr || result.stdout).trim().split('\n').slice(-8).join('\n')
        throw new Error(`Cycles 退出码 ${result.code}${tail ? `\n${tail}` : ''}`)
      }
      if (!existsSync(target)) {
        throw new Error('Cycles 没有写出图片。检查 --output 是否被场景文件覆盖。')
      }
      return readFile(target)
    }

    /* 假地板由 Cycles 的 shadow catcher 一趟渲完：`is_shadow_catcher` 的平面
     * 不进入可见通道，只把阴影比乘到背景上。以前那套「渲两遍相减」被删掉了，
     * 它靠两张图的亮度差反推阴影，接触处和地平线都不对，还得多渲一趟。 */
    const png = await renderOnce(scenePath, outPath)

    const size = pngSize(png) ?? { width: scene.width, height: scene.height }
    return {
      png,
      width: size.width,
      height: size.height,
      scene: { counts: scene.counts, skipped: scene.skipped },
      elapsedMs: Date.now() - started,
      binary: isAbsolute(binary) ? binary : join(process.cwd(), binary),
    }
  } finally {
    if (options.keepFiles) {
      console.error(`Cycles 场景保留在 ${dir}`)
    } else {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** 只导出、不渲染。调试场景或交给别的机器渲染时用。 */
export async function writeCyclesScene(
  doc: LayerDocument,
  target: string,
  options: CyclesEngineOptions & { width?: number; height?: number },
): Promise<CyclesExport> {
  const scene = exportCyclesScene(doc, options)
  const base = join(target, '..')
  await mkdir(base, { recursive: true })
  await writeFile(target, scene.xml, 'utf8')
  // 只导场景时贴图也要跟着走，否则拿这份 XML 去别处渲染会缺图。
  for (const image of scene.images) {
    await writeFile(join(base, image.name), image.bytes)
  }
  return scene
}
