import { describe, expect, it } from 'vitest'
import { loadImage, createCanvas } from '@napi-rs/canvas'
import { renderLayer } from './render.js'
import { visiblePlaneWindow } from './plane-crop.js'

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

describe('大平面只画取景窗里的一块', () => {
  it('5000 的平面裁进 600×400 后，留下的局部范围跟着窗口走', () => {
    const seen = visiblePlaneWindow(
      [
        { u: 0, v: 0, x: -2200, y: -800, z: 0 },
        { u: 5000, v: 0, x: 2800, y: -800, z: 0 },
        { u: 5000, v: 5000, x: 2800, y: 4200, z: 0 },
        { u: 0, v: 5000, x: -2200, y: 4200, z: 0 },
      ],
      800,
      300,
      200,
      { x: 0, y: 0, width: 600, height: 400 },
      0,
    )
    expect(seen).not.toBeNull()
    expect(seen!.u).toBeGreaterThan(2000)
    expect(seen!.u).toBeLessThan(2300)
    expect(seen!.v).toBeGreaterThan(700)
    expect(seen!.v).toBeLessThan(900)
    expect(seen!.width).toBeGreaterThan(500)
    expect(seen!.width).toBeLessThan(800)
    expect(seen!.height).toBeGreaterThan(350)
    expect(seen!.height).toBeLessThan(550)
    expect(seen!.densityU).toBeGreaterThan(0.9)
    expect(seen!.densityU).toBeLessThan(1.2)
  })

  it('正对镜头的超大纯色平面，画面中间就是这个颜色', async () => {
    const { png } = await renderLayer(
      `<layer width="320" height="200" background="#101820" perspective="600"><rect x="-2000" y="-800" width="5000" height="5000" fill="#3d8bfd" z="1" /></layer>`,
    )
    const px = await pixelAt(png, 160, 100)
    expect(px[0]).toBeGreaterThan(50)
    expect(px[0]).toBeLessThan(75)
    expect(px[1]).toBeGreaterThan(125)
    expect(px[1]).toBeLessThan(155)
    expect(px[2]).toBeGreaterThan(240)
  })

  it('大层上的色块仍落在它投影到的位置', async () => {
    const { png } = await renderLayer(
      `<layer width="320" height="200" background="#101820" perspective="600"><layer x="-1000" y="-400" width="2400" height="1600" z="1"><rect width="2400" height="1600" fill="#224466" /><rect x="1160" y="500" width="80" height="40" fill="#ff00aa" /></layer></layer>`,
    )
    const pink = await pixelAt(png, 180, 110)
    const blue = await pixelAt(png, 40, 40)
    expect(pink[0]).toBeGreaterThan(220)
    expect(pink[2]).toBeGreaterThan(140)
    expect(blue[2]).toBeGreaterThan(blue[0])
    expect(blue[0]).toBeLessThan(80)
  })

  it('斜放的大地仍铺在画面下半', async () => {
    const { png } = await renderLayer(
      `<layer width="320" height="200" background="#101820" perspective="500"><rect x="-2340" y="-1820" width="5000" height="4000" fill="#3d8bfd" rotateX="82" /></layer>`,
    )
    const sky = await pixelAt(png, 160, 24)
    const floor = await pixelAt(png, 160, 170)
    expect(sky[2]).toBeLessThan(50)
    expect(floor[2]).toBeGreaterThan(180)
    expect(floor[0]).toBeLessThan(90)
  })

  it('和球体同一台镜头里的大地，颜色留在球的外面', async () => {
    const { png } = await renderLayer(
      `<layer width="320" height="200" background="#101820" perspective="600"><rect x="-2000" y="-800" width="5000" height="5000" fill="#3d8bfd" z="1" /><sphere cx="160" cy="70" r="24" fill="#ffcc00" /></layer>`,
    )
    const ground = await pixelAt(png, 30, 170)
    const ball = await pixelAt(png, 160, 70)
    expect(ground[2]).toBeGreaterThan(ground[0])
    expect(ball[0]).toBeGreaterThan(180)
    expect(ball[1]).toBeGreaterThan(120)
  })
})
