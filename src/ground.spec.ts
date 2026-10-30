import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { checkLayer, renderLayer } from './render.js'

async function imageOf(png: Buffer) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx
}

function luma(data: Uint8ClampedArray) {
  return data[0]! * 0.3 + data[1]! * 0.59 + data[2]! * 0.11
}

describe('ground', () => {
  it('angle 要改成和 box 一样的旋转', async () => {
    const report = await checkLayer(`<layer width="200" height="200" camera="200"><ground y="150" angle="50" /></layer>`)
    const issue = report.issues.find((item) => item.message.includes('angle'))
    expect(issue?.code).toBe('invalid-attr')
    expect(issue?.hint).toContain('rotateX')
  })

  it('不写旋转时平面正对镜头，rotateX=90 只留在灭点下方', async () => {
    const facing = await renderLayer(
      `<layer width="200" height="200" background="#f4f1ea" camera="200"><ground x="100" y="100" fill="#2266cc" shadow-opacity="0" /></layer>`,
    )
    const floor = await renderLayer(
      `<layer width="200" height="200" background="#f4f1ea" camera="200"><ground x="100" y="150" rotateX="90" fill="#2266cc" shadow-opacity="0" /></layer>`,
    )
    const facingCtx = await imageOf(facing.png)
    const floorCtx = await imageOf(floor.png)
    const top = facingCtx.getImageData(100, 20, 1, 1).data
    expect(top[2]).toBeGreaterThan(top[0])
    const above = floorCtx.getImageData(100, 40, 1, 1).data
    const below = floorCtx.getImageData(100, 170, 1, 1).data
    expect(above[0]).toBeGreaterThan(200)
    expect(below[2]).toBeGreaterThan(below[0])
  })

  it('透明地面只在影子里变暗', async () => {
    const { png } = await renderLayer(
      `<layer width="200" height="200" background="#ffffff" camera="200"><sphere cx="100" cy="70" r="24" fill="#ff3344" /><ground x="100" y="150" rotateX="90" shadow-opacity="0.85" shadow-blur="0" /></layer>`,
    )
    const ctx = await imageOf(png)
    const clear = ctx.getImageData(16, 180, 1, 1).data
    expect(luma(clear)).toBeGreaterThan(240)
    let darkest = 255
    for (let y = 120; y < 190; y += 2) {
      for (let x = 40; x < 170; x += 2) {
        darkest = Math.min(darkest, luma(ctx.getImageData(x, y, 1, 1).data))
      }
    }
    expect(darkest).toBeLessThan(180)
  })

  it('shadow-blur 把影子铺开', async () => {
    const scene = (blur: number) =>
      `<layer width="160" height="160" background="#ffffff" camera="160"><sphere cx="80" cy="56" r="20" fill="#ff3344" /><ground x="80" y="120" rotateX="90" shadow-opacity="0.9" shadow-blur="${blur}" /></layer>`
    const hard = await imageOf((await renderLayer(scene(0))).png)
    const soft = await imageOf((await renderLayer(scene(18))).png)
    const dim = (ctx: Awaited<ReturnType<typeof imageOf>>) => {
      let n = 0
      for (let y = 96; y < 156; y += 2) {
        for (let x = 8; x < 152; x += 2) {
          if (luma(ctx.getImageData(x, y, 1, 1).data) < 250) n += 1
        }
      }
      return n
    }
    expect(dim(soft)).toBeGreaterThan(dim(hard))
  })

  // QUALITY-6 §D. The layer that holds the bodies is turned down 90° about its
  // own centre, so without `origin` half of it is under `y="420"`. The floor is
  // infinite and opaque, so the bodies vanish while their shadow stays behind.
  // That used to be 0 issues.
  const buried = `<layer width="640" height="420" background="#efe9df">
    <layer width="640" height="420" camera="fov 30, orbit 24 26, distance 1000, at 320 360 0">
      <ground y="420" rotateX="90" fill="#e7e0d4" shadow-blur="30" />
      <layer x="60" y="420" width="520" height="260" rotateX="90" preserve-3d>
        <rect x="120" y="70" width="130" height="100" depth="100" rx="10" fill="#d23b3b" material="plastic 0.3" />
        <sphere cx="370" cy="120" r="56" z="56" fill="#c5c9ce" material="metal 0.2" />
      </layer>
    </layer>
  </layer>`

  it('地面吃掉实体时报 buried-in-ground，被埋的实体 ink 为空', async () => {
    const report = await checkLayer(buried)
    const hits = report.issues.filter((issue) => issue.code === 'buried-in-ground')
    expect(hits.map((issue) => issue.path).sort()).toEqual([
      'layer/layer[0]/layer[1]/rect[0]',
      'layer/layer[0]/layer[1]/sphere[1]',
    ])
    expect(hits[0]?.level).toBe('warn')
    expect(hits[0]?.hint).toContain('origin')
    for (const tag of ['rect', 'sphere']) {
      const el = report.elements.find((item) => item.tag === tag)
      expect(el?.visible).toBe(0)
      expect(el?.ink).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    }
  })

  it('加上 origin 之后不再报 buried-in-ground', async () => {
    const fixed = buried.replace('width="520" height="260" rotateX', 'width="520" height="260" origin="260 0" rotateX')
    const report = await checkLayer(fixed)
    expect(report.issues.filter((issue) => issue.code === 'buried-in-ground')).toEqual([])
    expect(report.elements.find((item) => item.tag === 'rect')?.visible).toBeUndefined()
  })

  it('埋在地面以下的实体不在地面上投影', async () => {
    // The floor is the only thing that can carry a shadow, so any dark pixel
    // is a shadow. A buried body must leave none.
    const hidden = await imageOf((await renderLayer(buried)).png)
    let dark = 0
    for (let y = 0; y < 420; y += 2) {
      for (let x = 0; x < 640; x += 2) {
        const [r, g, b] = hidden.getImageData(x, y, 1, 1).data
        if (r! < 200 && g! < 200 && b! < 200) dark += 1
      }
    }
    expect(dark).toBe(0)
  })
})
