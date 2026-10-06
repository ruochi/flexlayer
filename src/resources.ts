import { CATALOG_FONTS, type CatalogFont } from './font-catalog.js'
import type { BlendMode, GradePresetName } from './types.js'

export type FontResource = CatalogFont

export type ImageResource = {
  name: string
  title: string
  /** 可直接写进 `<img src>` 的地址，返回的是图片字节 */
  src: string
  credit: string
}

const fontsByKey = new Map<string, CatalogFont>()
for (const font of CATALOG_FONTS) {
  fontsByKey.set(font.family.toLowerCase(), font)
  for (const alias of font.aliases) fontsByKey.set(alias.trim().toLowerCase(), font)
}

/** 海报里反复用到的几组颜色。值都是可以直接写进 `fill` 或 `color` 的色值。 */
export const palettes = {
  night: { title: '夜色', bg: '#0c1424', ink: '#f4ecdf', accent: '#e8b04a' },
  paper: { title: '纸面', bg: '#f4f1ea', ink: '#0e1219', accent: '#3ecfc4', line: '#f5c16c' },
  halving: { title: '减半', bg: '#0f1115', ink: '#ffffff', accent: '#f7931a' },
} as const

export const images: ImageResource[] = [
  {
    name: 'lake',
    title: '山湖',
    src: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80',
    credit: 'Unsplash photo-1500530855697-b586d89ba3ee',
  },
  {
    name: 'valley',
    title: '山谷',
    src: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=960&q=80',
    credit: 'Unsplash photo-1469474968028-56623f02e42e',
  },
  {
    name: 'forest',
    title: '森林',
    src: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=960&q=80',
    credit: 'Unsplash photo-1441974231531-c6227db76b6e',
  },
]

const imagesByName = new Map(images.map((image) => [image.name, image]))

export const grades = ['lomo', 'matte', 'chrome', 'bleach', 'mono'] as const satisfies readonly GradePresetName[]
export const glass = ['clear', 'regular', 'thick'] as const
export const blends = ['source-over', 'multiply', 'screen', 'overlay', 'soft-light', 'lighten', 'darken'] as const satisfies readonly BlendMode[]

/**
 * 生成画面时可以用的字体、图片、配色和效果名。
 * 字体写 `font-family`，不必再写 `<font src>`。完整表见 docs/RESOURCES.md。
 */
export const resources = {
  fonts: CATALOG_FONTS,
  palettes,
  images,
  grades,
  glass,
  blends,
  font(name: string): CatalogFont | undefined {
    return fontsByKey.get(name.trim().toLowerCase())
  },
  image(name: string): ImageResource | undefined {
    return imagesByName.get(name.trim().toLowerCase())
  },
}
