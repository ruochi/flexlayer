import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { emitLayer } from './emit.js'
import { h } from './h.js'
import { checkFvg, renderLayer } from './render.js'

async function pixels(png: Buffer) {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data }
}

function at(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0]
}

describe('景深', () => {
  it('对焦处保持清楚，离开对焦面按弥散圆变糊，近处的糊边盖住远处', async () => {
    const card = `<rect x="70" y="50" width="50" height="40" fill="#fff" z="120" />`
    const focused = await renderLayer(
      `<layer width="200" height="160" background="#000" camera="focal 300">${card}</layer>`,
    )
    const soft = await renderLayer(
      `<layer width="200" height="160" background="#000" camera="focal 300, aperture 18">${card}</layer>`,
    )
    const widthOf = async (png: Buffer) => {
      const image = await pixels(png)
      let minX = image.width
      let maxX = 0
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if ((image.data[(y * image.width + x) * 4] ?? 0) < 40) continue
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
        }
      }
      return maxX - minX
    }
    const focusedWidth = await widthOf(focused.png)
    const softWidth = await widthOf(soft.png)
    expect(softWidth).toBeGreaterThan(focusedWidth + 8)
    expect(softWidth).toBeLessThan(focusedWidth + 48)
    const onFocus = `<rect x="70" y="50" width="50" height="40" fill="#fff" z="0" />`
    const heldFocus = await widthOf(
      (await renderLayer(`<layer width="200" height="160" background="#000" camera="focal 300, aperture 18">${onFocus}</layer>`)).png,
    )
    const plainFocus = await widthOf(
      (await renderLayer(`<layer width="200" height="160" background="#000" camera="focal 300">${onFocus}</layer>`)).png,
    )
    expect(Math.abs(heldFocus - plainFocus)).toBeLessThan(8)

    const scene = `<layer width="220" height="180" background="#000" camera="focal 300, aperture 18">
      <rect x="30" y="40" width="160" height="100" fill="#00ff00" z="-80" />
      <rect x="80" y="70" width="40" height="40" fill="#ff0000" z="120" />
    </layer>`
    const covered = await pixels((await renderLayer(scene)).png)
    const spill = at(covered.data, covered.width, 136, 90)
    expect(spill[0]).toBeGreaterThan(40)
    const sharp = await pixels(
      (await renderLayer(scene.replace('z="120"', 'z="120" sharp="true"'))).png,
    )
    const held = at(sharp.data, sharp.width, 136, 90)
    expect(held[0]).toBeLessThan(25)

    const report = await checkFvg(scene)
    const near = report.elements.find((el) => el.tag === 'rect' && el.defocus != null && el.defocus > 8)
    expect(near?.defocus).toBeCloseTo(12, 0)
  })

  it('有网格时平面仍按自己的深度糊，parallel 忽略景深', async () => {
    const report = await checkFvg(`<layer width="180" height="140" background="#111" camera="focal 300, aperture 18">
      <rect x="40" y="40" width="60" height="40" fill="#fff" z="120" />
      <sphere cx="130" cy="70" r="18" fill="#f00" />
    </layer>`)
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    const rect = report.elements.find((el) => el.tag === 'rect')
    expect(rect?.defocus).toBeCloseTo(12, 0)
    const parallel = await checkFvg(
      `<layer width="80" height="60" camera="parallel, aperture 8"><rect width="20" height="20" fill="#fff" /></layer>`,
    )
    expect(parallel.issues.some((issue) => issue.level === 'info' && issue.message.includes('aperture'))).toBe(true)
    expect(parallel.elements.some((el) => el.defocus != null)).toBe(false)
  })

  it('emit 保留 aperture、focus 点和 max', () => {
    const emitted = emitLayer(
      h('layer', {
        width: 100,
        height: 80,
        camera: { focal: 200, aperture: 8, focus: [10, 20, 0], max: 20 },
      }),
    )
    expect(emitted.source).toContain('camera="focal 200, aperture 8, focus 10 20 0, max 20"')
  })
})
