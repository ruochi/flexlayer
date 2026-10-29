/**
 * 3D 样张度量。逐张渲染 docs/gallery/3d/*.layer，按 report.elements[].ink 取物体区域。
 *
 *   npx tsx scripts/gallery-metrics.mjs --write
 *   npx tsx scripts/gallery-metrics.mjs --check
 *
 * --check only fails when a gate is a number and this run is outside it.
 * The manga hatch is compared with the legacy raster in the private renderer
 * repo, pointed at by FLEXLAYER_LEGACY_REFERENCE, so no retired renderer output
 * is committed to this public repository.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderLayer } from '../src/render.ts'
import { meanFlip } from './flip-diff.ts'
import { GATES, checkGates, metalLumaDelta, platformSlack } from './metrics-gates.mjs'
import { brightBlobs, edgeStairShare, facetStripe, luma, materialFeatures, moireEnergy, percentile, ssimLuma, ssrChecker, steppedShare, straightSeams } from './metrics-image.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const repo = dirname(root)
const gallery = join(repo, 'docs/gallery/3d')
const goldenPath = join(repo, 'test/golden/gallery-metrics.json')
// The manga hatch is compared against the legacy raster, which lives in the
// private renderer repo. Copying it here would publish a retired renderer's
// output from a public repository, so the path is resolved at run time:
// FLEXLAYER_LEGACY_REFERENCE points at that repo's docs/quality/legacy-reference.
// When it is unset the comparison is skipped and `hatchFlip` reads n/a.
const legacyDir = process.env.FLEXLAYER_LEGACY_REFERENCE ?? null
const legacyReference = legacyDir ? join(legacyDir, '3d-shade-manga.png') : null
// Engine-local manga baseline (sibling of legacy-reference, or FLEXLAYER_ENGINE_BASELINE).
// QUALITY-4 §1.2: FLIP vs the foreign f9628c0 legacy page is not a stable absolute
// gate after framing changes and when the 0.144 calibration used a darwin addon
// that did not match the published linux binary. Gate regressions against a PNG
// rendered from this engine instead; still report the legacy FLIP for history.
const engineBaselineDir = process.env.FLEXLAYER_ENGINE_BASELINE
  ?? (legacyDir ? join(dirname(legacyDir), 'engine-baseline') : null)
const engineMangaReference = engineBaselineDir ? join(engineBaselineDir, '3d-shade-manga.png') : null

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const check = args.has('--check')
// `--out <dir>` writes every cell as a PNG so the picture can be looked at
// beside a reference. Looking at the number alone is what let the first round
// of gates pass while the sheets were plainly wrong.
const outIndex = process.argv.indexOf('--out')
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : null
if (outDir) mkdirSync(outDir, { recursive: true })
// The contact ratio is measured on the ground lip, which the kernel writes
// beside the frame while this process is rendering. Production renders leave
// the variable unset and write nothing. `renderFile` points it at a per-cell
// directory; a bare `1` would let every cell overwrite the previous one.

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

/**
 * Below this a floor pixel is a contact core or shadow core, not a penumbra.
 * The ramp a stair-stepped lookup draws sits between this and open floor, so
 * the contours that matter start here.
 */
const NOISE_FLOOR = 60

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
      // Canvas stroke AA mixes ink into the fill (QUALITY-5 §3.5). Catch the
      // fringe so chroma is graded on body pixels, not the wash around a line.
      // Exact ink is ~0; a half-mix with a mid fill sits around 2000–6000.
      if (dist(i, [28, 25, 21]) < 6000 || dist(i, [154, 143, 128]) < 3500) line[y * width + x] = 1
      else {
        const r = rgba[i]
        const g = rgba[i + 1]
        const b = rgba[i + 2]
        if (r + g + b < 100 && Math.max(r, g, b) - Math.min(r, g, b) < 28) line[y * width + x] = 1
      }
    }
  }
  return line
}

function nearLine(line, width, height, x, y) {
  for (let dy = -3; dy <= 3; dy++) {
    const yy = y + dy
    if (yy < 0 || yy >= height) continue
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 10) continue
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

function clearSeat(dir) {
  for (const name of ['seat-size.txt', 'seat-ground.bin', 'seat-color.bin', 'seat-depth.bin', 'seat-own.bin']) {
    try { rmSync(join(dir, name)) } catch { /* the first cell has nothing to clear */ }
  }
}

/** One seat directory per cell: a sheet renders every page in one process. */
const seatRoot = join(tmpdir(), 'flexlayer-seat')
function seatDirFor(stem) {
  return join(seatRoot, stem)
}

/** The same sheet with the shadow map four times as wide, which is Q0's reference. */
function shadowReferenceSource(source) {
  const tag = source.match(/<layer[^>]*\bcamera="[^"]*"[^>]*>/)
  if (!tag || /shadow-scale=/.test(tag[0])) return null
  return source.replace(tag[0], tag[0].replace(/\s*camera="/, ' shadow-scale="4" camera="'))
}

async function renderReference(file, source) {
  const ref = shadowReferenceSource(source)
  if (!ref) return null
  try {
    const painted = await renderLayer(ref, { baseDir: join(repo, 'docs/gallery'), format: 'rgba', meshCache: false })
    return { rgba: painted.rgba, width: painted.width, height: painted.height }
  } catch {
    return null
  }
}

async function renderFile(file) {
  const source = readFileSync(join(gallery, file), 'utf8')
  const dir = seatDirFor(file.replace(/\.layer$/, ''))
  clearSeat(dir)
  mkdirSync(dir, { recursive: true })
  process.env.FLEXLAYER_SEAT_DEBUG = dir
  const painted = await renderLayer(source, { baseDir: join(repo, 'docs/gallery'), format: 'rgba', meshCache: false })
  if (outDir) {
    const canvas = createCanvas(painted.width, painted.height)
    const ctx = canvas.getContext('2d')
    const image = ctx.createImageData(painted.width, painted.height)
    image.data.set(painted.rgba)
    ctx.putImageData(image, 0, 0)
    writeFileSync(join(outDir, file.replace(/\.layer$/, '.png')), canvas.toBuffer('image/png'))
  }
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

function loadSeat(dir) {
  try {
    const parts = readFileSync(join(dir, 'seat-size.txt'), 'utf8').trim().split(/\s+/).map(Number)
    const [pw, ph, originX, originY, pixelScale] = parts
    const ground = readFileSync(join(dir, 'seat-ground.bin'))
    const color = readFileSync(join(dir, 'seat-color.bin'))
    const depth = readFileSync(join(dir, 'seat-depth.bin'))
    // Optional: present only when the kernel was built with the shadow export.
    let shadow = null
    try {
      const bytes = readFileSync(join(dir, 'seat-shadow.bin'))
      if (bytes.length === pw * ph) shadow = bytes
    } catch {
      shadow = null
    }
    if (!pw || !ph || ground.length !== pw * ph || color.length !== pw * ph * 4 || depth.length !== pw * ph * 4) return null
    return { pw, ph, ground, color, depth, shadow, originX, originY, pixelScale }
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
  // 内核按 `(page - origin) * pixelScale` 取页坐标，所以页到格子的偏移就是
  // `-origin * scale`；写成 `+origin` 会把整张地面图挪到另一条对角线上。
  const baseOx = Number.isFinite(seat.originX) ? Math.round(-seat.originX * scale) + 0 : 0
  const baseOy = Number.isFinite(seat.originY) ? Math.round(-seat.originY * scale) + 0 : 0
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

function measure(stem, rgba, width, height, elements, fills, seat, reference = null) {
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
  // Cell captions sit in the 32px strip under the camera. Seat alignment can
  // still map those rows onto ground texels, so a label baseline reads as a
  // screen-aligned floor seam (QUALITY-5 §2: dof / anisotropy were the two
  // survivors). Drop caption ink the same way manga paper already does.
  const labels = elements
    .filter((el) => el.tag === 'p' || (el.tag === 'layer' && !el.box?.width?.toString().match(/^\d{3,}/)))
    .map((el) => bounds(el.ink, width, height))
    .filter(Boolean)
  const distant = distantFloor(rgba, width, height, camera, others)
  const align = seat ? alignSeat(rgba, width, height, seat) : null
  // Ground pixels the page has not painted over: the seat knows which pixels
  // are floor, captions and other page overlays are dropped, and the
  // silhouettes are left out so a body's own edge is never read as a seam.
  const groundPixel = (x, y) => {
    if (!seat || !align) return false
    const [kx, ky] = kernelXY(align, x, y)
    if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) return false
    return seat.ground[ky * seat.pw + kx] !== 0
  }
  const cleanGround = (x, y) =>
    groundPixel(x, y) && !others.some((rect) => hit(rect, x, y)) && !labels.some((rect) => hit(rect, x, y))
  const seams = seat && align ? straightSeams(rgba, width, height, cleanGround) : []
  const blobs = seat && align
    ? brightBlobs(rgba, width, height, camera, { require: cleanGround })
    : []
  // The shadow ramp is the darkened part of the clean floor, and only that.
  // Quantiles over the whole floor would put contours through the lamp pool and
  // the near-black contact core, neither of which is a shadow edge. A flat fill
  // is worse still: the material sheet is all flat fill, and every dark pixel
  // there is an object silhouette. So the ramp is defined by value, an
  // intermediate grey between the contact core and open floor, which is where a
  // penumbra lives and nothing else does. A cell with no pixels in that band has
  // no shadow to grade and reports nothing; a cell where the band is mostly
  // outline reports nothing either, because a silhouette is meant to be sharp.
  let stair = null
  let stairGap = null
  let edgeFlip = null
  if (seat && align && distant != null && distant - NOISE_FLOOR > 24) {
    const lo = NOISE_FLOOR + 8
    const hi = distant - 8
    let bandPx = 0
    const band = (x, y) => {
      if (!cleanGround(x, y)) return false
      const v = luma(rgba, (y * width + x) * 4)
      return v > lo && v < hi
    }
    for (let y = camera.y0; y < camera.y1; y++) {
      for (let x = camera.x0; x < camera.x1; x++) if (band(x, y)) bandPx += 1
    }
    // A penumbra needs area to be a penumbra. Forty pixels is one thin edge.
    if (bandPx >= 40) {
      stair = round(steppedShare(rgba, width, height, band))
    }
    // Along a straight edge the same question has a sharper answer: does every
    // row carry a transition, and does the edge move every row? That is the
    // number a nearest-neighbour lookup cannot fake, because it either leaves a
    // row with no crossing or holds the edge for a whole cell. The crossing is
    // taken at the midpoint of the row's own darkest and brightest ground pixel,
    // so a soft penumbra a few code values deep still counts: a fixed threshold
    // would only see edges that happen to span it.
    const crossing = (y) => {
      // The window is local: a row spanning the whole page takes its darkest
      // and brightest pixel from different objects, and the midpoint then lands
      // where nothing crosses. A 48-pixel run of clean floor holds one edge.
      for (let start = camera.x0; start + 48 <= camera.x1; start += 24) {
        let lo_ = Infinity
        let hi_ = -Infinity
        let clean = true
        for (let x = start; x < start + 48; x++) {
          if (!cleanGround(x, y)) {
            clean = false
            break
          }
          const v = luma(rgba, (y * width + x) * 4)
          if (v < lo_) lo_ = v
          if (v > hi_) hi_ = v
        }
        if (!clean || !(hi_ - lo_ > 3)) continue
        const half = (lo_ + hi_) / 2
        for (let x = start; x < start + 47; x++) {
          const a = luma(rgba, (y * width + x) * 4)
          const b = luma(rgba, (y * width + x + 1) * 4)
          if (a < half && b > half) return x + (half - a) / (b - a)
        }
      }
      return null
    }
    // The penumbra is where the shadow value is between its two ends. Walking
    // that band is what Q0 asks for: the value is the amount the floor was
    // asked to darken by, before the contact core and the ink wash are painted
    // over it, so a soft edge is in the band and a hard one is not. Along a
    // penumbra the direction of steepest darkening must point away from the
    // cast shadow, not along the pixel grid. A nearest-neighbour lookup holds a
    // value for a whole shadow cell, so its gradient comes out axis aligned:
    // within 20 degrees of 0 or 90.
    const shadowField = seat?.shadow ?? null
    if (shadowField && align) {
      const value = (x, y) => {
        const [kx, ky] = kernelXY(align, x, y)
        if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) return null
        return shadowField[ky * seat.pw + kx]
      }
      let graded = 0
      let stepped = 0
      for (let y = camera.y0 + 2; y < camera.y1 - 2; y++) {
        for (let x = camera.x0 + 2; x < camera.x1 - 2; x++) {
          const v = value(x, y)
          // 0.1 and 0.9 of 255: the penumbra, excluding flat shadow and flat floor.
          if (v == null || v < 26 || v > 229) continue
          const gx = value(x + 1, y) - value(x - 1, y)
          const gy = value(x, y + 1) - value(x, y - 1)
          if (gx == null || gy == null) continue
          const ax = Math.abs(gx)
          const ay = Math.abs(gy)
          if (Math.max(ax, ay) < 2) continue
          graded += 1
          // atan(ax/ay) within 20 degrees of the axes: min/max <= tan(20deg).
          if (Math.min(ax, ay) <= 0.364 * Math.max(ax, ay)) stepped += 1
        }
      }
      stair = graded >= 40 ? round(stepped / graded) : null
    }
    // Q0 allows either a direction histogram or an edge FLIP against a
    // reference. The histogram moved barely at all on these sheets (0.54 for a
    // bilinear penumbra and 0.54 for a nearest-neighbour one): a contact
    // penumbra is only a few pixels wide, so an axis-aligned gradient is as
    // likely on a smooth edge as on a stepped one. The edge FLIP is what Q0
    // named as the alternative, and it separates builds cleanly: the
    // nearest-neighbour build reads 0.036 against the bilinear one over the
    // whole frame but 0.213 on the penumbra band.
    //
    // The reference is the same sheet's penumbra at 4x the shading grid, which
    // is as smooth as the geometry allows. FLIP against it says how much of the
    // edge is still drawn on the output grid instead of being resolved. A
    // sheet whose penumbra is already only a few pixels wide (and therefore
    // reads close to the reference) is simply not the failure mode.
    let worst = null
    for (let y = camera.y0; y + 32 < camera.y1; y += 40) {
      const span = edgeStairShare(crossing, y, y + 31)
      // A window with no edge at all is sky or a solid, not a shadow that lost
      // its penumbra. Only windows that found the edge on some row are graded.
      if (!span || span.defined === 0) continue
      if (span.gap > (worst ?? -1)) worst = span.gap
    }
    stairGap = worst == null ? null : round(worst)
    // The direction histogram above barely separated a bilinear penumbra from a
    // nearest-neighbour one; Q0 allows the edge FLIP instead. The reference is
    // this sheet with the shadow map four times as wide, which resolves a ramp
    // the output grid can only approximate. `edgeFlip` is that difference
    // averaged over the penumbra band alone, so a sharp silhouette does not
    // dilute it and a flat floor cannot fake it.
    if (reference && reference.width === width && reference.height === height && bandPx >= 40) {
      const flip = meanFlip(rgba, reference.rgba, width, height, band)
      edgeFlip = flip == null ? null : round(flip, 6)
    }
  }
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
    // The page carries a caption inside the frame. It is not paper, and it is
    // dark enough to pull the mean down by several code values, so it is
    // excluded the same way the solids are.
    const labels = elements
      .filter((el) => el.tag === 'p' || (el.tag === 'layer' && !el.box?.width?.toString().match(/^\d{3,}/)))
      .map((el) => bounds(el.ink, width, height))
      .filter(Boolean)
    // The question is what the paper itself is, not what the page averages to:
    // a decorative band at the top and the far floor at the bottom are not
    // paper, and averaging them moved the number by several code values while
    // the paper under the solids was correct. The mode of the paper-coloured
    // pixels is the sheet, and `share` says how much of the page is that colour,
    // so a sheet that went grey cannot pass by having one bright pixel.
    let ySum = 0
    let cSum = 0
    let n = 0
    const bins = new Map()
    for (let y = camera.y0; y < camera.y1; y++) {
      for (let x = camera.x0; x < camera.x1; x++) {
        if (others.some((rect) => hit(rect, x, y))) continue
        if (labels.some((rect) => hit(rect, x, y))) continue
        const i = (y * width + x) * 4
        const Y = luma(rgba, i)
        ySum += Y
        cSum += oklabChroma(rgba[i], rgba[i + 1], rgba[i + 2])
        n += 1
        const key = Math.round(Y)
        bins.set(key, (bins.get(key) ?? 0) + 1)
      }
    }
    let mode = null
    let best = -1
    for (const [key, count] of bins) {
      if (count > best) {
        best = count
        mode = key
      }
    }
    // `share` only guards the mode. The remaining page is unmeasured, and a
    // grey wash over a quarter of it passed as long as the mode stayed bright.
    // A manga page is paper; anything well below paper that is not an object is
    // a smudge.
    let gray = 0
    for (const [key, count] of bins) if (key < 200) gray += count
    paper = n > 0
      ? {
          meanY: round(ySum / n, 2),
          chroma: round(cSum / n),
          paperY: mode,
          share: round(best / n, 4),
          grayShare: round(gray / n, 4),
        }
      : null
  }
  return {
    overexposure: round(over),
    meanY: round(meanIn(rgba, width, camera), 2),
    metals,
    contacts,
    seams: seams.slice(0, 6).map((seam) => ({ axis: seam.axis, position: seam.position, hits: seam.hits })),
    seamCount: seams.length,
    blobs,
    stair,
    stairGap,
    edgeFlip,
    floatGap: round(floatGap),
    toon,
    paper,
    camera,
    elements,
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
    // `null` in a recorded file means "not calibrated yet". It must not overwrite
    // a value the script now has, or tightening a gate here could never take
    // effect: every run would read the old null back.
    const recorded = Object.fromEntries(Object.entries(saved.gates ?? {}).filter(([, value]) => value != null))
    return { ...GATES, ...recorded }
  } catch {
    return { ...GATES }
  }
}

/** Which platform the recorded numbers came from, or null when there is none. */
function readBaselinePlatform() {
  try {
    return JSON.parse(readFileSync(goldenPath, 'utf8')).platform ?? null
  } catch {
    return null
  }
}

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function applyGates(gates, report, slack = { luma: 0, fraction: 0 }) {
  const errors = checkGates(gates, report, slack)
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
  console.log(`manga paper Y ${report.manga?.paperY ?? 'n/a'} (page mean ${report.manga?.meanY ?? 'n/a'}, ${report.manga?.share ?? 'n/a'} of page)  grey ${report.manga?.grayShare ?? 'n/a'}  chroma ${report.manga?.chroma ?? 'n/a'}  hatch flip legacy ${report.manga?.hatchFlip ?? 'n/a'} engine ${report.manga?.hatchFlipEngine ?? 'n/a'}`)
  if (report.lines) {
    console.log(`lines empty below ${report.lines.emptyBelow}  ink gap ${report.lines.inkGap}px ${report.lines.inkGapPair}  top gap ${report.lines.topGap}  solids ${report.lines.solids}`)
  }
  const seamCells = (report.groundDefects ?? []).filter((item) => item.seams > 0)
  const blobCells = (report.groundDefects ?? []).filter((item) => item.blobs > 0)
  const stairs = (report.groundDefects ?? []).map((item) => item.stair).filter((value) => value != null)
  console.log(`ground seams ${seamCells.length} cell(s)  ${seamCells.map((item) => `${item.cell}:${item.seams}/${item.seamHits}px`).join(' ') || '-'}`)
  console.log(`bright blobs ${blobCells.length} cell(s)  ${blobCells.map((item) => `${item.cell}:${item.blobs}@${item.blobPeak}`).join(' ') || '-'}`)
  console.log(`shadow stair share max ${stairs.length ? round(Math.max(...stairs)) : 'n/a'}`)
  const gaps = (report.groundDefects ?? []).map((item) => item.stairGap).filter((value) => value != null)
  console.log(`shadow edge gap max ${gaps.length ? round(Math.max(...gaps)) : 'n/a'} (${gaps.length} cell(s) with a graded edge)`)
  const edgeFlips = (report.groundDefects ?? []).map((item) => item.edgeFlip).filter((value) => value != null)
  if (edgeFlips.length) {
    const worst = (report.groundDefects ?? []).filter((item) => item.edgeFlip != null).sort((a, b) => b.edgeFlip - a.edgeFlip)
    console.log(`shadow edge FLIP max ${round(Math.max(...edgeFlips), 4)}  ${worst.slice(0, 5).map((item) => `${item.cell}:${item.edgeFlip}`).join(' ')}`)
  }
  if (gaps.length) {
    const worst = (report.groundDefects ?? []).filter((item) => item.stairGap != null).sort((a, b) => b.stairGap - a.stairGap)
    console.log(`  worst ${worst.slice(0, 5).map((item) => `${item.cell}:${item.stairGap}`).join(' ')}`)
  }
  const toonLevels = (report.toon ?? []).map((item) => item.levels).filter((value) => value != null)
  console.log(`toon levels max ${toonLevels.length ? Math.max(...toonLevels) : 'n/a'}`)
  for (const item of report.toon ?? []) {
    if (item.levels > 4) console.log(`toon ${item.id} ${item.levels}`)
  }
  console.log(`technical/studio min chroma ratio ${report.technical?.minRatio ?? 'n/a'}  hidden ${report.technicalHidden?.count ?? 'n/a'} vs legacy ${report.technicalHidden?.legacy ?? 'n/a'} (${report.technicalHidden?.ratio ?? 'n/a'})`)
  const flips = report.materials.map((pair) => pair.flip).filter((value) => value != null)
  console.log(`material adjacent flip min ${flips.length ? Math.min(...flips) : 'n/a'}  n ${flips.length}`)
  if (report.glassSsim) {
    console.log(`glass SSIM clear ${report.glassSsim.clear ?? 'n/a'} frost ${report.glassSsim.frost ?? 'n/a'}`)
  }
  if (report.materialPairDeltas?.length) {
    console.log(
      `material pair deltas ${report.materialPairDeltas.map((p) => `${p.a.split('3d-mat-')[1]}/${p.b.split('3d-mat-')[1]}:${p.bestDelta}`).join(' ')}`,
    )
  }
  if (report.metalPlasticReflectDelta != null) {
    console.log(`metal vs plastic reflectContent Δ ${report.metalPlasticReflectDelta}`)
  }
  const weakest = report.materials
    .filter((pair) => pair.sphereFlip != null)
    .sort((a, b) => a.sphereFlip - b.sphereFlip)
    .slice(0, 4)
  if (weakest.length) {
    console.log(`material weakest sphere flip ${weakest.map((p) => `${p.a}/${p.b}:${p.sphereFlip}`).join(' ')}`)
  }
  console.log(`draft/final metal luma delta ${round(metalLumaDelta(report)) ?? 'n/a'}`)
  const em = report.emissive
  console.log(`emissive core Y ${em?.coreY ?? 'n/a'}  halo rise ${em?.haloRise ?? 'n/a'}  outside hot ${em?.outsideHot ?? 'n/a'}`)
  const st = report.still
  if (st) {
    console.log(`still floor open ${st.openMedian} peak ${st.openPeak} pool rise ${st.poolRise}  lamp-below rise ${st.lampPoolRise ?? 'n/a'}  dip ${st.poolDip ?? 'n/a'}`)
    if (st.objectBlobs) {
      console.log(`still object blobs ${Object.entries(st.objectBlobs).map(([k, v]) => `${k}:${v}`).join(' ') || '-'}`)
    }
    console.log(`still neon ring ${st.neon?.ring ?? 'n/a'}  core ${st.neon?.core ?? 'n/a'}  hollow ${st.neon?.hollow ?? 'n/a'}  occluded ${st.neon?.occluded ?? 'n/a'}`)
    const stripes = Object.entries(st.stripes ?? {})
      .filter(([name]) => name !== 'throughGlass')
      .map(([name, item]) => `${name}:${item?.peak ?? '-'}/${item?.share ?? '-'}`)
      .join(' ')
    console.log(`still stripes (glass ${st.glassBase ?? 'n/a'}) ${stripes || '-'}`)
    const through = st.stripes?.throughGlass
    if (through) console.log(`still stripes inside glass red ${through.red} white ${through.white} blue ${through.blue} of ${through.total}`)
    console.log(`still empty floor ${st.emptyFloor ?? 'n/a'}  blue top gap ${st.blueTopGap ?? 'n/a'}`)
    console.log(`still metal-plate SSR checker ${st.ssrChecker ?? 'n/a'}`)
  }
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
  const reference = await renderReference(file, readFileSync(join(gallery, file), 'utf8'))
  // The reference render overwrote the seat buffers, so they are read again
  // afterwards. Its shadow map is the smooth one the penumbra is graded against,
  // which is the field the direction histogram should see too.
  const seat = loadSeat(seatDirFor(stem))
  rendered.set(stem, measure(stem, rgba, width, height, report.elements ?? [], painted.fills, seat, reference))
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
    // One average over every object lets a material pair that only changes the
    // plate pass on the plate's share of the mask, while the sphere it is
    // supposed to differ on stays identical. Each body is graded on its own box,
    // and the pair reports the weakest one.
    const perObject = {}
    for (const name of OBJECT_IDS) {
      const rect = bounds(left.ids.get(name)?.ink, left.width, left.height)
      if (!rect) continue
      const only = (x, y) => hit(rect, x, y)
      perObject[name] = round(meanFlip(left.rgba, right.rgba, left.width, left.height, only), 6)
    }
    // The graded body is the sphere: every finish cell puts the material on it,
    // and `box` and `side` are the same objects beside it, there to show what
    // the material does to what is behind and around it. `side` sits outside the
    // sphere's refraction path, so a pair that only changes the glass leaves it
    // byte-identical by design; gating on it would fail every clear material.
    const weakest = Object.entries(perObject).sort((a, b) => a[1] - b[1])[0]
    materials.push({
      a: MATERIAL_GRID[i],
      b: name,
      flip: round(flip, 6),
      weakest: weakest?.[0] ?? null,
      weakestFlip: weakest?.[1] ?? null,
      sphereFlip: perObject.sphere ?? null,
    })
  }
}

/** Per-cell material features on the sphere (QUALITY-4 §4.4). */
const materialTraits = []
for (const name of MATERIAL_GRID) {
  const cell = rendered.get(name)
  if (!cell) continue
  const rect = bounds(cell.ids.get('sphere')?.ink, cell.width, cell.height)
  if (!rect) continue
  // Stay inside 0.75 r so silhouette AA does not dominate reflectContent.
  const cx = (rect.x0 + rect.x1) / 2
  const cy = (rect.y0 + rect.y1) / 2
  const rr = Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0) / 2
  const accept = (x, y) => {
    if (!hit(rect, x, y)) return false
    return (x - cx) ** 2 + (y - cy) ** 2 <= (rr * 0.75) ** 2
  }
  const features = materialFeatures(cell.rgba, cell.width, cell.height, accept)
  if (!features) continue
  materialTraits.push({
    cell: name,
    highlightArea: round(features.highlightArea, 4),
    highlightSharpness: round(features.highlightSharpness, 2),
    darkFloor: round(features.darkFloor, 1),
    anisotropy: round(features.anisotropy, 3),
    reflectContent: features.reflectContent == null ? null : round(features.reflectContent, 4),
  })
}

/**
 * Glass transmittance (QUALITY-4 §4.4): the material cells put vertical RGB
 * stripes behind the sphere. SSIM is mean-matched against the per-column
 * stripe profile measured *above* the sphere (the band below the disk is
 * plinth/ground and flattens the reference; an earlier full-band Y-profile
 * was flat for vertical bars). Clear keeps stripe edges; frost washes them.
 */
function glassTransmit(cell) {
  const sphere = bounds(cell.ids.get('sphere')?.ink, cell.width, cell.height)
  const red = bounds(cell.ids.get('stripe-red')?.ink, cell.width, cell.height)
  const white = bounds(cell.ids.get('stripe-white')?.ink, cell.width, cell.height)
  const blue = bounds(cell.ids.get('stripe-blue')?.ink, cell.width, cell.height)
  if (!sphere || !red || !white || !blue) return null
  const cx = (sphere.x0 + sphere.x1) / 2
  const cy = (sphere.y0 + sphere.y1) / 2
  const r = Math.min(sphere.x1 - sphere.x0, sphere.y1 - sphere.y0) / 2
  const bandX0 = Math.min(red.x0, white.x0, blue.x0)
  const bandX1 = Math.max(red.x1, white.x1, blue.x1)
  const bandY0 = Math.min(red.y0, white.y0, blue.y0)
  const bandY1 = Math.max(red.y1, white.y1, blue.y1)
  const x0 = Math.max(sphere.x0, bandX0)
  const x1 = Math.min(sphere.x1, bandX1)
  if (x1 - x0 < 3) return null
  // Per-column luma of the stripe band above the sphere disk — that is the
  // part of the plate where the three fills are still readable as bars.
  const profileX = []
  for (let x = bandX0; x < bandX1; x++) {
    let sum = 0
    let n = 0
    for (let y = bandY0; y < Math.min(bandY1, sphere.y0); y++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) continue
      sum += luma(cell.rgba, (y * cell.width + x) * 4)
      n += 1
    }
    profileX[x] = n ? sum / n : null
  }
  const actual = []
  const expected = []
  let edge = 0
  let edgeN = 0
  for (let y = Math.max(sphere.y0, bandY0); y < Math.min(sphere.y1, bandY1); y++) {
    for (let x = x0; x < x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > (r * 0.75) ** 2) continue
      const px = profileX[x]
      if (px == null) continue
      const yL = luma(cell.rgba, (y * cell.width + x) * 4)
      actual.push(yL)
      expected.push(px)
      if (x > 0 && x < cell.width - 1) {
        edge += Math.abs(luma(cell.rgba, (y * cell.width + x + 1) * 4) - luma(cell.rgba, (y * cell.width + x - 1) * 4))
        edgeN += 1
      }
    }
  }
  if (actual.length < 24) return null
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length
  const ma = mean(actual)
  const mb = mean(expected)
  const matched = actual.map((v) => v - ma + mb)
  return {
    ssim: ssimLuma(matched, expected),
    edge: edgeN ? edge / edgeN : null,
  }
}

const glassClear = rendered.get('3d-mat-glass-0-06')
const glassFrost = rendered.get('3d-mat-glass-0-72')
const glassClearT = glassClear ? glassTransmit(glassClear) : null
const glassFrostT = glassFrost ? glassTransmit(glassFrost) : null
const glassSsim = {
  clear: glassClearT?.ssim != null ? round(glassClearT.ssim, 4) : null,
  frost: glassFrostT?.ssim != null ? round(glassFrostT.ssim, 4) : null,
  clearEdge: glassClearT?.edge != null ? round(glassClearT.edge, 2) : null,
  frostEdge: glassFrostT?.edge != null ? round(glassFrostT.edge, 2) : null,
}

/**
 * Adjacent material-grid pairs (QUALITY-5 §2.1 keeps the ≥30% bestDelta floor
 * and adds category rules in `checkMaterialPairRules`).
 */
const MATERIAL_PAIRS = [
  ['3d-mat-plastic-0-12', '3d-mat-plastic-0-85'],
  ['3d-mat-glass-0-06', '3d-mat-glass-0-72'],
  ['3d-mat-metal-0-08', '3d-mat-metal-0-8'],
  ['3d-mat-plastic-0-12', '3d-mat-clearcoat-1'],
  ['3d-mat-metal-0-08', '3d-mat-anisotropy-0-9'],
  ['3d-mat-metal-0-08', '3d-mat-brushed'],
  ['3d-mat-metal-0-08', '3d-mat-mirror'],
]
function traitDelta(a, b) {
  const keys = ['highlightArea', 'highlightSharpness', 'darkFloor', 'anisotropy', 'reflectContent']
  let best = 0
  const perKey = {}
  for (const key of keys) {
    if (a[key] == null || b[key] == null) continue
    const d = Math.abs(a[key] - b[key]) / Math.max(Math.abs(a[key]), Math.abs(b[key]), 1e-6)
    perKey[key] = round(d, 4)
    if (d > best) best = d
  }
  return { best, perKey }
}
const byCell = new Map(materialTraits.map((t) => [t.cell, t]))
const materialPairDeltas = MATERIAL_PAIRS.map(([a, b]) => {
  const A = byCell.get(a)
  const B = byCell.get(b)
  if (!A || !B) return { a, b, bestDelta: null, deltas: null }
  const { best, perKey } = traitDelta(A, B)
  return {
    a,
    b,
    bestDelta: round(best, 4),
    deltas: perKey,
  }
})
/** QUALITY-4 §4.4: metal vs plastic reflection-content NCC absolute gap ≥ 0.2. */
const metalReflect = byCell.get('3d-mat-metal-0-08')?.reflectContent
const plasticReflect = byCell.get('3d-mat-plastic-0-12')?.reflectContent
const metalPlasticReflectDelta =
  metalReflect != null && plasticReflect != null ? round(Math.abs(metalReflect - plasticReflect), 4) : null

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

/**
 * Hidden-line ink in the technical cell, against the legacy raster. The brief
 * asks for at least 90% of what main drew: a technical drawing without its
 * hidden edges loses the far side of every solid, which is the whole point of
 * the style. The count is taken over the cell, so a shift in composition shows
 * up as a drop rather than hiding behind a per-object average.
 */
async function technicalHidden(technical) {
  if (!technical) return null
  // LOOK_HIDDEN is (154,143,128). QUALITY-5 §2 restores ±12; AA fringe that
  // drifts outside that band is a colour wash to fix, not a wider gate.
  const tol = 12
  const match = (rgba, i) => {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    return Math.abs(r - 154) <= tol && Math.abs(g - 143) <= tol && Math.abs(b - 128) <= tol
  }
  let now = 0
  for (let i = 0; i < technical.width * technical.height; i++) {
    if (match(technical.rgba, i)) now += 1
  }
  const legacyCell = join(legacyDir ?? '', '3d-shade-technical.png')
  if (!legacyDir || !existsSync(legacyCell)) return { count: now, ratio: null }
  const frozen = await readRgba(legacyCell)
  if (frozen.width !== technical.width || frozen.height !== technical.height) return { count: now, ratio: null }
  let before = 0
  for (let i = 0; i < frozen.width * frozen.height; i++) {
    if (match(frozen.rgba, i)) before += 1
  }
  return { count: now, legacy: before, ratio: before > 0 ? round(now / before) : null }
}
const technicalHiddenReport = await technicalHidden(rendered.get('3d-shade-technical'))

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

/** 一张样张里除地面外的实体 ink，合成一张覆盖遮罩。地面上的光池和空地面都不算实体。 */
function objectRects(ids, width = 1e6, height = 1e6) {
  return [...ids.values()]
    .filter((el) => el.id && el.id !== 'ground')
    .map((el) => (el.ink && el.ink.width > 0 && el.ink.height > 0
      ? { x0: el.ink.x, y0: el.ink.y, x1: el.ink.x + el.ink.width, y1: el.ink.y + el.ink.height }
      : bounds(el.ink, width, height)))
    .filter(Boolean)
}

/**
 * still 的地面判据。铺地像素只在实体 ink 之外取，物体自己的高光不会冒充灯光。
 * 光池只看灯在地面上投影点周围：`peak` 取那一片的最亮值，`base` 取远离所有
 * 灯的同一片开阔地面。早先 `peak` 是全图地面上最亮的值，墙和白盒的顶面都能
 * 冒充光池，所以门槛过了而灯下是暗的。
 */
function floorStats(rgba, width, height, ids) {
  const rects = objectRects(ids, width, height)
  const covered = (x, y) => rects.some((rect) => x >= rect.x0 && y >= rect.y0 && x < rect.x1 && y < rect.y1)
  const lamp = bounds(ids.get('lamp')?.ink, width, height)
  // The pool sits under the lamp. Sample a box that reaches from the lamp's own
  // ink down to the bottom of the frame, so the pool is measured where a lamp
  // hanging over the floor would actually put it.
  const near = []
  const far = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (covered(x, y)) continue
      const Y = luma(rgba, (y * width + x) * 4)
      // The page behind the studio is a dark field, not floor. A pool reading
      // taken over it measures the background's own black, not a lamp.
      if (Y < 120) continue
      // The lamp's own ink is excluded by `covered`, but its halo reaches past
      // it, and the halo is not a pool: it is the bulb's bloom, and it stays at
      // the same brightness whether or not the floor under it is lit. Start the
      // pool window below the halo so a bloom cannot pass for a wash.
      const halo = lamp && x >= lamp.x0 - 140 && x <= lamp.x1 + 140 && y >= lamp.y0 && y < lamp.y1 + 120
      if (halo) continue
      const underLamp = lamp && x >= lamp.x0 - 140 && x <= lamp.x1 + 140 && y >= lamp.y1 + 120
      if (underLamp) near.push(Y)
      else far.push(Y)
    }
  }
  const all = [...near, ...far].sort((a, b) => a - b)
  if (!all.length) return null
  const median = all[Math.floor(all.length / 2)]
  // The pool has to beat the floor that is nowhere near a lamp. Comparing
  // against the frame-wide median let a bright wall raise the bar and a bright
  // wall also meet it, which is how a dark pool passed.
  far.sort((a, b) => a - b)
  const farMedian = far.length ? far[Math.floor(far.length / 2)] : median
  const poolPeak = near.length ? Math.max(...near) : far[far.length - 1]
  // A pool is a lift, never a dip. Measuring only the peak let a wash that also
  // darkened its own rim pass: the rim is the shadow of the lamp's bloom, and it
  // sat 48 below the open floor while the peak still cleared the bar.
  const poolLow = near.length ? Math.min(...near) : far[0]
  return {
    openMedian: round(farMedian, 1),
    openPeak: round(poolPeak, 1),
    // 光池必须比开阔地面亮出一截，不是全图随便一个白点。
    poolRise: round(poolPeak - farMedian, 1),
    lampPoolRise: near.length ? round(poolPeak - farMedian, 1) : null,
    poolDip: round(farMedian - poolLow, 1),
  }
}

/**
 * 霓虹要看出是环：沿 ink 半径采样，环带一圈都应亮，环心必须暗下来。
 * `ring` 是 r/R 在 0.55..0.95 上扫一整圈的亮度中位数，`core` 是 r/R<0.2 的中位数。
 * 环心不暗就说明光晕把环吞成了一团，`hollow` 是核心相对环带的落差。
 */
function neonRing(rgba, width, height, rect) {
  if (!rect) return null
  const cx = (rect.x0 + rect.x1) / 2
  const cy = (rect.y0 + rect.y1) / 2
  const R = Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0) / 2
  if (!(R > 4)) return null
  const at = (t, deg) => {
    const x = Math.round(cx + Math.cos((deg * Math.PI) / 180) * R * t)
    const y = Math.round(cy + Math.sin((deg * Math.PI) / 180) * R * t)
    if (x < 0 || y < 0 || x >= width || y >= height) return null
    return luma(rgba, (y * width + x) * 4)
  }
  const band = []
  const core = []
  for (let deg = 0; deg < 360; deg += 10) {
    for (let t = 0.55; t <= 0.95; t += 0.05) {
      const Y = at(t, deg)
      if (Y != null) band.push(Y)
    }
    const c = at(0.1, deg)
    if (c != null) core.push(c)
  }
  if (!band.length || !core.length) return null
  band.sort((a, b) => a - b)
  core.sort((a, b) => a - b)
  const ring = band[Math.floor(band.length / 2)]
  const inner = core[Math.floor(core.length / 2)]
  return { ring: round(ring, 1), core: round(inner, 1), hollow: round(ring - inner, 1) }
}

/**
 * How much of the neon ring sits behind something else.
 *
 * `hollow` alone cannot tell a ring that reads as a ring from a ring that is
 * mostly hidden: the part that is still visible is still a ring, so the metric
 * passes while the composition shows a crescent. This walks the ring's own ink
 * and counts the pixels another body's ink covers.
 */
function neonOccluded(neonRect, otherRects) {
  if (!neonRect) return null
  const w = neonRect.x1 - neonRect.x0
  const h = neonRect.y1 - neonRect.y0
  if (!(w > 0 && h > 0)) return null
  let total = 0
  let hidden = 0
  for (let y = Math.floor(neonRect.y0); y < neonRect.y1; y++) {
    for (let x = Math.floor(neonRect.x0); x < neonRect.x1; x++) {
      total += 1
      if (otherRects.some((r) => x >= r.x0 && y >= r.y0 && x < r.x1 && y < r.y1)) hidden += 1
    }
  }
  return total ? round(hidden / total, 3) : null
}

/**
 * 色条要能透过玻璃看见：每条 ink 里的最高亮度要明显高过玻璃自己的底色，
 * 不然就是被压成一块灰。`share` 是条带里亮度超过玻璃底色 +12 的像素占比。
 */
function stripeVisible(rgba, width, height, ids, glassRect) {
  const out = {}
  const glassBase = glassRect
    ? (() => {
        const values = []
        for (let y = Math.floor(glassRect.y0); y < glassRect.y1; y += 2) {
          for (let x = Math.floor(glassRect.x0); x < glassRect.x1; x += 2) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue
            values.push(luma(rgba, (y * width + x) * 4))
          }
        }
        values.sort((a, b) => a - b)
        return values.length ? values[Math.floor(values.length / 2)] : null
      })()
    : null
  for (const name of ['stripe-red', 'stripe-white', 'stripe-blue']) {
    const rect = bounds(ids.get(name)?.ink, width, height)
    if (!rect) {
      out[name] = null
      continue
    }
    let peak = 0
    let above = 0
    let n = 0
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const Y = luma(rgba, (y * width + x) * 4)
        if (Y > peak) peak = Y
        if (glassBase != null && Y > glassBase + 12) above += 1
        n += 1
      }
    }
    out[name] = { peak: round(peak, 1), share: n ? round(above / n, 4) : null }
  }
  // `share` only says a stripe is brighter than the glass somewhere in its own
  // box. The plate's question is whether the stripe survives *through* the
  // sphere, and a stripe can be bright in its own box while the glass in front
  // of it paints it out. Count, inside the glass ink, the pixels that carry each
  // stripe's hue.
  if (glassRect) {
    let red = 0
    let white = 0
    let blue = 0
    let total = 0
    for (let y = Math.floor(glassRect.y0); y < glassRect.y1; y++) {
      for (let x = Math.floor(glassRect.x0); x < glassRect.x1; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const i = (y * width + x) * 4
        const r = rgba[i]
        const g = rgba[i + 1]
        const b = rgba[i + 2]
        total += 1
        // The glass is a bright white body, so a stripe behind it is the stripe
        // mixed toward white, not the stripe's own saturated fill. The hue test
        // has to allow that mix: at `r > g * 1.6` a red stripe behind this glass
        // reads as no stripe at all, which is how a sphere that painted its
        // stripes out could pass.
        if (r > 100 && r - g > 14 && r - b > 14) red += 1
        else if (b > 80 && b - r > 10 && b - g > 6) blue += 1
        else if (r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 26) white += 1
      }
    }
    const share = (n) => (total ? round(n / total, 4) : null)
    out.throughGlass = { red: share(red), white: share(white), blue: share(blue), total }
  }
  return { glassBase: round(glassBase, 1), stripes: out }
}

/** 构图：物体 ink 的底边以下、相机层底边以上的空地面占多少；蓝球离层顶多远。 */
function stillFrame(ids, cameraRect, top, height) {
  if (!cameraRect) return null
  // Labels sit outside the camera layer. Only ink inside the frame is a solid,
  // or the caption under the plate would shorten the floor that is graded.
  const rects = objectRects(ids, 1e6, height ?? 1e6)
    .filter((rect) => rect.y0 >= cameraRect.y0 && rect.y1 <= cameraRect.y1)
  if (!rects.length) return null
  const bottom = Math.max(...rects.map((rect) => rect.y1))
  const floor = Math.max(1, cameraRect.y1 - cameraRect.y0)
  const blue = bounds(ids.get('blue-float')?.ink, 1e6, height ?? 1e6)
  return {
    emptyFloor: round(Math.min(1, (cameraRect.y1 - bottom) / floor), 4),
    blueTopGap: blue ? round(blue.y0 - (top ?? cameraRect.y0), 1) : null,
  }
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

/** Object-ink FLIP against a reference manga PNG (legacy or engine baseline). */
async function measureHatchAgainst(manga, referencePath) {
  if (!manga || !referencePath || !existsSync(referencePath)) return null
  const frozen = await readRgba(referencePath)
  if (frozen.width !== manga.width || frozen.height !== manga.height) return null
  return round(meanFlip(manga.rgba, frozen.rgba, manga.width, manga.height, inkMask(manga)), 6)
}

const emissive = await measureEmissive(rendered.get('3d-quality-draft'))
// still 的四条单独列出来，提案 Q3 要按条验收。
const stillCell = rendered.get('3d-still')
let stillReport = null
if (stillCell) {
  const ids = stillCell.ids
  // `cameraBox` only sees a `view`, which the native report does not carry, so
  // read the frame off the camera layer itself. It is the one box that is not
  // the page and is taller than a label.
  const cameraLayer = (stillCell.elements ?? [])
    .filter((el) => el.tag === 'layer' && el.box && el.box.height > 0 && el.path?.includes('/'))
    .sort((a, b) => b.box.height - a.box.height)[0]
  const cameraRect = cameraLayer ? bounds(cameraLayer.box, stillCell.width, stillCell.height) : null
  const glassRect = bounds(ids.get('glass')?.ink, stillCell.width, stillCell.height)
  const neonRect = bounds(ids.get('neon')?.ink, stillCell.width, stillCell.height)
  // A white lump growing out of the bulb is the same artifact as one on open
  // floor, but the floor-only walk never sees it: those pixels sit inside the
  // bulb's own ink, which `cleanGround` rejects. Glass and neon are excluded on
  // purpose — a glass sphere is a mirror and a neon ring is emissive, so both
  // are legitimately 240..255 across most of their ink and a walk there only
  // measures their design. What is measurable is the bulb's core escaping its
  // own silhouette: a bulb that ends at its ink scores zero, a bulb that blooms
  // past it leaves a field of near-white pixels outside the box.
  const objectBlobs = {}
  const lampRect = bounds(ids.get('lamp')?.ink, stillCell.width, stillCell.height)
  if (lampRect) {
    const grown = 30
    let outside = 0
    for (let y = Math.max(0, Math.floor(lampRect.y0 - grown)); y < Math.min(stillCell.height, Math.ceil(lampRect.y1 + grown)); y++) {
      for (let x = Math.max(0, Math.floor(lampRect.x0 - grown)); x < Math.min(stillCell.width, Math.ceil(lampRect.x1 + grown)); x++) {
        if (x >= lampRect.x0 && y >= lampRect.y0 && x < lampRect.x1 && y < lampRect.y1) continue
        if (luma(stillCell.rgba, (y * stillCell.width + x) * 4) >= 250) outside += 1
      }
    }
    objectBlobs.lampBloom = outside
  }
  const goldRect = bounds(ids.get('gold')?.ink, stillCell.width, stillCell.height)
  // Mid-band of the cylinder wall only — silhouettes jump 100+ and are not facets.
  const goldStripe = goldRect
    ? facetStripe(
        stillCell.rgba,
        stillCell.width,
        stillCell.height,
        (x, y) => {
          const cx = (goldRect.x0 + goldRect.x1) / 2
          const cy = (goldRect.y0 + goldRect.y1) / 2
          const r = Math.min(goldRect.x1 - goldRect.x0, goldRect.y1 - goldRect.y0) / 2
          const d = Math.hypot(x - cx, y - cy)
          if (d < r * 0.45 || d > r * 0.82) return false
          const yL = luma(stillCell.rgba, (y * stillCell.width + x) * 4)
          if (yL < 40 || yL > 230) return false
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nY = luma(stillCell.rgba, ((y + dy) * stillCell.width + (x + dx)) * 4)
            if (Math.abs(nY - yL) > 25) return false
          }
          return true
        },
        0.9,
      )
    : null
  const metalPlate = bounds(ids.get('metal-plate')?.ink, stillCell.width, stillCell.height)
  const chrome = bounds(ids.get('chrome')?.ink, stillCell.width, stillCell.height)
  // Grade the bowl under the chrome sphere — that is where draft SSR drew the
  // checkerboard (QUALITY-5 §1.2), not the whole plate.
  const ssrRate = metalPlate && chrome
    ? ssrChecker(stillCell.rgba, stillCell.width, stillCell.height, (x, y) => {
        if (!hit(metalPlate, x, y) || hit(chrome, x, y)) return false
        const cx = (chrome.x0 + chrome.x1) / 2
        const cy = chrome.y1
        const r = Math.max(chrome.x1 - chrome.x0, chrome.y1 - chrome.y0) * 0.85
        return Math.hypot(x - cx, y - cy) <= r
      })
    : null
  stillReport = {
    ...(floorStats(stillCell.rgba, stillCell.width, stillCell.height, ids) ?? {}),
    objectBlobs,
    neon: {
      ...(neonRing(stillCell.rgba, stillCell.width, stillCell.height, neonRect) ?? {}),
      // Glass and the bulb are the two bodies the ring can disappear behind.
      occluded: neonOccluded(neonRect, [glassRect, lampRect].filter(Boolean)),
    },
    ...(stripeVisible(stillCell.rgba, stillCell.width, stillCell.height, ids, glassRect) ?? {}),
    ...(stillFrame(ids, cameraRect, cameraRect?.y0, stillCell.height) ?? {}),
    goldFacetStripe: goldStripe == null ? null : round(goldStripe, 2),
    ssrChecker: ssrRate == null ? null : round(ssrRate, 4),
  }
}
const mangaCell = rendered.get('3d-shade-manga')
const hatchFlip = await measureHatchAgainst(mangaCell, legacyReference)
const hatchFlipEngine = await measureHatchAgainst(mangaCell, engineMangaReference)

/**
 * `3d-lines` composition. The plate is a line-art sheet: the objects have to
 * fill it, and no two of them may sit on top of each other's ink, or the lines
 * cross where there is no geometry to explain them. Both readings are taken
 * over the camera layer, not the page, so the caption and title do not count.
 */
function linesFrame(cell) {
  if (!cell) return null
  const cameraLayer = (cell.elements ?? [])
    .filter((el) => el.tag === 'layer' && el.box && el.box.height > 0 && el.path?.includes('/'))
    .sort((a, b) => b.box.height - a.box.height)[0]
  const camera = cameraLayer ? bounds(cameraLayer.box, cell.width, cell.height) : null
  if (!camera) return null
  const solids = [...cell.ids.values()]
    .filter((el) => el.id && el.id !== 'ground')
    .map((el) => {
      const rect = bounds(el.ink, cell.width, cell.height)
      return rect && { ...rect, rowY: el.box?.y ?? rect.y0 }
    })
    .filter((rect) => rect && rect.y0 >= camera.y0 && rect.y1 <= camera.y1 && rect.x0 >= camera.x0 && rect.x1 <= camera.x1)
  // The line plate names no ids: every solid is an anonymous primitive. Take the
  // drawable tags inside the camera layer instead, and drop the text, which sits
  // in its own nested layers and is not a solid.
  const solidTags = new Set(['rect', 'cylinder', 'sphere', 'path', 'tube', 'torus', 'circle'])
  const fromTags = (cell.elements ?? [])
    .filter((el) => solidTags.has(el.tag) && el.ink && el.path?.startsWith('layer/layer[2]'))
    .map((el) => {
      const rect = bounds(el.ink, cell.width, cell.height)
      // Row membership comes from the unprojected box. Two solids at different
      // depths overlap in projection by design, so ink alone cannot tell a row
      // from a stack.
      return rect && { ...rect, rowY: el.box?.y ?? rect.y0 }
    })
    .filter((rect) => rect && rect.y0 >= camera.y0 && rect.y1 <= camera.y1 && rect.x0 >= camera.x0 && rect.x1 <= camera.x1)
  const candidates = solids.length ? solids : fromTags
  if (candidates.length < 2) return null
  const solidList = candidates
  const bottom = Math.max(...solidList.map((rect) => rect.y1))
  const top = Math.min(...solidList.map((rect) => rect.y0))
  // Empty band below the lowest solid, as a share of the camera frame's height.
  const emptyBelow = (camera.y1 - bottom) / Math.max(1, camera.y1 - camera.y0)
  // Nearest horizontal gap between two ink boxes that share a row. Boxes at
  // different depths cross in projection even when the drawing is right, so a
  // blanket pairwise gap would punish correct occlusion; the brief's 16 px is a
  // clearance between side-by-side neighbours, which is what this measures.
  const rows = []
  for (const rect of solidList) {
    const row = rows.find((band) => Math.abs(band.y0 - rect.rowY) < 80)
    if (row) row.items.push(rect)
    else rows.push({ y0: rect.rowY, items: [rect] })
  }
  let minGap = Infinity
  let minGapPair = ''
  for (const row of rows) {
    const sorted = [...row.items].sort((a, b) => a.x0 - b.x0)
    for (let i = 1; i < sorted.length; i++) {
      // Piercing / stacked solids share a row and overlap in ink on purpose
      // (QUALITY-4 §1.3). Those pairs are not side-by-side clearance.
      const gap = sorted[i].x0 - sorted[i - 1].x1
      if (gap <= 0) continue
      if (gap < minGap) { minGap = gap; minGapPair = `${sorted[i - 1].rowY.toFixed(0)}:${Math.round(sorted[i - 1].x1)}~${sorted[i].rowY.toFixed(0)}:${Math.round(sorted[i].x0)}` }
    }
  }
  return {
    emptyBelow: round(Math.min(1, Math.max(0, emptyBelow)), 4),
    inkGap: Number.isFinite(minGap) ? Math.round(minGap) : null,
    inkGapPair: minGapPair,
    topGap: round((top - camera.y0) / Math.max(1, camera.y1 - camera.y0), 4),
    solids: solidList.length,
  }
}
const linesReport = linesFrame(rendered.get('3d-lines'))

const report = {
  platform: `${process.platform}-${process.arch}`,
  engine: engineString(),
  // Page size, so a cross-platform fraction tolerance can be counted in pixels.
  pixels: draft ? draft.width * draft.height : null,
  gates: loadGates(),
  cells,
  draftFinal,
  metals,
  contacts,
  floatGap: rendered.get('3d-quality-draft')?.floatGap ?? null,
  lines: linesReport,
  // Per-cell ground defects: a screen-aligned step in the floor shading, a
  // bright lump well above its surroundings, and how much of the shadow ramp
  // is drawn along the pixel grid. See docs/quality/3D-QUALITY-2.md Q0-1.
  groundDefects: [...rendered]
    .map(([cell, measured]) => ({
      cell,
      seams: measured.seamCount,
      seamHits: measured.seams.reduce((sum, seam) => sum + seam.hits, 0),
      listed: measured.seams,
      blobs: measured.blobs.length,
      blobPeak: measured.blobs.length ? Math.max(...measured.blobs.map((blob) => blob.peak)) : null,
      stair: measured.stair,
      stairGap: measured.stairGap,
      edgeFlip: measured.edgeFlip,
    }))
    .filter((item) => item.seams > 0 || item.blobs > 0 || item.stair != null || item.stairGap != null),
  emissive,
  still: stillReport,
  materials,
  materialTraits,
  glassSsim,
  materialPairDeltas,
  metalPlasticReflectDelta,
  toon: rendered.get('3d-shade-toon')?.toon ?? null,
  manga: mangaCell?.paper ? { ...mangaCell.paper, hatchFlip, hatchFlipEngine } : null,
  technical: technicalReport,
  technicalHidden: technicalHiddenReport,
}

printTable(report)
if (write) {
  writeFileSync(goldenPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`wrote ${goldenPath}`)
}
if (check) {
  const recorded = readBaselinePlatform()
  if (recorded && recorded !== report.platform) {
    console.log(`baseline recorded on ${recorded}; checking ${report.platform} with one-code-value slack`)
  }
  applyGates(report.gates, report, platformSlack(recorded, report.pixels))
}
