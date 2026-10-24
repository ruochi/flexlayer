/**
 * 3D 样张度量。逐张渲染 docs/gallery/3d/*.layer，按 report.elements[].ink 取物体区域。
 *
 *   npx tsx scripts/gallery-metrics.mjs --write
 *   npx tsx scripts/gallery-metrics.mjs --check
 *
 * --check only fails when a gate is a number and this run is outside it.
 * The manga hatch is compared with test/golden/manga-hatch.png, a frozen page
 * that no renderer regenerates, so drift still shows after the legacy raster
 * is gone.
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderLayer } from '../src/render.ts'
import { meanFlip } from './flip-diff.ts'

const root = dirname(fileURLToPath(import.meta.url))
const repo = dirname(root)
const gallery = join(repo, 'docs/gallery/3d')
const goldenPath = join(repo, 'test/golden/gallery-metrics.json')
const hatchGolden = join(repo, 'test/golden/manga-hatch.png')

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const check = args.has('--check')
// The contact ratio is measured on the ground lip, which the kernel writes
// beside the frame while this process is rendering. Production renders leave
// the variable unset and write nothing.
process.env.FLEXLAYER_SEAT_DEBUG = '1'

/** 材质表的格子顺序，和 gallery-3d.ts 的 FINISHES 一致，四列。 */
const MATERIAL_GRID = [
  '3d-mat-matte',
  '3d-mat-clay',
  '3d-mat-clay-fill',
  '3d-mat-plastic-0-12',
  '3d-mat-plastic-0-85',
  '3d-mat-metal-0-08',
  '3d-mat-metal-0-8',
  '3d-mat-mirror',
  '3d-mat-brushed',
  '3d-mat-glass-0-06',
  '3d-mat-glass-0-72',
  '3d-mat-clearcoat-1',
  '3d-mat-anisotropy-0-9',
  '3d-mat-sheen-0-85',
  '3d-mat-lamp',
  '3d-mat-neon',
]

const GROUNDED = new Set(['plinth', 'red-box', 'white-box', 'metal-plate', 'gold', 'box', 'side'])
const BENCH_METAL = new Set(['metal-plate', 'chrome'])
const MATERIAL_METAL = /metal|mirror|brushed|anisotropy/
const OBJECT_IDS = ['box', 'sphere', 'side']

const GATES = {
  overexposureMax: null,
  draftFinalLumaDeltaMax: null,
  draftFinalFlipMax: null,
  metalDarkFractionMax: null,
  metalLumaDeltaMax: null,
  contactRatioMax: null,
  floatGapMin: null,
  materialFlipMin: null,
  emissiveCoreYMin: null,
  emissiveHaloRiseMax: null,
  emissiveOutsideHotMax: null,
  toonLevelsMax: null,
  mangaPaperLumaMin: null,
  mangaPaperChromaMax: null,
  hatchFlipMax: null,
  technicalChromaRatioMin: null,
}

function luma(data, i) {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
}

function srgbToLinear(c) {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}

function oklabChroma(r, g, b) {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  return Math.hypot(a, bb)
}

function round(value, digits = 4) {
  if (value == null || Number.isNaN(value)) return null
  const p = 10 ** digits
  return Math.round(value * p) / p
}

function bounds(ink, w, h) {
  if (!ink || ink.width <= 0 || ink.height <= 0) return null
  const x0 = Math.max(0, Math.floor(ink.x))
  const y0 = Math.max(0, Math.floor(ink.y))
  const x1 = Math.min(w, Math.ceil(ink.x + ink.width))
  const y1 = Math.min(h, Math.ceil(ink.y + ink.height))
  if (x1 <= x0 || y1 <= y0) return null
  return { x0, y0, x1, y1 }
}

function hit(rect, x, y) {
  return rect != null && x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1
}

function byId(elements) {
  const map = new Map()
  for (const el of elements) {
    if (el.id) map.set(el.id, el)
  }
  return map
}

function cameraBox(elements, w, h) {
  const camera = elements.find((el) => el.tag === 'layer' && el.view && el.box)
  if (camera?.box) return bounds(camera.box, w, h) ?? { x0: 0, y0: 0, x1: w, y1: h }
  return { x0: 0, y0: 0, x1: w, y1: h }
}

function meanIn(data, w, rect, skip) {
  if (!rect) return null
  let sum = 0
  let n = 0
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      if (skip && skip(x, y)) continue
      sum += luma(data, (y * w + x) * 4)
      n += 1
    }
  }
  return n > 0 ? sum / n : null
}

function fraction(data, w, rect, pred, skip) {
  if (!rect) return null
  let hitCount = 0
  let n = 0
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      if (skip && skip(x, y)) continue
      const i = (y * w + x) * 4
      n += 1
      if (pred(data, i)) hitCount += 1
    }
  }
  return n > 0 ? hitCount / n : null
}

function lineMask(rgba, width, height) {
  const line = new Uint8Array(width * height)
  const dist = (i, rgb) => {
    const dr = rgba[i] - rgb[0]
    const dg = rgba[i + 1] - rgb[1]
    const db = rgba[i + 2] - rgb[2]
    return dr * dr + dg * dg + db * db
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (dist(i, [28, 25, 21]) < 800 || dist(i, [154, 143, 128]) < 400) line[y * width + x] = 1
    }
  }
  return line
}

function nearLine(line, width, height, x, y) {
  for (let dy = -2; dy <= 2; dy++) {
    const yy = y + dy
    if (yy < 0 || yy >= height) continue
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue
      const xx = x + dx
      if (xx < 0 || xx >= width) continue
      if (line[yy * width + xx]) return true
    }
  }
  return false
}

/** 物体内部的亮度带。去掉外圈 2px，再去掉近黑的线条像素。带宽度是 16。 */
function luminanceLevels(data, w, h, rect, skip) {
  if (!rect) return null
  const x0 = rect.x0 + 2
  const y0 = rect.y0 + 2
  const x1 = rect.x1 - 2
  const y1 = rect.y1 - 2
  if (x1 <= x0 || y1 <= y0) return null
  const bins = new Map()
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (skip?.(x, y)) continue
      const i = (y * w + x) * 4
      const yv = luma(data, i)
      if (yv < 40) continue
      const band = Math.min(15, Math.floor(yv / 16))
      bins.set(band, (bins.get(band) ?? 0) + 1)
      n += 1
    }
  }
  if (n === 0) return null
  // 同一块面上的抗锯齿会跨过 16 宽的亮度档。不足 8% 且紧挨着更大一档的，并进那一档。
  const kept = [...bins.entries()].filter(([, count]) => count / n >= 0.02).sort((a, b) => a[0] - b[0])
  const drop = new Set()
  for (let i = 0; i < kept.length; i++) {
    const [band, count] = kept[i]
    if (count / n >= 0.08) continue
    const beside = (other) => other && Math.abs(other[0] - band) === 1 && other[1] > count
    if (beside(kept[i - 1]) || beside(kept[i + 1])) drop.add(band)
  }
  return kept.length - drop.size
}

/** 物体墨区外扩之后，镜头里仍然偏亮的像素。中位数是远处地面，不受灯池里少数极亮点拉动。 */
function distantFloor(data, w, h, camera, rects) {
  const grown = rects.map((rect) => ({
    x0: rect.x0 - 8,
    y0: rect.y0 - 8,
    x1: rect.x1 + 8,
    y1: rect.y1 + 8,
  }))
  const samples = []
  for (let y = camera.y0; y < camera.y1; y++) {
    for (let x = camera.x0; x < camera.x1; x++) {
      if (grown.some((rect) => hit(rect, x, y))) continue
      const value = luma(data, (y * w + x) * 4)
      if (value < 160) continue
      samples.push(value)
    }
  }
  if (samples.length < 32) return null
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

function union(rects) {
  if (rects.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const rect of rects) {
    x0 = Math.min(x0, rect.x0)
    y0 = Math.min(y0, rect.y0)
    x1 = Math.max(x1, rect.x1)
    y1 = Math.max(y1, rect.y1)
  }
  return { x0, y0, x1, y1 }
}

function engineString() {
  try {
    const require = createRequire(fileURLToPath(import.meta.url))
    const native = require('../native/flexlayer-render/index.cjs')
    return typeof native.engine === 'function' ? String(native.engine()) : null
  } catch {
    return null
  }
}

function clearSeat() {
  for (const name of ['seat-size.txt', 'seat-ground.bin', 'seat-color.bin', 'seat-depth.bin']) {
    try { rmSync(`/tmp/${name}`) } catch { /* the first cell has nothing to clear */ }
  }
}

async function renderFile(file) {
  const source = readFileSync(join(gallery, file), 'utf8')
  clearSeat()
  const painted = await renderLayer(source, { baseDir: join(repo, 'docs/gallery'), format: 'rgba', meshCache: false })
  return { rgba: painted.rgba, width: painted.width, height: painted.height, report: painted.report, fills: fillsOf(source) }
}

function emissiveNames(stem) {
  const names = ['lamp', 'neon']
  if (stem === '3d-mat-lamp' || stem === '3d-mat-neon') names.push('sphere', 'side')
  return names
}

function metalNames(stem, ids) {
  const names = []
  for (const name of BENCH_METAL) if (ids.has(name)) names.push(name)
  if (MATERIAL_METAL.test(stem)) {
    for (const name of OBJECT_IDS) if (ids.has(name)) names.push(name)
  }
  return names
}

function fillsOf(source) {
  const fills = new Map()
  for (const tag of source.match(/<[^>]+>/g) ?? []) {
    const id = tag.match(/\bid="([^"]+)"/)
    const fill = tag.match(/\bfill="#([0-9a-fA-F]{6})"/)
    if (!id || !fill) continue
    const hex = fill[1]
    fills.set(id[1], [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)])
  }
  return fills
}

/** 着色后的像素大约是填充色乘一个亮度。地面和别的物体对不上这个比例。 */
function likeFill(rgb, fill) {
  let scale = 0
  let n = 0
  for (let c = 0; c < 3; c++) {
    if (fill[c] > 24) {
      scale += rgb[c] / fill[c]
      n += 1
    }
  }
  if (!n) {
    return Math.abs(rgb[0] - fill[0]) + Math.abs(rgb[1] - fill[1]) + Math.abs(rgb[2] - fill[2]) < 48
  }
  scale /= n
  if (scale < 0.15 || scale > 1.45) return false
  let err = 0
  for (let c = 0; c < 3; c++) err += Math.abs(rgb[c] - fill[c] * scale)
  return err / 3 < 28
}

function loadSeat() {
  try {
    const parts = readFileSync('/tmp/seat-size.txt', 'utf8').trim().split(/\s+/).map(Number)
    const [pw, ph, originX, originY, pixelScale] = parts
    const ground = readFileSync('/tmp/seat-ground.bin')
    const color = readFileSync('/tmp/seat-color.bin')
    const depth = readFileSync('/tmp/seat-depth.bin')
    if (!pw || !ph || ground.length !== pw * ph || color.length !== pw * ph * 4 || depth.length !== pw * ph * 4) return null
    return { pw, ph, ground, color, depth, originX, originY, pixelScale }
  } catch {
    return null
  }
}

function kernelXY(align, x, y) {
  const s = align.scale || 1
  return [Math.round(x * s + align.ox), Math.round(y * s + align.oy)]
}

function alignSeat(rgba, width, height, seat) {
  const points = []
  for (let y = 40; y < height - 40; y += 70) {
    for (let x = 40; x < width - 40; x += 80) points.push([x, y])
  }
  if (!points.length) points.push([Math.floor(width / 2), Math.floor(height / 2)])
  const scale = seat.pixelScale > 0 ? seat.pixelScale : 1
  const baseOx = Number.isFinite(seat.originX) ? Math.round(-seat.originX * scale) : 0
  const baseOy = Number.isFinite(seat.originY) ? Math.round(-seat.originY * scale) : 0
  const score = (ox, oy) => {
    const samples = []
    for (const [x, y] of points) {
      const kx = Math.round(x * scale + ox)
      const ky = Math.round(y * scale + oy)
      if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) continue
      const i = (y * width + x) * 4
      const k = (ky * seat.pw + kx) * 4
      samples.push(Math.abs(rgba[i] - seat.color[k]) + Math.abs(rgba[i + 1] - seat.color[k + 1]) + Math.abs(rgba[i + 2] - seat.color[k + 2]))
    }
    if (samples.length < Math.min(8, points.length)) return null
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const inliers = samples.filter((value) => value < 80)
    const trimmed = inliers.length ? inliers.reduce((sum, value) => sum + value, 0) / inliers.length : mean
    return { mean, trimmed, inliers: inliers.length }
  }
  // 平地上很多偏移的误差都接近 0。内核原点是裁切的依据，只有旁边明显更准时才挪。
  const base = score(baseOx, baseOy)
  let best = { ox: baseOx, oy: baseOy, scale, err: base?.mean ?? Infinity, trimmed: base?.trimmed ?? Infinity, inliers: base?.inliers ?? 0 }
  for (let oy = baseOy - 3; oy <= baseOy + 3; oy++) {
    for (let ox = baseOx - 3; ox <= baseOx + 3; ox++) {
      const found = score(ox, oy)
      if (!found || found.mean + 3 >= best.err) continue
      best = { ox, oy, scale, err: found.mean, trimmed: found.trimmed, inliers: found.inliers }
    }
  }
  if (seat.pw + 4 < width || seat.ph + 4 < height) return null
  if (best.inliers < Math.min(8, points.length) || best.trimmed >= 12) return null
  return best
}

function groundLips(seat, align, rect) {
  const lips = []
  const [kx0, ky0] = kernelXY(align, rect.x0, rect.y0)
  const [kx1, ky1] = kernelXY(align, rect.x1, rect.y1 + 16)
  const x0 = Math.max(1, Math.min(kx0, kx1))
  const x1 = Math.min(seat.pw - 2, Math.max(kx0, kx1))
  const y0 = Math.max(1, Math.min(ky0, ky1))
  const y1 = Math.min(seat.ph - 2, Math.max(ky0, ky1))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * seat.pw + x
      if (seat.ground[i] === 0) continue
      if (seat.ground[i - seat.pw] !== 0) continue
      const above = seat.depth.readFloatLE((i - seat.pw) * 4)
      if (above <= -1e20) continue
      lips.push({ x, y })
    }
  }
  return lips
}

function lipStrip(rgba, width, height, seat, align, rect, distant) {
  const lips = groundLips(seat, align, rect)
  if (!lips.length || distant == null) return null
  const front = Math.max(...lips.map((lip) => lip.y))
  let sum = 0
  let n = 0
  for (const lip of lips) {
    if (lip.y < front - 8) continue
    let col = 0
    let cn = 0
    for (let d = 0; d < 6; d++) {
      const s = align.scale || 1
      const x = Math.round((lip.x - align.ox) / s)
      const y = Math.round((lip.y - align.oy) / s) + d
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      col += luma(rgba, (y * width + x) * 4)
      cn += 1
    }
    if (!cn) continue
    sum += col / cn
    n += 1
  }
  if (!n) return null
  return { stripY: sum / n, ratio: (sum / n) / distant }
}

function measure(stem, rgba, width, height, elements, fills, seat) {
  const ids = byId(elements)
  const camera = cameraBox(elements, width, height)
  const skipEmissive = (x, y) => {
    for (const name of emissiveNames(stem)) {
      if (hit(bounds(ids.get(name)?.ink, width, height), x, y)) return true
    }
    return false
  }
  const over = fraction(rgba, width, camera, (_data, i) => luma(rgba, i) > 250, skipEmissive)
  const metals = []
  for (const name of metalNames(stem, ids)) {
    const rect = bounds(ids.get(name)?.ink, width, height)
    metals.push({
      id: name,
      meanY: round(meanIn(rgba, width, rect), 2),
      darkFraction: round(fraction(rgba, width, rect, (_d, i) => luma(rgba, i) < 40)),
    })
  }
  const others = []
  for (const [name, el] of ids) {
    if (name === 'ground') continue
    const rect = bounds(el.ink, width, height)
    if (rect) others.push(rect)
  }
  const distant = distantFloor(rgba, width, height, camera, others)
  const align = seat ? alignSeat(rgba, width, height, seat) : null
  const contacts = []
  for (const name of GROUNDED) {
    const ink = ids.get(name)?.ink
    const body = bounds(ink, width, height)
    if (!body || distant == null) continue
    // The lip is the first ground pixel under the silhouette. Pale fills match
    // the floor, so a colour walk stops on the bare floor past the contact.
    const seated = align ? lipStrip(rgba, width, height, seat, align, body, distant) : null
    let stripY = seated?.stripY ?? null
    let ratio = seated?.ratio ?? null
    if (stripY == null) {
      const fill = fills?.get(name)
      const bottoms = []
      let frontY = -1
      const yStart = Math.min(height - 1, body.y1 + 2)
      for (let x = body.x0; x < body.x1; x++) {
        let bottom = null
        for (let y = yStart; y >= body.y0; y--) {
          const i = (y * width + x) * 4
          const value = luma(rgba, i)
          const rgb = [rgba[i], rgba[i + 1], rgba[i + 2]]
          const own = fill ? likeFill(rgb, fill) && Math.abs(value - distant) > 12 : Math.abs(value - distant) > 12
          if (own) {
            bottom = y
            break
          }
        }
        if (bottom == null) continue
        bottoms.push([x, bottom])
        if (bottom > frontY) frontY = bottom
      }
      let sum = 0
      let n = 0
      for (const [x, bottom] of bottoms) {
        if (bottom < frontY - 8) continue
        let col = 0
        let cn = 0
        for (let y = bottom + 1; y < Math.min(height, bottom + 7); y++) {
          col += luma(rgba, (y * width + x) * 4)
          cn += 1
        }
        if (!cn) continue
        sum += col / cn
        n += 1
      }
      stripY = n > 0 ? sum / n : null
      ratio = distant && stripY != null ? stripY / distant : null
    }
    contacts.push({
      id: name,
      stripY: round(stripY, 2),
      groundY: round(distant, 2),
      ratio: round(ratio),
    })
  }
  let floatGap = null
  if (stem === '3d-quality-draft' && align && distant != null) {
    const blue = bounds(ids.get('blue-float')?.ink, width, height)
    const red = bounds(ids.get('red-box')?.ink, width, height)
    if (blue && red) {
      // Ground directly under the floating ball, before the next solid.
      // A recovered run is the bright floor between its shadow and the red box.
      let best = 0
      for (let x = blue.x0; x < blue.x1; x++) {
        let run = 0
        for (let y = blue.y1; y < Math.min(height, red.y1); y++) {
          const [kx, ky] = kernelXY(align, x, y)
          if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) break
          if (seat.ground[ky * seat.pw + kx] === 0) {
            if (run > 0) break
            continue
          }
          if (luma(rgba, (y * width + x) * 4) >= distant * 0.9) run += 1
          else run = 0
          if (run > best) best = run
        }
      }
      floatGap = best
    }
  }
  const onGround = (x, y) => {
    if (!seat || !align) return false
    const [kx, ky] = kernelXY(align, x, y)
    if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) return false
    return seat.ground[ky * seat.pw + kx] !== 0
  }
  const colorDist = (i, fill) => {
    const dr = rgba[i] - fill[0]
    const dg = rgba[i + 1] - fill[1]
    const db = rgba[i + 2] - fill[2]
    return dr * dr + dg * dg + db * db
  }
  const nearerOther = (x, y, id) => {
    const mine = fills.get(id)
    if (!mine) return false
    const mineD = colorDist((y * width + x) * 4, mine)
    for (const [other, fill] of fills) {
      if (other === id || other === 'ground') continue
      if (!hit(bounds(ids.get(other)?.ink, width, height), x, y)) continue
      if (colorDist((y * width + x) * 4, fill) + 200 < mineD) return true
    }
    return false
  }
  const wrongHue = (x, y, id) => {
    const fill = fills.get(id)
    if (!fill) return false
    const i = (y * width + x) * 4
    const px = [rgba[i], rgba[i + 1], rgba[i + 2]]
    const sat = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])
    const yv = luma(rgba, i)
    if (sat(fill) > 40 && yv < 220 && sat(px) < sat(fill) * 0.35) return true
    if (sat(fill) > 30 && sat(px) > 30 && yv < 220) {
      const angle = (c) => Math.atan2(c[1] - c[2], c[0] - c[1])
      let d = Math.abs(angle(px) - angle(fill))
      if (d > Math.PI) d = 2 * Math.PI - d
      if (d > 0.6) return true
    }
    return false
  }
  const toon = stem === '3d-shade-toon'
    ? [...ids.keys()].filter((name) => name !== 'ground').map((name) => ({
      id: name,
      levels: luminanceLevels(rgba, width, height, bounds(ids.get(name)?.ink, width, height), (x, y) => onGround(x, y) || nearerOther(x, y, name) || wrongHue(x, y, name)),
    }))
    : null
  let paper = null
  if (stem === '3d-shade-manga') {
    let ySum = 0
    let cSum = 0
    let n = 0
    for (let y = camera.y0; y < camera.y1; y++) {
      for (let x = camera.x0; x < camera.x1; x++) {
        if (others.some((rect) => hit(rect, x, y))) continue
        const i = (y * width + x) * 4
        ySum += luma(rgba, i)
        cSum += oklabChroma(rgba[i], rgba[i + 1], rgba[i + 2])
        n += 1
      }
    }
    paper = n > 0 ? { meanY: round(ySum / n, 2), chroma: round(cSum / n) } : null
  }
  return {
    overexposure: round(over),
    meanY: round(meanIn(rgba, width, camera), 2),
    metals,
    contacts,
    floatGap: round(floatGap),
    toon,
    paper,
    camera,
    rgba,
    width,
    height,
    ids,
  }
}

function objectMask(measured, width, height) {
  const rects = OBJECT_IDS
    .map((name) => bounds(measured.ids.get(name)?.ink, width, height))
    .filter(Boolean)
  return (x, y) => rects.some((rect) => hit(rect, x, y))
}

function loadGates() {
  try {
    const saved = JSON.parse(readFileSync(goldenPath, 'utf8'))
    return { ...GATES, ...(saved.gates ?? {}) }
  } catch {
    return { ...GATES }
  }
}

function metalLumaDelta(report) {
  const draft = new Map()
  for (const metal of report.metals) {
    if (metal.cell === '3d-quality-draft') draft.set(metal.id, metal.meanY)
  }
  let worst = null
  for (const metal of report.metals) {
    if (metal.cell !== '3d-quality-final') continue
    const base = draft.get(metal.id)
    if (base == null || metal.meanY == null) continue
    const rel = Math.abs(base - metal.meanY) / Math.max(base, metal.meanY)
    if (worst == null || rel > worst) worst = rel
  }
  return worst
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function applyGates(gates, report) {
  const errors = []
  const maxOf = (limit, value, label) => {
    if (limit == null || value == null) return
    if (value > limit) errors.push(`${label} ${value} > ${limit}`)
  }
  const minOf = (limit, value, label) => {
    if (limit == null || value == null) return
    if (value < limit) errors.push(`${label} ${value} < ${limit}`)
  }
  for (const [name, cell] of Object.entries(report.cells)) {
    maxOf(gates.overexposureMax, cell.overexposure, `${name} overexposure`)
  }
  maxOf(gates.draftFinalLumaDeltaMax, report.draftFinal?.lumaDelta, 'draft/final luma')
  maxOf(gates.draftFinalFlipMax, report.draftFinal?.flip, 'draft/final flip')
  for (const metal of report.metals) {
    if (metal.cell === '3d-shade-toon' || metal.cell === '3d-shade-manga') continue
    maxOf(gates.metalDarkFractionMax, metal.darkFraction, `${metal.cell} ${metal.id} dark`)
  }
  maxOf(gates.metalLumaDeltaMax, metalLumaDelta(report), 'draft/final metal luma')
  for (const contact of report.contacts) {
    if (contact.cell !== '3d-quality-draft') continue
    maxOf(gates.contactRatioMax, contact.ratio, `${contact.cell} ${contact.id} contact`)
  }
  if (gates.materialFlipMin != null) {
    for (const pair of report.materials) {
      minOf(gates.materialFlipMin, pair.flip, `${pair.a} vs ${pair.b}`)
    }
  }
  for (const item of report.toon ?? []) {
    maxOf(gates.toonLevelsMax, item.levels, `toon ${item.id}`)
  }
  minOf(gates.mangaPaperLumaMin, report.manga?.meanY, 'manga paper Y')
  maxOf(gates.mangaPaperChromaMax, report.manga?.chroma, 'manga paper chroma')
  maxOf(gates.hatchFlipMax, report.manga?.hatchFlip, 'manga hatch flip')
  minOf(gates.technicalChromaRatioMin, report.technical?.minRatio, 'technical/studio chroma')
  minOf(gates.floatGapMin, report.floatGap, 'blue-float recovered px')
  minOf(gates.emissiveCoreYMin, report.emissive?.coreY, 'emissive core Y')
  maxOf(gates.emissiveHaloRiseMax, report.emissive?.haloRise, 'emissive halo rise')
  maxOf(gates.emissiveOutsideHotMax, report.emissive?.outsideHot, 'emissive Y>250 outside core')
  if (errors.length) fail(errors.join('\n'))
}

function printTable(report) {
  const rows = [['cell', 'overexposure', 'mean Y']]
  for (const [name, cell] of Object.entries(report.cells)) {
    rows.push([name, String(cell.overexposure), String(cell.meanY)])
  }
  const width = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)))
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(width[i])).join('  '))
  }
  const df = report.draftFinal
  console.log(`draft/final luma delta ${df?.lumaDelta ?? 'n/a'}  flip ${df?.flip ?? 'n/a'}`)
  console.log(`blue-float recovered px ${report.floatGap ?? 'n/a'}`)
  console.log(`manga paper Y ${report.manga?.meanY ?? 'n/a'}  chroma ${report.manga?.chroma ?? 'n/a'}  hatch flip ${report.manga?.hatchFlip ?? 'n/a'}`)
  const toonLevels = (report.toon ?? []).map((item) => item.levels).filter((value) => value != null)
  console.log(`toon levels max ${toonLevels.length ? Math.max(...toonLevels) : 'n/a'}`)
  for (const item of report.toon ?? []) {
    if (item.levels > 4) console.log(`toon ${item.id} ${item.levels}`)
  }
  console.log(`technical/studio min chroma ratio ${report.technical?.minRatio ?? 'n/a'}`)
  const flips = report.materials.map((pair) => pair.flip).filter((value) => value != null)
  console.log(`material adjacent flip min ${flips.length ? Math.min(...flips) : 'n/a'}  n ${flips.length}`)
  console.log(`draft/final metal luma delta ${round(metalLumaDelta(report)) ?? 'n/a'}`)
  const em = report.emissive
  console.log(`emissive core Y ${em?.coreY ?? 'n/a'}  halo rise ${em?.haloRise ?? 'n/a'}  outside hot ${em?.outsideHot ?? 'n/a'}`)
  const benchContacts = report.contacts.filter((item) => item.cell === '3d-quality-draft' || item.cell === '3d-quality-final')
  for (const item of benchContacts) {
    console.log(`contact ${item.cell} ${item.id} ${item.ratio}`)
  }
  const dark = report.metals.filter((item) => item.cell === '3d-quality-draft')
  for (const item of dark) {
    console.log(`metal ${item.cell} ${item.id} Y ${item.meanY} dark ${item.darkFraction}`)
  }
}

const files = readdirSync(gallery).filter((name) => name.endsWith('.layer')).sort()

const rendered = new Map()
for (const file of files) {
  const stem = file.replace(/\.layer$/, '')
  process.stderr.write(`render ${stem}\n`)
  const painted = await renderFile(file)
  const { rgba, width, height, report } = painted
  rendered.set(stem, measure(stem, rgba, width, height, report.elements ?? [], painted.fills, loadSeat()))
}

const cells = {}
const metals = []
const contacts = []
for (const [stem, measured] of rendered) {
  cells[stem] = { overexposure: measured.overexposure, meanY: measured.meanY }
  for (const metal of measured.metals) metals.push({ cell: stem, ...metal })
  for (const contact of measured.contacts) contacts.push({ cell: stem, ...contact })
}

const draft = rendered.get('3d-quality-draft')
const finalCell = rendered.get('3d-quality-final')
let draftFinal = null
if (draft && finalCell && draft.width === finalCell.width && draft.height === finalCell.height) {
  const stripes = ['stripe-red', 'stripe-white', 'stripe-blue']
    .map((name) => bounds(draft.ids.get(name)?.ink, draft.width, draft.height))
    .filter(Boolean)
  const blocked = [
    bounds(draft.ids.get('chrome')?.ink, draft.width, draft.height),
    bounds(draft.ids.get('glass')?.ink, draft.width, draft.height),
    union(stripes),
  ].filter(Boolean)
  const accept = (x, y) => hit(draft.camera, x, y) && !blocked.some((rect) => hit(rect, x, y))
  const flip = meanFlip(draft.rgba, finalCell.rgba, draft.width, draft.height, accept)
  const lumaDelta = draft.meanY != null && finalCell.meanY != null
    ? Math.abs(draft.meanY - finalCell.meanY)
    : null
  draftFinal = { lumaDelta: round(lumaDelta, 2), flip: round(flip, 6) }
}

const materials = []
const cols = 4
for (let i = 0; i < MATERIAL_GRID.length; i++) {
  const neighbors = []
  if ((i + 1) % cols !== 0) neighbors.push(MATERIAL_GRID[i + 1])
  if (i + cols < MATERIAL_GRID.length) neighbors.push(MATERIAL_GRID[i + cols])
  const left = rendered.get(MATERIAL_GRID[i])
  for (const name of neighbors) {
    const right = rendered.get(name)
    if (!left || !right || left.width !== right.width || left.height !== right.height) {
      materials.push({ a: MATERIAL_GRID[i], b: name, flip: null })
      continue
    }
    const flip = meanFlip(left.rgba, right.rgba, left.width, left.height, objectMask(left, left.width, left.height))
    materials.push({ a: MATERIAL_GRID[i], b: name, flip: round(flip, 6) })
  }
}

const studio = rendered.get('3d-shade-studio')
const technical = rendered.get('3d-shade-technical')
const ratios = []
if (studio && technical && studio.width === technical.width && studio.height === technical.height) {
  const lines = lineMask(technical.rgba, technical.width, technical.height)
  for (const [name, el] of studio.ids) {
    if (name === 'ground') continue
    const rect = bounds(el.ink, studio.width, studio.height)
    if (!rect) continue
    let tech = 0
    let base = 0
    let n = 0
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        if (nearLine(lines, technical.width, technical.height, x, y)) continue
        const i = (y * studio.width + x) * 4
        tech += oklabChroma(technical.rgba[i], technical.rgba[i + 1], technical.rgba[i + 2])
        base += oklabChroma(studio.rgba[i], studio.rgba[i + 1], studio.rgba[i + 2])
        n += 1
      }
    }
    if (n < 20 || base === 0) continue
    ratios.push({ id: name, ratio: round(tech / base) })
  }
}
const technicalReport = ratios.length
  ? { minRatio: round(Math.min(...ratios.map((item) => item.ratio))), objects: ratios }
  : null

function topCore(rgba, width, rect) {
  if (!rect) return null
  let peak = -1
  let top = null
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const Y = luma(rgba, (y * width + x) * 4)
      if (Y > peak) peak = Y
      if (Y >= 240 && (!top || y < top.y)) top = { x, y }
    }
  }
  if (peak < 0) return null
  if (!top) return { peak, rise: 0 }
  let prev = luma(rgba, (top.y * width + top.x) * 4)
  let rise = 0
  for (let d = 1; d <= 28; d++) {
    const y = top.y - d
    if (y < 0) break
    const Y = luma(rgba, (y * width + top.x) * 4)
    if (Y >= 240) {
      prev = Y
      continue
    }
    if (Y > prev) rise = Math.max(rise, Y - prev)
    prev = Y
    if (Y < 22) break
  }
  return { peak, rise }
}

function hotOutside(rgba, width, height, rects) {
  let n = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rects.some((rect) => hit(rect, x, y))) continue
      if (luma(rgba, (y * width + x) * 4) > 250) n += 1
    }
  }
  return n
}

/** Open black field, so the halo walk is not a shadow on the bench floor. */
async function measureEmissive(bench) {
  const source = `<layer width="320" height="220" background="#101014" camera="500"><sphere id="lamp" cx="90" cy="80" r="18" material="lamp" /><torus id="neon" cx="220" cy="90" r="36" tube="8" fill="#3ad8ff" material="neon" /></layer>`
  const painted = await renderLayer(source, { format: 'rgba', meshCache: false })
  const ids = byId(painted.report.elements ?? [])
  const lampRect = bounds(ids.get('lamp')?.ink, painted.width, painted.height)
  const neonRect = bounds(ids.get('neon')?.ink, painted.width, painted.height)
  const lamp = topCore(painted.rgba, painted.width, lampRect)
  const neon = topCore(painted.rgba, painted.width, neonRect)
  const peaks = [lamp?.peak, neon?.peak]
  if (bench) {
    for (const name of ['lamp', 'neon']) {
      const rect = bounds(bench.ids.get(name)?.ink, bench.width, bench.height)
      const core = topCore(bench.rgba, bench.width, rect)
      if (core) peaks.push(core.peak)
    }
  }
  const finite = peaks.filter((value) => value != null && value >= 0)
  return {
    coreY: round(finite.length ? Math.min(...finite) : null, 2),
    haloRise: round(Math.max(lamp?.rise ?? 0, neon?.rise ?? 0), 2),
    outsideHot: hotOutside(painted.rgba, painted.width, painted.height, [lampRect, neonRect].filter(Boolean)),
  }
}

function inkMask(measured) {
  const rects = [...measured.ids.values()]
    .filter((el) => el.id && el.id !== 'ground')
    .map((el) => bounds(el.ink, measured.width, measured.height))
    .filter(Boolean)
  return (x, y) => rects.some((rect) => hit(rect, x, y))
}

async function readRgba(path) {
  const image = await loadImage(path)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return { rgba: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height }
}

/** Object ink against the frozen manga page. */
async function measureHatch(manga) {
  if (!manga || !existsSync(hatchGolden)) return null
  const frozen = await readRgba(hatchGolden)
  if (frozen.width !== manga.width || frozen.height !== manga.height) return null
  return round(meanFlip(manga.rgba, frozen.rgba, manga.width, manga.height, inkMask(manga)), 6)
}

const emissive = await measureEmissive(rendered.get('3d-quality-draft'))
const mangaCell = rendered.get('3d-shade-manga')
const hatchFlip = await measureHatch(mangaCell)

const report = {
  platform: `${process.platform}-${process.arch}`,
  engine: engineString(),
  gates: loadGates(),
  cells,
  draftFinal,
  metals,
  contacts,
  floatGap: rendered.get('3d-quality-draft')?.floatGap ?? null,
  emissive,
  materials,
  toon: rendered.get('3d-shade-toon')?.toon ?? null,
  manga: mangaCell?.paper ? { ...mangaCell.paper, hatchFlip } : null,
  technical: technicalReport,
}

printTable(report)
if (write) {
  writeFileSync(goldenPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`wrote ${goldenPath}`)
}
if (check) applyGates(report.gates, report)
