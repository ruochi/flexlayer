import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import { layoutSync, prepareAssets, readLayerRoot } from './layout.js'
import { loadNativeRender } from './native.js'
import { packPaintTree } from './paint-tree.js'
import { renderLayer } from './render.js'

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
  it('实心矩形和 JS 绘制器一致，超长边拒绝', async () => {
    const native = loadNativeRender()
    if (!native?.render || !String(native.engine()).includes('+cap1080')) return
    process.env.FLEXLAYER_PAINTER = 'js'
    const js = await renderLayer(scene)
    process.env.FLEXLAYER_PAINTER = 'native'
    const rust = await renderLayer(scene)
    expect(rust.report.issues.some((issue) => issue.level === 'error')).toBe(false)
    const jsPx = await pixels(js.png)
    const rustPx = await pixels(rust.png)
    expect(rustPx.width).toBe(jsPx.width)
    expect(rustPx.height).toBe(jsPx.height)
    let far = 0
    for (let i = 0; i < jsPx.data.length; i += 1) far = Math.max(far, Math.abs(jsPx.data[i]! - rustPx.data[i]!))
    expect(far).toBeLessThanOrEqual(2)

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
    process.env.FLEXLAYER_PAINTER = 'js'
    const jsText = await renderLayer(text)
    process.env.FLEXLAYER_PAINTER = 'native'
    const rustText = await renderLayer(text)
    const a = await pixels(jsText.png)
    const b = await pixels(rustText.png)
    expect(b.width).toBe(a.width)
    expect(b.height).toBe(a.height)
    let textSum = 0
    for (let i = 0; i < a.data.length; i += 1) textSum += Math.abs(a.data[i]! - b.data[i]!)
    expect(textSum / a.data.length).toBeLessThanOrEqual(8)
  })
})

async function pixels(png: Buffer) {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, image.width, image.height).data
  return { width: image.width, height: image.height, data }
}
