import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderLayer } from './render.js'

const gallery = join(__dirname, '..', 'docs', 'gallery', '3d')
const HIDDEN = [154, 143, 128] as const
const INK = [28, 25, 21] as const

function read(name: string): string {
  return readFileSync(join(gallery, `${name}.layer`), 'utf8')
}

function near(rgba: Uint8ClampedArray | Uint8Array, i: number, rgb: readonly [number, number, number], tol = 8): boolean {
  return Math.abs(rgba[i]! - rgb[0]) <= tol && Math.abs(rgba[i + 1]! - rgb[1]) <= tol && Math.abs(rgba[i + 2]! - rgb[2]) <= tol
}

function count(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, rgb: readonly [number, number, number], tol = 8): number {
  let n = 0
  for (let i = 0; i < width * height; i++) {
    if (near(rgba, i * 4, rgb, tol)) n += 1
  }
  return n
}

type Rect = { x0: number; y0: number; x1: number; y1: number }

/** Screen boxes of every solid the plate draws, from the native ink report. */
function solidBoxes(report: any): Rect[] {
  return (report?.elements ?? [])
    .filter((el: any) => ['rect', 'cylinder', 'sphere', 'path', 'tube'].includes(el.tag) && el.ink && el.path?.startsWith('layer/layer[2]'))
    .map((el: any) => ({ x0: el.ink.x, y0: el.ink.y, x1: el.ink.x + el.ink.width, y1: el.ink.y + el.ink.height }))
}

describe('3d-lines 线稿', () => {
  it('技术格里的隐藏线画出来了', async () => {
    // Q4: the hidden pass is the pale `hidden` colour inside a solid. If it is
    // lost the technical cell has no hidden lines at all, which is exactly what
    // happened when the crossing pass stopped classifying them.
    const painted = await renderLayer(read('3d-lines'), { baseDir: gallery, format: 'rgba', meshCache: false })
    // A dashed line one pixel wide lands on fractional pixel positions, so the
    // drawn colour is the hidden ink blended into paper; the tolerance has to
    // accept that mix or the count only sees the dashes that happened to land
    // on a whole pixel.
    expect(count(painted.rgba, painted.width, painted.height, HIDDEN, 26)).toBeGreaterThan(600)
  }, 60000)

  it('圆柱穿过盒子时产生交线', async () => {    // Q4: the pair pass only compared different owners, so two solids in one
    // `preserve-3d` layer never crossed and the cell had no crossing line.
    // Pulling the bar clear of the box keeps every other line identical, so
    // the ink that appears only in the crossing scene is the crossing.
    const scene = (cx: number) => `<layer width="420" height="360" background="#f3efe6" color="#1c1915">
  <layer width="420" height="360" camera="fov 34, orbit 30 26, distance 900, at 210 200 0">
    <layer width="420" height="360" rotateX="56" preserve-3d>
      <rect x="60" y="90" width="150" height="180" depth="80" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1" hidden="#a89880" />
      <cylinder cx="${cx}" cy="150" r="34" height="260" fill="#e7d3a8" stroke="#1c1915" stroke-width="3 2 1" hidden="#a89880" />
    </layer>
  </layer>
</layer>
`
    const crossing = await renderLayer(scene(135), { baseDir: gallery, format: 'rgba', meshCache: false })
    const apart = await renderLayer(scene(330), { baseDir: gallery, format: 'rgba', meshCache: false })
    let gained = 0
    for (let i = 0; i < crossing.width * crossing.height; i++) {
      const before = near(apart.rgba, i * 4, INK, 60)
      const after = near(crossing.rgba, i * 4, INK, 60)
      if (after && !before) gained += 1
    }
    expect(gained).toBeGreaterThan(120)
  }, 60000)
})

describe('3d-lines 隐藏线遮罩', () => {
  it('隐藏线落在实体遮罩内', async () => {
    // Q4: counting pale pixels only proves some were drawn, not that they are
    // the far side of a solid. A hidden line that escaped its body would show
    // up on open paper and read as a stray dash, so the pixels have to sit
    // inside a solid's ink box. The 5% that misses is the outer contour, where
    // a dashed stroke straddles the box edge by a pixel.
    const painted = await renderLayer(read('3d-lines'), { baseDir: gallery, format: 'rgba', meshCache: false })
    const boxes = solidBoxes(painted.report)
    expect(boxes.length).toBeGreaterThanOrEqual(5)
    const inside = (x: number, y: number) => boxes.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)
    let total = 0
    let masked = 0
    for (let y = 0; y < painted.height; y++) {
      for (let x = 0; x < painted.width; x++) {
        if (!near(painted.rgba, (y * painted.width + x) * 4, HIDDEN, 26)) continue
        total += 1
        if (inside(x, y)) masked += 1
      }
    }
    expect(total).toBeGreaterThan(600)
    expect(masked / total).toBeGreaterThan(0.9)
  }, 60000)
})
