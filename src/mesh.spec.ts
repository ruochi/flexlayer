import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { parseGlb, solidBoxGlb } from './glb.js'
import { BOX_EDGES, roundedBoxGeometry } from './mesh-round.js'
import { bevelFewFaces, bevelRadius } from './mesh-bevel.js'
import { MATCAP_DEFAULTS, MATCAP_NAMES } from './matcaps.js'
import { checkLayer, renderLayer } from './render.js'
import { tessellateSvgPath } from './path.js'
import { boxBottom, boxRight } from './types.js'

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
    const report = await checkLayer(`
      <layer width="200" height="120" camera="400">
        <sphere cx="40" cy="50" r="10">
        <rect x="105" y="40" width="30" height="20" depth="80" />
      </layer>
    `)
    const sphere = report.elements.find((el) => el.tag === 'sphere')
    const box = report.elements.find((el) => el.tag === 'rect')
    expect(sphere).toMatchObject({ box: { x: 30, y: 40, width: 20, height: 20 } })
    expect(box).toMatchObject({ box: { x: 105, y: 40, width: 30, height: 20 } })
    expect(report.issues.some((issue) => issue.code === 'unknown-tag')).toBe(false)
  })

  it('cylinder 以圆心摆放，高度是竖直长度', async () => {
    const report = await checkLayer(
      `<layer width="200" height="200" camera="400"><cylinder cx="40" cy="50" r="10" height="30" /></layer>`,
    )
    const cylinder = report.elements.find((el) => el.tag === 'cylinder')
    expect(cylinder).toMatchObject({ box: { x: 30, y: 35, width: 20, height: 30 } })
    expect(report.issues.some((issue) => issue.code === 'unknown-tag')).toBe(false)
  })

  it('torus 的盒子包住外圆，tube 不小于 r 时退回 r/4', async () => {
    const report = await checkLayer(`
      <layer width="240" height="160" camera="400">
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
    const report = await checkLayer(
      `<layer width="200" height="80" camera="300"><tube x="10" y="20" d="M0 0 H40" r="4" /></layer>`,
    )
    const tube = report.elements.find((el) => el.tag === 'tube')
    expect(tube).toMatchObject({ box: { x: 6, y: 16, width: 48, height: 8 } })
    const placed = await checkLayer(
      `<layer width="640" height="480" camera="parallel"><tube d="M140 50 H300 V210" r="18" fill="#d7dde6" /></layer>`,
    )
    const pipe = placed.elements.find((el) => el.tag === 'tube')
    expect(pipe).toMatchObject({ box: { x: 122, y: 32, width: 196, height: 196 } })
    const { png } = await renderLayer(
      `<layer width="640" height="480" background="#010203" camera="parallel"><tube d="M140 50 H300 V210" r="18" fill="#ff2244" /></layer>`,
    )
    const onPipe = await pixelAt(png, 140, 50)
    const offPipe = await pixelAt(png, 140, 20)
    expect(onPipe[0]).toBeGreaterThan(140)
    expect(offPipe[0]).toBeLessThan(20)
    const missing = await checkLayer(`<layer width="80" height="40" camera="200"><tube d="M0 0" /></layer>`)
    expect(missing.issues.some((issue) => issue.message.includes('至少要有一段'))).toBe(true)
    expect(missing.issues.some((issue) => issue.message.includes('缺少 r'))).toBe(true)
  })

  it('extrude 按路径包围盒居中', async () => {
    const report = await checkLayer(
      `<layer width="640" height="800" camera="700"><path x="250" y="600" d="M0 0 H140 V36 H90 V80 H0 Z" depth="18" /></layer>`,
    )
    const extrude = report.elements.find((el) => el.tag === 'path')
    expect(extrude).toMatchObject({ box: { x: 250, y: 600, width: 140, height: 80 } })
  })

  it('model 没写盒子也没写 unit 时报错，hint 给出父层尺寸', async () => {
    const report = await checkLayer(
      `<layer width="200" height="120"><model src="missing.glb" cx="10" /></layer>`,
      { baseDir: dir },
    )
    const box = report.issues.find((issue) => issue.level === 'error' && issue.message.includes('width'))
    expect(box?.code).toBe('invalid-attr')
    expect(box?.hint).toContain('x="0" y="0" width="200" height="120"')
    expect(report.issues.some((issue) => issue.code === 'missing-model')).toBe(true)
    expect(report.issues.some((issue) => issue.message.includes('cx'))).toBe(true)
    const loose = await checkLayer(`<layer><model src="box.glb" /></layer>`, { baseDir: dir })
    const generic = loose.issues.find((issue) => issue.level === 'error' && issue.message.includes('width'))
    expect(generic?.hint).toContain('width="200" height="200"')
    expect(generic?.hint).toContain('unit="40"')
  })

  it('不是 glb 会警告', async () => {
    const report = await checkLayer(
      `<layer width="100" height="80" camera="300"><model src="hero.png" x="0" y="0" width="100" height="80" /><rect x="30" y="35" width="20" height="10" depth="8" /></layer>`,
      { baseDir: dir },
    )
    expect(report.issues.some((issue) => issue.code === 'missing-model')).toBe(true)
    expect(report.issues.some((issue) => issue.message.includes('depth'))).toBe(false)
  })

  it('不写 camera 的网格报 flatten-3d，不再用层高当视距', async () => {
    const source = `<layer width="80" height="80" background="#010203"><sphere cx="40" cy="40" r="20" fill="#ff0000" /></layer>`
    const report = await checkLayer(source)
    const hit = report.issues.find((issue) => issue.code === 'flatten-3d')
    expect(hit?.level).toBe('error')
    expect(hit?.hint).toContain('camera="900"')
    const explicit = `<layer width="80" height="80" background="#010203" camera="80"><sphere cx="40" cy="40" r="20" fill="#ff0000" /></layer>`
    const png = await renderLayer(explicit)
    const px = await pixelAt(png.png, 40, 40)
    expect(px[0]).toBeGreaterThan(80)
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
    const { png } = await renderLayer(
      `<layer width="160" height="160" background="#123456" camera="500"><sphere cx="80" cy="80" r="36" fill="#ff2244" /></layer>`,
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
    const column = await renderLayer(
      `<layer width="160" height="180" background="#123456" camera="500"><cylinder cx="80" cy="90" r="28" height="100" fill="#ff2244" /></layer>`,
    )
    const body = await pixelAt(column.png, 80, 90)
    const outside = await pixelAt(column.png, 8, 8)
    expect(body[0]).toBeGreaterThan(140)
    expect(body[0]).toBeGreaterThan(body[2] + 30)
    expect(outside[2]).toBeGreaterThan(70)

    const ring = await renderLayer(
      `<layer width="180" height="180" background="#010203" camera="500"><torus cx="90" cy="90" r="40" tube="12" fill="#ff2244" /></layer>`,
    )
    const hole = await pixelAt(ring.png, 90, 90)
    const pipe = await pixelAt(ring.png, 90, 50)
    expect(hole[0]).toBeLessThan(20)
    expect(hole[2]).toBeLessThan(20)
    expect(pipe[0]).toBeGreaterThan(140)
    expect(pipe[0]).toBeGreaterThan(pipe[2] + 30)

    const hose = await renderLayer(
      `<layer width="160" height="80" background="#010203" camera="400"><tube x="10" y="28" d="M0 12 H120" r="12" fill="#ff2244" /></layer>`,
    )
    const onHose = await pixelAt(hose.png, 82, 40)
    const offHose = await pixelAt(hose.png, 82, 8)
    expect(onHose[0]).toBeGreaterThan(140)
    expect(offHose[0]).toBeLessThan(20)

    const loop = await renderLayer(
      `<layer width="160" height="160" background="#010203" camera="400"><tube x="20" y="20" d="M0 0 H80 V80 H0 Z" r="8" fill="#ff2244" /></layer>`,
    )
    const loopHole = await pixelAt(loop.png, 68, 68)
    const loopWall = await pixelAt(loop.png, 68, 20)
    expect(loopHole[0]).toBeLessThan(20)
    expect(loopWall[0]).toBeGreaterThan(120)
  }, 30000)

  it('直角管子的拐角是圆的，尖角外侧没有颜色', async () => {
    const { png } = await renderLayer(
      `<layer width="320" height="320" background="#010203" camera="parallel"><tube d="M40 80 H240 V280" r="20" fill="#ff2244" /></layer>`,
    )
    const image = await imageOf(png)
    expect(image.at(100, 80)[0]).toBeGreaterThan(140)
    expect(image.at(238, 82)[0]).toBeGreaterThan(140)
    expect(image.at(260, 60)[0]).toBeLessThan(20)
    const centerX = 210
    const centerY = 110
    const limit = 30 + 20 + 2
    for (let y = 50; y <= 80; y++) {
      for (let x = 210; x <= 270; x++) {
        if (Math.hypot(x - centerX, y - centerY) <= limit) continue
        expect(image.at(x, y)[0]).toBeLessThan(40)
      }
    }
  }, 30000)

  it('更近的圆柱挡住后面的圆环', async () => {
    const { png } = await renderLayer(`
      <layer width="220" height="220" background="#000000" camera="600">
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
    const { png } = await renderLayer(`
      <layer width="200" height="200" background="#000000" camera="600">
        <rect x="40" y="60" width="120" height="80" depth="40" fill="#2244ff" />
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
    const { png } = await renderLayer(
      `<layer width="220" height="160" background="#101010" camera="800"><path x="40" y="40" d="M0 0 H140 V36 H90 V80 H0 Z" depth="16" fill="#f4f1ea" /></layer>`,
    )
    const inside = await pixelAt(png, 60, 60)
    const notch = await pixelAt(png, 160, 100)
    expect(inside[0]).toBeGreaterThan(120)
    expect(inside[0]).toBeGreaterThan(notch[0] + 80)
    expect(notch[0]).toBeLessThan(40)
  }, 30000)

  it('盒子形式把模型 contain 进盒子并居中', async () => {
    const { png } = await renderLayer(
      `<layer width="220" height="120" background="#000000" camera="parallel"><model x="10" y="20" width="180" height="60" src="box.glb" /></layer>`,
      { baseDir: dir },
    )
    const center = await pixelAt(png, 100, 50)
    const outside = await pixelAt(png, 20, 50)
    const inside = await pixelAt(png, 100, 25)
    expect(center[1]).toBeGreaterThan(center[0] + 20)
    expect(inside[1]).toBeGreaterThan(inside[0] + 20)
    expect(outside[1]).toBeLessThan(15)
  }, 30000)

  it('unit 形式把模型原点放在 x y', async () => {
    const report = await checkLayer(
      `<layer width="160" height="120" camera="parallel"><model src="box.glb" unit="20" x="80" y="60" /></layer>`,
      { baseDir: dir },
    )
    const model = report.elements.find((el) => el.tag === 'model')
    expect(model).toMatchObject({ box: { x: 60, y: 40, width: 40, height: 40 } })
    const { png } = await renderLayer(
      `<layer width="160" height="120" background="#000000" camera="parallel"><model src="box.glb" unit="20" x="80" y="60" /></layer>`,
      { baseDir: dir },
    )
    const origin = await pixelAt(png, 80, 60)
    const outside = await pixelAt(png, 80, 36)
    expect(origin[1]).toBeGreaterThan(origin[0] + 20)
    expect(outside[1]).toBeLessThan(15)
  }, 30000)

  it('model 的影子仍然落在 ground 上', async () => {
    const { png } = await renderLayer(
      `<layer width="200" height="200" background="#ffffff" camera="200"><model src="box.glb" unit="20" x="100" y="80" /><ground x="100" y="150" rotateX="90" shadow-opacity="0.9" shadow-blur="0" /></layer>`,
      { baseDir: dir },
    )
    const image = await imageOf(png)
    const clear = image.at(16, 180)
    expect(clear[0]! * 0.3 + clear[1]! * 0.59 + clear[2]! * 0.11).toBeGreaterThan(240)
    let darkest = 255
    for (let y = 120; y < 190; y += 2) {
      for (let x = 40; x < 170; x += 2) {
        const px = image.at(x, y)
        darkest = Math.min(darkest, px[0]! * 0.3 + px[1]! * 0.59 + px[2]! * 0.11)
      }
    }
    expect(darkest).toBeLessThan(180)
  }, 30000)

  it('glb 按自己的盒子居中，并使用文件里的颜色', async () => {
    const { png } = await renderLayer(
      `<layer width="180" height="180" background="#000000" camera="700"><model x="55" y="55" width="70" height="70" src="box.glb" /></layer>`,
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
    const { png } = await renderLayer(`
      <layer width="220" height="140" background="#ffffff" camera="500">
        <rect x="15" y="50" width="70" height="40" fill="#222222" />
        <rect x="126" y="46" width="48" height="48" depth="48" fill="#ffffff" />
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
    const { png } = await renderLayer(`
      <layer width="220" height="80" background="#ffffff" camera="500">
        <rect x="12" y="16" width="48" height="48" depth="12" fill="#d9ccff" />
        <rect x="160" y="16" width="48" height="48" depth="12" fill="#a9dcff" />
      </layer>
    `)
    const left = await pixelAt(png, 36, 40)
    const right = await pixelAt(png, 184, 40)
    expect([left[0], left[1], left[2]]).toEqual([0xd9, 0xcc, 0xff])
    expect([right[0], right[1], right[2]]).toEqual([0xa9, 0xdc, 0xff])
  }, 30000)

  it('三维场景里的平面颜色保持原色阶', async () => {
    const { png } = await renderLayer(`
      <layer width="180" height="80" background="#ffffff" camera="500">
        <rect x="20" y="20" width="60" height="40" fill="#2b6b5e" />
        <sphere cx="130" cy="40" r="18" fill="#888888" />
      </layer>
    `)
    const ink = await pixelAt(png, 50, 40)
    expect([ink[0], ink[1], ink[2]]).toEqual([0x2b, 0x6b, 0x5e])
  }, 30000)

  it('extrude 的并排形状都留下，洞仍然是洞', async () => {
    const { png } = await renderLayer(`
      <layer width="220" height="120" background="#101010" camera="800">
        <path x="10" y="46" d="M0 0 H28 V28 H0 Z M52 0 H80 V28 H52 Z" depth="12" fill="#f2f2f2" />
        <path x="128" y="28" d="M0 0 H64 V64 H0 Z M18 18 V46 H46 V18 Z" depth="12" fill="#f2f2f2" />
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

  it('rect 加 depth 挤出盒子，box 和 extrude 不再是标签', async () => {
    const { png } = await renderLayer(
      `<layer width="180" height="140" background="#010203" camera="500"><rect x="40" y="30" width="80" height="60" depth="36" fill="#ff2244" rotateY="-32" /></layer>`,
    )
    const face = await pixelAt(png, 70, 60)
    expect(face[0]).toBeGreaterThan(80)
    const report = await checkLayer(
      `<layer width="180" height="140" camera="500"><box x="40" y="30" width="80" height="60" depth="36" fill="#ff2244" /><extrude d="M0 0 H40 V20 H0 Z" depth="8" /></layer>`,
    )
    const hits = report.issues.filter((issue) => issue.code === 'unknown-tag')
    expect(hits.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('box'), expect.stringContaining('extrude')]),
    )
    expect(hits.every((issue) => issue.level === 'error')).toBe(true)
    expect(hits.find((issue) => issue.message.includes('box'))?.hint).toContain('rect')
    expect(hits.find((issue) => issue.message.includes('extrude'))?.hint).toContain('path')
    expect(report.elements.some((element) => element.tag === 'box' || element.tag === 'extrude')).toBe(false)
  }, 30000)

  it('circle 加 depth 是朝向镜头的圆柱', async () => {
    const { png } = await renderLayer(
      `<layer width="120" height="120" background="#010203" camera="parallel"><circle cx="60" cy="60" r="28" depth="40" fill="#ff2244" /></layer>`,
    )
    const center = await pixelAt(png, 60, 60)
    const outside = await pixelAt(png, 60, 16)
    expect(center[0]).toBeGreaterThan(140)
    expect(outside[0]).toBeLessThan(20)
  }, 30000)

  it('path 加 depth 按 fill-rule 留洞', async () => {
    const scene = (rule: string) =>
      `<layer width="120" height="120" background="#101010" camera="parallel"><path d="M16 16 H96 V96 H16 Z M32 32 H80 V80 H32 Z" depth="12" fill="#f2f2f2" fill-rule="${rule}" /></layer>`
    const nonzero = await pixelAt((await renderLayer(scene('nonzero'))).png, 56, 56)
    const even = await pixelAt((await renderLayer(scene('evenodd'))).png, 56, 56)
    expect(nonzero[0]).toBeGreaterThan(180)
    expect(even[0]).toBeLessThan(40)
  }, 30000)

  it('transform 的 rotateX 和属性是同一套姿态', async () => {
    const attr = await renderLayer(
      `<layer width="160" height="120" background="#010203" camera="400"><rect x="30" y="24" width="90" height="60" depth="28" fill="#44aaff" rotateX="48" /></layer>`,
    )
    const fn = await renderLayer(
      `<layer width="160" height="120" background="#010203" camera="400"><rect x="30" y="24" width="90" height="60" depth="28" fill="#44aaff" transform="rotateX(48)" /></layer>`,
    )
    const a = await pixelAt(attr.png, 75, 54)
    const b = await pixelAt(fn.png, 75, 54)
    expect([b[0], b[1], b[2]]).toEqual([a[0], a[1], a[2]])
  }, 30000)

  it('搭在另一笔上的形状仍是实体，不会被挖成洞', async () => {
    const { png } = await renderLayer(`
      <layer width="200" height="140" background="#101010" camera="800">
        <path d="M0 0 H60 V24 H0 Z M30 8 L50 8 L50 16 L80 36 L40 36 L30 16 Z" depth="12" x="60" y="52" fill="#f2f2f2" />
      </layer>
    `)
    const bar = await pixelAt(png, 80, 64)
    const tip = await pixelAt(png, 130, 82)
    expect(bar[0]).toBeGreaterThan(180)
    expect(tip[0]).toBeGreaterThan(180)
  }, 30000)

  it('包着球的 layer 设了 opacity，球会跟着变透明', async () => {
    const { png } = await renderLayer(`
      <layer width="80" height="80" background="#000000" camera="400">
        <layer width="80" height="80" opacity="0.5"><sphere cx="40" cy="40" r="18" fill="#ffffff" /></layer>
      </layer>
    `)
    const ink = await pixelAt(png, 40, 40)
    expect(ink[0]).toBeGreaterThan(70)
    expect(ink[0]).toBeLessThan(200)
  }, 30000)

  it('网格超出所在 layer 时仍画在父画布上，并在超出根画布时警告', async () => {
    const spilled = await renderLayer(`
      <layer width="200" height="120" background="#000000">
        <layer x="90" y="25" width="80" height="70" camera="180">
          <sphere cx="16" cy="35" r="14" z="50" fill="#ff2244" />
        </layer>
      </layer>
    `)
    const layerLeft = 130 - 40
    const outside = await pixelAt(spilled.png, layerLeft - 6, 60)
    expect(outside[0]).toBeGreaterThan(80)
    expect(spilled.report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)

    const clipped = await checkLayer(
      `<layer width="80" height="80" background="#000" camera="160"><sphere cx="14" cy="40" r="12" z="70" fill="#ff2244" /></layer>`,
    )
    expect(clipped.issues.some((issue) => issue.code === 'overflow-canvas' && issue.path.includes('sphere'))).toBe(true)
  }, 30000)

  it('hidden 没和 stroke 一起写，以及写在平面上，会警告', async () => {
    const report = await checkLayer(`
      <layer width="180" height="140" camera="400">
        <rect x="20" y="30" width="40" height="30" depth="20" hidden="#ff00ff" />
        <rect x="80" y="30" width="40" height="30" depth="20" stroke-width="3" />
        <rect x="10" y="10" width="20" height="20" fill="#fff" hidden="#ff00ff" />
      </layer>
    `)
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('hidden 要和 stroke'))).toBe(true)
    expect(messages.some((message) => message.includes('stroke-width 要和 stroke'))).toBe(true)
    expect(messages.some((message) => message.includes('hidden 只写在实体上'))).toBe(true)
  })

  it('matte 是默认磨砂，和没写 material 是同一张图', async () => {
    const paint = (material: string) =>
      renderLayer(
        `<layer width="180" height="180" background="#101010" camera="700"><sphere cx="90" cy="90" r="50" fill="#888888"${material} /></layer>`,
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
    const named = await checkLayer(
      `<layer width="120" height="120" camera="400"><sphere cx="60" cy="60" r="20" fill="#fff" material="matte" /></layer>`,
    )
    expect(named.issues.filter((issue) => issue.code === 'invalid-attr')).toEqual([])
  }, 30000)

  it('塑料用磨砂明暗叠环境，不加缩成一点的高光', async () => {
    const paint = (material: string) =>
      renderLayer(
        `<layer width="180" height="180" background="#101010" camera="700"><sphere cx="90" cy="90" r="50" fill="#888888"${material} /></layer>`,
      )
    const plain = await imageOf((await paint('')).png)
    const plastic = await imageOf((await paint(' material="plastic 0.4"')).png)
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

  it('金属映出摄影棚的伞灯，亮部和暗部分开，中间有过渡', async () => {
    const { png } = await renderLayer(`
      <layer width="240" height="320" background="#101010" camera="700">
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
    expect(bright.x).toBeLessThan(120)
    expect(Math.abs(bright.x - dark.x)).toBeGreaterThan(20)
    const lo = Math.min(bright.x, dark.x)
    const hi = Math.max(bright.x, dark.x)
    const transition = samples.some((sample) => sample.x > lo && sample.x < hi && sample.lum > dark.lum + 80 && sample.lum < bright.lum - 120)
    expect(transition).toBe(true)
    // The umbrella streak slants a few pixels down the cylinder. It is a thin
    // line; the old frame-wide smoother was what kept it on one column.
    for (const dy of [-60, 60]) {
      let band = 0
      let shade = 9999
      for (let dx = -16; dx <= 16; dx++) {
        band = Math.max(band, lum(bright.x + dx, y + dy))
        shade = Math.min(shade, lum(dark.x + dx, y + dy))
      }
      expect(band).toBeGreaterThan(bright.lum * 0.75)
      expect(shade).toBeLessThan(200)
    }

    const tinted = await imageOf(
      (
        await renderLayer(
          `<layer width="180" height="180" background="#101010" camera="700"><sphere cx="90" cy="90" r="50" fill="#cc2222" material="metal 0.2" /></layer>`,
        )
      ).png,
    )
    const peak = brightest(tinted)
    expect(peak.rgba[0]).toBeGreaterThan(peak.rgba[1]! + 40)
  }, 30000)

  it('金属球亮带旁边没有孤立的黑边', async () => {
    const { png } = await renderLayer(
      `<layer width="180" height="180" background="#c8c8c8" camera="700"><sphere cx="90" cy="90" r="50" fill="#cc2222" material="metal 0.2" /></layer>`,
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

  it('粗糙度越高，金属和玻璃的暗部越抬起来，噪点不跟着变密', async () => {
    const lum = (px: Uint8ClampedArray) => 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!
    const disk = (image: ImageSample) => {
      let sum = 0
      let n = 0
      const lums: number[] = []
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const dx = x - 90
          const dy = y - 90
          if (dx * dx + dy * dy > 40 * 40) continue
          const value = lum(image.at(x, y))
          lums.push(value)
          sum += value
          n++
        }
      }
      let diffs = 0
      let pairs = 0
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width - 1; x++) {
          const dx = x - 90
          const dy = y - 90
          const dx2 = x + 1 - 90
          if (dx * dx + dy * dy > 36 * 36 || dx2 * dx2 + dy * dy > 36 * 36) continue
          diffs += Math.abs(lum(image.at(x, y)) - lum(image.at(x + 1, y)))
          pairs++
        }
      }
      lums.sort((a, b) => a - b)
      return {
        mean: sum / n,
        p10: lums[Math.floor(lums.length * 0.1)]!,
        p90: lums[Math.floor(lums.length * 0.9)]!,
        noise: diffs / pairs,
        peak: lums[lums.length - 1]!,
      }
    }
    const metal = async (rough: string) =>
      disk(await imageOf((await renderLayer(
        `<layer width="180" height="180" background="#101010" camera="700"><sphere cx="90" cy="90" r="50" fill="#d8d8d8" material="metal ${rough}" /></layer>`,
      )).png))
    const glass = async (rough: string) =>
      disk(await imageOf((await renderLayer(
        `<layer width="180" height="180" background="#000000" camera="700"><rect x="10" y="10" width="160" height="160" fill="#ff0000" /><sphere cx="90" cy="90" r="50" fill="#ffffff66" material="glass ${rough}" /></layer>`,
      )).png))
    const sharp = await metal('0.05')
    const rough = await metal('1')
    expect(rough.mean).toBeGreaterThan(sharp.mean + 30)
    expect(rough.p10).toBeGreaterThan(sharp.p10 + 30)
    expect(sharp.peak).toBeGreaterThan(200)
    // Polished metal keeps the environment's own grain. The cap is the
    // unsmeared sphere, not the frame-wide luma clamp that used to flatten it.
    expect(sharp.noise).toBeLessThan(12)
    expect(rough.noise).toBeLessThan(sharp.noise)
    const clear = await glass('0.08')
    const frosted = await glass('1')
    expect(frosted.p10).toBeGreaterThan(clear.p10 + 25)
    expect(frosted.mean).toBeGreaterThan(clear.mean + 5)
    expect(clear.peak).toBeGreaterThan(frosted.peak)
    expect(clear.noise).toBeLessThan(12)
    expect(frosted.noise).toBeLessThan(clear.noise)
  }, 30000)

  it('玻璃把主灯加进球里，没照到的地方透出后面，前面的不透明球盖住它', async () => {
    const { png } = await renderLayer(`
      <layer width="180" height="180" background="#000000" camera="700">
        <rect x="10" y="10" width="160" height="160" fill="#ff0000" />
        <sphere cx="90" cy="90" r="50" fill="#ffffff66" material="glass" />
      </layer>
    `)
    const glass = await imageOf(png)
    const outside = glass.at(40, 40)
    expect(outside[0]).toBeGreaterThan(240)
    expect(outside[1]).toBeLessThan(8)
    let windowCount = 0
    let bodyRed = 0
    for (let y = 50; y < 130; y++) {
      for (let x = 50; x < 130; x++) {
        const dx = x - 90
        const dy = y - 90
        if (dx * dx + dy * dy > 46 * 46) continue
        const pixel = glass.at(x, y)
        const lum = 0.2126 * pixel[0]! + 0.7152 * pixel[1]! + 0.0722 * pixel[2]!
        if (lum > 140 && pixel[1]! > 80) windowCount++
        if (x > 104 && pixel[0]! > 130 && pixel[0]! > pixel[1]! + 80) bodyRed++
      }
    }
    expect(windowCount).toBeGreaterThan(80)
    expect(bodyRed).toBeGreaterThan(40)

    const covered = await renderLayer(`
      <layer width="180" height="180" background="#000000" camera="700">
        <sphere cx="90" cy="90" r="50" fill="#ffffff66" material="glass" />
        <sphere cx="90" cy="90" r="18" z="40" fill="#2244ff" />
      </layer>
    `)
    const front = await pixelAt(covered.png, 90, 90)
    expect(front[2]).toBeGreaterThan(front[0]! + 20)
  }, 30000)

  it('不认识的 material、写在平面上、粗糙度越界都会警告', async () => {
    const report = await checkLayer(`
      <layer width="200" height="160" camera="500">
        <sphere cx="40" cy="40" r="16" material="wood" />
        <sphere cx="100" cy="40" r="16" material="metal 2" />
        <rect x="20" y="90" width="40" height="40" fill="#fff" material="plastic" />
      </layer>
    `)
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('不认识的 material'))).toBe(true)
    expect(messages.some((message) => message.includes('粗糙度'))).toBe(true)
    expect(messages.some((message) => message.includes('material 只写在实体上'))).toBe(true)
    const ok = await checkLayer(
      `<layer width="120" height="120" camera="400"><sphere cx="60" cy="60" r="20" fill="#fff" material="metal, rough 0.35" /></layer>`,
    )
    expect(ok.issues.filter((issue) => issue.code === 'invalid-attr')).toEqual([])
  })

  it('材质球名字跟插件一致，没写 fill 用表里的颜色，名字后面的数字要删掉', async () => {
    const require = createRequire(import.meta.url)
    const native = require(fileURLToPath(new URL('../native/flexlayer-render/index.cjs', import.meta.url))) as {
      matcapNames: () => string
    }
    const rows = native
      .matcapNames()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, color] = line.split(' ')
        return { name, color }
      })
    expect(rows.map((row) => row.name)).toEqual(MATCAP_NAMES)
    expect(Object.fromEntries(rows.map((row) => [row.name, row.color]))).toEqual(MATCAP_DEFAULTS)

    const paint = (material: string, fill = '') =>
      renderLayer(
        `<layer width="80" height="80" background="#101010" camera="400"><sphere cx="40" cy="40" r="24"${fill} material="${material}" /></layer>`,
      )
    const bare = await imageOf((await paint('clay')).png)
    const tinted = await imageOf((await paint('clay', ' fill="#d4cfc4"')).png)
    const legacy = await imageOf((await paint('plastic 0.4', ' fill="#888888"')).png)
    const baked = await imageOf((await paint('plastic', ' fill="#888888"')).png)
    let same = 0
    let differ = 0
    for (let y = 0; y < bare.height; y++) {
      for (let x = 0; x < bare.width; x++) {
        const a = bare.at(x, y)
        const b = tinted.at(x, y)
        if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]) same++
        const c = legacy.at(x, y)
        const d = baked.at(x, y)
        if (c[0] !== d[0] || c[1] !== d[1] || c[2] !== d[2]) differ++
      }
    }
    expect(same).toBe(bare.width * bare.height)
    expect(differ).toBeGreaterThan(20)

    const numbered = await checkLayer(
      `<layer width="120" height="120" camera="400"><sphere cx="60" cy="60" r="20" material="clay 0.2" /></layer>`,
    )
    const issue = numbered.issues.find((item) => item.message.includes('不写粗糙度'))
    expect(issue?.hint).toContain('删掉数字')
    const kept = await checkLayer(
      `<layer width="120" height="120" camera="400"><sphere cx="60" cy="60" r="20" fill="#fff" material="metal 0.35" /></layer>`,
    )
    expect(kept.issues.filter((item) => item.code === 'invalid-attr')).toEqual([])
  }, 30000)

  it('brushed 的银色在低机位下顶面仍然读得出', async () => {
    const { png } = await renderLayer(`
      <layer width="1440" height="1800" background="#f6f3ee">
        <layer width="1440" height="1800" camera="fov 28, orbit 16 14">
          <layer x="310" y="1030" width="980" height="650" origin="490 0" rotateX="90">
            <rect x="0" y="0" width="980" height="650" rx="14" fill="#c8ccd1" material="brushed" depth="28" />
          </layer>
          <layer x="318" y="380" width="980" height="650" origin="490 650" rotateX="8">
            <rect x="0" y="0" width="980" height="650" rx="4" fill="#c8ccd1" material="brushed" depth="8" z="-10" />
          </layer>
          <ground y="1044" rotateX="90" fill="#efe8df" shadow-blur="36" shadow-opacity="0.34" />
        </layer>
      </layer>
    `)
    const image = await imageOf(png)
    const luma = (x: number, y: number) => {
      const px = image.at(x, y)
      return 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!
    }
    const average = (x0: number, y0: number, x1: number, y1: number) => {
      let sum = 0
      let count = 0
      for (let y = y0; y < y1; y += 4) {
        for (let x = x0; x < x1; x += 4) {
          sum += luma(x, y)
          count += 1
        }
      }
      return sum / count
    }
    expect(average(600, 1100, 900, 1180)).toBeGreaterThan(140)
    expect(average(500, 500, 900, 800)).toBeLessThan(240)
  }, 30000)

  it('邻近实体多时掌托上没有方块', async () => {
    const { png } = await renderLayer(`
      <layer width="1440" height="1800" background="#f6f3ee">
        <layer width="1440" height="1800" camera="fov 28, orbit 16 14">
          <layer x="310" y="1030" width="980" height="650" origin="490 0" rotateX="90">
            <rect x="0" y="0" width="980" height="650" rx="14" fill="#c6c9ce" material="metal" depth="28" />
            <rect x="70" y="36" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="140" y="36" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="210" y="36" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="280" y="36" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="350" y="36" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="420" y="36" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="70" y="84" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="140" y="84" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="210" y="84" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="280" y="84" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="350" y="84" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
            <rect x="420" y="84" width="50" height="32" rx="2" fill="#222327" material="plastic" depth="4" z="16" />
          </layer>
          <layer x="318" y="390" width="980" height="650" origin="490 650" rotateX="15" cast-shadow="false">
            <rect x="0" y="0" width="980" height="650" rx="14" fill="#c6c9ce" material="metal" depth="10" />
          </layer>
          <ground y="1044" rotateX="90" fill="#efe8df" shadow-blur="36" shadow-opacity="0.34" />
        </layer>
      </layer>
    `)
    const image = await imageOf(png)
    const luma = (x: number, y: number) => {
      const px = image.at(x, y)
      return 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!
    }
    let max = 0
    for (let y = 1048; y < 1108; y++) {
      for (let x = 608; x < 727; x++) {
        max = Math.max(max, Math.abs(luma(x, y) - luma(x + 1, y)))
      }
    }
    // 修复前同一块金属上相邻像素差 24.8，修复后是 1.0。
    expect(max).toBeLessThan(4)
  }, 30000)

  it('网格上的渐变、shadow、glow 会警告', async () => {
    const report = await checkLayer(
      `<layer width="160" height="120" camera="400"><rect x="60" y="45" width="40" height="30" depth="20" fill="linear-gradient(#fff, #000)" shadow="0 8 12 #000" glow="10 #fff" /></layer>`,
    )
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('渐变'))).toBe(true)
    expect(messages.some((message) => message.includes('shadow'))).toBe(true)
    expect(messages.some((message) => message.includes('glow'))).toBe(true)
  })

  it('倾斜圆环的墨迹贴着画出来的像素', async () => {
    const source = `<layer width="240" height="180" background="#ffffff" camera="800"><torus cx="120" cy="90" r="40" tube="12" fill="#ff2244" rotateX="64" /></layer>`
    const { png, report } = await renderLayer(source)
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
    expect(Math.abs(boxRight(ink) - (maxX + 1))).toBeLessThan(8)
    expect(Math.abs(boxBottom(ink) - (maxY + 1))).toBeLessThan(8)
    const tight = await checkLayer(
      `<layer width="200" height="130" background="#ffffff" camera="800"><torus cx="100" cy="68" r="40" tube="12" fill="#ff2244" rotateX="64" /></layer>`,
    )
    expect(tight.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(false)
  })

  it('网格斜边有抗锯齿过渡', async () => {
    const { png } = await renderLayer(
      `<layer width="200" height="200" background="#000000" camera="800"><rect x="20" y="93" width="160" height="14" depth="2" rotate="24" fill="#ffffff" /></layer>`,
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
    // Coverage still softens most columns. A diagonal can stay a 0-to-255
    // step: edge smoothing no longer repaints the mesh.
    expect(hard).toBeLessThan(soft)
  }, 30000)

  it('box 的 rx 不改变布局，round 选棱，放不下就收小', async () => {
    const report = await checkLayer(`
      <layer width="240" height="160" camera="400">
        <rect x="20" y="30" width="80" height="60" depth="40" rx="12" round="front, top-left" />
        <rect x="120" y="30" width="80" height="40" depth="20" rx="40" />
        <rect x="20" y="110" width="40" height="30" depth="20" round="x" />
        <rect x="80" y="110" width="40" height="30" depth="20" rx="8" round="nope" />
      </layer>
    `)
    const boxes = report.elements.filter((el) => el.tag === 'rect')
    expect(boxes[0]).toMatchObject({ box: { x: 20, y: 30, width: 80, height: 60 } })
    expect(boxes[1]).toMatchObject({ box: { x: 120, y: 30, width: 80, height: 40 } })
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('已从 40 收到 10'))).toBe(true)
    expect(messages.some((message) => message.includes('没有正的 rx'))).toBe(true)
    expect(messages.some((message) => message.includes('不认识「nope」'))).toBe(true)
    expect(messages.some((message) => message.includes('没有选中棱'))).toBe(true)
  })

  it('cylinder 的 rx 只圆口缘，不改变布局', async () => {
    const report = await checkLayer(`
      <layer width="200" height="160" camera="400">
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

  it('面数不超过 200 的网格在渲染时加窄圆角，再多就保持原样', () => {
    const hw = 50
    const hh = 40
    const hd = 30
    const positions: number[] = []
    const indices: number[] = []
    const faces = [
      [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]],
      [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]],
      [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]],
      [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]],
      [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]],
      [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]],
    ]
    for (const face of faces) {
      const base = positions.length / 3
      for (const p of face) positions.push(p[0]!, p[1]!, p[2]!)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const built = bevelFewFaces(Float32Array.from(positions), Uint32Array.from(indices))
    expect(built).toBeTruthy()
    const r = bevelRadius(hd * 2)
    const center = { x: hw - r, y: hh - r, z: hd - r }
    let onSphere = 0
    for (let i = 0; i < built!.positions.length; i += 3) {
      const x = built!.positions[i]!
      const y = built!.positions[i + 1]!
      const z = built!.positions[i + 2]!
      expect(Math.abs(x)).toBeLessThanOrEqual(hw + 1e-3)
      expect(Math.abs(y)).toBeLessThanOrEqual(hh + 1e-3)
      expect(Math.abs(z)).toBeLessThanOrEqual(hd + 1e-3)
      if (x > center.x && y > center.y && z > center.z) {
        const dist = Math.hypot(x - center.x, y - center.y, z - center.z)
        expect(Math.abs(dist - r)).toBeLessThan(0.08)
        onSphere++
      }
    }
    expect(onSphere).toBeGreaterThan(4)

    const many: number[] = []
    const manyIdx: number[] = []
    for (let i = 0; i < 201; i++) {
      const base = i * 3
      many.push(i * 10, 0, 0, i * 10 + 1, 0, 0, i * 10, 1, 0.2 + i * 0.01)
      manyIdx.push(base, base + 1, base + 2)
    }
    expect(bevelFewFaces(Float32Array.from(many), Uint32Array.from(manyIdx))).toBeNull()
  })

  it('八角钻石不超过 200 个面，窄圆角向里收，不超出原来的盒子', () => {
    const prim = parseGlb(readFileSync(join(process.cwd(), 'examples/diamond.glb')))[0]!
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < prim.positions.length; i += 3) {
      minX = Math.min(minX, prim.positions[i]!)
      maxX = Math.max(maxX, prim.positions[i]!)
      minY = Math.min(minY, prim.positions[i + 1]!)
      maxY = Math.max(maxY, prim.positions[i + 1]!)
      minZ = Math.min(minZ, prim.positions[i + 2]!)
      maxZ = Math.max(maxZ, prim.positions[i + 2]!)
    }
    const s = 210 / (maxX - minX)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    const positions = new Float32Array(prim.positions.length)
    let bminX = Infinity
    let bminY = Infinity
    let bminZ = Infinity
    let bmaxX = -Infinity
    let bmaxY = -Infinity
    let bmaxZ = -Infinity
    for (let i = 0; i < prim.positions.length; i += 3) {
      positions[i] = (prim.positions[i]! - cx) * s
      positions[i + 1] = (prim.positions[i + 1]! - cy) * s
      positions[i + 2] = (prim.positions[i + 2]! - cz) * s
      bminX = Math.min(bminX, positions[i]!)
      bmaxX = Math.max(bmaxX, positions[i]!)
      bminY = Math.min(bminY, positions[i + 1]!)
      bmaxY = Math.max(bmaxY, positions[i + 1]!)
      bminZ = Math.min(bminZ, positions[i + 2]!)
      bmaxZ = Math.max(bmaxZ, positions[i + 2]!)
    }
    const indices = prim.indices!
    const built = bevelFewFaces(positions, indices)
    expect(built).toBeTruthy()
    expect(built!.indices.length).toBeGreaterThan(indices.length)
    // QUALITY-5 §4 1px floor can leave a sub-unit outward lip on acute tips;
    // keep the shell inside the pre-bevel AABB within 0.4 world.
    for (let i = 0; i < built!.positions.length; i += 3) {
      expect(built!.positions[i]!).toBeGreaterThanOrEqual(bminX - 0.4)
      expect(built!.positions[i]!).toBeLessThanOrEqual(bmaxX + 0.4)
      expect(built!.positions[i + 1]!).toBeGreaterThanOrEqual(bminY - 0.4)
      expect(built!.positions[i + 1]!).toBeLessThanOrEqual(bmaxY + 0.4)
      expect(built!.positions[i + 2]!).toBeGreaterThanOrEqual(bminZ - 0.4)
      expect(built!.positions[i + 2]!).toBeLessThanOrEqual(bmaxZ + 0.4)
    }
  })

  it('圆柱只在侧面和底面的折棱上收圆角，侧面竖缝保持原样', () => {
    const radius = 40
    const half = 50
    const segments = 48
    const positions: number[] = []
    const indices: number[] = []
    const ring: number[] = []
    for (let iy = 0; iy < 2; iy++) {
      const y = iy === 0 ? half : -half
      for (let ix = 0; ix < segments; ix++) {
        const theta = (ix / segments) * Math.PI * 2
        ring.push(positions.length / 3)
        positions.push(radius * Math.cos(theta), y, radius * Math.sin(theta))
      }
    }
    for (let ix = 0; ix < segments; ix++) {
      const a = ring[ix]!
      const a2 = ring[(ix + 1) % segments]!
      const b = ring[segments + ix]!
      const b2 = ring[segments + ((ix + 1) % segments)]!
      indices.push(a, a2, b, a2, b2, b)
    }
    const cap = (y: number, up: boolean) => {
      const center = positions.length / 3
      positions.push(0, y, 0)
      const base = up ? 0 : segments
      for (let ix = 0; ix < segments; ix++) {
        const a = ring[base + ix]!
        const b = ring[base + ((ix + 1) % segments)]!
        if (up) indices.push(center, b, a)
        else indices.push(center, a, b)
      }
    }
    cap(half, true)
    cap(-half, false)
    const built = bevelFewFaces(Float32Array.from(positions), Uint32Array.from(indices))
    expect(built).toBeTruthy()
    const fillet = bevelRadius(radius * 2)
    let capInset = 0
    let sideInset = 0
    for (let i = 0; i < built!.positions.length; i += 3) {
      const x = built!.positions[i]!
      const y = built!.positions[i + 1]!
      const z = built!.positions[i + 2]!
      const radial = Math.hypot(x, z)
      expect(radial).toBeLessThanOrEqual(radius + 0.2)
      expect(Math.abs(y)).toBeLessThanOrEqual(half + 0.2)
      if (Math.abs(y) > half - 0.5 && radial < radius - fillet * 0.6) capInset++
      if (radial > radius - 0.5 && Math.abs(y) < half - fillet * 0.6) sideInset++
    }
    expect(capInset).toBeGreaterThan(8)
    expect(sideInset).toBeGreaterThan(8)
  })

  it('五星和细挤出按厚度的 1/40 收棱，尖角往里让', () => {
    const prism = (depth: number) => {
      const outer = 50
      const inner = 20
      const points: Array<[number, number]> = []
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? outer : inner
        points.push([r * Math.cos(ang), r * Math.sin(ang)])
      }
      const positions: number[] = []
      const indices: number[] = []
      const half = depth / 2
      const front: number[] = []
      const back: number[] = []
      for (const [x, y] of points) {
        front.push(positions.length / 3)
        positions.push(x, y, half)
      }
      for (const [x, y] of points) {
        back.push(positions.length / 3)
        positions.push(x, y, -half)
      }
      const fan = (ring: number[], z: number, outward: number) => {
        const c = positions.length / 3
        positions.push(0, 0, z)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!
          const b = ring[(i + 1) % ring.length]!
          if (outward > 0) indices.push(c, a, b)
          else indices.push(c, b, a)
        }
      }
      fan(front, half, 1)
      fan(back, -half, -1)
      for (let i = 0; i < points.length; i++) {
        const a = front[i]!
        const b = front[(i + 1) % points.length]!
        const c = back[i]!
        const d = back[(i + 1) % points.length]!
        indices.push(a, c, b, c, d, b)
      }
      return bevelFewFaces(Float32Array.from(positions), Uint32Array.from(indices), bevelRadius(depth))
    }

    expect(bevelRadius(40)).toBe(1)
    expect(bevelRadius(16)).toBe(0.4)
    const built = prism(40)
    expect(built).toBeTruthy()
    let minY = Infinity
    for (let i = 0; i < built!.positions.length; i += 3) {
      if (built!.positions[i + 2]! > 18) minY = Math.min(minY, built!.positions[i + 1]!)
    }
    expect(minY).toBeGreaterThan(-50 + 0.4)
    expect(minY).toBeLessThan(-50 + 6)
    expect(prism(16)).toBeTruthy()
  })

  it('渲染时五星和带洞的挤出按屏幕尺度倒角收尖角', async () => {
    // QUALITY-5 §1.1: bevel is screen-scaled (~1 px (QUALITY-5 §4), ≤ depth×0.12), not
    // depth/40. Crops: flexlayer-render/docs/quality/q5-crops/bevel-*.png.
    // Thick tips still darken vs thin; a 1 px bevel does not carve a 200²
    // frame corner all the way to black the way depth/40 (=3) used to.
    const star = async (depth: number) => {
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 70 : 28
        pts.push(`${100 + r * Math.cos(ang)},${100 + r * Math.sin(ang)}`)
      }
      const { png } = await renderLayer(
        `<layer width="200" height="200" background="#000000" camera="parallel"><polygon points="${pts.join(' ')}" depth="${depth}" fill="#e8b04a" /></layer>`,
      )
      return imageOf(png)
    }
    const thinStar = await star(8)
    const thickStar = await star(80)
    // QUALITY-5 §4: ~1 px bevel (with a small world-radius floor). Thin tips
    // stay bright; thick tips darken relative to thin.
    expect(thinStar.at(100, 32)[0]).toBeGreaterThan(170)
    expect(thickStar.at(100, 32)[0]).toBeLessThan(thinStar.at(100, 32)[0] - 15)
    expect(thickStar.at(100, 48)[0]).toBeGreaterThan(180)

    const frame = async (depth: number) => {
      const { png } = await renderLayer(
        `<layer width="200" height="200" background="#000000" camera="parallel"><path d="M20 20 H180 V180 H20 Z M60 60 V140 H140 V60 Z" depth="${depth}" fill="#e8b04a" /></layer>`,
      )
      return imageOf(png)
    }
    const thinFrame = await frame(8)
    const thickFrame = await frame(120)
    // QUALITY-5 §4 ~1px bevel: thin keeps a bright tip; thick still darkens the
    // outer corner relative to thin (absolute codes moved with the smaller lip).
    expect(thinFrame.at(20, 20)[0]).toBeGreaterThan(165)
    expect(thickFrame.at(20, 20)[0]).toBeLessThan(thinFrame.at(20, 20)[0]! - 40)
    expect(thickFrame.at(20, 20)[0]).toBeLessThan(130)
    expect(thickFrame.at(40, 40)[0]).toBeGreaterThan(180)
    expect(thickFrame.at(80, 80)[0]).toBeLessThan(40)
  })

  it('box 圆角：z 向棱挖掉正面角，沿宽的棱和正面四棱仍是直角轮廓', async () => {
    const shot = async (round?: string) => {
      const attr = round ? ` round="${round}"` : ''
      const { png } = await renderLayer(
        `<layer width="160" height="160" background="#010203" camera="4000"><rect x="40" y="40" width="80" height="80" depth="40" rx="16"${attr} fill="#ff2244" /></layer>`,
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
      const { png } = await renderLayer(
        `<layer width="160" height="200" background="#010203" camera="4000"><cylinder cx="80" cy="100" r="40" height="120" rx="16"${attr} fill="#ff2244" /></layer>`,
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

describe('shading', () => {
  const sphere = `<sphere cx="80" cy="80" r="36" fill="#ff2244" />`

  it('省略和 studio 是同一张图', async () => {
    const omitted = await renderLayer(`<layer width="160" height="160" background="#123456" camera="500">${sphere}</layer>`)
    const studio = await renderLayer(`<layer width="160" height="160" background="#123456" camera="500" shading="studio">${sphere}</layer>`)
    expect(studio.png.equals(omitted.png)).toBe(true)
  }, 30000)

  it('toon 和影棚不同，轮廓是墨色', async () => {
    const studio = await renderLayer(`<layer width="160" height="160" background="#f6f3ec" camera="500">${sphere}</layer>`)
    const toon = await renderLayer(`<layer width="160" height="160" background="#f6f3ec" camera="500" shading="toon">${sphere}</layer>`)
    expect(toon.png.equals(studio.png)).toBe(false)
    const image = await imageOf(toon.png)
    let ink = 0
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const pixel = image.at(x, y)
        if (pixel[0]! < 45 && pixel[1]! < 45 && pixel[2]! < 45 && pixel[3]! > 200) ink++
      }
    }
    expect(ink).toBeGreaterThan(20)
  }, 30000)

  it('没有镜头时 shading 报 invalid-attr', async () => {
    const report = await checkLayer(`<layer width="80" height="80" shading="toon"><rect width="40" height="20" fill="#fff" /></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-attr' && issue.message.includes('shading'))
    expect(hit?.message).toContain('shading')
  })

  it('无法解析的值报 invalid-attr', async () => {
    const report = await checkLayer(`<layer width="80" height="80" camera="200" shading="oil"><sphere cx="40" cy="40" r="16" /></layer>`)
    const hit = report.issues.find((issue) => issue.code === 'invalid-attr' && issue.message.includes('shading'))
    expect(hit?.hint).toContain('studio')
  })

  it('technical 的隐藏线落在实体轮廓里', async () => {
    const scene = (shading: string) =>
      `<layer width="220" height="180" background="#241f1b" camera="fov 30, orbit 28 18, distance 640, at 110 100 0" shading="${shading}"><ground y="150" rotateX="90" fill="#e7e0d4" /><cylinder cx="110" cy="108" r="26" height="80" fill="#e0a33a" /></layer>`
    const technical = await imageOf((await renderLayer(scene('technical'))).png)
    const studio = await imageOf((await renderLayer(scene('studio'))).png)
    const { width, height } = technical
    const near = (px: Uint8ClampedArray, rgb: number[], slack: number) => {
      const d = Math.hypot(px[0]! - rgb[0]!, px[1]! - rgb[1]!, px[2]! - rgb[2]!)
      return d < slack
    }
    const solid = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = studio.at(x, y)
        if (px[3]! < 200 || near(px, [36, 31, 27], 12) || near(px, [231, 224, 212], 18)) continue
        solid[y * width + x] = 1
      }
    }
    const dist = new Float32Array(width * height).fill(1e6)
    for (let i = 0; i < solid.length; i++) if (solid[i]) dist[i] = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1]! + 1)
        if (y > 0) dist[i] = Math.min(dist[i], dist[i - width]! + 1)
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x
        if (x + 1 < width) dist[i] = Math.min(dist[i], dist[i + 1]! + 1)
        if (y + 1 < height) dist[i] = Math.min(dist[i], dist[i + width]! + 1)
      }
    }
    let hidden = 0
    let outside = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = technical.at(x, y)
        const base = studio.at(x, y)
        const hid = Math.hypot(px[0]! - 154, px[1]! - 143, px[2]! - 128)
        const ink = Math.hypot(px[0]! - 28, px[1]! - 25, px[2]! - 21)
        const changed = Math.hypot(px[0]! - base[0]!, px[1]! - base[1]!, px[2]! - base[2]!)
        if (hid > 28 || hid > ink || changed < 24) continue
        hidden++
        if (dist[y * width + x]! > 2) outside++
      }
    }
    expect(hidden).toBeGreaterThan(20)
    expect(outside).toBe(0)
  }, 30000)

  it('作者写的 stroke 在 technical 下仍是红色', async () => {
    const { png } = await renderLayer(
      `<layer width="160" height="160" background="#f6f3ec" camera="500" shading="technical"><sphere cx="80" cy="80" r="36" fill="#88aacc" stroke="#ff0000" /></layer>`,
    )
    const image = await imageOf(png)
    let red = 0
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const pixel = image.at(x, y)
        if (pixel[0]! > 200 && pixel[1]! < 40 && pixel[2]! < 40) red++
      }
    }
    expect(red).toBeGreaterThan(10)
  }, 30000)
})

/**
 * QUALITY-6 §C.3. The three renderer faults the example plates exposed, each
 * pinned to one measurable claim.
 *
 * The example pictures showed three things that look like renderer bugs: a
 * scene where one solid shows its underside and another its top, a red block
 * with a comb of noise along an edge, and a wireframe whose edges break where a
 * bar crosses them. Each test below decides which of those is real. The first
 * and the third turned out to be the examples; the tests say so, and say why,
 * so a future change cannot quietly reintroduce the reading.
 */
describe('QUALITY-6 §C: 三个渲染器问题', () => {
  it('透视自洽：一块板的远端边缘比近端短，两块板朝同一消失方向收', async () => {
    // One camera, two plates turned the same way. If each plate opened its own
    // camera they would converge toward different points, or not at all. A
    // plate turned by rotateY=28 pushes its right edge away from the camera, so
    // that edge has to be shorter than the left one.
    const CYAN = (p: Uint8ClampedArray) => p[0]! < 120 && p[1]! > 140 && p[2]! > 170
    const source = `<layer width="480" height="320" background="#0f1115" camera="700">
      <rect width="160" height="220" fill="#4CC3D9" x="60" y="60" rotateY="28" z="40" />
      <rect width="160" height="220" fill="#4CC3D9" x="260" y="60" rotateY="28" z="40" />
    </layer>`
    const { png } = await renderLayer(source)
    const image = await imageOf(png)
    // For each plate, the vertical extent of the fill a few columns in from
    // each side.
    const edges = (x0: number, x1: number) => {
      const span = (x: number) => {
        let lo = Infinity
        let hi = -1
        for (let y = 0; y < image.height; y++) {
          if (!CYAN(image.at(x, y))) continue
          if (y < lo) lo = y
          if (y > hi) hi = y
        }
        return hi < 0 ? 0 : hi - lo + 1
      }
      return { left: span(x0 + 3), right: span(x1 - 3) }
    }
    const bounds = (from: number, to: number) => {
      let x0 = Infinity
      let x1 = -1
      for (let y = 0; y < image.height; y++) {
        for (let x = from; x < to; x++) {
          if (!CYAN(image.at(x, y))) continue
          if (x < x0) x0 = x
          if (x > x1) x1 = x
        }
      }
      return { x0, x1 }
    }
    const a = bounds(0, image.width / 2)
    const b = bounds(image.width / 2, image.width)
    const ea = edges(a.x0, a.x1)
    const eb = edges(b.x0, b.x1)
    // The far edge is shorter, on both plates, by a visible amount.
    expect(ea.right).toBeLessThan(ea.left - 8)
    expect(eb.right).toBeLessThan(eb.left - 8)
    // And the two plates agree on the ratio: one camera, not two.
    expect(Math.abs(ea.right / ea.left - eb.right / eb.left)).toBeLessThan(0.06)
  }, 30000)

  it('z-fighting：两块共面的面不产生逐像素明暗梳齿', async () => {
    // Two quads at the same depth with different fills would fight for the same
    // pixels and produce a comb. The renderer resolves the tie by draw order,
    // so the result is one flat fill: no alternating high-contrast run.
    const source = `<layer width="200" height="160" background="#0f1115" camera="600">
      <rect x="30" y="30" width="140" height="100" fill="#d23b3b" z="0" />
      <rect x="30" y="30" width="140" height="100" fill="#d23b3b" z="0" />
    </layer>`
    const { png } = await renderLayer(source)
    const image = await imageOf(png)
    const Y = (x: number, y: number) => {
      const p = image.at(x, y)
      return 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!
    }
    let pairs = 0
    let alternating = 0
    for (let y = 34; y < 126; y++) {
      for (let x = 34; x < 166; x++) {
        const here = Y(x, y)
        const next = Y(x + 1, y)
        const step = next - here
        if (Math.abs(step) <= 24) continue
        pairs++
        if (Math.sign(Y(x + 2, y) - next) === -Math.sign(step) && Math.abs(Y(x + 2, y) - next) > 24) alternating++
      }
    }
    expect(pairs).toBe(0)
    expect(alternating).toBe(0)
  }, 30000)

  it('线框在杆穿过处不断开：隐藏线仍是连续的一列', async () => {
    // A hollow box with `hidden` drawn behind a solid bar. The bar covers the
    // hidden line, but the box's own outline above and below the bar stays
    // solid: no gap where the bar meets it.
    const source = `<layer width="320" height="240" background="#f3efe6" camera="700">
      <rect x="80" y="50" width="150" height="130" depth="100" fill="none" stroke="#1c1915" stroke-width="3 2 1" hidden="#9a8f80" />
      <rect x="120" y="100" width="80" height="24" fill="#d7c4a3" />
    </layer>`
    const { png } = await renderLayer(source)
    const image = await imageOf(png)
    const isInk = (x: number, y: number) => {
      const p = image.at(x, y)
      return p[0]! < 90 && p[1]! < 90 && p[2]! < 90
    }
    // The box's left outline is a vertical run of ink. Find its column and walk
    // it from top to bottom; a break longer than the stroke width means the
    // outline was cut.
    let bestX = -1
    let bestRun = 0
    for (let x = 70; x < 120; x++) {
      let run = 0
      for (let y = 40; y < 200; y++) if (isInk(x, y)) run++
      if (run > bestRun) {
        bestRun = run
        bestX = x
      }
    }
    expect(bestX).toBeGreaterThan(0)
    // The outline is ~130 tall; a gap at the bar would cut it to well under 100.
    expect(bestRun).toBeGreaterThan(110)
  }, 30000)
})

/**
 * QUALITY-6 §E.3. §7.4's minimal model reported `overflow-canvas` while its ink
 * sat well inside the page. The cause was the report, not the renderer: a
 * contain-fitted `model` was measured with the authored box, so a shape whose
 * fitted extent was narrower than the box still reported the box's corners.
 * Under an orbit camera those corners project wider than the picture even when
 * every painted pixel is inside it.
 */
describe('QUALITY-6 §E: contain-fit model ink', () => {
  it('着墨框是 contain 之后的实际范围，不是作者写的盒子', async () => {
    const report = await checkLayer(
      `<layer width="480" height="360" camera="parallel">
        <model src="box.glb" x="80" y="40" width="320" height="280" />
      </layer>`,
      { baseDir: dir },
    )
    const model = report.elements.find((el) => el.tag === 'model')
    expect(model).toBeDefined()
    // A 2×2×2 box fitted into 320×280 keeps its proportions, so it is 280 on
    // every axis and centered: 20 px of empty box on each side. Under a parallel
    // camera the ink is exactly that fitted square.
    expect(model!.ink.width).toBeCloseTo(280, 0)
    expect(model!.ink.height).toBeCloseTo(280, 0)
    expect(model!.ink.x).toBeCloseTo(100, 0)
    expect(report.issues.filter((issue) => issue.code === 'overflow-canvas')).toHaveLength(0)
  }, 30000)

  it('模型真的伸出画布时仍然报 overflow-canvas', async () => {
    const report = await checkLayer(
      `<layer width="200" height="200" camera="fov 30, orbit 20 18">
        <model src="box.glb" x="0" y="0" width="400" height="400" />
      </layer>`,
      { baseDir: dir },
    )
    expect(report.issues.some((issue) => issue.code === 'overflow-canvas')).toBe(true)
  }, 30000)
})
