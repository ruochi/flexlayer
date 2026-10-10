import { applyToBox, aroundPivot, originOffset } from './matrix.js'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerComponent } from './components.js'
import { ensureBuiltinFontsSync, fontReady, registerFontPath, resolveFontSrcSync } from './fonts.js'
import { fontFamiliesOf, measureLayer, noteMeasuredSize, parseSafe, prepareAssetsSync, type MeasureEnv } from './layout.js'
import type { FvgNode } from './parse.js'
import { divHasFlowBreak, isDisplayFlex } from './rules.js'
import { placedElements, placedRootMask, type PlacedElement, type PlacedMask } from './placed-elements.js'
import { placedText, type PlacedText } from './placed-text.js'
import { parseNumber, parseOrigin, parseScale, readAnchor } from './style.js'
import { isTextBoxTag } from './text.js'
import type { Anchor, Issue } from './types.js'

const BASE_KEY = '__flexlayerBaseDir'

type GlobalBase = typeof globalThis & { __flexlayerBaseDir?: string }

/** loadLayerFile 在执行 .tsx 之前记下源文件所在目录。打包后的栈指向临时文件，不能用来找字体。 */
export function setLayerBaseDir(dir: string): void {
  ;(globalThis as GlobalBase)[BASE_KEY] = dir
}

function fileFromStack(line: string): string | null {
  const matched = /\((?:file:\/\/)?([^)]+):\d+:\d+\)$/.exec(line) ?? /at (?:file:\/\/)?(\S+):\d+:\d+$/.exec(line)
  if (!matched) return null
  let file = matched[1]!
  if (file.startsWith('file://')) file = fileURLToPath(file)
  return file
}

/** `<font src>` 和图片的相对路径。打包执行时用源文件目录，直接调用时用调用方文件，否则用当前目录。 */
export function layerBaseDir(): string {
  const pinned = (globalThis as GlobalBase)[BASE_KEY]
  const stack = new Error().stack ?? ''
  const bundled = /flexlayer-[^/\\]*[/\\]entry\.mjs/.test(stack)
  if (bundled && pinned) return pinned
  for (const line of stack.split('\n')) {
    const file = fileFromStack(line)
    if (!file) continue
    if (/[/\\](src|dist)[/\\](canvas|analyze-image)\.[cm]?[jt]s/.test(file)) continue
    if (file.includes('/node_modules/') || file.includes('\\node_modules\\')) continue
    if (file.includes('flexlayer-')) continue
    return dirname(file)
  }
  return pinned || process.cwd()
}

const UNLIMITED = 1_000_000

export type LayerBox = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type { PlacedElement, PlacedMask } from './placed-elements.js'
export type { PlacedChar, PlacedLine, PlacedText } from './placed-text.js'

export type CreatedLayer = FvgNode & LayerBox & {
  issues: Issue[]
  /**
   * `rotate`、`scale` 之后的外接矩形。`left` 到 `height` 仍是没转之前的布局盒。
   * 下一块要避开转过的内容时，用 `rotatedBox.bottom`。
   */
  rotatedBox: LayerBox
  /**
   * 这一层里的文字，按节点分组。没有文字时是空数组。
   * 坐标相对布局盒左上角。一个字是只有一个字的一行，多行是 `lines` 数组。
   */
  text: PlacedText[]
  /**
   * 这一层里每个排进去的元素。没有子元素时是空数组。根层自己不在里面。
   * 坐标和 `text` 同一套，相对布局盒左上角。
   */
  elements: PlacedElement[]
  /**
   * 这一层自己写了 `<mask>` 时才有。先把蒙版画成位图，再量面积、外接矩形、碎片数和软边宽度。
   * 嵌套层的蒙版在 `elements` 对应那一项的 `mask` 里。
   */
  mask?: PlacedMask
}

function parseAnchor(raw: string | undefined, fallback: Anchor = 'top-left'): Anchor {
  return readAnchor(raw, fallback).anchor
}

/** (x, y) 是盒子上 anchor 那一点，返回盒子左上角。 */
function topLeft(x: number, y: number, w: number, h: number, anchor: Anchor): { x: number; y: number } {
  switch (anchor) {
    case 'top-left':
      return { x, y }
    case 'top':
      return { x: x - w / 2, y }
    case 'top-right':
      return { x: x - w, y }
    case 'left':
      return { x, y: y - h / 2 }
    case 'right':
      return { x: x - w, y: y - h / 2 }
    case 'bottom-left':
      return { x, y: y - h }
    case 'bottom':
      return { x: x - w / 2, y: y - h }
    case 'bottom-right':
      return { x: x - w, y: y - h }
    default:
      return { x: x - w / 2, y: y - h / 2 }
  }
}

function wraps(node: FvgNode): boolean {
  const flex = isDisplayFlex(node.attrs.style)
  if (isTextBoxTag(node.tag) && !flex && !divHasFlowBreak(node)) {
    return !/white-space\s*:\s*nowrap/.test(node.attrs.style ?? '')
  }
  return node.children.some((child) => typeof child !== 'string' && wraps(child))
}

function measure(node: FvgNode, maxContentWidth: number) {
  const env: MeasureEnv = {
    baseDir: layerBaseDir(),
    color: node.attrs.color ?? '#111111',
    fontFamily: node.attrs['font-family'] ?? 'ChillDuanSans',
    maxContentWidth,
  }
  return measureLayer(node, env)
}

function contentLimit(node: FvgNode, width: number | undefined, both: boolean): number {
  if (width == null) return UNLIMITED
  if (!both) return width
  const height = parseNumber(node.attrs.height) ?? width
  const safe = parseSafe(node.attrs.safe, width, height)
  return Math.max(0, width - safe.left - safe.right)
}

/**
 * 同步量一个已经写好的 `<layer>`。字体和图片在这一次调用里准备，并在进程里记住。
 * 只写了宽或只写了高、且里面没有会换行的文字时，另一边按比例放缩。
 */
export function create(node: FvgNode): CreatedLayer {
  if (!node || typeof node !== 'object' || node.tag !== 'layer') {
    throw new Error('canvas.create 只接受 <layer>')
  }
  const baseDir = layerBaseDir()
  prepareAssetsSync(node, baseDir, { nestedFonts: true })
  const families = fontFamiliesOf(node)
  ensureBuiltinFontsSync(families)
  for (const family of families) {
    if (fontReady(family)) continue
    throw new Error(
      `字体「${family}」还没注册，量出来的尺寸会按备用字体计算。把 <font family="${family}" src="…"> 写进这一层，或先调用 canvas.font("${family}", "字体文件")`,
    )
  }
  const width = parseNumber(node.attrs.width)
  const height = parseNumber(node.attrs.height)
  const widthSet = node.attrs.width != null && node.attrs.width !== ''
  const heightSet = node.attrs.height != null && node.attrs.height !== ''
  const oneSide = widthSet !== heightSet
  if (oneSide && !wraps(node)) {
    const key = widthSet ? 'width' : 'height'
    const saved = node.attrs[key]!
    delete node.attrs.width
    delete node.attrs.height
    const natural = measure(node, UNLIMITED).laid
    node.attrs[key] = saved
    const naturalSide = key === 'width' ? natural.width : natural.height
    const target = parseNumber(saved)
    if (naturalSide > 0 && target != null) {
      const factor = target / naturalSide
      const other = key === 'width' ? 'height' : 'width'
      const otherSize = (key === 'width' ? natural.height : natural.width) * factor
      node.attrs[other] = String(otherSize)
      node.attrs.scale = multiplyScaleAttr(node.attrs.scale, factor)
      node.attrs.origin = 'top-left'
    }
  }
  const both = node.attrs.width != null && node.attrs.width !== '' && node.attrs.height != null && node.attrs.height !== ''
  const limit = contentLimit(node, parseNumber(node.attrs.width), both)
  const { laid, issues } = measure(node, limit)
  noteMeasuredSize(node, laid.width, laid.height)
  const anchor = parseAnchor(node.attrs.anchor)
  const origin = topLeft(parseNumber(node.attrs.x) ?? 0, parseNumber(node.attrs.y) ?? 0, laid.width, laid.height, anchor)
  const box: LayerBox = {
    left: origin.x,
    top: origin.y,
    right: origin.x + laid.width,
    bottom: origin.y + laid.height,
    width: laid.width,
    height: laid.height,
  }
  const created = Object.assign(node, box, {
    rotatedBox: rotatedBoxOf(node, box),
    issues,
    text: placedText(laid),
    elements: placedElements(laid),
  }) as CreatedLayer
  const mask = placedRootMask(laid)
  if (mask) created.mask = mask
  else delete created.mask
  return created
}

/** 只写一个数时仍写回一个数。已经是两个数时，两个都乘上比例，不把 `-1 1` 收成一个数。 */
function multiplyScaleAttr(existing: string | undefined, factor: number): string {
  const parts = existing?.trim().split(/[\s,]+/).filter(Boolean) ?? []
  if (parts.length >= 2) {
    const x = parseNumber(parts[0]) ?? 1
    const y = parseNumber(parts[1]) ?? x
    return `${x * factor} ${y * factor}`
  }
  const current = parseNumber(parts[0]) ?? 1
  return String(current * factor)
}

/** 绕 origin（默认中心）做 rotate、scale 之后的轴对齐外接矩形。 */
function rotatedBoxOf(node: FvgNode, box: LayerBox): LayerBox {
  const pivot = originOffset(parseOrigin(node.attrs.origin), box.width, box.height)
  const scale = parseScale(node.attrs.scale)
  const visual = applyToBox(
    aroundPivot(box.left + pivot.x, box.top + pivot.y, parseNumber(node.attrs.rotate) ?? 0, scale.x, scale.y),
    { x: box.left, y: box.top, width: box.width, height: box.height },
  )
  return {
    left: visual.x,
    top: visual.y,
    right: visual.x + visual.width,
    bottom: visual.y + visual.height,
    width: visual.width,
    height: visual.height,
  }
}

function retiredCanvas(..._args: unknown[]): never {
  throw new Error(
    'canvas({...}) 已去掉。底色写成铺满的 <rect fill>，color 和 font-family 写在 <layer> 上，然后调用 canvas.create(<layer>…</layer>)。自定义字体先 canvas.font(family, src)，或把 <font family src> 写进正在量的这一层。',
  )
}

export const canvas = Object.assign(retiredCanvas, {
  create,
  component: registerComponent,
  font(family: string, src: string) {
    registerFontPath(family, resolveFontSrcSync(src, layerBaseDir()))
  },
})
