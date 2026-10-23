import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { loadNativeRender } from './native.js'
import { packPaintTree } from './paint-tree.js'
import { painterMode, renderLayer, renderPreview } from './render.js'

const prevPainter = process.env.FLEXLAYER_PAINTER
const prevRender = process.env.FLEXLAYER_RENDER

afterEach(() => {
  if (prevPainter === undefined) delete process.env.FLEXLAYER_PAINTER
  else process.env.FLEXLAYER_PAINTER = prevPainter
  if (prevRender === undefined) delete process.env.FLEXLAYER_RENDER
  else process.env.FLEXLAYER_RENDER = prevRender
})

const scene = `<layer width="32" height="24" background="#112233"><rect x="4" y="6" width="10" height="8" fill="#ff0000" /></layer>`

async function laid() {
  const opened = readLayerRoot(scene)
  const assets = await prepareAssets(opened.root, process.cwd(), { fonts: opened.fonts })
  return layoutSync(opened.root, assets)
}

describe('绘制树', () => {
  it('把形状收成纯数据，不带位图对象', async () => {
    const doc = await laid()
    const packed = packPaintTree(doc, {
      scale: 1,
      debug: false,
      frame: 0,
      baseDir: process.cwd(),
      native: { engine: () => 'test', solidPng: () => Buffer.alloc(0) },
    })
    const tree = JSON.parse(packed.json) as { root: { children: Array<{ kind: string; fill: string; shape: string }> } }
    expect(tree.root.children[0]).toMatchObject({ kind: 'shape', shape: 'rect', fill: '#ff0000' })
    expect(packed.json.includes('bitmap')).toBe(false)
    expect(packed.images).toEqual([])
  })
})

describe('native 绘制', () => {
  it('请求 js 绘制器直接报错', () => {
    process.env.FLEXLAYER_PAINTER = 'js'
    expect(() => painterMode()).toThrow(/移除/)
  })

  it('实心矩形出图，超长边拒绝', async () => {
    const native = loadNativeRender()
    if (!native?.render || !String(native.engine()).includes('+cap1080')) return
    delete process.env.FLEXLAYER_PAINTER
    expect(painterMode()).toBe('native')
    const rust = await renderLayer(scene)
    expect(rust.report.issues.some((issue) => issue.level === 'error')).toBe(false)
    const rustPx = await pixels(rust.png)
    expect(rustPx.width).toBe(32)
    expect(rustPx.height).toBe(24)
    expect(channel(rustPx.data, 32, 1, 1, 0)).toBeGreaterThan(10)
    expect(channel(rustPx.data, 32, 1, 1, 2)).toBeGreaterThan(40)
    expect(channel(rustPx.data, 32, 8, 9, 0)).toBeGreaterThan(200)
    expect(channel(rustPx.data, 32, 8, 9, 1)).toBeLessThan(30)

    const refused = native.render(
      JSON.stringify({
        width: 2000,
        height: 40,
        scale: 1,
        background: '#fff',
        root: { kind: 'layer', x: 0, y: 0, width: 2000, height: 40, opacity: 1, children: [] },
      }),
      [],
      [],
      false,
    )
    expect(refused.png == null || Buffer.from(refused.png).length === 0).toBe(true)
    expect(refused.issues.some((issue) => issue.code === 'output-limit' && issue.level === 'error')).toBe(true)

    const text = `<layer width="180" height="64" background="#ffffff"><h1 style="font-size:32px; color:#111">Hello</h1></layer>`
    const rustText = await renderLayer(text)
    const b = await pixels(rustText.png)
    expect(b.width).toBe(180)
    expect(b.height).toBe(64)
    expect(rustText.report.issues.some((issue) => issue.level === 'error')).toBe(false)
    let dark = 0
    for (let i = 0; i < b.data.length; i += 4) if ((b.data[i]! + b.data[i + 1]! + b.data[i + 2]!) < 200) dark += 1
    expect(dark).toBeGreaterThan(20)
  })

  it('预览拼图超长边也拿不到图', async () => {
    const native = loadNativeRender()
    if (!native?.previewSheet || !String(native.engine()).includes('+cap1080')) return
    process.env.FLEXLAYER_PAINTER = 'native'
    const source = `<layer id="page" width="2000" height="80" background="#ffffff"><preview of="#page" show="checker" /></layer>`
    await expect(renderPreview(source)).rejects.toThrow(/1920|超过/)
  })
})

function channel(data: Uint8ClampedArray, width: number, x: number, y: number, i: number) {
  return data[(y * width + x) * 4 + i] ?? 0
}

async function pixels(png: Buffer) {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, image.width, image.height).data
  return { width: image.width, height: image.height, data }
}
