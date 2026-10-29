/**
 * Image measurements that answer "does the picture have a visible seam" rather
 * than "did a number move". Kept free of rendering: every function takes pixels
 * plus a coverage predicate, so `src/metrics-image.spec.ts` can drive the exact
 * cases that used to slip past the gates.
 *
 * The three detectors exist because the first round of gates all passed while
 * the sheets plainly looked wrong:
 *
 * - `straightSeams` finds screen-aligned cliffs in the ground shading. The
 *   tone-mapped light pool ended in a rectangle, so its four edges read as
 *   hundreds of identical one-pixel steps along a fixed x or y.
 * - `stairStepShare` measures how much of a shadow ramp is drawn along the
 *   pixel grid, which is what a nearest-neighbour shadow lookup produces.
 * - `brightBlobs` finds bright lumps that sit well above their surroundings,
 *   which is how the refraction bug showed up beside the glass sphere.
 */
export function luma(rgba, i) {
  return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]
}

/**
 * Screen-aligned seams in a shaded surface.
 *
 * A seam is a narrow ramp — at most `maxRun` pixels, at least `minTotal` code
 * values in total — with flat shoulders on both sides. One seam is not enough
 * to say anything: a soft shadow edge can produce one as well. A *straight*
 * seam can: when hundreds of rows at one x each carry the same step, the cause
 * is a screen-aligned rectangle rather than a shadow, whose contour is a curve.
 * So hits are grouped by line and only lines with at least `minRun` hits count.
 */
export function straightSeams(rgba, width, height, accept = () => true, options = {}) {
  const { minRun = 24, flatTol = 1, stepMin = 1.5, maxRun = 3, minTotal = 4, shoulder = 3 } = options
  const at = (x, y) => luma(rgba, (y * width + x) * 4)
  const hitsH = new Map()
  const hitsV = new Map()
  // A vertical seam: the step is across x, so the line is `x` and it is counted
  // once per row it appears in. Both shoulders have to be the same kind of
  // surface as the seam pixel: the horizon where the floor meets the wall is a
  // straight step too, and it is not a seam in a shading ramp.
  for (let y = 4; y < height - 4; y++) {
    for (let x = 4; x < width - 4; x++) {
      if (!sameSurface(x, y, 'v')) continue
      if (!seamAcross((d) => at(x + d, y))) continue
      hitsV.set(x, (hitsV.get(x) ?? 0) + 1)
    }
  }
  for (let x = 4; x < width - 4; x++) {
    for (let y = 4; y < height - 4; y++) {
      if (!sameSurface(x, y, 'h')) continue
      if (!seamAcross((d) => at(x, y + d))) continue
      hitsH.set(y, (hitsH.get(y) ?? 0) + 1)
    }
  }
  function sameSurface(x, y, axis) {
    const step = (d) => (axis === 'v' ? accept(x + d, y) : accept(x, y + d))
    for (let d = -shoulder; d <= shoulder + maxRun; d++) {
      if (!step(d)) return false
    }
    return true
  }
  function seamAcross(get) {
    const diff = (d) => get(d + 1) - get(d)
    let run = 0
    let total = 0
    for (let d = 0; d < maxRun; d++) {
      const value = Math.abs(diff(d))
      if (value < stepMin) break
      run += 1
      total += value
    }
    if (run === 0 || total < minTotal) return false
    if (Math.abs(diff(-1)) > flatTol || Math.abs(diff(-2)) > flatTol) return false
    if (Math.abs(diff(run)) > flatTol || Math.abs(diff(run + 1)) > flatTol) return false
    return true
  }
  const found = []
  for (const [position, hits] of hitsV) if (hits >= minRun) found.push({ axis: 'v', position, hits })
  for (const [position, hits] of hitsH) if (hits >= minRun) found.push({ axis: 'h', position, hits })
  return found.sort((a, b) => b.hits - a.hits)
}

/**
 * How much of the shadow ramp is drawn along the pixel grid.
 *
 * Each `level` traces one contour of the ramp. For a contour pixel the local
 * gradient says which way the ramp runs: a soft penumbra follows the caster's
 * shape, so the gradient points anywhere, while a nearest-neighbour shadow
 * lookup lays the same ramp down in axis-aligned steps and the gradient snaps
 * to 0 or 90 degrees. The result is the share of contour pixels whose gradient
 * is within `tolerance` degrees of an axis, over contour pixels that carry a
 * real gradient.
 */
export function stairStepShare(rgba, width, height, levels, accept = () => true, tolerance = 20) {
  const at = (x, y) => luma(rgba, (y * width + x) * 4)
  const limit = Math.tan((tolerance * Math.PI) / 180)
  let total = 0
  let aligned = 0
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (!accept(x, y)) continue
      const here = at(x, y)
      if (!levels.some((level) => Math.abs(here - level) <= 1.5)) continue
      const gx = at(x + 1, y) - at(x - 1, y)
      const gy = at(x, y + 1) - at(x, y - 1)
      const ax = Math.abs(gx)
      const ay = Math.abs(gy)
      if (Math.max(ax, ay) < 1) continue
      total += 1
      if (Math.min(ax, ay) <= limit * Math.max(ax, ay)) aligned += 1
    }
  }
  return total < 20 ? null : aligned / total
}

/**
 * How much of a shading ramp is drawn as visible steps rather than a smooth
 * gradient.
 *
 * A ramp that a nearest-neighbour lookup lays down in cells jumps by several
 * code values between two pixels and then sits flat, repeatedly: the edge is a
 * staircase. A bilinear read spreads the same range over neighbouring pixels,
 * so each step is under a code value or two. Only pixels already on the ramp
 * count, which keeps flat floor and flat shadow out of the number; the result
 * is the share of ramp pixels whose neighbour moves by more than `jump`.
 */
export function steppedShare(rgba, width, height, accept = () => true, jump = 2.5) {
  const at = (x, y) => luma(rgba, (y * width + x) * 4)
  let total = 0
  let stepped = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!accept(x, y)) continue
      const here = at(x, y)
      const dx = at(x + 1, y) - here
      const dy = at(x, y + 1) - here
      // Two flat neighbours mean this pixel sits inside a band, not on its edge.
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      total += 1
      // The step along the ramp's own direction. A row that is flat here but
      // one code quieter than the row below is the slope, not a step, so only
      // the steeper neighbour counts and it must beat `jump` on its own.
      const step = Math.abs(dx) >= Math.abs(dy) ? Math.abs(dx) : Math.abs(dy)
      if (step > jump) stepped += 1
    }
  }
  return total < 20 ? null : stepped / total
}

/**
 * How an edge is laid down row by row.
 *
 * `edgeAt(y)` returns the sub-pixel `x` where a straight edge crosses row `y`,
 * or `null` when that row has no transition at all. Two things spoil an edge: a
 * nearest-neighbour lookup moves it in cells, so `x` holds for several rows and
 * then jumps (`hold`), and a lookup that fails on a row leaves a hard cut with
 * nothing to interpolate (`gap`). A bilinear read fails neither: every row has a
 * crossing and each one moves by the same fraction.
 *
 * `hold` is the share of adjacent defined rows where the edge did not move.
 * `gap` is the share of rows that had no crossing at all. A region where the
 * edge is defined on fewer than half its rows has no penumbra to grade.
 */
export function edgeStairShare(edgeAt, y0, y1) {
  const xs = []
  for (let y = y0; y <= y1; y++) {
    const x = edgeAt(y)
    xs.push(x != null && Number.isFinite(x) ? x : null)
  }
  const rows = xs.length
  if (rows < 8) return null
  const defined = xs.filter((x) => x != null)
  const gap = 1 - defined.length / rows
  if (defined.length < rows / 2) {
    // No penumbra on this edge: it is a hard step, which is the worst case, and
    // reporting null would let the worst case pass. `hold` 0 says the edge did
    // not move smoothly; `gap` is what actually went wrong.
    return { hold: 0, gap, defined: defined.length }
  }
  let held = 0
  let pairs = 0
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1]
    const b = xs[i]
    if (a == null || b == null) continue
    pairs += 1
    if (Math.abs(b - a) < 0.4) held += 1
  }
  return { hold: pairs === 0 ? 0 : held / pairs, gap, defined: defined.length }
}

/** 4-connected components of a byte mask, each with its pixel count and bbox. */
export function components(mask, width, height) {
  const seen = new Uint8Array(width * height)
  const out = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    const stack = [start]
    seen[start] = 1
    let count = 0
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    while (stack.length) {
      const index = stack.pop()
      const x = index % width
      const y = (index - x) / width
      count += 1
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (!mask[next] || seen[next]) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    out.push({ count, x0, y0, x1, y1 })
  }
  return out
}

/**
 * Bright blobs in a region: pixels that sit `riseMin` levels above a local
 * background, grouped into blobs of at least `minArea` pixels.
 *
 * The background is the *median* of a box wide enough to swallow the body the
 * blob sits on. A mean would read every gap between two hatch strokes as a
 * bright lump, because the strokes drag the average down; the median of a paper
 * field stays at the paper's own value. A white bump on a dark blue box has
 * nothing bright around it and does count.
 */
export function brightBlobs(rgba, width, height, area, options = {}) {
  const { riseMin = 40, minArea = 30, blur = 15, floorMin = 140, require: requirePixel = null } = options
  const x0 = Math.max(0, Math.floor(area.x0))
  const y0 = Math.max(0, Math.floor(area.y0))
  const x1 = Math.min(width, Math.ceil(area.x1))
  const y1 = Math.min(height, Math.ceil(area.y1))
  const at = (x, y) => luma(rgba, (y * width + x) * 4)
  const half = Math.max(1, Math.round(blur / 2))
  const mask = new Uint8Array(width * height)
  const window = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (requirePixel && !requirePixel(x, y)) continue
      const here = at(x, y)
      // Below this a pixel cannot be a white lump, and the median is the
      // expensive part of the walk.
      if (here < floorMin) continue
      let n = 0
      let clean = true
      let dark = 0
      window.length = 0
      for (let dy = -half; dy <= half && clean; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -half; dx <= half; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          // A blob only counts when its whole neighbourhood is the same kind of
          // surface. Otherwise the bright side of every silhouette against the
          // dark wall would read as an artifact.
          if (requirePixel && !requirePixel(xx, yy)) {
            clean = false
            break
          }
          const value = at(xx, yy)
          if (value < 60) dark += 1
          window.push(value)
          n += 1
        }
      }
      if (!clean || !n) continue
      // A line drawing puts ink through the window; that is a different
      // structure, and the hatch comparison already covers it.
      if (dark * 8 > n) continue
      window.sort((a, b) => a - b)
      const median = window[n >> 1]
      if (here - median < riseMin) continue
      mask[y * width + x] = 1
    }
  }
  const blobs = []
  for (const blob of components(mask, width, height)) {
    if (blob.count < minArea) continue
    let peak = 0
    for (let y = blob.y0; y <= blob.y1; y++) {
      for (let x = blob.x0; x <= blob.x1; x++) {
        if (mask[y * width + x]) peak = Math.max(peak, at(x, y))
      }
    }
    blobs.push({ count: blob.count, x0: blob.x0, y0: blob.y0, x1: blob.x1, y1: blob.y1, peak: Number(peak.toFixed(1)) })
  }
  return blobs
}

/** Value at a percentile of an ascending array, 0–1. */
export function percentile(sorted, p) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[index]
}

/**
 * Continuity of a 1px bevel / highlight row along an edge.
 *
 * `samples` is the luma sequence taken every pixel along the edge. A broken
 * sub-pixel bevel reads as a large standard deviation and a periodic FFT peak
 * (the macbook base front edge used to beat at 10 px). Returns `{ mean, sd, cv,
 * peakShare }` where `peakShare` is the strongest 2–20 px period as a share of
 * the mean. Null when the row is too short.
 */
export function edgeLineCv(samples) {
  if (!samples || samples.length < 16) return null
  const n = samples.length
  let sum = 0
  for (const v of samples) sum += v
  const mean = sum / n
  if (!(mean > 1e-6)) return null
  let varSum = 0
  for (const v of samples) varSum += (v - mean) ** 2
  const sd = Math.sqrt(varSum / n)
  let peak = 0
  for (let period = 2; period <= 20; period++) {
    let re = 0
    let im = 0
    const omega = (2 * Math.PI) / period
    for (let i = 0; i < n; i++) {
      const d = samples[i] - mean
      re += d * Math.cos(omega * i)
      im += d * Math.sin(omega * i)
    }
    peak = Math.max(peak, Math.hypot(re, im) / n)
  }
  return {
    mean,
    sd,
    cv: sd / mean,
    peakShare: peak / mean,
  }
}

/**
 * Share of energy above `cutoff` cycles per pixel inside a region.
 *
 * Built for speaker mesh, brushed grain, and clay speckles: when the texture
 * period sits under two pixels the DFT dump above 0.35 cycle/px lights up.
 * `accept(x, y)` selects the region. Returns null when fewer than 64 samples.
 */
export function moireEnergy(rgba, width, height, accept = () => true, cutoff = 0.35) {
  const rows = []
  for (let y = 1; y < height - 1; y++) {
    const row = []
    for (let x = 1; x < width - 1; x++) {
      if (!accept(x, y)) continue
      row.push({ x, y: luma(rgba, (y * width + x) * 4) })
    }
    if (row.length >= 32) rows.push(row)
  }
  if (rows.length < 8) return null
  let total = 0
  let high = 0
  for (const row of rows) {
    const n = row.length
    let mean = 0
    for (const p of row) mean += p.y
    mean /= n
    // One-dimensional DFT along the row; periods shorter than 1/cutoff px.
    for (let k = 1; k < n / 2; k++) {
      const freq = k / n
      let re = 0
      let im = 0
      for (let i = 0; i < n; i++) {
        const d = row[i].y - mean
        const ang = (2 * Math.PI * k * i) / n
        re += d * Math.cos(ang)
        im += d * Math.sin(ang)
      }
      const power = (re * re + im * im) / (n * n)
      total += power
      if (freq >= cutoff) high += power
    }
  }
  if (total < 1e-9) return 0
  return high / total
}

/**
 * Largest adjacent-pixel luma jump along a circumferential scan of a cylinder
 * or sphere side. Faceted extrude walls light up as jumps of several code
 * values; a smooth cylinder stays under 3. `accept` selects the body; the scan
 * walks each row's accepted run and keeps the worst neighbour step.
 */
export function facetStripe(rgba, width, height, accept = () => true, quantile = 1) {
  const jumps = []
  for (let y = 1; y < height - 1; y++) {
    let prev = null
    for (let x = 1; x < width - 1; x++) {
      if (!accept(x, y)) {
        prev = null
        continue
      }
      const here = luma(rgba, (y * width + x) * 4)
      if (prev != null) jumps.push(Math.abs(here - prev))
      prev = here
    }
  }
  if (jumps.length < 32) return null
  if (!(quantile < 1)) return Math.max(...jumps)
  const sorted = [...jumps].sort((a, b) => a - b)
  return percentile(sorted, quantile)
}

/**
 * Material-feature probes on a sphere (or any accept mask). Used to tell
 * finishes apart when whole-cell FLIP only sees colour.
 *
 * - `highlightArea`: share of pixels at or above the 98th percentile
 * - `highlightSharpness`: mean gradient on the highlight rim
 * - `darkFloor`: 5th percentile luma
 * - `anisotropy`: highlight bbox aspect (width / height), 1 when round
 * - `reflectContent`: Laplacian variance / 1000 on the body, clamped to 1
 *   (QUALITY-4 §4.4). Metal/SSR carries env structure; smooth plastic does not.
 *   Absolute NCC against neighbours is near zero (phase mismatch), so variance
 *   of the high-pass field is the practical "reflection content" score; the
 *   metal–plastic gate uses |Δ| ≥ 0.2 on this score.
 */
export function materialFeatures(rgba, width, height, accept = () => true) {
  const values = []
  const coords = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!accept(x, y)) continue
      const yL = luma(rgba, (y * width + x) * 4)
      values.push(yL)
      coords.push(x, y)
    }
  }
  if (values.length < 40) return null
  const sorted = [...values].sort((a, b) => a - b)
  const p98 = percentile(sorted, 0.98)
  const darkFloor = percentile(sorted, 0.05)
  let highlight = 0
  let hx0 = width
  let hy0 = height
  let hx1 = -1
  let hy1 = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i] < p98) continue
    highlight += 1
    const x = coords[i * 2]
    const y = coords[i * 2 + 1]
    if (x < hx0) hx0 = x
    if (y < hy0) hy0 = y
    if (x > hx1) hx1 = x
    if (y > hy1) hy1 = y
  }
  const highlightArea = highlight / values.length
  let sharpSum = 0
  let sharpN = 0
  let lapSum = 0
  let lapSq = 0
  let lapN = 0
  for (let i = 0; i < values.length; i++) {
    const x = coords[i * 2]
    const y = coords[i * 2 + 1]
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue
    if (!accept(x - 1, y) || !accept(x + 1, y) || !accept(x, y - 1) || !accept(x, y + 1)) continue
    const c = luma(rgba, (y * width + x) * 4)
    const lap =
      4 * c
      - luma(rgba, (y * width + x - 1) * 4)
      - luma(rgba, (y * width + x + 1) * 4)
      - luma(rgba, ((y - 1) * width + x) * 4)
      - luma(rgba, ((y + 1) * width + x) * 4)
    lapSum += lap
    lapSq += lap * lap
    lapN += 1
    if (values[i] < p98) continue
    const gx = luma(rgba, (y * width + x + 1) * 4) - luma(rgba, (y * width + x - 1) * 4)
    const gy = luma(rgba, ((y + 1) * width + x) * 4) - luma(rgba, ((y - 1) * width + x) * 4)
    sharpSum += Math.hypot(gx, gy)
    sharpN += 1
  }
  const bw = Math.max(1, hx1 - hx0 + 1)
  const bh = Math.max(1, hy1 - hy0 + 1)
  // Use E[lap²] (not centered variance): SSR metals carry larger absolute
  // high-pass energy than smooth plastic even when the mean Laplacian is near 0.
  const lapEnergy = lapN ? lapSq / lapN : 0
  return {
    highlightArea,
    highlightSharpness: sharpN ? sharpSum / sharpN : 0,
    darkFloor,
    anisotropy: Math.max(bw, bh) / Math.min(bw, bh),
    // Soft-normalize so metal (~700) and plastic (~160) stay separated past 0.2.
    reflectContent: lapN ? lapEnergy / (lapEnergy + 200) : null,
  }
}

/**
 * Fraction of metal-ink pixels whose luma-delta signs alternate with their
 * four neighbours (QUALITY-5 §1.2 SSR checkerboard). A binary SSR hit/miss
 * leaves a high rate; a smooth reflection stays ≤ ~1%.
 */
export function ssrChecker(rgba, width, height, accept = () => true) {
  let n = 0
  let bad = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!accept(x, y)) continue
      const c = luma(rgba, (y * width + x) * 4)
      const l = luma(rgba, (y * width + (x - 1)) * 4)
      const r = luma(rgba, (y * width + (x + 1)) * 4)
      const u = luma(rgba, ((y - 1) * width + x) * 4)
      const d = luma(rgba, ((y + 1) * width + x) * 4)
      const dx = Math.sign(c - l) !== 0 && Math.sign(c - l) === -Math.sign(c - r) && Math.abs(c - l) > 1.5 && Math.abs(c - r) > 1.5
      const dy = Math.sign(c - u) !== 0 && Math.sign(c - u) === -Math.sign(c - d) && Math.abs(c - u) > 1.5 && Math.abs(c - d) > 1.5
      n += 1
      if (dx || dy) bad += 1
    }
  }
  if (n < 32) return null
  return bad / n
}

/**
 * Structural similarity between two luma patches of equal size. Used for glass
 * transmittance: clear glass keeps the stripes behind it (SSIM high), frosted
 * glass washes them out (SSIM low).
 */
export function ssimLuma(a, b) {
  if (!a || !b || a.length !== b.length || a.length < 16) return null
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let va = 0
  let vb = 0
  let cov = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    va += da * da
    vb += db * db
    cov += da * db
  }
  va /= n
  vb /= n
  cov /= n
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  return ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
}
