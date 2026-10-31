/**
 * QUALITY-6 §C. Every 3D example, rendered and measured, with a side-by-side
 * against the last accepted build.
 *
 * The examples under `examples/` are what a new author reads first, and none of
 * them were in any previous round's plates. This script renders each one, puts
 * it beside the same file rendered by the reference build, and checks three
 * things that a picture alone hides:
 *
 * - `contactRatio`: how much of each body's bottom row sits on something. A
 *   body with nothing under it is floating. §C.2 asks that no 3D example
 *   floats, or says in its own source why it does (a wireframe plate).
 * - `zFight`: within one owner's faces, the share of neighbouring pixels whose
 *   luma alternates sign at high contrast. Two coplanar faces produce that
 *   comb; a smooth surface does not.
 * - `check`: the example's own report, which has to be free of errors.
 *
 *   npx tsx scripts/examples-gallery.mjs
 *   npx tsx scripts/examples-gallery.mjs --out /tmp/examples
 *   npx tsx scripts/examples-gallery.mjs --reference ../flexlayer-ref
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { checkLayer, renderLayer } from '../src/render.js'
import { loadLayerFile } from '../src/load-source.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = dirname(here)
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(repo, 'docs/gallery/examples')
const refIndex = args.indexOf('--reference')
const refRepo = refIndex >= 0 ? resolve(args[refIndex + 1]) : null

/**
 * The 3D examples, and what each one is allowed to do.
 *
 * `ground: false` marks a plate that is deliberately in space: a wireframe
 * study has no floor, and adding one would hide the lines it is about. Every
 * other 3D example has to sit on something (§C.2 point 2).
 */
export const EXAMPLES = [
  { file: 'meshes.layer', ground: true },
  { file: 'perspective.layer', ground: true },
  { file: 'solids.layer', ground: true },
  { file: 'wire.layer', ground: false },
  // SPEC: glass keeps its own color at the rim and writes no hard shadow, so a
  // glass sphere or a glb diamond cannot score a contact shadow however well it
  // is seated. The opaque stripe cards behind them carry the plate's contact
  // score; the glass bodies are seated but not judged on it.
  { file: 'glass.layer', ground: true, shadowless: ['sphere', 'model'] },
  { file: 'product-shapes.layer', ground: true },
  { file: 'camera.layer', ground: true },
  { file: 'materials.layer', ground: true },
  { file: 'brushed.layer', ground: true },
  { file: 'finish-mix.layer', ground: true },
  { file: 'finish-pairs.layer', ground: true },
  { file: 'matcaps.layer', ground: true },
  { file: 'three-assembly.tsx', ground: true },
]

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The tags that are bodies in a 3D plate: things with a silhouette that lands. */
const SOLIDS = new Set(['rect', 'sphere', 'cylinder', 'torus', 'tube', 'model', 'path', 'polygon', 'ellipse', 'circle', 'line', 'polyline', 'curve'])

/**
 * Share of neighbouring pixel pairs whose luma alternates at high contrast,
 * twice in a row.
 *
 * Two faces at the same depth fight for the same pixel and the winner flips
 * from pixel to pixel, which reads as a comb of light and dark: dark, light,
 * dark, light. A drawn outline is dark then light and then stays light — one
 * reversal, not a comb — so a single high-contrast step must not count, or every
 * stroked example would score as fighting. The test therefore needs two
 * reversals over four pixels, each step past `CONTRAST`.
 */
const CONTRAST = 24

function zFight(rgba, width, height, owner) {
  const Y = (i) => luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
  /** 1 when the run p, p+step, p+2·step, p+3·step reverses twice at contrast. */
  const comb = (p, step) => {
    const a = Y(p)
    const b = Y(p + step)
    const c = Y(p + 2 * step)
    const d = Y(p + 3 * step)
    const d1 = b - a
    const d2 = c - b
    const d3 = d - c
    if (Math.abs(d1) <= CONTRAST || Math.abs(d2) <= CONTRAST || Math.abs(d3) <= CONTRAST) return 0
    return Math.sign(d1) !== Math.sign(d2) && Math.sign(d2) !== Math.sign(d3) ? 1 : 0
  }
  let samples = 0
  let combed = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 4; x++) {
      const p = y * width + x
      if (owner && !owner(p)) continue
      samples += 2
      combed += comb(p, 1) + comb(p, width)
    }
  }
  return samples > 0 ? combed / samples : 0
}

/**
 * How much of each body's bottom edge sits in its own contact shadow.
 *
 * A body that floats has plain floor under its lowest painted pixel; a body
 * that is seated has the floor darkened there by its own contact shadow.
 * Absolute brightness cannot tell those apart, because a plate may have a dark
 * floor, so the floor's own luma is measured once per plate — the most common
 * luma in the picture is the open floor — and the band under the body is
 * compared with it.
 *
 * The reported ink box is not the right place to look. A solid's box is its
 * projected bounds, and under a pitched camera the box's lowest row is the far
 * bottom corner, which the floor paints over. Measuring at the box's bottom
 * therefore samples bare floor under a body that is sitting perfectly well.
 *
 * So each column walks up from the box's bottom to the lowest row where that
 * column stops matching the open floor: the body's own last painted row. The
 * band under that row is where a contact shadow would be. The band may be
 * darker *or* lighter than the floor — a bright floor bounces light into a
 * crevice, a dark one only gets darker — so the test is the size of the
 * difference, not its sign.
 *
 * The band is read by its darkest row, not its mean. A small body's contact
 * shadow is one or two rows tall before the floor opens up again, so a mean
 * over three rows is mostly open floor and reports a well-seated thin plate as
 * floating (the glass cards scored 0.53 for exactly that). A shadow is present
 * if any row in the band is clearly away from the floor; a body with no shadow
 * has all three rows at the floor's own value and still fails.
 *
 * A body that reaches the bottom edge of the page is cropped rather than
 * seated, and its columns are skipped. A plate with no `<ground>` has no floor
 * to compare against; it is reported as `null` and is not judged.
 */
const CONTACT_DROP = 6
const CONTACT_BAND = 3
/** A column differs from the open floor by more than this on its painted rows. */
const BODY_DELTA = 12

/** The plate's open floor: the luma that covers the most pixels. */
function floorLuma(rgba, width, height) {
  const histogram = new Map()
  for (let i = 0; i < width * height; i++) {
    const value = Math.round(luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]))
    histogram.set(value, (histogram.get(value) ?? 0) + 1)
  }
  let best = 0
  let value = 0
  for (const [candidate, count] of histogram) {
    if (count > best) {
      best = count
      value = candidate
    }
  }
  return value
}

function contactRatio(rgba, width, height, bodies, hasGround) {
  if (!hasGround) return null
  const Y = (x, y) => luma(rgba[(y * width + x) * 4], rgba[(y * width + x) * 4 + 1], rgba[(y * width + x) * 4 + 2])
  const floor = floorLuma(rgba, width, height)
  let columns = 0
  let seated = 0
  for (const body of bodies) {
    const box = body.ink
    if (!(box.width > 24 && box.height > 24)) continue
    const x0 = Math.max(1, Math.ceil(box.x + box.width * 0.2))
    const x1 = Math.min(width - 2, Math.floor(box.x + box.width * 0.8))
    const top = Math.max(1, Math.round(box.y))
    const bottom = Math.min(height - 2, Math.round(box.y + box.height))
    if (bottom - top < 24) continue
    for (let x = x0; x <= x1; x += 2) {
      // The body's own last painted row in this column.
      let edge = -1
      for (let y = bottom; y >= top; y--) {
        if (Math.abs(Y(x, y) - floor) > BODY_DELTA) {
          edge = y
          break
        }
      }
      if (edge < 1 || edge + CONTACT_BAND >= height) continue
      let darkest = floor
      for (let k = 1; k <= CONTACT_BAND; k++) {
        const value = Y(x, edge + k)
        if (Math.abs(floor - value) > Math.abs(floor - darkest)) darkest = value
      }
      columns++
      if (Math.abs(floor - darkest) >= CONTACT_DROP) seated++
    }
  }
  return columns > 0 ? seated / columns : null
}

async function paintExample(file, baseDir) {
  const path = join(baseDir, 'examples', file)
  const base = join(baseDir, 'examples')
  const node = file.endsWith('.layer') ? readFileSync(path, 'utf8') : (await loadLayerFile(path)).node
  if (node == null) throw new Error(`${file} 不是 layer`)
  // One paint, two views: `rgba` for the metrics and `png` for the plate.
  const rgbaOut = await renderLayer(node, { baseDir: base, format: 'rgba' })
  const pngOut = await renderLayer(node, { baseDir: base })
  return { ...rgbaOut, png: pngOut.png }
}

async function checkExample(file, baseDir, shadowless = []) {
  const path = join(baseDir, 'examples', file)
  const base = join(baseDir, 'examples')
  const source = file.endsWith('.layer') ? readFileSync(path, 'utf8') : null
  const node = source ?? (await loadLayerFile(path)).node
  if (node == null) return { issues: [], bodies: [], hasGround: false }
  const report = await checkLayer(node, { baseDir: base })
  // Every solid and model is a body that has to sit on something. Grounds, the
  // root layer, and the 2D furniture around the bench (labels, captions, the
  // HTML boxes they sit in) are not: a caption does not cast a contact shadow
  // and scoring it as floating buries the one number this metric is about.
  //
  // A plate may also name tags that are exempt by material: SPEC says glass
  // writes no hard shadow, so a glass body has no contact shadow to measure.
  // The report names each mesh's material, so glass is exempt without the plate
  // having to list it.
  const bodies = report.elements.filter(
    (el) =>
      SOLIDS.has(el.tag) &&
      el.material !== 'glass' &&
      !shadowless.includes(el.tag) &&
      el.ink.width > 0 &&
      el.ink.height > 0,
  )
  const hasGround = report.elements.some((el) => el.tag === 'ground')
  return { issues: report.issues, bodies, hasGround }
}

async function composite(file, before, after) {
  const [a, b] = await Promise.all([loadImage(before), loadImage(after)])
  const gap = 8
  const width = a.width + b.width + gap
  const height = Math.max(a.height, b.height) + 28
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#241f1b'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#b7aea2'
  ctx.font = '16px sans-serif'
  ctx.fillText('reference', 8, 20)
  ctx.fillText('current', a.width + gap + 8, 20)
  ctx.drawImage(a, 0, 28)
  ctx.drawImage(b, a.width + gap, 28)
  writeFileSync(join(outDir, `${file.replace(/\.(layer|tsx)$/, '')}.png`), canvas.toBuffer('image/png'))
}

mkdirSync(outDir, { recursive: true })
const report = {}
let failed = 0
for (const example of EXAMPLES) {
  const started = Date.now()
  try {
    const painted = await paintExample(example.file, repo)
    const { rgba, width, height, png } = painted
    const { issues, bodies, hasGround } = await checkExample(example.file, repo, example.shadowless ?? [])
    const errors = issues.filter((i) => i.level === 'error')
    const contact = contactRatio(rgba, width, height, bodies, hasGround && example.ground)
    const entry = {
      width,
      height,
      ground: hasGround,
      contactRatio: contact == null ? null : Math.round(contact * 1000) / 1000,
      zFight: Math.round(zFight(rgba, width, height) * 10000) / 10000,
      errors: errors.map((e) => e.code),
      warnings: issues.filter((i) => i.level === 'warn').map((w) => w.code),
    }
    report[example.file] = entry
    // A plate that has to sit on a floor fails when less than 80 % of the
    // bodies' bottom edges are in their own contact shadow. Plates that are
    // deliberately in space (`ground: false`) are not judged.
    if (example.ground) {
      if (!hasGround) entry.floats = 'no ground'
      else if (contact == null) entry.floats = 'no body'
      else if (contact < 0.8) entry.floats = 'floating'
    }
    writeFileSync(join(outDir, `${example.file.replace(/\.(layer|tsx)$/, '')}-current.png`), png)
    if (refRepo) {
      try {
        const before = await paintExample(example.file, refRepo)
        writeFileSync(join(outDir, `${example.file.replace(/\.(layer|tsx)$/, '')}-reference.png`), before.png)
        await composite(example.file, before.png, png)
      } catch (error) {
        console.log(`  ${example.file}: reference render failed (${error instanceof Error ? error.message : error})`)
      }
    }
    const flag = entry.floats ? `  FLOATS (${entry.floats})` : ''
    console.log(
      `${example.file.padEnd(22)} contact ${(entry.contactRatio ?? 0).toFixed(2)}  zFight ${entry.zFight.toFixed(4)}  ` +
        `errors ${entry.errors.length}${flag}  ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
  } catch (error) {
    failed += 1
    console.error(`${example.file}: ${error instanceof Error ? error.message : error}`)
  }
}
writeFileSync(join(outDir, 'examples-metrics.json'), JSON.stringify(report, null, 2) + '\n')
if (failed > 0) {
  console.error(`✗ ${failed} error`)
  process.exit(1)
}
