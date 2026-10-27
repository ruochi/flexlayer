/**
 * The kernel's seat buffers, and the alignment between them and the page.
 *
 * `FLEXLAYER_SEAT_DEBUG=1` makes the kernel write four files beside the
 * rendered page: the buffer size and origin, a ground mask, a colour buffer,
 * and a depth buffer. They are in the kernel's own pixel grid, which is the
 * camera layer's size, not the page's: a bench page can carry a caption strip
 * under the camera. Everything here maps page coordinates into that grid so a
 * measurement can ask "is this page pixel on the ground plane".
 *
 * Kept free of rendering so a test can drive the alignment with hand-made
 * buffers: see `src/metrics-seat.spec.ts`.
 */
import { readFileSync } from 'node:fs'

export function loadSeat(dir = '/tmp') {
  try {
    const parts = readFileSync(`${dir}/seat-size.txt`, 'utf8').trim().split(/\s+/).map(Number)
    const [pw, ph, originX, originY, pixelScale] = parts
    const ground = readFileSync(`${dir}/seat-ground.bin`)
    const color = readFileSync(`${dir}/seat-color.bin`)
    const depth = readFileSync(`${dir}/seat-depth.bin`)
    if (!pw || !ph || ground.length !== pw * ph || color.length !== pw * ph * 4 || depth.length !== pw * ph * 4) return null
    // The owner buffer arrived later than the other three, so a missing file is
    // a warning for the measurement, not a failed render.
    let owner = null
    try {
      const bytes = readFileSync(`${dir}/seat-own.bin`)
      if (bytes.length === pw * ph * 2) owner = new Int16Array(bytes.buffer, bytes.byteOffset, pw * ph)
    } catch {
      owner = null
    }
    return { pw, ph, ground, color, depth, owner, originX, originY, pixelScale }
  } catch {
    return null
  }
}

export function kernelXY(align, x, y) {
  const s = align.scale || 1
  return [Math.round(x * s + align.ox), Math.round(y * s + align.oy)]
}

/**
 * Fit the kernel grid onto the page.
 *
 * `camera` is the camera layer's box on the page. Only that box has to be
 * covered by the seat buffer; a caption strip below it does not, which is why
 * the coverage test is against the camera rather than the page. The origin the
 * kernel records is where its grid starts, so it is the first guess; a ±3px
 * search only moves the fit when a nearby offset scores clearly better, since
 * a flat floor scores almost the same at several offsets.
 */
export function alignSeat(rgba, width, height, seat, camera = { x0: 0, y0: 0, x1: width, y1: height }) {
  const points = []
  for (let y = Math.max(40, camera.y0); y < Math.min(height - 40, camera.y1); y += 70) {
    for (let x = Math.max(40, camera.x0); x < Math.min(width - 40, camera.x1); x += 80) points.push([x, y])
  }
  if (!points.length) points.push([Math.floor(width / 2), Math.floor(height / 2)])
  const scale = seat.pixelScale > 0 ? seat.pixelScale : 1
  // `+ 0` turns a -0 into 0, so the fit records the same offset it searched.
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
  const base = score(baseOx, baseOy)
  let best = { ox: baseOx, oy: baseOy, scale, err: base?.mean ?? Infinity, trimmed: base?.trimmed ?? Infinity, inliers: base?.inliers ?? 0 }
  for (let oy = baseOy - 3; oy <= baseOy + 3; oy++) {
    for (let ox = baseOx - 3; ox <= baseOx + 3; ox++) {
      const found = score(ox, oy)
      if (!found || found.mean + 3 >= best.err) continue
      best = { ox, oy, scale, err: found.mean, trimmed: found.trimmed, inliers: found.inliers }
    }
  }
  // The buffer has to cover the camera box; a page taller than the camera is
  // fine, and so is a buffer a few pixels smaller from rounding.
  const needW = (camera.x1 - camera.x0) * scale
  const needH = (camera.y1 - camera.y0) * scale
  if (seat.pw + 4 < needW || seat.ph + 4 < needH) return null
  if (best.inliers < Math.min(8, points.length) || best.trimmed >= 12) return null
  return best
}

/** Page pixels whose kernel sample is on the ground plane. */
export function groundAt(seat, align, x, y) {
  if (!seat || !align) return false
  const [kx, ky] = kernelXY(align, x, y)
  if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) return false
  return seat.ground[ky * seat.pw + kx] !== 0
}

/** The kernel's owner id at a page pixel, or 0 when nothing covers it. */
export function ownerAt(seat, align, x, y) {
  if (!seat || !align || !seat.owner) return 0
  const [kx, ky] = kernelXY(align, x, y)
  if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) return 0
  return seat.owner[ky * seat.pw + kx]
}

/**
 * One element's pixels, found by the owner id at a point the element is known
 * to cover. Used instead of an ink box so a measurement never averages the
 * wall or the floor into an object's numbers.
 */
export function ownerMask(seat, align, x, y) {
  const id = ownerAt(seat, align, x, y)
  if (!id) return () => false
  return (px, py) => ownerAt(seat, align, px, py) === id
}

export function depthAt(seat, align, x, y) {
  if (!seat || !align) return -Infinity
  const [kx, ky] = kernelXY(align, x, y)
  if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) return -Infinity
  return seat.depth.readFloatLE((ky * seat.pw + kx) * 4)
}

/**
 * Whether the page pixel is still the kernel's own pixel.
 *
 * A page can draw captions over the rendered frame, and the kernel buffer knows
 * nothing about them: a label row reads as a hundred flat steps on the floor.
 * Comparing against `seat-color.bin`, which holds the frame before the page
 * composited anything, keeps text and other page overlays out of the ground
 * measurements. The alpha byte is skipped so a transparent kernel pixel is not
 * compared by a channel the page has already blended.
 */
export function sameAsSeat(seat, align, rgba, width, x, y, tolerance = 24) {
  if (!seat || !align) return false
  const [kx, ky] = kernelXY(align, x, y)
  if (kx < 0 || ky < 0 || kx >= seat.pw || ky >= seat.ph) return false
  const i = (y * width + x) * 4
  const k = (ky * seat.pw + kx) * 4
  const dr = Math.abs(rgba[i] - seat.color[k])
  const dg = Math.abs(rgba[i + 1] - seat.color[k + 1])
  const db = Math.abs(rgba[i + 2] - seat.color[k + 2])
  return Math.max(dr, dg, db) <= tolerance
}

/**
 * Ground pixels under an element's silhouette: a ground pixel with a solid
 * directly above it in the kernel grid. The returned points are in kernel
 * space, which is what a colour walk wants.
 */
export function groundLips(seat, align, rect) {
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
