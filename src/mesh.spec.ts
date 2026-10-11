import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { solidBoxGlb } from './glb.js'
import { BOX_EDGES, roundedBoxGeometry } from './mesh-round.js'
import { checkFvg, renderFvg } from './render.js'
import { tessellateSvgPath } from './path.js'

const dir = mkdtempSync(join(tmpdir(), 'flexlayer-mesh-'))
writeFileSync(join(dir, 'box.glb'), solidBoxGlb([0.15, 0.82, 0.35, 1]))

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

type ImageSample = {
  width: number
  height: number
  at: (x: number, y: number) => Uint8ClampedArray
}

async function imageOf(png: Buffer): Promise<ImageSample> {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const image = ctx.getImageData(0, 0, img.width, img.height)
  return {
    width: img.width,
    height: img.height,
    at: (x, y) => image.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
  }
}

function brightest(image: ImageSample) {
  let sum = -1
  let rgba = image.at(0, 0)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const pixel = image.at(x, y)
      const next = pixel[0]! + pixel[1]! + pixel[2]!
      if (next > sum) {
        sum = next
        rgba = pixel
      }
    }
  }
  return { sum, rgba }
}

describe('网格布局', () => {
  it('sphere 的盒子是边长 2r 的正方形，box 的布局不计 depth', async () => {
    const report = await checkFvg(`
      <layer width="200" height="120" perspective="400">
        <sphere cx="40" cy="50" r="10">
        <box x="105" y="40" width="30" height="20" depth="80" />
      </layer>
    `)
    const sphere = report.elements.find((el) => el.tag === 'sphere')
    const box = report.elements.find((el) => el.tag === 'box')
    expect(sphere).toMatchObject({ box: { x: 30, y: 40, width: 20, height: 20 } })
    expect(box).toMatchObject({ box: { x: 105, y: 40, width: 30, height: 20 } })
    expect(report.issues.some((issue) => issue.code === 'unknown-tag')).toBe(false)
  })

  it('cylinder 以圆心摆放，高度是竖直长度', async () => {
    const report = await checkFvg(
      `<layer width="200" height="200" perspective="400"><cylinder cx="40" cy="50" r="10" height="30" /></layer>`,
    )
    const cylinder = report.elements.find((el) => el.tag === 'cylinder')
    expect(cylinder).toMatchObject({ box: { x: 30, y: 35, width: 20, height: 30 } })
    expect(report.issues.some((issue) => issue.code === 'unknown-tag')).toBe(false)
  })

  it('torus 的盒子包住外圆，tube 不小于 r 时退回 r/4', async () => {
    const report = await checkFvg(`
      <layer width="240" height="160" perspective="400">
        <torus cx="80" cy="40" r="20" tube="6" />
        <torus cx="180" cy="40" r="20" tube="20" />
      </layer>
    `)
    const rings = report.elements.filter((el) => el.tag === 'torus')
    expect(rings[0]).toMatchObject({ box: { x: 54, y: 14, width: 52, height: 52 } })
    expect(rings[1]).toMatchObject({ box: { x: 155, y: 15, width: 50, height: 50 } })
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('没有孔'))).toBe(true)
  })

  it('tube 的盒子是中心线四边各扩 r', async () => {
    const report = await checkFvg(
      `<layer width="200" height="80" perspective="300"><tube x="10" y="20" d="M0 0 H40" r="4" /></layer>`,
    )
    const tube = report.elements.find((el) => el.tag === 'tube')
    expect(tube).toMatchObject({ box: { x: 10, y: 20, width: 48, height: 8 } })
    const missing = await checkFvg(`<layer width="80" height="40" perspective="200"><tube d="M0 0" /></layer>`)
    expect(missing.issues.some((issue) => issue.message.includes('至少要有一段'))).toBe(true)
    expect(missing.issues.some((issue) => issue.message.includes('缺少 r'))).toBe(true)
  })

  it('extrude 按路径包围盒居中', async () => {
    const report = await checkFvg(
      `<layer width="640" height="800" perspective="700"><extrude x="250" y="600" d="M0 0 H140 V36 H90 V80 H0 Z" depth="18" /></layer>`,
    )
    const extrude = report.elements.find((el) => el.tag === 'extrude')
    expect(extrude).toMatchObject({ box: { x: 250, y: 600, width: 140, height: 80 } })
  })

  it('model 撑满外包 layer，cx 写在 model 上会警告', async () => {
    const report = await checkFvg(
      `<layer width="200" height="120"><model src="missing.glb" cx="10" /></layer>`,
      { baseDir: dir },
    )
    const model = report.elements.find((el) => el.tag === 'model')
    expect(model).toMatchObject({ box: { x: 0, y: 0, width: 200, height: 120 } })
    expect(report.issues.some((issue) => issue.code === 'missing-model')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('model'))).toBe(true)
  })

  it('不是 glb、以及没写 depth，会警告', async () => {
    const report = await checkFvg(
      `<layer width="100" height="80" perspective="300"><model src="hero.png" /><box x="30" y="35" width="20" height="10" /></layer>`,
      { baseDir: dir },
    )
    expect(report.issues.some((issue) => issue.code === 'missing-model')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('depth'))).toBe(true)
  })

  it('没有 perspective 的网格报 flatten-3d，并且不绘制', async () => {
    const source = `<layer width="80" height="80" background="#010203"><sphere cx="40" cy="40" r="20" fill="#ff0000" /></layer>`
    const report = await checkFvg(source)
    expect(report.issues.some((issue) => issue.code === 'flatten-3d')).toBe(true)
    const px = await pixelAt((await renderFvg(source)).png, 40, 40)
    expect(px[0]).toBeLessThan(20)
    expect(px[1]).toBeLessThan(20)
    expect(px[2]).toBeLessThan(20)
  })

  it('路径折线保留矩形的四个角', () => {
    const rings = tessellateSvgPath('M0 0 H10 V10 H0 Z')
    expect(rings).toHaveLength(1)
    expect(rings[0]?.closed).toBe(true)
    expect(rings[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
  })
})

describe('网格绘制', () => {
  it('球体中心有颜色，画布角仍是背景', async () => {
    const { png } = await renderFvg(
      `<layer width="160" height="160" background="#123456" perspective="500"><sphere cx="80" cy="80" r="36" fill="#ff2244" /></layer>`,
    )
    const center = await pixelAt(png, 80, 80)
    const corner = await pixelAt(png, 4, 4)
    expect(center[0]).toBeGreaterThan(140)
    expect(center[0]).toBeGreaterThan(center[1] + 30)
    expect(center[0]).toBeGreaterThan(center[2] + 30)
    expect(corner[0]).toBeGreaterThan(10)
    expect(corner[0]).toBeLessThan(40)
    expect(corner[2]).toBeGreaterThan(70)
  }, 30000)

  it('圆柱侧面有颜色，圆环中间是孔，线管跟着中心线走', async () => {
    const column = await renderFvg(
      `<layer width="160" height="180" background="#123456" perspective="500"><cylinder cx="80" cy="90" r="28" height="100" fill="#ff2244" /></layer>`,
    )
    const body = await pixelAt(column.png, 80, 90)
    const outside = await pixelAt(column.png, 8, 8)
    expect(body[0]).toBeGreaterThan(140)
    expect(body[0]).toBeGreaterThan(body[2] + 30)
    expect(outside[2]).toBeGreaterThan(70)

    const ring = await renderFvg(
      `<layer width="180" height="180" background="#010203" perspective="500"><torus cx="90" cy="90" r="40" tube="12" fill="#ff2244" /></layer>`,
    )
    const hole = await pixelAt(ring.png, 90, 90)
    const pipe = await pixelAt(ring.png, 90, 50)
    expect(hole[0]).toBeLessThan(20)
    expect(hole[2]).toBeLessThan(20)
    expect(pipe[0]).toBeGreaterThan(140)
    expect(pipe[0]).toBeGreaterThan(pipe[2] + 30)

    const hose = await renderFvg(
      `<layer width="160" height="80" background="#010203" perspective="400"><tube x="10" y="28" d="M0 12 H120" r="12" fill="#ff2244" /></layer>`,
    )
    const onHose = await pixelAt(hose.png, 82, 40)
    const offHose = await pixelAt(hose.png, 82, 8)
    expect(onHose[0]).toBeGreaterThan(140)
    expect(offHose[0]).toBeLessThan(20)

    const loop = await renderFvg(
      `<layer width="160" height="160" background="#010203" perspective="400"><tube x="20" y="20" d="M0 0 H80 V80 H0 Z" r="8" fill="#ff2244" /></layer>`,
    )
    const loopHole = await pixelAt(loop.png, 68, 68)
    const loopWall = await pixelAt(loop.png, 68, 28)
    expect(loopHole[0]).toBeLessThan(20)
    expect(loopWall[0]).toBeGreaterThan(120)
  }, 30000)

  it('更近的圆柱挡住后面的圆环', async () => {
    const { png } = await renderFvg(`
      <layer width="220" height="220" background="#000000" perspective="600">
        <torus cx="110" cy="110" r="46" tube="14" fill="#2244ff" />
        <cylinder cx="110" cy="64" r="18" height="48" z="36" fill="#ff2244" />
      </layer>
    `)
    const front = await pixelAt(png, 110, 64)
    const side = await pixelAt(png, 156, 110)
    expect(front[0]).toBeGreaterThan(front[2] + 20)
    expect(side[2]).toBeGreaterThan(side[0] + 20)
  }, 30000)

  it('更近的球体挡住长方体和平面', async () => {
    const { png } = await renderFvg(`
      <layer width="200" height="200" background="#000000" perspective="600">
        <box x="40" y="60" width="120" height="80" depth="40" fill="#2244ff" />
        <rect x="20" y="40" width="160" height="120" fill="#22cc44" z="-30" />
        <sphere cx="100" cy="100" r="26" z="50" fill="#ff2244" />
      </layer>
    `)
    const center = await pixelAt(png, 100, 100)
    const onBox = await pixelAt(png, 52, 100)
    expect(center[0]).toBeGreaterThan(center[2] + 20)
    expect(onBox[2]).toBeGreaterThan(onBox[0] + 20)
  }, 30000)

  it('extrude 的剪影跟着路径走', async () => {
    const { png } = await renderFvg(
      `<layer width="220" height="160" background="#101010" perspective="800"><extrude x="40" y="40" d="M0 0 H140 V36 H90 V80 H0 Z" depth="16" fill="#f4f1ea" /></layer>`,
    )
    const inside = await pixelAt(png, 60, 60)
    const notch = await pixelAt(png, 160, 100)
    expect(inside[0]).toBeGreaterThan(120)
    expect(inside[0]).toBeGreaterThan(notch[0] + 80)
    expect(notch[0]).toBeLessThan(40)
  }, 30000)

  it('glb 按外包 layer 居中，并使用文件里的颜色', async () => {
    const { png } = await renderFvg(
      `<layer width="180" height="180" background="#000000" perspective="700"><layer x="55" y="55" width="70" height="70"><model src="box.glb" /></layer></layer>`,
      { baseDir: dir },
    )
    const center = await pixelAt(png, 90, 90)
    const corner = await pixelAt(png, 4, 4)
    expect(center[1]).toBeGreaterThan(center[0] + 20)
    expect(center[1]).toBeGreaterThan(center[2] + 20)
    expect(corner[0]).toBeLessThan(15)
    expect(corner[1]).toBeLessThan(15)
  }, 30000)

  it('平面上的深色在有网格时不变浅，正对镜头的白方块达到 fill', async () => {
    const { png } = await renderFvg(`
      <layer width="220" height="140" background="#ffffff" perspective="500">
        <rect x="15" y="50" width="70" height="40" fill="#222222" />
        <box x="126" y="46" width="48" height="48" depth="48" fill="#ffffff" />
      </layer>
    `)
    const ink = await pixelAt(png, 50, 70)
    const face = await pixelAt(png, 150, 70)
    expect(ink[0]).toBeGreaterThan(24)
    expect(ink[0]).toBeLessThan(50)
    expect(face[0]).toBeGreaterThan(245)
    expect(face[1]).toBeGreaterThan(245)
    expect(face[2]).toBeGreaterThan(245)
  }, 30000)

  it('偏离光轴的浅色正面仍是写下的 fill', async () => {
    const { png } = await renderFvg(`
      <layer width="220" height="80" background="#ffffff" perspective="500">
        <box x="12" y="16" width="48" height="48" depth="12" fill="#d9ccff" />
        <box x="160" y="16" width="48" height="48" depth="12" fill="#a9dcff" />
      </layer>
    `)
    const left = await pixelAt(png, 36, 40)
    const right = await pixelAt(png, 184, 40)
    expect([left[0], left[1], left[2]]).toEqual([0xd9, 0xcc, 0xff])
    expect([right[0], right[1], right[2]]).toEqual([0xa9, 0xdc, 0xff])
  }, 30000)

  it('三维场景里的平面颜色保持原色阶', async () => {
    const { png } = await renderFvg(`
      <layer width="180" height="80" background="#ffffff" perspective="500">
        <rect x="20" y="20" width="60" height="40" fill="#2b6b5e" />
        <sphere cx="130" cy="40" r="18" fill="#888888" />
      </layer>
    `)
    const ink = await pixelAt(png, 50, 40)
    expect([ink[0], ink[1], ink[2]]).toEqual([0x2b, 0x6b, 0x5e])
  }, 30000)

  it('extrude 的并排形状都留下，洞仍然是洞', async () => {
    const { png } = await renderFvg(`
      <layer width="220" height="120" background="#101010" perspective="800">
        <extrude x="10" y="46" d="M0 0 H28 V28 H0 Z M52 0 H80 V28 H52 Z" depth="12" fill="#f2f2f2" />
        <extrude x="128" y="28" d="M0 0 H64 V64 H0 Z M18 18 H46 V46 H18 Z" depth="12" fill="#f2f2f2" />
      </layer>
    `)
    const left = await pixelAt(png, 28, 60)
    const gap = await pixelAt(png, 50, 60)
    const right = await pixelAt(png, 72, 60)
    const ring = await pixelAt(png, 140, 60)
    const hole = await pixelAt(png, 160, 60)
    expect(left[0]).toBeGreaterThan(180)
    expect(right[0]).toBeGreaterThan(180)
    expect(gap[0]).toBeLessThan(40)
    expect(ring[0]).toBeGreaterThan(180)
    expect(hole[0]).toBeLessThan(40)
  }, 30000)

  it('搭在另一笔上的形状仍是实体，不会被挖成洞', async () => {
    const { png } = await renderFvg(`
      <layer width="200" height="140" background="#101010" perspective="800">
        <extrude d="M0 0 H60 V24 H0 Z M30 8 L50 8 L50 16 L80 36 L40 36 L30 16 Z" depth="12" x="60" y="52" fill="#f2f2f2" />
      </layer>
    `)
    const bar = await pixelAt(png, 80, 64)
    const tip = await pixelAt(png, 130, 82)
    expect(bar[0]).toBeGreaterThan(180)
    expect(tip[0]).toBeGreaterThan(180)
  }, 30000)

  it('包着球的 layer 设了 opacity，球会跟着变透明', async () => {
    const { png } = await renderFvg(`
      <layer width="80" height="80" background="#000000" perspective="400">
        <layer opacity="0.5"><sphere cx="40" cy="40" r="18" fill="#ffffff" /></layer>
      </layer>
    `)
    const ink = await pixelAt(png, 40, 40)
    expect(ink[0]).toBeGreaterThan(70)
    expect(ink[0]).toBeLessThan(200)
  }, 30000)

  it('网格超出所在 layer 时仍画在父画布上，并在超出根画布时警告', async () => {
    const spilled = await renderFvg(`
      <layer width="200" height="120" background="#000000">
        <layer x="90" y="25" width="80" height="70" perspective="180">
          <sphere cx="16" cy="35" r="14" z="50" fill="#ff2244" />
        </layer>
      </layer>
    `)
    const layerLeft = 130 - 40
    const outside = await pixelAt(spilled.png, layerLeft - 6, 60)
    expect(outside[0]).toBeGreaterThan(80)
    expect(spilled.report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)

    const clipped = await checkFvg(
      `<layer width="80" height="80" background="#000" perspective="160"><sphere cx="14" cy="40" r="12" z="70" fill="#ff2244" /></layer>`,
    )
    expect(clipped.issues.some((issue) => issue.code === 'overflow-canvas' && issue.path.includes('sphere'))).toBe(true)
  }, 30000)

  it('hidden 没和 stroke 一起写，以及写在平面上，会警告', async () => {
    const report = await checkFvg(`
      <layer width="180" height="140" perspective="400">
        <box x="20" y="30" width="40" height="30" depth="20" hidden="#ff00ff" />
        <box x="80" y="30" width="40" height="30" depth="20" stroke-width="3" />
        <rect x="10" y="10" width="20" height="20" fill="#fff" hidden="#ff00ff" />
      </layer>
    `)
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('hidden 要和 stroke'))).toBe(true)
    expect(messages.some((message) => message.includes('stroke-width 要和 stroke'))).toBe(true)
    expect(messages.some((message) => message.includes('hidden 只写在网格上'))).toBe(true)
  })

  it('matte 是默认磨砂，和没写 material 是同一张图', async () => {
    const paint = (material: string) =>
      renderFvg(
        `<layer width="180" height="180" background="#101010" perspective="700"><sphere cx="90" cy="90" r="50" fill="#888888"${material} /></layer>`,
      )
    const plain = await imageOf((await paint('')).png)
    const matte = await imageOf((await paint(' material="matte"')).png)
    const rough = await imageOf((await paint(' material="matte 0.2"')).png)
    let mismatch = 0
    for (let y = 0; y < plain.height; y++) {
      for (let x = 0; x < plain.width; x++) {
        const a = plain.at(x, y)
        const b = matte.at(x, y)
        const c = rough.at(x, y)
        if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) mismatch++
        if (a[0] !== c[0] || a[1] !== c[1] || a[2] !== c[2] || a[3] !== c[3]) mismatch++
      }
    }
    expect(mismatch).toBe(0)
    const named = await checkFvg(
      `<layer width="120" height="120" perspective="400"><sphere cx="60" cy="60" r="20" fill="#fff" material="matte" /></layer>`,
    )
    expect(named.issues.filter((issue) => issue.code === 'invalid-attr')).toEqual([])
  }, 30000)

  it('塑料用磨砂明暗叠环境，不加缩成一点的高光', async () => {
    const paint = (material: string) =>
      renderFvg(
        `<layer width="180" height="180" background="#101010" perspective="700"><sphere cx="90" cy="90" r="50" fill="#888888"${material} /></layer>`,
      )
    const plain = await imageOf((await paint('')).png)
    const plastic = await imageOf((await paint(' material="plastic"')).png)
    const lum = (image: ImageSample, x: number, y: number) => image.at(x, y).reduce((sum, channel, index) => (index < 3 ? sum + channel : sum), 0)
    const peakP = brightest(plastic)
    const peakM = brightest(plain)
    expect(peakP.sum).toBeGreaterThan(peakM.sum + 20)
    expect(peakP.sum).toBeLessThan(200 * 3)
    let band = 0
    for (let y = 0; y < plastic.height; y++) {
      for (let x = 0; x < plastic.width; x++) {
        if (lum(plastic, x, y) > peakP.sum - 40) band++
      }
    }
    expect(band).toBeGreaterThan(40)
    expect(lum(plastic, 70, 70)).toBeGreaterThan(lum(plastic, 115, 120) + 15)
    expect(lum(plain, 70, 70)).toBeGreaterThan(lum(plain, 115, 120) + 15)
  }, 30000)

  it('金属映竖向灯板，亮带和暗带偏开正中，中间有灰过渡', async () => {
    const { png } = await renderFvg(`
      <layer width="240" height="320" background="#101010" perspective="700">
        <cylinder cx="120" cy="170" r="70" height="200" fill="#d8d8d8" material="metal 0.2" />
      </layer>
    `)
    const img = await imageOf(png)
    const lum = (x: number, y: number) => img.at(x, y).reduce((sum, channel, index) => (index < 3 ? sum + channel : sum), 0)
    const y = 170
    const samples: Array<{ x: number; lum: number }> = []
    for (let x = 70; x <= 170; x++) samples.push({ x, lum: lum(x, y) })
    const bright = samples.reduce((best, sample) => (sample.lum > best.lum ? sample : best))
    const dark = samples.reduce((best, sample) => (sample.lum < best.lum ? sample : best))
    expect(bright.lum).toBeGreaterThan(500)
    expect(dark.lum).toBeLessThan(140)
    expect(bright.x).toBeGreaterThan(132)
    expect(dark.x).toBeGreaterThan(118)
    expect(dark.x).toBeLessThan(165)
    const lo = Math.min(bright.x, dark.x)
    const hi = Math.max(bright.x, dark.x)
    const transition = samples.some((sample) => sample.x > lo && sample.x < hi && sample.lum > dark.lum + 80 && sample.lum < bright.lum - 120)
    expect(transition).toBe(true)
    for (const dy of [-60, 60]) {
      expect(lum(bright.x, y + dy)).toBeGreaterThan(bright.lum * 0.75)
      expect(lum(dark.x, y + dy)).toBeLessThan(200)
    }

    const tinted = await imageOf(
      (
        await renderFvg(
          `<layer width="180" height="180" background="#101010" perspective="700"><sphere cx="90" cy="90" r="50" fill="#cc2222" material="metal 0.2" /></layer>`,
        )
      ).png,
    )
    const peak = brightest(tinted)
    expect(peak.rgba[0]).toBeGreaterThan(peak.rgba[1]! + 40)
  }, 30000)

  it('金属球亮带旁边没有孤立的黑边', async () => {
    const { png } = await renderFvg(
      `<layer width="180" height="180" background="#c8c8c8" perspective="700"><sphere cx="90" cy="90" r="50" fill="#cc2222" material="metal 0.2" /></layer>`,
    )
    const img = await imageOf(png)
    for (const y of [76, 90, 104]) {
      for (let x = 40; x < 145; x++) {
        const [r, g, b] = img.at(x, y)
        if (r > 180 && g > 180 && b > 180) continue
        if (r > 28) continue
        const left = img.at(x - 5, y)[0]!
        const right = img.at(x + 5, y)[0]!
        expect(left > 160 && right > 160).toBe(false)
      }
    }
  })

  it('玻璃透出后面的颜色，边缘更白，前面的不透明球盖住它', async () => {
    const { png } = await renderFvg(`
      <layer width="180" height="180" background="#000000" perspective="700">
        <rect x="10" y="10" width="160" height="160" fill="#ff0000" />
        <sphere cx="90" cy="90" r="50" fill="#ffffff66" material="glass" />
      </layer>
    `)
    const glass = await imageOf(png)
    const outside = glass.at(40, 40)
    const center = glass.at(90, 90)
    expect(outside[0]).toBeGreaterThan(240)
    expect(outside[1]).toBeLessThan(8)
    expect(center[0]).toBeGreaterThan(240)
    expect(center[1]).toBeGreaterThan(50)
    expect(center[1]).toBeLessThan(160)
    expect(brightest(glass).rgba[1]).toBeGreaterThan(center[1]! + 30)

    const covered = await renderFvg(`
      <layer width="180" height="180" background="#000000" perspective="700">
        <sphere cx="90" cy="90" r="50" fill="#ffffff66" material="glass" />
        <sphere cx="90" cy="90" r="18" z="40" fill="#2244ff" />
      </layer>
    `)
    const front = await pixelAt(covered.png, 90, 90)
    expect(front[2]).toBeGreaterThan(front[0]! + 20)
  }, 30000)

  it('不认识的 material、写在平面上、粗糙度越界都会警告', async () => {
    const report = await checkFvg(`
      <layer width="200" height="160" perspective="500">
        <sphere cx="40" cy="40" r="16" material="wood" />
        <sphere cx="100" cy="40" r="16" material="metal 2" />
        <rect x="20" y="90" width="40" height="40" fill="#fff" material="plastic" />
      </layer>
    `)
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('不认识的 material'))).toBe(true)
    expect(messages.some((message) => message.includes('粗糙度'))).toBe(true)
    expect(messages.some((message) => message.includes('material 只写在网格上'))).toBe(true)
    const ok = await checkFvg(
      `<layer width="120" height="120" perspective="400"><sphere cx="60" cy="60" r="20" fill="#fff" material="metal, rough 0.35" /></layer>`,
    )
    expect(ok.issues.filter((issue) => issue.code === 'invalid-attr')).toEqual([])
  })

  it('网格上的渐变、shadow、glow 会警告', async () => {
    const report = await checkFvg(
      `<layer width="160" height="120" perspective="400"><box x="60" y="45" width="40" height="30" depth="20" fill="linear-gradient(#fff, #000)" shadow="0 8 12 #000" glow="10 #fff" /></layer>`,
    )
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('渐变'))).toBe(true)
    expect(messages.some((message) => message.includes('shadow'))).toBe(true)
    expect(messages.some((message) => message.includes('glow'))).toBe(true)
  })

  it('倾斜圆环的墨迹贴着画出来的像素', async () => {
    const source = `<layer width="240" height="180" background="#ffffff" perspective="800"><torus cx="120" cy="90" r="40" tube="12" fill="#ff2244" rotateX="64" /></layer>`
    const { png, report } = await renderFvg(source)
    expect(report.issues.filter((issue) => issue.code === 'overflow-canvas')).toEqual([])
    const torus = report.elements.find((el) => el.tag === 'torus')
    expect(torus).toBeTruthy()
    const img = await imageOf(png)
    let minX = img.width
    let minY = img.height
    let maxX = 0
    let maxY = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r, g, b] = img.at(x, y)
        if (r > 180 && g < 80 && b < 120) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    expect(maxX).toBeGreaterThan(minX + 20)
    const ink = torus!.ink
    expect(Math.abs(ink.x - minX)).toBeLessThan(8)
    expect(Math.abs(ink.y - minY)).toBeLessThan(8)
    expect(Math.abs(ink.right - (maxX + 1))).toBeLessThan(8)
    expect(Math.abs(ink.bottom - (maxY + 1))).toBeLessThan(8)
    const tight = await checkFvg(
      `<layer width="200" height="130" background="#ffffff" perspective="800"><torus cx="100" cy="68" r="40" tube="12" fill="#ff2244" rotateX="64" /></layer>`,
    )
    expect(tight.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
  })

  it('网格斜边有抗锯齿过渡', async () => {
    const { png } = await renderFvg(
      `<layer width="200" height="200" background="#000000" perspective="800"><box x="20" y="93" width="160" height="14" depth="2" rotate="24" fill="#ffffff" /></layer>`,
    )
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    const at = (x: number, y: number) => data[(y * img.width + x) * 4] ?? 0
    let hard = 0
    let soft = 0
    for (let x = 30; x < 170; x++) {
      let kind = 'none'
      let prev = at(x, 30)
      for (let y = 31; y < 170; y++) {
        const v = at(x, y)
        if (prev < 12 && v > 243) {
          kind = 'hard'
          break
        }
        if (prev < 12 && v >= 12) {
          kind = 'soft'
          break
        }
        prev = v
      }
      if (kind === 'hard') hard++
      else if (kind === 'soft') soft++
    }
    expect(at(100, 100)).toBeGreaterThan(250)
    expect(at(8, 8)).toBeLessThan(8)
    expect(soft).toBeGreaterThan(80)
    expect(hard).toBeLessThan(8)
  }, 30000)

  it('box 的 rx 不改变布局，round 选棱，放不下就收小', async () => {
    const report = await checkFvg(`
      <layer width="240" height="160" perspective="400">
        <box x="20" y="30" width="80" height="60" depth="40" rx="12" round="front, top-left" />
        <box x="120" y="30" width="80" height="40" depth="20" rx="40" />
        <box x="20" y="110" width="40" height="30" depth="20" round="x" />
        <box x="80" y="110" width="40" height="30" depth="20" rx="8" round="nope" />
      </layer>
    `)
    const boxes = report.elements.filter((el) => el.tag === 'box')
    expect(boxes[0]).toMatchObject({ box: { x: 20, y: 30, width: 80, height: 60 } })
    expect(boxes[1]).toMatchObject({ box: { x: 120, y: 30, width: 80, height: 40 } })
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('已从 40 收到 10'))).toBe(true)
    expect(messages.some((message) => message.includes('没有正的 rx'))).toBe(true)
    expect(messages.some((message) => message.includes('不认识「nope」'))).toBe(true)
    expect(messages.some((message) => message.includes('没有选中棱'))).toBe(true)
  })

  it('cylinder 的 rx 只圆口缘，不改变布局', async () => {
    const report = await checkFvg(`
      <layer width="200" height="160" perspective="400">
        <cylinder cx="50" cy="60" r="20" height="80" rx="8" round="top" />
        <cylinder cx="140" cy="60" r="20" height="80" rx="30" />
      </layer>
    `)
    const cylinders = report.elements.filter((el) => el.tag === 'cylinder')
    expect(cylinders[0]).toMatchObject({ box: { x: 30, y: 20, width: 40, height: 80 } })
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('已从 30 收到 20'))).toBe(true)
  })

  it('圆角盒子的顶点落在球面附近，不超出原盒子', () => {
    const hw = 40
    const hh = 40
    const hd = 20
    const rx = 16
    const built = roundedBoxGeometry(hw, hh, hd, rx, BOX_EDGES)
    expect(built.indices.length % 3).toBe(0)
    expect(built.indices.length).toBeGreaterThan(200)
    let nearSphere = false
    const center = { x: hw - rx, y: hh - rx, z: hd - rx }
    for (let i = 0; i < built.positions.length; i += 3) {
      const x = built.positions[i]!
      const y = built.positions[i + 1]!
      const z = built.positions[i + 2]!
      expect(Math.abs(x)).toBeLessThanOrEqual(hw + 1e-4)
      expect(Math.abs(y)).toBeLessThanOrEqual(hh + 1e-4)
      expect(Math.abs(z)).toBeLessThanOrEqual(hd + 1e-4)
      const dist = Math.hypot(x - center.x, y - center.y, z - center.z)
      if (Math.abs(dist - rx) < 0.05) nearSphere = true
    }
    expect(nearSphere).toBe(true)
  })

  it('box 圆角：z 向棱挖掉正面角，沿宽的棱和正面四棱仍是直角轮廓', async () => {
    const shot = async (round?: string) => {
      const attr = round ? ` round="${round}"` : ''
      const { png } = await renderFvg(
        `<layer width="160" height="160" background="#010203" perspective="4000"><box x="40" y="40" width="80" height="80" depth="40" rx="16"${attr} fill="#ff2244" /></layer>`,
      )
      return {
        corner: await pixelAt(png, 41, 41),
        inside: await pixelAt(png, 52, 52),
        center: await pixelAt(png, 80, 80),
      }
    }
    const painted = (px: Uint8ClampedArray) => px[0]! > 80
    const all = await shot()
    const depthEdges = await shot('z')
    const widthEdges = await shot('x')
    const front = await shot('front')
    expect(painted(all.center)).toBe(true)
    expect(painted(all.inside)).toBe(true)
    expect(painted(all.corner)).toBe(false)
    expect(painted(depthEdges.corner)).toBe(false)
    expect(painted(depthEdges.inside)).toBe(true)
    expect(painted(widthEdges.corner)).toBe(true)
    expect(painted(front.corner)).toBe(true)
    expect(painted(front.center)).toBe(true)
  }, 30000)

  it('cylinder 的圆口只挖掉被选中的那一端', async () => {
    const shot = async (round?: string) => {
      const attr = round ? ` round="${round}"` : ''
      const { png } = await renderFvg(
        `<layer width="160" height="200" background="#010203" perspective="4000"><cylinder cx="80" cy="100" r="40" height="120" rx="16"${attr} fill="#ff2244" /></layer>`,
      )
      return {
        top: await pixelAt(png, 41, 41),
        bottom: await pixelAt(png, 41, 158),
        mid: await pixelAt(png, 80, 100),
      }
    }
    const painted = (px: Uint8ClampedArray) => px[0]! > 80
    const both = await shot()
    const topOnly = await shot('top')
    const bottomOnly = await shot('bottom')
    expect(painted(both.mid)).toBe(true)
    expect(painted(both.top)).toBe(false)
    expect(painted(both.bottom)).toBe(false)
    expect(painted(topOnly.top)).toBe(false)
    expect(painted(topOnly.bottom)).toBe(true)
    expect(painted(bottomOnly.top)).toBe(true)
    expect(painted(bottomOnly.bottom)).toBe(false)
  }, 30000)

  it('圆弧挤出的采样比八个切面更密', () => {
    const rings = tessellateSvgPath('M -40 0 A 40 40 0 1 1 40 0 A 40 40 0 1 1 -40 0 Z', 16, Math.PI / 24)
    expect(rings[0]!.points.length).toBeGreaterThan(40)
  })
})
