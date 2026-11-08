/**
 * Rust 内核仍然烘焙的五张材质球（`matcapNames()`），颜色从 `finishes.ts` 取。
 *
 * `matte` 和 `glass` 也在 `finishes.ts` 里，但没有烘焙球：它们的着色完全解析式，
 * 所以不在这张表里。测试会拿它跟插件的 `matcapNames()` 逐行对。
 */
import { FINISHES } from './finishes.js'

const BAKED = ['clay', 'plastic', 'metal', 'mirror', 'brushed'] as const

export const MATCAP_DEFAULTS: Record<string, string> = Object.fromEntries(
  BAKED.map((name) => [name, FINISHES[name].color]),
)

export const MATCAP_NAMES = [...BAKED]

/** 自发光名字。颜色仍可以写 fill 盖过。 */
export const LIGHT_DEFAULTS: Record<string, string> = {
  lamp: FINISHES.lamp.color,
  neon: FINISHES.neon.color,
}

export const LIGHT_NAMES = Object.keys(LIGHT_DEFAULTS)
