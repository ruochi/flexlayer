import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GlobalFonts } from '@napi-rs/canvas'

export const DEFAULT_FONT_FAMILY = 'ChillDuanSans'
const DEFAULT_FONT_URL =
  'https://banling1.oss-cn-beijing.aliyuncs.com/weixin/dc/fonts/ChillDuanSansVF.ttf'
const DEFAULT_FONT_FILE = 'ChillDuanSansVF.ttf'

const registered = new Set<string>()

let cacheDirOverride: string | undefined

export function setFontsCacheDir(dir: string | undefined): void {
  cacheDirOverride = dir
}

export function getFontsCacheDir(): string {
  return cacheDirOverride ?? join(homedir(), '.cache', 'flexlayer', 'fonts')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function download(url: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`字体下载失败 ${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
}

export async function ensureDefaultFont(): Promise<string> {
  const cache = getFontsCacheDir()
  const dest = join(cache, DEFAULT_FONT_FILE)
  if (!(await fileExists(dest))) {
    await download(DEFAULT_FONT_URL, dest)
  }
  registerFontPath(DEFAULT_FONT_FAMILY, dest)
  return dest
}

export function registerFontPath(family: string, filePath: string): void {
  if (registered.has(family)) return
  GlobalFonts.registerFromPath(filePath, family)
  registered.add(family)
}

export async function resolveFontSrc(src: string, baseDir: string): Promise<string> {
  const trimmed = src.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 16)
    const ext = trimmed.match(/\.(ttf|otf|woff2?)(\?|$)/i)?.[1] ?? 'ttf'
    const dest = join(getFontsCacheDir(), `${hash}.${ext}`)
    if (!(await fileExists(dest))) await download(trimmed, dest)
    return dest
  }
  const local = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  if (!(await fileExists(local))) throw new Error(`字体文件不存在: ${local}`)
  return local
}

export async function registerFontsFromDocument(
  fontNodes: Array<{ family: string; src: string }>,
  baseDir: string,
): Promise<void> {
  await ensureDefaultFont()
  for (const f of fontNodes) {
    const path = await resolveFontSrc(f.src, baseDir)
    registerFontPath(f.family, path)
  }
}

type FontFace = { file: string; weight: number; url: string; registeredAs: string }

type BuiltinFont = { cssFamily: string; faces: FontFace[] }

const SONG: BuiltinFont = {
  cssFamily: 'Song',
  faces: [
    {
      file: 'NotoSerifSC-400.woff',
      weight: 400,
      registeredAs: 'Song',
      url: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.8/files/noto-serif-sc-chinese-simplified-400-normal.woff',
    },
    {
      file: 'NotoSerifSC-700.woff',
      weight: 700,
      registeredAs: 'SongBold',
      url: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.8/files/noto-serif-sc-chinese-simplified-700-normal.woff',
    },
  ],
}

const KAI: BuiltinFont = {
  cssFamily: 'Kai',
  faces: [
    {
      file: 'LXGWWenKai-Regular.ttf',
      weight: 400,
      registeredAs: 'Kai',
      url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.330/LXGWWenKai-Regular.ttf',
    },
    {
      file: 'LXGWWenKai-Bold.ttf',
      weight: 700,
      registeredAs: 'KaiBold',
      url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.330/LXGWWenKai-Bold.ttf',
    },
  ],
}

const BRUSH: BuiltinFont = {
  cssFamily: 'Brush',
  faces: [
    {
      file: 'MaShanZheng-Regular.woff',
      weight: 400,
      registeredAs: 'Brush',
      url: 'https://cdn.jsdelivr.net/npm/@fontsource/ma-shan-zheng@5.2.8/files/ma-shan-zheng-chinese-simplified-400-normal.woff',
    },
  ],
}

const BUILTIN_FONTS = [SONG, KAI, BRUSH]

const FONT_ALIASES: Record<string, BuiltinFont> = {}
for (const font of BUILTIN_FONTS) {
  FONT_ALIASES[font.cssFamily.toLowerCase()] = font
}
for (const name of ['sourcehanserif', 'notoserifsc', 'noto serif sc', '宋体', '思源宋体']) FONT_ALIASES[name] = SONG
for (const name of ['lxgwwenkai', 'wenkai', '楷体', '霞鹜文楷']) FONT_ALIASES[name] = KAI
for (const name of ['mashanzheng', '书法', '毛笔']) FONT_ALIASES[name] = BRUSH

export function builtinFont(family: string): BuiltinFont | undefined {
  return FONT_ALIASES[family.trim().toLowerCase()]
}

function isVariableFamily(family: string): boolean {
  const norm = family.trim().toLowerCase()
  return norm === 'chillduansans' || norm.includes('chillduan')
}

function nearestFace(font: BuiltinFont, weight: number): FontFace {
  return font.faces.reduce((best, face) => (Math.abs(face.weight - weight) < Math.abs(best.weight - weight) ? face : best))
}

/** 可变字体保留字重。内置宋体、楷体按最近的字重文件选，书法只有一档。其它静态字体按 400。 */
export function effectiveFontWeight(family: string, weight: number): number {
  if (isVariableFamily(family)) return weight
  const builtin = builtinFont(family)
  if (builtin) return nearestFace(builtin, weight).weight
  return 400
}

/**
 * 画布的 font 简写只认 100–900 的整百。
 * 450 会被当成字号，测量宽高跟着变成十几倍，排版就散了。
 * 精确字重另写在 wght 轴上。
 */
function canvasFontWeight(weight: number): number {
  const snapped = Math.round(weight / 100) * 100
  return Math.min(900, Math.max(100, snapped))
}

export function buildFontString(family: string, weight: number, sizePx: number): string {
  const builtin = builtinFont(family)
  if (builtin) {
    const face = nearestFace(builtin, weight)
    return `400 ${sizePx}px ${face.registeredAs}, ${DEFAULT_FONT_FAMILY}, sans-serif`
  }
  const w = canvasFontWeight(effectiveFontWeight(family, weight))
  return `${w} ${sizePx}px ${family}, ${DEFAULT_FONT_FAMILY}, sans-serif`
}

const WGHT_TAG = 0x77676874
const axisCache = new Map<string, { min: number; max: number } | null>()

/** 可变字体的 wght 轴。静态字体返回 null。字体还没注册时不缓存，避免第一次测量锁死。 */
function wghtAxis(family: string): { min: number; max: number } | null {
  const key = family.trim()
  if (axisCache.has(key)) return axisCache.get(key) ?? null
  if (!GlobalFonts.has(key)) return null
  let axis: { min: number; max: number } | null = null
  try {
    if (GlobalFonts.hasVariations(key, 400, 5, 0)) {
      const found = GlobalFonts.getVariationAxes(key, 400, 5, 0).find((item) => item.tag === WGHT_TAG)
      if (found) axis = { min: found.min, max: found.max }
    }
  } catch {
    axis = null
  }
  axisCache.set(key, axis)
  return axis
}

/**
 * 只写 `ctx.font` 的数字字重时，可变字体会被收成常规和粗体两档。
 * 这里把字重写进 wght 轴，测量和绘制共用。
 */
export function applyCanvasFont(
  ctx: { font: string; fontVariationSettings: string },
  family: string,
  weight: number,
  sizePx: number,
): void {
  ctx.font = buildFontString(family, weight, sizePx)
  const axis = wghtAxis(family)
  if (!axis) {
    ctx.fontVariationSettings = 'normal'
    return
  }
  const value = Math.min(axis.max, Math.max(axis.min, weight))
  ctx.fontVariationSettings = `'wght' ${value}`
}

async function ensureFace(face: FontFace): Promise<void> {
  if (registered.has(face.registeredAs)) return
  const dest = join(getFontsCacheDir(), face.file)
  if (!(await fileExists(dest))) await download(face.url, dest)
  registerFontPath(face.registeredAs, dest)
}

/** 按字体名下载并注册内置宋体、楷体、书法。已经注册过的名字跳过。 */
export async function ensureBuiltinFonts(families: Iterable<string>): Promise<void> {
  const seen = new Set<string>()
  for (const family of families) {
    const font = builtinFont(family)
    if (!font || seen.has(font.cssFamily) || registered.has(font.cssFamily)) continue
    seen.add(font.cssFamily)
    for (const face of font.faces) await ensureFace(face)
    registered.add(font.cssFamily)
  }
}

/** 测量用：若默认字体未注册则尝试读缓存路径（测试可预先放入字体） */
export async function initFontsForMeasure(options?: { fontsCacheDir?: string }): Promise<boolean> {
  if (options?.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  const cache = getFontsCacheDir()
  const dest = join(cache, DEFAULT_FONT_FILE)
  if (await fileExists(dest)) {
    registerFontPath(DEFAULT_FONT_FAMILY, dest)
    return true
  }
  try {
    await ensureDefaultFont()
    return true
  } catch {
    return false
  }
}

export function packageDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}
