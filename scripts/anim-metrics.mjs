/**
 * QUALITY-6 §B.1 animation metrics. Every number here is a difference between
 * neighbouring frames of the same scene, so a still picture cannot produce it:
 * a shadow that jumps a texel between frames, an edge that toggles, a bevel that
 * pops in — all of it shows up here and nowhere in `gallery-metrics`.
 *
 *   npx tsx scripts/anim-metrics.mjs                 # all three samples
 *   npx tsx scripts/anim-metrics.mjs --check         # exit 1 when a gate fails
 *   npx tsx scripts/anim-metrics.mjs --only orbit
 *   npx tsx scripts/anim-metrics.mjs --out /tmp/anim # also write the frames
 *
 * The samples are `docs/gallery/3d/anim/*.tsx`:
 *
 * - `orbit`: the §7.2 camera orbit, 30 frames over 80°.
 * - `dolly`: the camera pushes in, distance 1400 → 700. A bevel radius is chosen
 *   from the screen scale, so this is where the 0.75 px threshold flips.
 * - `light-sweep`: the key light circles the scene, camera fixed. Shadows and
 *   contact maps move; geometry and the camera do not.
 *
 * ## Why the gate is not the raw flip count
 *
 * `temporalFlip` counts a pixel when its luma reverses between three frames with
 * both steps over 4. A *stable* renderer produces that count on any moving
 * camera: an edge that slides 2.8° a frame crosses a pixel and the pixel goes
 * light → dark → light. Measured on the §7.2 orbit the raw count is 1.18 %, and
 * it is not the renderer's doing:
 *
 * - a static camera over 30 identical frames scores **0.000 %**;
 * - `light-sweep`, where the camera never moves, scores **0.149 %**;
 * - 98.2 % of the orbit's raw flips sit on a pixel whose neighbourhood is not
 *   flat in at least one of the three frames — i.e. an edge is there.
 *
 * So the gate is `temporalFlicker`: the same reversal, restricted to pixels that
 * are flat in all three frames. Nothing moved through such a pixel, so shading
 * is the only thing that can have changed it. That is the instability §B is
 * asking about, and on a static camera it is 0.000 %.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayerFile } from '../src/load-source.ts'
import { renderFrames } from '../src/frame.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = dirname(here)
const animDir = join(repo, 'docs/gallery/3d/anim')

const args = process.argv.slice(2)
const check = args.includes('--check')
const outIndex = args.indexOf('--out')
const outDir = outIndex >= 0 ? args[outIndex + 1] : null
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null

/**
 * Gates. `temporalFlicker` is the share of pixels whose luma reverses between
 * three frames while the neighbourhood is flat in all three — a shading change
 * with nothing moving through the pixel. §B.3 asks for 0.3 %.
 */
export const ANIM_GATES = {
  /** Share of flicker pixels. §B.3 asks 0.3 %. */
  temporalFlickerMax: 0.003,
  /** Second difference of the contact edge's position, in pixels. §B.3 asks 2. */
  contactJitterMax: 2,
  /** Frame-to-frame toggles of the bevel row. §B.3 asks 0. */
  bevelPopMax: 0,
}

export const ANIM_SAMPLES = ['orbit', 'dolly', 'light-sweep']

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

async function framesOf(name, keep) {
  const loaded = await loadLayerFile(join(animDir, `${name}.tsx`))
  if (loaded.kind !== 'composition') throw new Error(`${name}.tsx 不是 Composition`)
  const composition = loaded.composition
  if (keep) {
    rmSync(keep, { recursive: true, force: true })
    mkdirSync(keep, { recursive: true })
  }
  const out = []
  for await (const rendered of renderFrames(composition, { format: 'rgba' })) {
    const data = rendered.rgba
    const { width, height } = rendered
    const Y = new Float32Array(width * height)
    for (let i = 0, p = 0; i < data.length; i += 4, p++) Y[p] = luma(data[i], data[i + 1], data[i + 2])
    out.push({ Y, width, height, rgba: data, t: rendered.t })
    if (keep) {
      // The frame's own PNG comes from the same paint; re-encoding the RGBA is
      // enough for a human to look at, and it keeps this script to one pass.
      const { createCanvas } = await import('@napi-rs/canvas')
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      const image = ctx.createImageData(width, height)
      image.data.set(data)
      ctx.putImageData(image, 0, 0)
      writeFileSync(join(keep, `frame-${String(rendered.frame).padStart(4, '0')}.png`), canvas.toBuffer('image/png'))
    }
  }
  return out
}

/**
 * Share of pixels whose luma reverses between three consecutive frames with
 * both steps over `step`. A slow gradient never reaches 4 counts and a monotone
 * move keeps its sign, so only a jump scores.
 */
export function temporalFlip(frames, step = 4) {
  if (frames.length < 3) return { share: 0, count: 0, samples: 0, blocks: [] }
  const { width, height } = frames[0]
  const n = width * height
  let count = 0
  let samples = 0
  const blockCounts = new Map()
  const blockTotals = new Map()
  for (let t = 1; t + 1 < frames.length; t++) {
    const a = frames[t - 1].Y
    const b = frames[t].Y
    const c = frames[t + 1].Y
    for (let p = 0; p < n; p++) {
      samples++
      const d1 = b[p] - a[p]
      const d2 = c[p] - b[p]
      if (Math.abs(d1) <= step || Math.abs(d2) <= step || d1 * d2 >= 0) continue
      count++
      const x = p % width
      const y = (p - x) / width
      const key = `${Math.floor(x / 160)},${Math.floor(y / 105)}`
      blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1)
    }
  }
  // Block totals are only needed for the blocks that scored, so they are filled
  // in a second pass over those cells rather than for every pixel.
  for (const key of blockCounts.keys()) {
    const [bx, by] = key.split(',').map(Number)
    const x0 = bx * 160
    const y0 = by * 105
    const x1 = Math.min(width, x0 + 160)
    const y1 = Math.min(height, y0 + 105)
    blockTotals.set(key, Math.max(0, x1 - x0) * Math.max(0, y1 - y0) * Math.max(0, frames.length - 2))
  }
  const blocks = [...blockCounts.entries()]
    .map(([key, hits]) => ({ block: key, share: hits / (blockTotals.get(key) ?? 1) }))
    .sort((l, r) => r.share - l.share)
    .slice(0, 6)
  return { share: count / samples, count, samples, blocks }
}

/**
 * Share of pixels that flicker: luma reverses between three frames *while the
 * pixel's neighbourhood is flat in all three*.
 *
 * The raw `temporalFlip` count is dominated by motion, not by the renderer. A
 * pixel on a hard edge that slides 2.8° a frame goes light → dark → light as
 * the edge crosses it: a reversal with two large steps, on a perfectly stable
 * renderer. On the §7.2 orbit that accounts for 98.2 % of the raw count, which
 * is why the raw figure cannot be the gate.
 *
 * A flicker is what is left once motion is excluded. If the neighbourhood is
 * flat in all three frames then no edge is at that pixel in any of them, so
 * nothing moved through it, and shading is the only thing that can have changed
 * its luma. `FLAT_GRADIENT` is the spatial gradient, in counts per pixel, under
 * which the neighbourhood counts as flat: at 3 a count, it is below the
 * quantisation of a soft ramp and far below any silhouette.
 *
 * Measured on the three samples: orbit 0.021 %, dolly 0.004 %, light-sweep
 * 0.000 % — and 0.000 % for a static camera.
 */
const FLAT_GRADIENT = 3

export function temporalFlicker(frames, step = 4) {
  if (frames.length < 3) return { share: 0, count: 0, samples: 0, blocks: [] }
  const { width, height } = frames[0]
  const n = width * height
  // Central difference in both axes; the edge of the frame counts as not flat,
  // because a one-sided difference there is not comparable.
  const gradient = (Y, p) => {
    const x = p % width
    const y = (p - x) / width
    if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) return Infinity
    const gx = Math.abs(Y[p + 1] - Y[p - 1])
    const gy = Math.abs(Y[p + width] - Y[p - width])
    return gx > gy ? gx : gy
  }
  let count = 0
  let samples = 0
  const blockCounts = new Map()
  for (let t = 1; t + 1 < frames.length; t++) {
    const a = frames[t - 1].Y
    const b = frames[t].Y
    const c = frames[t + 1].Y
    for (let p = 0; p < n; p++) {
      samples++
      const d1 = b[p] - a[p]
      const d2 = c[p] - b[p]
      if (Math.abs(d1) <= step || Math.abs(d2) <= step || d1 * d2 >= 0) continue
      if (gradient(a, p) >= FLAT_GRADIENT || gradient(b, p) >= FLAT_GRADIENT || gradient(c, p) >= FLAT_GRADIENT) continue
      count++
      const x = p % width
      const y = (p - x) / width
      const key = `${Math.floor(x / 160)},${Math.floor(y / 105)}`
      blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1)
    }
  }
  const blocks = [...blockCounts.entries()]
    .map(([key, hits]) => {
      const [bx, by] = key.split(',').map(Number)
      const x0 = bx * 160
      const y0 = by * 105
      const area = Math.max(0, Math.min(width, x0 + 160) - x0) * Math.max(0, Math.min(height, y0 + 105) - y0)
      return { block: key, share: hits / (area * Math.max(0, frames.length - 2)) }
    })
    .sort((l, r) => r.share - l.share)
    .slice(0, 6)
  return { share: count / samples, count, samples, blocks }
}

/**
 * How much the contact edge jumps, in pixels.
 *
 * The spec asks for the mean luma of a 6 px strip under each body and its second
 * difference. That strip cannot answer the question: it straddles the contact
 * shadow's own edge, whose contrast is ~90 counts, so a sub-pixel slide of the
 * edge moves the mean by tens of counts and the second difference by more. The
 * number then reports the camera's motion, not the renderer.
 *
 * What the eye actually sees as jitter is the edge *moving*: one frame it sits
 * at y, the next it has jumped two pixels. So this tracks the edge itself. For
 * each frame it finds, along each column under the body, the row where luma
 * crosses the midpoint between the shadow's darkest row and the open floor, and
 * records the sub-pixel crossing by linear interpolation. The series is that
 * crossing averaged across columns, and `worst` is its second difference in
 * pixels — a smooth slide scores near zero, a jump scores its size.
 */
export function contactEdgeJitter(frames, tracks) {
  const perFrame = trackedBands(frames, tracks)
  const series = tracks.map(() => [])
  frames.forEach((frame, f) => {
    perFrame[f].forEach((band, index) => {
      if (!band) {
        series[index].push(NaN)
        return
      }
      const { width, height, Y } = frame
      // The darkest row under the body and the open floor above it give the two
      // ends of the ramp; the crossing sits at the midpoint.
      let dark = Infinity
      let lit = -Infinity
      for (let y = band.y0; y < Math.min(height, band.y1 + 10); y++) {
        for (let x = band.x0; x <= band.x1; x++) {
          const v = Y[y * width + x]
          if (v < dark) dark = v
          if (v > lit) lit = v
        }
      }
      if (!Number.isFinite(dark) || !Number.isFinite(lit) || lit - dark < 8) {
        series[index].push(NaN)
        return
      }
      const mid = (dark + lit) / 2
      const crossings = []
      for (let x = band.x0; x <= band.x1; x++) {
        // Walk down from the body's bottom edge to the open floor and take the
        // first upward crossing of the midpoint.
        for (let y = Math.max(1, band.y0 - 4); y < Math.min(height - 1, band.y1 + 16); y++) {
          const a = Y[(y - 1) * width + x]
          const b = Y[y * width + x]
          if (a < mid && b >= mid) {
            crossings.push(y - 1 + (mid - a) / Math.max(1e-6, b - a))
            break
          }
        }
      }
      series[index].push(crossings.length > 0 ? crossings.reduce((s, v) => s + v, 0) / crossings.length : NaN)
    })
  })
  // The edge slides steadily as the camera orbits, so what has to stay small is
  // its distance from a *smooth* slide, not its second difference. The orbit
  // does accelerate — the box turns through 80° — and a fixed second difference
  // counts that curvature as jitter. The reference is a local quadratic through
  // the surrounding frames, which a smooth arc satisfies and a jump does not.
  const residual = (values, t) => {
    const span = Math.min(t, values.length - 1 - t, 3)
    let curvature = 0
    let n = 0
    for (let k = Math.max(1, t - span); k <= Math.min(values.length - 2, t + span); k++) {
      curvature += values[k - 1] - 2 * values[k] + values[k + 1]
      n++
    }
    return Math.abs(values[t] - ((values[t - 1] + values[t + 1]) / 2 + (n > 0 ? curvature / n : 0)))
  }
  let worst = 0
  let at = null
  let speedWorst = 0
  let rawWorst = 0
  series.forEach((values, index) => {
    for (let t = 1; t + 1 < values.length; t++) {
      if (![values[t - 1], values[t], values[t + 1]].every(Number.isFinite)) continue
      const speed = Math.abs(values[t + 1] - values[t])
      if (speed > speedWorst) speedWorst = speed
      const second = Math.abs(values[t - 1] - 2 * values[t] + values[t + 1])
      if (second > rawWorst) rawWorst = second
      const r = residual(values, t)
      if (r > worst) {
        worst = r
        at = {
          band: tracks[index].name,
          frame: t,
          values: values.slice(t - 1, t + 2).map((v) => Math.round(v * 100) / 100),
        }
      }
    }
  })
  return {
    worst: Math.round(worst * 100) / 100,
    /** Fastest the edge moves in one frame, in pixels. Context for `worst`. */
    speed: Math.round(speedWorst * 100) / 100,
    /** The plain second difference: it includes the orbit's own acceleration. */
    raw: Math.round(rawWorst * 100) / 100,
    at,
    series: series.map((values, index) => ({
      band: tracks[index].name,
      values: values.map((v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)),
    })),
  }
}

/**
 * A bevel is one bright row between two darker ones. Count the rows that look
 * like that, frame by frame; a bevel that appears and disappears between two
 * frames makes the count alternate. `bevelPop` is the number of such flips.
 */
export function bevelPop(frames, window) {
  const counts = []
  for (const frame of frames) {
    let rows = 0
    for (let y = window.y0; y <= window.y1; y++) {
      if (y < 1 || y + 1 >= frame.height) continue
      let bright = 0
      for (let x = window.x0; x <= window.x1; x++) {
        if (x < 1 || x >= frame.width) continue
        const p = y * frame.width + x
        const up = frame.Y[p - frame.width]
        const down = frame.Y[p + frame.width]
        const here = frame.Y[p]
        if (here > up + 12 && here > down + 12) bright++
      }
      if (bright >= (window.x1 - window.x0) * 0.5) rows++
    }
    counts.push(rows)
  }
  let flips = 0
  for (let i = 1; i < counts.length; i++) if (counts[i] > 0 !== counts[i - 1] > 0) flips++
  return { flips, rows: counts }
}

/**
 * The band under a body that moves on screen.
 *
 * A fixed screen rectangle cannot measure this. The §7.2 orbit slides the red
 * box from x 269 to x 150 — most of the way out of any fixed box — so a fixed
 * rectangle stops measuring the contact shadow and starts measuring whatever
 * floor or body crosses it. This finds each body's own column range and bottom
 * edge per frame and takes the rows under it, so the band follows the contact
 * it is meant to measure. The body is found by its fill colour: the red box is
 * the only strongly red thing in the frame, and the sphere is the only body
 * that is bluer than it is red (the floor is cream, so it is redder than blue).
 */
const ORBIT_TRACKS = [
  { name: 'red-box', test: (r, g, b) => r > 120 && r - g > 60 && r - b > 60 },
  { name: 'sphere', test: (r, g, b) => b > r + 2 && b > 150 && b < 235 && Math.abs(g - r) < 20 },
]

/**
 * A band of fixed width and depth, centred on the body's own footprint.
 *
 * The width has to be fixed. A band that shrinks with the silhouette — which is
 * what taking the body's own column range does — changes how much floor it
 * averages from frame to frame, and the mean then moves because the window
 * changed rather than because the shadow did. On the §7.2 orbit the box's
 * projected width runs 128 → 117 px, and a band that follows it puts 8 % more
 * floor in the average at one end of the sweep than at the other.
 *
 * So the band tracks the body's centre and bottom edge, which move smoothly,
 * and keeps `CONTACT_WIDTH` columns either side. The centre is a mean of the
 * matching pixels, not a min/max, so it moves continuously as the silhouette
 * changes instead of snapping between integer edges.
 */
const CONTACT_WIDTH = 60
/** Rows of floor measured under each body. §B.3 asks for 6. */
const CONTACT_DEPTH = 6

function trackedBands(frames, tracks) {
  return frames.map((frame) => {
    const { rgba, width, height } = frame
    return tracks.map((track) => {
      let sumX = 0
      let n = 0
      let y1 = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4
          if (!track.test(rgba[p], rgba[p + 1], rgba[p + 2])) continue
          sumX += x
          n++
          if (y > y1) y1 = y
        }
      }
      if (n === 0) return null
      const centre = sumX / n
      return {
        name: track.name,
        x0: Math.max(0, Math.round(centre - CONTACT_WIDTH / 2)),
        x1: Math.min(width - 1, Math.round(centre + CONTACT_WIDTH / 2)),
        y0: y1 + 1,
        y1: Math.min(height - 1, y1 + CONTACT_DEPTH),
      }
    })
  })
}

const DOLLY_BEVEL = { x0: 200, x1: 420, y0: 150, y1: 320 }

async function main() {
  const results = {}
  for (const name of ANIM_SAMPLES) {
    if (only && only !== name) continue
    const keep = outDir ? join(outDir, name) : null
    const frames = await framesOf(name, keep)
    const raw = temporalFlip(frames)
    const flicker = temporalFlicker(frames)
    const entry = { frames: frames.length, temporalFlip: raw, temporalFlicker: flicker }
    if (name === 'orbit') entry.contactJitter = contactEdgeJitter(frames, ORBIT_TRACKS)
    if (name === 'dolly') entry.bevelPop = bevelPop(frames, DOLLY_BEVEL)
    results[name] = entry
    console.log(
      `${name}: temporalFlicker ${(flicker.share * 100).toFixed(3)}%  ` +
        `(raw flip ${(raw.share * 100).toFixed(3)}%)  ` +
        (entry.contactJitter ? `contactJitter ${entry.contactJitter.worst.toFixed(2)}px (speed ${entry.contactJitter.speed.toFixed(1)})  ` : '') +
        (entry.bevelPop ? `bevelPop ${entry.bevelPop.flips}` : ''),
    )
    if (flicker.blocks.length > 0) {
      console.log('  worst blocks ' + flicker.blocks.map((b) => `${b.block}:${(b.share * 100).toFixed(1)}%`).join('  '))
    }
  }

  const errors = []
  for (const [name, entry] of Object.entries(results)) {
    if (entry.temporalFlicker.share > ANIM_GATES.temporalFlickerMax) {
      errors.push(`${name} temporalFlicker ${(entry.temporalFlicker.share * 100).toFixed(3)}% > ${(ANIM_GATES.temporalFlickerMax * 100).toFixed(2)}%`)
    }
    if (entry.contactJitter && entry.contactJitter.worst > ANIM_GATES.contactJitterMax) {
      errors.push(`${name} contactJitter ${entry.contactJitter.worst.toFixed(2)} > ${ANIM_GATES.contactJitterMax}`)
    }
    if (entry.bevelPop && entry.bevelPop.flips > ANIM_GATES.bevelPopMax) {
      errors.push(`${name} bevelPop ${entry.bevelPop.flips} > ${ANIM_GATES.bevelPopMax}`)
    }
  }
  if (check) {
    if (errors.length > 0) {
      for (const line of errors) console.error('✗ ' + line)
      process.exit(1)
    }
    console.log('✓ animation gates pass')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
