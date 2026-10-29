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

describe('3d-lines 样张验收', () => {
  it('圆柱 ink 与盒子 ink 相交，带孔平板存在，弯管与另一实体相交', async () => {
    const painted = await renderLayer(read('3d-lines'), { baseDir: gallery, format: 'rgba', meshCache: false })
    const byId = new Map(
      (painted.report?.elements ?? [])
        .filter((el: any) => el.id && el.ink)
        .map((el: any) => [el.id, el]),
    )
    const box = byId.get('box')
    const piercing = byId.get('piercing')
    const hole = byId.get('hole-plate')
    const elbow = byId.get('elbow')
    expect(box).toBeTruthy()
    expect(piercing).toBeTruthy()
    expect(hole).toBeTruthy()
    expect(elbow).toBeTruthy()
    const overlap = (a: any, b: any) => {
      const ax0 = a.ink.x
      const ay0 = a.ink.y
      const ax1 = a.ink.x + a.ink.width
      const ay1 = a.ink.y + a.ink.height
      const bx0 = b.ink.x
      const by0 = b.ink.y
      const bx1 = b.ink.x + b.ink.width
      const by1 = b.ink.y + b.ink.height
      return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0
    }
    expect(overlap(box, piercing)).toBe(true)
    // Hole interior should show paper (not the plate fill) near the path centre.
    const hx = Math.round(hole.ink.x + hole.ink.width / 2)
    const hy = Math.round(hole.ink.y + hole.ink.height / 2)
    const i = (hy * painted.width + hx) * 4
    expect(near(painted.rgba, i, [243, 239, 230], 30)).toBe(true)
    const others = [...byId.values()].filter((el: any) => el.id !== 'elbow' && el.id !== 'ground')
    expect(others.some((el: any) => overlap(elbow, el))).toBe(true)
  }, 60000)
})

describe('3d-lines 外轮廓覆盖', () => {
  it('盒体与平板外轮廓上的墨线覆盖率 ≥ 95%', async () => {
    // QUALITY-5 §1.5: the box left/top outlines dashed under 8× coverage.
    // Curved silhouettes (cylinder, sphere, tube) do not sit on AABB sides, so
    // this gate grades the rectilinear solids the bug report named.
    const painted = await renderLayer(read('3d-lines'), { baseDir: gallery, format: 'rgba', meshCache: false })
    const rects = (painted.report?.elements ?? [])
      .filter((el: any) => (el.id === 'box' || el.id === 'hole-plate') && el.ink)
      .map((el: any) => ({
        id: el.id,
        x0: el.ink.x,
        y0: el.ink.y,
        x1: el.ink.x + el.ink.width,
        y1: el.ink.y + el.ink.height,
      }))
    expect(rects.length).toBe(2)
    const isInk = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= painted.width || y >= painted.height) return false
      return near(painted.rgba, (y * painted.width + x) * 4, INK, 80)
    }
    const spanCover = (coords: number[]) => {
      if (coords.length < 8) return null
      const uniq = [...new Set(coords)].sort((a, b) => a - b)
      const lo = uniq[0]!
      const hi = uniq[uniq.length - 1]!
      const span = hi - lo + 1
      if (span < 8) return null
      let missing = 0
      for (let i = 1; i < uniq.length; i++) {
        const gap = uniq[i]! - uniq[i - 1]!
        if (gap > 2) missing += gap - 1
      }
      return 1 - missing / span
    }
    for (const box of rects) {
      const x0 = Math.floor(box.x0)
      const y0 = Math.floor(box.y0)
      const x1 = Math.ceil(box.x1) - 1
      const y1 = Math.ceil(box.y1) - 1
      if (x1 - x0 < 16 || y1 - y0 < 16) continue
      const pad = Math.min(12, Math.floor((x1 - x0) / 3), Math.floor((y1 - y0) / 3))
      const leftYs: number[] = []
      const rightYs: number[] = []
      const topXs: number[] = []
      for (let x = x0; x <= x0 + pad; x++) {
        for (let y = y0; y <= y1; y++) if (isInk(x, y)) leftYs.push(y)
      }
      for (let x = x1 - pad; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) if (isInk(x, y)) rightYs.push(y)
      }
      for (let y = y0; y <= y0 + pad; y++) {
        for (let x = x0; x <= x1; x++) if (isInk(x, y)) topXs.push(x)
      }
      // Bottom often meets the ground / hidden pass — grade left, right, top.
      for (const rate of [spanCover(leftYs), spanCover(rightYs), spanCover(topXs)]) {
        if (rate == null) continue
        expect(rate).toBeGreaterThanOrEqual(0.95)
      }
    }
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
