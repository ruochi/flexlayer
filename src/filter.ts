import { applyGrade, parseGrade } from './grade.js'
import { isGradient, parseGradient } from './gradient.js'
import { parseColor } from './gradientField.js'
import { attrByName } from './schema.js'
import { colorFilterToCss, parseColorFilter } from './style.js'
import type { AppliedFilter, ColorFilterSpec, GradeSpec } from './types.js'

/** 滤镜看到的像素。data 是非预乘 RGBA，改它就是改画面。 */
export type FilterPixels = {
  data: Uint8ClampedArray
  width: number
  height: number
  /** 这一层的盒子在缓冲里的位置，单位是像素。暗角一类效果用它。 */
  frame: { x: number; y: number; width: number; height: number }
  /** 同尺寸 RGBA。alpha 是强度；没有就是整幅全强度。 */
  mask?: Uint8ClampedArray
}

export type FilterParseResult<Spec> = { spec: Spec } | { error: string }

export type FilterKind = 'pixel' | 'canvas'

/**
 * 一层画完之后再处理的滤镜。
 * `pixel` 直接改 RGBA，排在模糊之前。
 * `canvas` 返回一段 canvas filter CSS，和 `blur` 合在一起，`blur` 在前。
 */
export type LayerFilter<Spec = unknown> = {
  /** 属性名。`<layer wash="0.4">` 里的 wash。 */
  name: string
  kind: FilterKind
  /** 同一种 kind 里越小越先。缺省 0。相同则按注册顺序。 */
  order?: number
  /**
   * 只允许写在 layer 上。
   * 缺省：pixel 为 true，canvas 为 false（可以写在图形属性或文字 style 里）。
   */
  layerOnly?: boolean
  /** 配套遮罩属性，paint 的 alpha 是强度。例如 grade 的 grade-mask。 */
  maskAttr?: string
  /** 写在根 layer 上时，连画布底色一起处理。 */
  includeBackdrop?: boolean
  /** 解析失败时，接在错误说明后面的写法提示。 */
  hint?: string
  /** 只写了遮罩、没有滤镜时的提示。 */
  maskHint?: string
  /** 遮罩 paint 解析失败时的提示。 */
  maskPaintHint?: string
  parse(value: string): FilterParseResult<Spec> | undefined
  /** kind 为 pixel 时必填。原地修改 pixels.data。 */
  apply?(pixels: FilterPixels, spec: Spec): void
  /** kind 为 canvas 时必填。 */
  canvasFilter?(spec: Spec): string
  /** 离屏缓冲要额外留出的逻辑像素。 */
  pad?(spec: Spec): number
  /** 报告里回显的值。缺省回显 spec。 */
  report?(spec: Spec): unknown
}

export type FilterIssue = { message: string; hint: string }

const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const BUILTIN_NAMES = new Set(['grade', 'filter'])

const registry: Array<LayerFilter<any>> = []

export function filterIsLayerOnly(filter: LayerFilter): boolean {
  if (filter.layerOnly != null) return filter.layerOnly
  return filter.kind === 'pixel'
}

function assertFilter(filter: LayerFilter): void {
  if (!NAME_RE.test(filter.name)) {
    throw new Error(`滤镜名要是小写属性名，例如 wash：${filter.name}`)
  }
  if (filter.kind !== 'pixel' && filter.kind !== 'canvas') {
    throw new Error(`${filter.name} 的 kind 只能是 pixel 或 canvas`)
  }
  if (filter.kind === 'pixel' && !filter.apply) {
    throw new Error(`${filter.name} 是 pixel 滤镜，要提供 apply`)
  }
  if (filter.kind === 'canvas' && !filter.canvasFilter) {
    throw new Error(`${filter.name} 是 canvas 滤镜，要提供 canvasFilter`)
  }
  if (filter.order != null && !Number.isFinite(filter.order)) {
    throw new Error(`${filter.name} 的 order 要是有限数字`)
  }
  const taken = attrByName(filter.name)
  const builtin = BUILTIN_NAMES.has(filter.name)
  if (taken && !builtin) {
    throw new Error(`「${filter.name}」已经是属性，不能再注册成滤镜`)
  }
  if (filter.maskAttr) {
    if (!NAME_RE.test(filter.maskAttr)) {
      throw new Error(`遮罩属性名要是小写属性名：${filter.maskAttr}`)
    }
    if (filter.maskAttr === filter.name) {
      throw new Error(`${filter.name} 的遮罩属性不能和滤镜同名`)
    }
    const builtinMask = filter.name === 'grade' && filter.maskAttr === 'grade-mask'
    if (attrByName(filter.maskAttr) && !builtinMask) {
      throw new Error(`「${filter.maskAttr}」已经是属性，不能当作滤镜遮罩`)
    }
  }
  const others = registry.filter((item) => item.name !== filter.name)
  if (filter.maskAttr && others.some((item) => item.name === filter.maskAttr || item.maskAttr === filter.maskAttr)) {
    throw new Error(`遮罩属性 ${filter.maskAttr} 已经被占用`)
  }
  if (others.some((item) => item.maskAttr === filter.name)) {
    throw new Error(`${filter.name} 已经被别的滤镜用作遮罩属性`)
  }
}

/** 登记一个滤镜。同名再登记会换掉原来的实现，内置的 grade 和 filter 也一样。 */
export function registerFilter<Spec>(filter: LayerFilter<Spec>): void {
  assertFilter(filter)
  const index = registry.findIndex((item) => item.name === filter.name)
  if (index >= 0) registry[index] = filter
  else registry.push(filter)
}

/** 卸下后加的滤镜。grade 和 filter 不能卸。没登记过的名字什么也不做。 */
export function unregisterFilter(name: string): void {
  if (BUILTIN_NAMES.has(name)) throw new Error(`${name} 是内置滤镜，不能卸下`)
  const index = registry.findIndex((item) => item.name === name)
  if (index >= 0) registry.splice(index, 1)
}

export function getFilter(name: string): LayerFilter<any> | undefined {
  return registry.find((item) => item.name === name)
}

export function listFilters(): Array<LayerFilter<any>> {
  return registry.slice()
}

function byOrder(a: AppliedFilter, b: AppliedFilter): number {
  if (a.order !== b.order) return a.order - b.order
  return a.seq - b.seq
}

export function orderedFilters(filters: AppliedFilter[] | undefined, kind: FilterKind): AppliedFilter[] {
  return (filters ?? []).filter((item) => item.kind === kind).sort(byOrder)
}

/** 像素滤镜在前，画布滤镜在后。 */
export function filtersInPaintOrder(filters: AppliedFilter[] | undefined): AppliedFilter[] {
  return [...orderedFilters(filters, 'pixel'), ...orderedFilters(filters, 'canvas')]
}

export function filtersPad(filters: AppliedFilter[] | undefined): number {
  let pad = 0
  for (const item of filters ?? []) {
    const extra = getFilter(item.name)?.pad?.(item.spec) ?? 0
    if (Number.isFinite(extra) && extra > 0) pad += extra
  }
  return pad
}

/** 根 layer 上要连画布底色一起处理的像素滤镜。 */
export function backdropFilters(filters: AppliedFilter[] | undefined): AppliedFilter[] {
  return orderedFilters(filters, 'pixel').filter((item) => item.includeBackdrop)
}

/** 同名时 over 盖掉 base，其余保留。over 里没有的名字留在 base 里。 */
export function mergeFilters(base: AppliedFilter[] | undefined, over: AppliedFilter[] | undefined): AppliedFilter[] {
  if (!over?.length) return base ? [...base] : []
  const replaced = new Set(over.map((item) => item.name))
  return [...(base ?? []).filter((item) => !replaced.has(item.name)), ...over]
}

function validMaskPaint(raw: string): boolean {
  if (isGradient(raw)) return parseGradient(raw) != null
  return parseColor(raw) != null
}

function parseIssue(def: LayerFilter, raw: string, error: string): FilterIssue {
  const hint = !def.hint || def.hint === error ? error : `${error}。${def.hint}`
  return { message: `无法解析 ${def.name}: ${raw}`, hint }
}

/**
 * 从属性或 style 里取出本槽位的滤镜。
 * shared：图形、文字、layer 都能写的（layerOnly 为 false）。
 * layer：只写在 layer 上的。
 */
export function collectFilters(
  src: Record<string, string | undefined>,
  slot: 'shared' | 'layer',
): { applied: AppliedFilter[]; issues: FilterIssue[] } {
  const applied: AppliedFilter[] = []
  const issues: FilterIssue[] = []
  for (let seq = 0; seq < registry.length; seq++) {
    const def = registry[seq]!
    const only = filterIsLayerOnly(def)
    if (slot === 'shared' && only) continue
    if (slot === 'layer' && !only) continue
    const raw = src[def.name]
    const absent = raw == null || raw.trim() === '' || raw.trim().toLowerCase() === 'none'
    let spec: unknown
    if (!absent) {
      const parsed = def.parse(raw!)
      if (parsed && 'spec' in parsed) spec = parsed.spec
      else if (parsed && 'error' in parsed) issues.push(parseIssue(def, raw!, parsed.error))
      else issues.push(parseIssue(def, raw!, def.hint ?? '检查写法'))
    }
    let mask: string | undefined
    if (def.maskAttr && slot === 'layer') {
      const maskRaw = src[def.maskAttr]?.trim()
      if (maskRaw && maskRaw !== 'none') {
        if (spec == null) {
          issues.push({
            message: `写了 ${def.maskAttr} 但没有可用的 ${def.name}`,
            hint: def.maskHint ?? `和 ${def.name} 一起写`,
          })
        } else if (!validMaskPaint(maskRaw)) {
          issues.push({
            message: `无法解析 ${def.maskAttr}: ${maskRaw}`,
            hint: def.maskPaintHint ?? '写成线性或径向渐变，或纯色；alpha 是强度',
          })
        } else {
          mask = maskRaw
        }
      }
    }
    if (spec == null) continue
    applied.push({
      name: def.name,
      kind: def.kind,
      order: def.order ?? 0,
      seq,
      spec,
      ...(mask ? { mask } : {}),
      includeBackdrop: def.includeBackdrop === true,
    })
  }
  return { applied, issues }
}

const GRADE_HINT = '写成 lomo 0.8, fade 0.1，或 shadows #2a6080, highlights #ffd8a8, contrast 1.1, vignette 0.4'
const FILTER_HINT =
  '写成 brightness(1.1) contrast(1.2) saturate(0.8) grayscale(0.2) hue-rotate(15) sepia(0.1) invert(0)，不要写 blur/drop-shadow'

registerFilter<GradeSpec>({
  name: 'grade',
  kind: 'pixel',
  layerOnly: true,
  maskAttr: 'grade-mask',
  includeBackdrop: true,
  hint: GRADE_HINT,
  maskHint: '和 grade 一起写，例如 <layer grade="lomo" grade-mask="radial-gradient(#fff0 30%, #fff)">',
  maskPaintHint: '写成 linear-gradient(to right, #fff, #fff0)、radial-gradient(#fff0 30%, #fff) 或 gradient(...)；alpha 是强度',
  parse: parseGrade,
  apply(pixels, spec) {
    applyGrade(pixels.data, pixels.width, pixels.height, spec, pixels.frame, pixels.mask)
  },
})

registerFilter<ColorFilterSpec[]>({
  name: 'filter',
  kind: 'canvas',
  layerOnly: false,
  hint: FILTER_HINT,
  parse(value) {
    const spec = parseColorFilter(value)
    if (!spec) return { error: FILTER_HINT }
    return { spec }
  },
  canvasFilter(spec) {
    return colorFilterToCss(spec)
  },
})
