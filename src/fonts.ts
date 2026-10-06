import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GlobalFonts } from '@napi-rs/canvas'

export const DEFAULT_FONT_FAMILY = 'ChillDuanSans'
const DEFAULT_FONT_URL =
  'https://banling1.oss-cn-beijing.aliyuncs.com/weixin/dc/fonts/ChillDuanSansVF.ttf'
const DEFAULT_FONT_FILE = 'ChillDuanSansVF.ttf'

const registered = new Set<string>()
let freshFontLoads = 0

/** 真正读过或下载过的字体次数。已经记住的名字不会再加。 */
export function freshFontLoadsCount(): number {
  return freshFontLoads
}

let cacheDirOverride: string | undefined

export function setFontsCacheDir(dir: string | undefined): void {
  cacheDirOverride = dir
}

export function getFontsCacheDir(): string {
  return cacheDirOverride ?? join(homedir(), '.cache', 'flexlayer', 'fonts')
}

/** 缺文件时在子进程里下载，调用方不用 await。同一地址落到缓存后不再下。 */
function downloadSync(url: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  let buf: Buffer
  try {
    buf = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const res = await fetch(${JSON.stringify(url)}); if (!res.ok) { process.stderr.write(String(res.status)); process.exit(2) } process.stdout.write(new Uint8Array(await res.arrayBuffer()))`,
      ],
      { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (err) {
    const failure = err as { stderr?: Buffer }
    const status = failure.stderr?.toString().trim()
    throw new Error(`字体下载失败 ${url}: ${status || '网络错误'}`)
  }
  writeFileSync(dest, buf)
}

export function ensureDefaultFontSync(): string {
  const dest = join(getFontsCacheDir(), DEFAULT_FONT_FILE)
  if (registered.has(DEFAULT_FONT_FAMILY)) return dest
  if (!existsSync(dest)) downloadSync(DEFAULT_FONT_URL, dest)
  registerFontPath(DEFAULT_FONT_FAMILY, dest)
  return dest
}

export async function ensureDefaultFont(): Promise<string> {
  return ensureDefaultFontSync()
}

export function registerFontPath(family: string, filePath: string): void {
  if (registered.has(family)) return
  GlobalFonts.registerFromPath(filePath, family)
  registered.add(family)
  freshFontLoads += 1
}

export function resolveFontSrcSync(src: string, baseDir: string): string {
  const trimmed = src.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 16)
    const ext = trimmed.match(/\.(ttf|otf|woff2?)(\?|$)/i)?.[1] ?? 'ttf'
    const dest = join(getFontsCacheDir(), `${hash}.${ext}`)
    if (!existsSync(dest)) downloadSync(trimmed, dest)
    return dest
  }
  const local = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  if (!existsSync(local)) throw new Error(`字体文件不存在: ${local}`)
  return local
}

export async function resolveFontSrc(src: string, baseDir: string): Promise<string> {
  return resolveFontSrcSync(src, baseDir)
}

export function registerFontsFromDocumentSync(fontNodes: Array<{ family: string; src: string }>, baseDir: string): void {
  ensureDefaultFontSync()
  for (const f of fontNodes) {
    registerFontPath(f.family, resolveFontSrcSync(f.src, baseDir))
  }
}

export async function registerFontsFromDocument(
  fontNodes: Array<{ family: string; src: string }>,
  baseDir: string,
): Promise<void> {
  registerFontsFromDocumentSync(fontNodes, baseDir)
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

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
])

/** font-family 里第一个具体的字体名。通用族和 inherit 返回 null。 */
export function primaryFontFamily(raw: string | undefined): string | null {
  if (!raw) return null
  const first = raw.split(',')[0]?.trim() ?? ''
  const name = first.replace(/^['"]|['"]$/g, '').trim()
  if (!name || GENERIC_FAMILIES.has(name.toLowerCase())) return null
  return name
}

/** 这个名字现在能不能拿来量尺寸。没注册时画布会悄悄换成备用字体。 */
export function fontReady(family: string): boolean {
  const name = family.trim()
  if (!name) return true
  const builtin = builtinFont(name)
  if (builtin) return registered.has(builtin.cssFamily) || GlobalFonts.has(builtin.cssFamily)
  if (name.toLowerCase().includes('chillduan')) return GlobalFonts.has(DEFAULT_FONT_FAMILY)
  return GlobalFonts.has(name)
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

function ensureFaceSync(face: FontFace): void {
  if (registered.has(face.registeredAs)) return
  const dest = join(getFontsCacheDir(), face.file)
  if (!existsSync(dest)) downloadSync(face.url, dest)
  registerFontPath(face.registeredAs, dest)
}

/** 按字体名准备内置宋体、楷体、书法。已经记住的名字直接跳过。 */
export function ensureBuiltinFontsSync(families: Iterable<string>): void {
  const seen = new Set<string>()
  for (const family of families) {
    const font = builtinFont(family)
    if (!font || seen.has(font.cssFamily) || registered.has(font.cssFamily)) continue
    seen.add(font.cssFamily)
    for (const face of font.faces) ensureFaceSync(face)
    registered.add(font.cssFamily)
  }
}

export async function ensureBuiltinFonts(families: Iterable<string>): Promise<void> {
  ensureBuiltinFontsSync(families)
}

export type OutlineFont = {
  /** 调用方认识的名字，如 Kai */
  family: string
  /** 写进 SVG 的字体名。粗楷是 KaiBold 这种已经注册的文件名 */
  canvasFamily: string
  /** 轮廓实际对应的字重 */
  weight: number
}

function variationWeight(family: string): { def: number } | null {
  try {
    if (!GlobalFonts.hasVariations(family, 400, 5, 0)) return null
    const found = GlobalFonts.getVariationAxes(family, 400, 5, 0).find((item) => item.tag === WGHT_TAG)
    return found ? { def: found.def } : null
  } catch {
    return null
  }
}

/**
 * 轮廓用哪一个字体文件。
 * 内置宋体、楷体按最近的字重文件选。可变字体的轮廓只在默认字重上，请求其它字重会抛错。
 */
export async function resolveOutlineFont(family: string | undefined, weight: number | undefined): Promise<OutlineFont> {
  ensureDefaultFontSync()
  const requested = family?.trim() || DEFAULT_FONT_FAMILY
  const builtin = builtinFont(requested)
  if (builtin) {
    ensureBuiltinFontsSync([requested])
    const face = nearestFace(builtin, weight ?? 400)
    return { family: builtin.cssFamily, canvasFamily: face.registeredAs, weight: face.weight }
  }
  const name = requested.toLowerCase().includes('chillduan') ? DEFAULT_FONT_FAMILY : requested
  if (!GlobalFonts.has(name)) {
    throw new Error(`字体未注册: ${requested}。内置 Song、Kai、Brush，默认字体是 ${DEFAULT_FONT_FAMILY}`)
  }
  const axis = variationWeight(name)
  if (axis) {
    if (weight != null && weight !== axis.def) {
      throw new Error(`可变字体 ${name} 的轮廓只能取默认字重 ${axis.def}，请求的是 ${weight}`)
    }
    return { family: name, canvasFamily: name, weight: axis.def }
  }
  return { family: name, canvasFamily: name, weight: effectiveFontWeight(name, weight ?? 400) }
}

/** 测量用：若默认字体未注册则尝试读缓存路径（测试可预先放入字体） */
export async function initFontsForMeasure(options?: { fontsCacheDir?: string }): Promise<boolean> {
  if (options?.fontsCacheDir) setFontsCacheDir(options.fontsCacheDir)
  if (registered.has(DEFAULT_FONT_FAMILY)) return true
  try {
    ensureDefaultFontSync()
    return true
  } catch {
    return false
  }
}

export function packageDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}
