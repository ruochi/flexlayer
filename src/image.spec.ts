import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { initFontsForMeasure } from './fonts.js'
import { parseObjectPosition } from './image.js'
import { layoutSource } from './layout.js'
import { parseFvg } from './parse.js'
import { renderFvg } from './render.js'
import type { ImageLayoutNode } from './types.js'

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

function pngDataUrl(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): string {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  paint(ctx)
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}

const SPLIT = pngDataUrl(20, 10, (ctx) => {
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 10, 10)
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(10, 0, 10, 10)
})

const RED = pngDataUrl(40, 40, (ctx) => {
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 40, 40)
})

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await (await import('@napi-rs/canvas')).loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

describe('img', () => {
  it('空元素，不吞掉后面的标签', () => {
    const [layer] = parseFvg('<layer><img src="a.png"><p>后</p></layer>')
    const tags = layer!.children.filter((child) => typeof child !== 'string').map((child) => (child as { tag: string }).tag)
    expect(tags).toEqual(['img', 'p'])
  })

  it('只写宽度时按原比例算高度，image 与 img 相同', async () => {
    const doc = await layoutSource(
      `<layer width="200" height="200"><image src="${SPLIT}" style="width:40px" /></layer>`,
      process.cwd(),
    )
    const image = doc.root.children[0] as ImageLayoutNode
    expect(image.kind).toBe('image')
    expect(image.tag).toBe('image')
    expect(image.width).toBe(40)
    expect(image.height).toBe(20)
    expect(doc.issues.filter((issue) => issue.code === 'unknown-tag' || issue.code === 'missing-image')).toEqual([])
  })

  it('contain 留出空白，cover 铺满盒子', async () => {
    const contain = await layoutSource(
      `<layer width="80" height="80"><img src="${SPLIT}" style="width:40px; height:40px; object-fit:contain" /></layer>`,
      process.cwd(),
    )
    const cover = await layoutSource(
      `<layer width="80" height="80"><img src="${SPLIT}" style="width:40px; height:40px; object-fit:cover" /></layer>`,
      process.cwd(),
    )
    const contained = contain.root.children[0] as ImageLayoutNode
    const covered = cover.root.children[0] as ImageLayoutNode
    expect(contained.ink).toMatchObject({ x: 0, y: 10, width: 40, height: 20 })
    expect(covered.ink).toMatchObject({ x: 0, y: 0, width: 40, height: 40 })
  })

  it('本地文件和 flex 间距', async () => {
    const dir = join(tmpdir(), `flexlayer-img-${process.pid}`)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'dot.png')
    const canvas = createCanvas(20, 10)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(0, 0, 20, 10)
    await writeFile(file, canvas.toBuffer('image/png'))
    const doc = await layoutSource(
      `<layer width="200" height="80"><div style="display:flex; gap:10px"><img src="dot.png" style="width:20px" /><img src="dot.png" style="width:20px" /></div></layer>`,
      dir,
    )
    const flex = doc.root.children[0] as { children: ImageLayoutNode[] }
    expect(flex.children[0]).toMatchObject({ width: 20, height: 10 })
    expect(flex.children[1]!.x).toBeCloseTo(flex.children[0]!.x + 30, 3)
    expect(doc.issues.filter((issue) => issue.code === 'missing-image')).toEqual([])
  })

  it('缺 src、读不到文件、宽高写成属性都会警告', async () => {
    const missing = await layoutSource(
      `<layer width="100" height="100"><img style="width:30px; height:20px" /><img src="no-such-flexlayer.png" style="width:30px; height:20px" /><img src="${RED}" width="80" height="40" /></layer>`,
      process.cwd(),
    )
    expect(missing.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('缺少 src'))).toBe(true)
    expect(missing.issues.some((issue) => issue.code === 'missing-image')).toBe(true)
    expect(missing.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('width'))).toBe(true)
    const broken = missing.root.children[1] as ImageLayoutNode
    expect(broken).toMatchObject({ width: 30, height: 20, bitmap: null })
    const ignoredAttr = missing.root.children[2] as ImageLayoutNode
    expect(ignoredAttr.width).toBe(40)
    expect(ignoredAttr.height).toBe(40)
  })

  it('绘制 contain、cover 和圆角', async () => {
    const fitted = await renderFvg(
      `<layer width="80" height="80" background="#000000"><layer x="20" y="20"><img src="${SPLIT}" style="width:40px; height:40px; object-fit:contain" /></layer></layer>`,
    )
    const red = await pixelAt(fitted.png, 30, 40)
    const blue = await pixelAt(fitted.png, 50, 40)
    const letterbox = await pixelAt(fitted.png, 40, 22)
    expect(red[0]).toBeGreaterThan(200)
    expect(red[2]).toBeLessThan(30)
    expect(blue[2]).toBeGreaterThan(200)
    expect(blue[0]).toBeLessThan(30)
    expect(letterbox[0]).toBeLessThan(20)
    expect(letterbox[2]).toBeLessThan(20)

    const covered = await renderFvg(
      `<layer width="80" height="80" background="#000000"><layer x="20" y="20"><img src="${SPLIT}" style="width:40px; height:40px; object-fit:cover" /></layer></layer>`,
    )
    const coverTop = await pixelAt(covered.png, 30, 22)
    expect(coverTop[0]).toBeGreaterThan(200)

    const rounded = await renderFvg(
      `<layer width="100" height="100" background="#000000"><layer x="30" y="30"><img src="${RED}" style="width:40px; height:40px; border-radius:20px" /></layer></layer>`,
    )
    const center = await pixelAt(rounded.png, 50, 50)
    const corner = await pixelAt(rounded.png, 31, 31)
    expect(center[0]).toBeGreaterThan(200)
    expect(corner[0]).toBeLessThan(20)
  })

  it('object-position', () => {
    expect(parseObjectPosition(undefined)).toEqual({ x: 0.5, y: 0.5 })
    expect(parseObjectPosition('top left')).toEqual({ x: 0, y: 0 })
    expect(parseObjectPosition('50% 0%')).toEqual({ x: 0.5, y: 0 })
    expect(parseObjectPosition('left 20%')).toEqual({ x: 0, y: 0.2 })
    expect(parseObjectPosition('nope')).toBeNull()
  })
})
