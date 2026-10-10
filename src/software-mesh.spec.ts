import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { solidBoxGlb } from './glb.js'
import { checkFvg, renderFvg } from './render.js'
import type { RenderOptions } from './types.js'

const dir = mkdtempSync(join(tmpdir(), 'flexlayer-software-mesh-'))
writeFileSync(join(dir, 'box.glb'), solidBoxGlb([0.15, 0.82, 0.35, 1]))

function render(source: string, options: RenderOptions = {}) {
  return renderFvg(source, options)
}

async function pixelAt(png: Buffer, x: number, y: number) {
  const img = await loadImage(png)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(x, y, 1, 1).data
}

describe('软件光栅', () => {
  it('球体中心有颜色，画布角仍是背景', async () => {
    const { png } = await render(
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
  })

  it('更近的球体挡住长方体和平面', async () => {
    const { png } = await render(`
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
  })

  it('extrude 的剪影跟着路径走', async () => {
    const { png } = await render(
      `<layer width="220" height="160" background="#101010" perspective="800"><extrude x="40" y="40" d="M0 0 H140 V36 H90 V80 H0 Z" depth="16" fill="#f4f1ea" /></layer>`,
    )
    const inside = await pixelAt(png, 60, 60)
    const notch = await pixelAt(png, 160, 100)
    expect(inside[0]).toBeGreaterThan(120)
    expect(inside[0]).toBeGreaterThan(notch[0] + 80)
    expect(notch[0]).toBeLessThan(40)
  })

  it('glb 按外包 layer 居中，并使用文件里的颜色', async () => {
    const { png } = await render(
      `<layer width="180" height="180" background="#000000" perspective="700"><layer x="55" y="55" width="70" height="70"><model src="box.glb" /></layer></layer>`,
      { baseDir: dir },
    )
    const center = await pixelAt(png, 90, 90)
    const corner = await pixelAt(png, 4, 4)
    expect(center[1]).toBeGreaterThan(center[0] + 20)
    expect(center[1]).toBeGreaterThan(center[2] + 20)
    expect(corner[0]).toBeLessThan(15)
    expect(corner[1]).toBeLessThan(15)
  })

  it('平面上的深色在有网格时不变浅，正对镜头的白方块达到 fill', async () => {
    const { png } = await render(`
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
  })

  it('偏离光轴的浅色正面仍是写下的 fill', async () => {
    const { png } = await render(`
      <layer width="220" height="80" background="#ffffff" perspective="500">
        <box x="12" y="16" width="48" height="48" depth="12" fill="#d9ccff" />
        <box x="160" y="16" width="48" height="48" depth="12" fill="#a9dcff" />
      </layer>
    `)
    const left = await pixelAt(png, 36, 40)
    const right = await pixelAt(png, 184, 40)
    expect([left[0], left[1], left[2]]).toEqual([0xd9, 0xcc, 0xff])
    expect([right[0], right[1], right[2]]).toEqual([0xa9, 0xdc, 0xff])
  })

  it('球体沿主光在平面上投下影子，没挡住的地方仍是 fill', async () => {
    const { png } = await render(`
      <layer width="240" height="240" background="#ffffff" perspective="800">
        <rect x="10" y="100" width="220" height="120" fill="#ffffff" />
        <sphere cx="70" cy="70" r="24" z="70" fill="#ff2244" />
      </layer>
    `)
    const shade = await pixelAt(png, 112, 130)
    const open = await pixelAt(png, 210, 200)
    const sphere = await pixelAt(png, 65, 65)
    expect(shade[0]).toBeLessThan(180)
    expect(Math.abs(shade[0] - shade[1])).toBeLessThan(12)
    expect(Math.abs(shade[1] - shade[2])).toBeLessThan(12)
    expect(open[0]).toBeGreaterThan(245)
    expect(open[1]).toBeGreaterThan(245)
    expect(open[2]).toBeGreaterThan(245)
    expect(sphere[0]).toBeGreaterThan(sphere[1] + 30)
    expect(sphere[0]).toBeGreaterThan(140)
  })

  it('球体的影子落在长方体正面，没挡住的正面仍是 fill', async () => {
    const { png } = await render(`
      <layer width="420" height="360" background="#d9d3c7" perspective="800">
        <box x="150" y="115" width="160" height="150" depth="20" fill="#f4f1ea" />
        <sphere cx="130" cy="110" r="28" z="48" fill="#e23d3d" />
      </layer>
    `)
    const shade = await pixelAt(png, 168, 158)
    const open = await pixelAt(png, 280, 240)
    expect(shade[0]).toBeLessThan(open[0] - 40)
    expect(Math.abs(shade[0] - shade[1])).toBeLessThan(12)
    expect([open[0], open[1], open[2]]).toEqual([0xf4, 0xf1, 0xea])
  })

  it('更靠近主光的长方体挡住后面的平面', async () => {
    const { png } = await render(`
      <layer width="240" height="240" background="#ffffff" perspective="800">
        <rect x="50" y="80" width="180" height="140" fill="#ffffff" />
        <box x="52" y="45" width="36" height="70" depth="36" z="48" fill="#3355aa" />
      </layer>
    `)
    const shade = await pixelAt(png, 102, 128)
    const open = await pixelAt(png, 210, 200)
    expect(shade[0]).toBeLessThan(180)
    expect(Math.abs(shade[0] - shade[1])).toBeLessThan(12)
    expect(open[0]).toBeGreaterThan(245)
    expect(open[1]).toBeGreaterThan(245)
    expect(open[2]).toBeGreaterThan(245)
  })

  it('三维场景里的平面颜色保持原色阶', async () => {
    const { png } = await render(`
      <layer width="180" height="80" background="#ffffff" perspective="500">
        <rect x="20" y="20" width="60" height="40" fill="#2b6b5e" />
        <sphere cx="130" cy="40" r="18" fill="#888888" />
      </layer>
    `)
    const ink = await pixelAt(png, 50, 40)
    expect([ink[0], ink[1], ink[2]]).toEqual([0x2b, 0x6b, 0x5e])
  })

  it('extrude 的并排形状都留下，洞仍然是洞', async () => {
    const { png } = await render(`
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
  })

  it('搭在另一笔上的形状仍是实体，不会被挖成洞', async () => {
    const { png } = await render(`
      <layer width="200" height="140" background="#101010" perspective="800">
        <extrude d="M0 0 H60 V24 H0 Z M30 8 L50 8 L50 16 L80 36 L40 36 L30 16 Z" depth="12" x="60" y="52" fill="#f2f2f2" />
      </layer>
    `)
    const bar = await pixelAt(png, 80, 64)
    const tip = await pixelAt(png, 130, 82)
    expect(bar[0]).toBeGreaterThan(180)
    expect(tip[0]).toBeGreaterThan(180)
  })

  it('网格超出所在 layer 时仍画在父画布上', async () => {
    const spilled = await render(`
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
  })

  it('网格斜边有抗锯齿过渡', async () => {
    const { png } = await render(
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
  })

  it('盒子描可见棱，对角线不画，被自己挡住的棱是虚线', async () => {
    const { png } = await render(`
      <layer width="200" height="200" background="#ffffff" perspective="500">
        <box x="50" y="60" width="100" height="80" depth="70" fill="#c8c8c8" stroke="#000000" stroke-width="4" hidden="#ff00ff" />
      </layer>
    `)
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    const at = (x: number, y: number) => {
      const i = (y * img.width + x) * 4
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
    }
    const face = at(100, 100)
    expect(face[0]).toBeGreaterThan(140)
    expect(face[0]).toBeLessThan(230)
    expect(Math.abs(face[0] - face[1])).toBeLessThan(30)
    expect(Math.abs(face[1] - face[2])).toBeLessThan(30)
    let black = 0
    let magenta = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r, g, b] = at(x, y)
        if (r < 30 && g < 30 && b < 30) black++
        if (r > 200 && b > 200 && g < 80) magenta++
      }
    }
    expect(black).toBeGreaterThan(40)
    expect(magenta).toBeGreaterThan(10)
  })

  it('fill=none 的盒子不填面，轮廓仍在', async () => {
    const { png } = await render(`
      <layer width="200" height="200" background="#ffffff" perspective="500">
        <box x="50" y="60" width="100" height="80" depth="70" fill="none" stroke="#000000" stroke-width="4" />
      </layer>
    `)
    const face = await pixelAt(png, 100, 100)
    const corner = await pixelAt(png, 4, 4)
    expect(face[0]).toBeGreaterThan(240)
    expect(face[1]).toBeGreaterThan(240)
    expect(face[2]).toBeGreaterThan(240)
    expect(corner[0]).toBeGreaterThan(240)
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    let black = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 30 && (data[i + 1] ?? 255) < 30 && (data[i + 2] ?? 255) < 30) black++
    }
    expect(black).toBeGreaterThan(40)
  })

  it('球的 stroke 只画轮廓圆', async () => {
    const { png } = await render(`
      <layer width="200" height="200" background="#ffffff" perspective="600">
        <sphere cx="100" cy="100" r="50" fill="none" stroke="#000000" stroke-width="4" hidden="#ff00ff" />
      </layer>
    `)
    const center = await pixelAt(png, 100, 100)
    expect(center[0]).toBeGreaterThan(240)
    expect(center[1]).toBeGreaterThan(240)
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    let black = 0
    let magenta = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      if (r < 30 && g < 30 && b < 30) black++
      if (r > 200 && b > 200 && g < 80) magenta++
    }
    expect(black).toBeGreaterThan(40)
    expect(magenta).toBe(0)
  })

  it('挤出体只描折棱，盖上的对角线不画', async () => {
    const { png } = await render(`
      <layer width="220" height="160" background="#ffffff" perspective="800">
        <extrude x="40" y="40" d="M0 0 H140 V36 H90 V80 H0 Z" depth="40" fill="#f4f1ea" stroke="#000000" stroke-width="3" hidden="#ff00ff" />
      </layer>
    `)
    const inside = await pixelAt(png, 70, 55)
    expect(inside[0]).toBeGreaterThan(200)
    expect(inside[1]).toBeGreaterThan(200)
    expect(inside[2]).toBeGreaterThan(180)
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    let black = 0
    let magenta = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      if (r < 30 && g < 30 && b < 30) black++
      if (r > 200 && b > 200 && g < 80) magenta++
    }
    expect(black).toBeGreaterThan(20)
    expect(magenta).toBeGreaterThan(5)
  })

  it('glb 的 stroke 描在文件颜色外面', async () => {
    const { png } = await render(
      `<layer width="180" height="180" background="#000000" perspective="700"><layer x="55" y="55" width="70" height="70"><model src="box.glb" stroke="#ffffff" stroke-width="3" /></layer></layer>`,
      { baseDir: dir },
    )
    const center = await pixelAt(png, 90, 90)
    expect(center[1]).toBeGreaterThan(center[0] + 20)
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    let white = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 220 && (data[i + 1] ?? 0) > 220 && (data[i + 2] ?? 0) > 220) white++
    }
    expect(white).toBeGreaterThan(10)
  })

  it('圆柱背面的弧是虚线，不是实线', async () => {
    const { png } = await render(`
      <layer width="280" height="220" background="#ffffff" perspective="800">
        <extrude x="40" y="30" d="M40 80 A 40 40 0 1 1 120 80 A 40 40 0 1 1 40 80 Z" depth="56" fill="none" stroke="#000000" stroke-width="3" hidden="#ff00ff" rotateX="62" />
      </layer>
    `)
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    const magentaAt = new Uint8Array(img.width * img.height)
    let magenta = 0
    let black = 0
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      if (r < 30 && g < 30 && b < 30) black++
      if (r > 200 && b > 200 && g < 80) {
        magenta++
        magentaAt[p] = 1
      }
    }
    const seen = new Uint8Array(magentaAt.length)
    let largest = 0
    let dashes = 0
    const stack: number[] = []
    for (let start = 0; start < magentaAt.length; start++) {
      if (!magentaAt[start] || seen[start]) continue
      let size = 0
      stack.push(start)
      seen[start] = 1
      while (stack.length > 0) {
        const p = stack.pop()!
        size++
        const x = p % img.width
        const y = (p - x) / img.width
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
            const n = ny * img.width + nx
            if (!magentaAt[n] || seen[n]) continue
            seen[n] = 1
            stack.push(n)
          }
        }
      }
      if (size > largest) largest = size
      if (size > 8) dashes++
    }
    expect(black).toBeGreaterThan(20)
    expect(magenta).toBeGreaterThan(40)
    expect(dashes).toBeGreaterThan(3)
    expect(largest).toBeLessThan(80)
  })

  it('前面的球体盖住后面盒子的棱', async () => {
    const { png } = await render(`
      <layer width="200" height="200" background="#ffffff" perspective="600">
        <box x="30" y="40" width="140" height="120" depth="40" fill="#dddddd" stroke="#000000" stroke-width="4" hidden="#ff00ff" />
        <sphere cx="100" cy="100" r="28" z="40" fill="#ff2244" />
      </layer>
    `)
    const center = await pixelAt(png, 100, 100)
    expect(center[0]).toBeGreaterThan(center[1] + 40)
    expect(center[0]).toBeGreaterThan(center[2] + 20)
    expect(center[0]).toBeGreaterThan(180)
  })

  it('轮廓、折棱、隐藏线按 stroke-width 的三个数依次变细', async () => {
    const stats = async (width: string) => {
      const { png } = await render(`
        <layer width="280" height="240" background="#ffffff" perspective="2400">
          <box x="70" y="50" width="120" height="90" depth="80" fill="#f2f2f2" stroke="#000000" stroke-width="${width}" hidden="#ff00ff" rotateY="-32" rotateX="22" />
        </layer>
      `)
      const img = await loadImage(png)
      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, img.width, img.height).data
      const dark = (i: number) => (data[i] ?? 255) < 40 && (data[i + 1] ?? 255) < 40 && (data[i + 2] ?? 255) < 40
      const dash = (i: number) => (data[i] ?? 0) > 180 && (data[i + 2] ?? 0) > 180 && (data[i + 1] ?? 255) < 90
      let outline = 0
      let crease = 0
      const hidden: number[] = []
      for (let y = 0; y < img.height; y++) {
        let blackRun = 0
        let magentaRun = 0
        const flush = () => {
          if (blackRun >= 7) outline++
          else if (blackRun >= 3 && blackRun <= 5) crease++
          if (magentaRun > 0) hidden.push(magentaRun)
          blackRun = 0
          magentaRun = 0
        }
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4
          if (dark(i)) blackRun++
          else {
            if (blackRun >= 7) outline++
            else if (blackRun >= 3 && blackRun <= 5) crease++
            blackRun = 0
          }
          if (dash(i)) magentaRun++
          else {
            if (magentaRun > 0) hidden.push(magentaRun)
            magentaRun = 0
          }
        }
        flush()
      }
      hidden.sort((a, b) => a - b)
      return { outline, crease, hidden: hidden[Math.floor(hidden.length / 2)] ?? 0, hiddenMax: hidden[hidden.length - 1] ?? 0 }
    }
    const tiered = await stats('10 4 1')
    const hiddenInherits = await stats('10 4')
    expect(tiered.outline).toBeGreaterThan(150)
    expect(tiered.crease).toBeGreaterThan(40)
    expect(tiered.hidden).toBeLessThanOrEqual(2)
    expect(tiered.hiddenMax).toBeLessThan(8)
    expect(hiddenInherits.hidden).toBeGreaterThan(tiered.hidden)
  })

  it('前面的线在交叉处把后面的线断开，角上仍然连着', async () => {
    const paint = (halo: string, scale = 1) =>
      render(
        `
        <layer width="220" height="200" background="#ffffff" perspective="4000">
          <box x="50" y="24" width="90" height="150" depth="16" fill="#ffffff" stroke="#000000" stroke-width="2" hidden="#000000" halo="4" />
          <tube x="0" y="70" d="M20 30 H200" r="5" z="40" fill="#ff2244" stroke="#ff2244" stroke-width="2"${halo} />
        </layer>
      `,
        { scale },
      )
    const measure = async (png: Buffer) => {
      const img = await loadImage(png)
      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, img.width, img.height).data
      const at = (x: number, y: number) => {
        const i = (y * img.width + x) * 4
        return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
      }
      const isBlack = (x: number, y: number) => {
        const [r, g, b] = at(x, y)
        return r < 40 && g < 40 && b < 40
      }
      const isRed = (x: number, y: number) => {
        const [r, g, b] = at(x, y)
        return r > 180 && g < 90 && b < 90
      }
      let edgeX = 0
      let best = 0
      for (let x = 0; x < img.width * 0.45; x++) {
        let n = 0
        for (let y = 0; y < img.height; y++) if (isBlack(x, y)) n++
        if (n > best) {
          best = n
          edgeX = x
        }
      }
      const reds: number[] = []
      const reach = Math.round(img.width * 0.08)
      for (let y = 0; y < img.height; y++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = edgeX + dx
          if (x < 0 || x >= img.width) continue
          if (isRed(x, y)) reds.push(y)
        }
      }
      const top = Math.min(...reds)
      let gap = 0
      for (let y = top - 1; y >= 0; y--) {
        if (isBlack(edgeX, y)) break
        gap++
      }
      let cornerX = img.width
      let cornerY = img.height
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (!isBlack(x, y)) continue
          if (x + y < cornerX + cornerY) {
            cornerX = x
            cornerY = y
          }
        }
      }
      let right = 0
      for (let x = cornerX; x < cornerX + 12 && x < img.width; x++) {
        let hit = false
        for (let dy = -2; dy <= 2; dy++) {
          const y = cornerY + dy
          if (y >= 0 && y < img.height && isBlack(x, y)) hit = true
        }
        if (!hit) break
        right++
      }
      let down = 0
      for (let y = cornerY; y < cornerY + 12 && y < img.height; y++) {
        let hit = false
        for (let dx = -2; dx <= 2; dx++) {
          const x = cornerX + dx
          if (x >= 0 && x < img.width && isBlack(x, y)) hit = true
        }
        if (!hit) break
        down++
      }
      return { edgeX, top, gap, right, down, isBlack }
    }
    const plain = await measure((await paint('')).png)
    const opened = await measure((await paint(' halo="8"')).png)
    const doubled = await measure((await paint(' halo="8"', 2)).png)
    expect(plain.gap).toBeLessThanOrEqual(2)
    expect(plain.isBlack(plain.edgeX, plain.top - 2)).toBe(true)
    expect(opened.gap).toBeGreaterThanOrEqual(6)
    expect(opened.isBlack(opened.edgeX, opened.top - 2)).toBe(false)
    expect(opened.right).toBeGreaterThanOrEqual(8)
    expect(opened.down).toBeGreaterThanOrEqual(8)
    expect(doubled.gap).toBeGreaterThan(opened.gap * 1.6)
  })

  it('halo 不会把线管端面和自己的轮廓切开', async () => {
    const { png } = await render(`
      <layer width="320" height="180" background="#ffffff" perspective="1200">
        <tube x="30" y="40" d="M0 50 H240" r="24" fill="none" stroke="#111111" stroke-width="3" halo="8" />
      </layer>
    `)
    const img = await loadImage(png)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height).data
    const darkAt = (x: number, y: number) => {
      const i = (y * img.width + x) * 4
      const r = data[i] ?? 255
      const g = data[i + 1] ?? 255
      const b = data[i + 2] ?? 255
      return r < 80 && g < 80 && b < 80
    }
    let maxX = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) if (darkAt(x, y)) maxX = Math.max(maxX, x)
    }
    const ys: number[] = []
    for (let y = 0; y < img.height; y++) {
      for (let x = maxX - 2; x <= maxX; x++) {
        if (darkAt(x, y)) {
          ys.push(y)
          break
        }
      }
    }
    expect(ys.length).toBeGreaterThan(20)
    let gap = 0
    for (let i = 1; i < ys.length; i++) gap = Math.max(gap, ys[i]! - ys[i - 1]! - 1)
    expect(gap).toBeLessThanOrEqual(2)
    expect(ys[ys.length - 1]! - ys[0]!).toBeGreaterThan(36)
  })

  it('halo 不配 stroke、写在平面上，或 stroke-width 超过三个数，会警告', async () => {
    const report = await checkFvg(`
      <layer width="180" height="140" perspective="400">
        <box x="20" y="30" width="40" height="30" depth="20" halo="3" />
        <rect x="10" y="10" width="20" height="20" fill="#fff" halo="3" />
        <box x="80" y="30" width="40" height="30" depth="20" fill="#fff" stroke="#000" stroke-width="1 2 3 4" />
      </layer>
    `)
    const messages = report.issues.filter((issue) => issue.code === 'invalid-attr').map((issue) => issue.message)
    expect(messages.some((message) => message.includes('halo 要和 stroke'))).toBe(true)
    expect(messages.some((message) => message.includes('halo 只写在网格上'))).toBe(true)
    expect(messages.some((message) => message.includes('最多三个数'))).toBe(true)
  })
})
