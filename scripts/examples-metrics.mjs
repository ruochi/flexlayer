/**
 * MacBook example metrics for the 3D quality round (bevel continuity, speaker
 * moiré, edge stairs). Separate from gallery-metrics because the example is not
 * a gallery cell.
 *
 *   npx tsx scripts/examples-metrics.mjs
 *   npx tsx scripts/examples-metrics.mjs --check
 *   npx tsx scripts/examples-metrics.mjs --out /tmp/macbook-metrics
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayerFile } from '../src/load-source.ts'
import { renderLayer } from '../src/render.ts'
import { edgeLineCv, facetStripe, luma, moireEnergy } from './metrics-image.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const repo = dirname(root)
const args = new Set(process.argv.slice(2))
const check = args.has('--check')
const outIndex = process.argv.indexOf('--out')
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : null
if (outDir) mkdirSync(outDir, { recursive: true })

/**
 * Gates that today's baseline must fail. Numbers come from 8d7c9d0 on the
 * macbook example: the front bevel row ran at sd≈15 with a 10 px beat, and the
 * speaker mesh dumped high-frequency energy. Tighten only after a fix lands.
 */
export const EXAMPLE_GATES = {
  /** Continuity of the four main bevel rows; QUALITY-4 §2.4 asks sd ≤ 4. */
  edgeLineSdMax: 4,
  /** 2–20 px FFT peak as a share of the mean; §2.4 asks ≤ 2%. */
  edgeLinePeakMax: 0.02,
  /** Speaker grille energy above 0.35 cycle/px. */
  speakerMoireMax: 0.12,
  /** Circumferential neighbour jump on any cylindrical body in the shot. */
  facetStripeMax: 3,
}

/** Named edge probes on the 1440×1800 macbook frame (calibrated on 8d7c9d0). */
const EDGES = [
  // Base front lip: dark-sideband row above the contact. Period-10 moiré lived here.
  { name: 'base-front', y: 1188, x0: 300, x1: 420 },
  // Base right diagonal: sample along a short horizontal chord of the bevel.
  { name: 'base-right', y: 1120, x0: 980, x1: 1100 },
  // Lid top outer contour.
  { name: 'lid-top', y: 268, x0: 420, x1: 900 },
  // Lid right side, mid height.
  { name: 'lid-side', y: 520, x0: 1080, x1: 1180 },
]

const SPEAKER = { x0: 360, y0: 720, x1: 520, y1: 900 }

function round(value, digits = 4) {
  if (value == null || Number.isNaN(value)) return null
  const p = 10 ** digits
  return Math.round(value * p) / p
}

/**
 * Sample a horizontal chord, keeping only mid-tone pixels so a silhouette
 * cliff does not dominate the bevel-row statistics.
 */
function sampleRow(rgba, width, y, x0, x1, band = [40, 220]) {
  const out = []
  for (let x = x0; x <= x1; x++) {
    const value = luma(rgba, (y * width + x) * 4)
    if (value < band[0] || value > band[1]) continue
    out.push(value)
  }
  return out
}

async function main() {
  const macbook = join(repo, 'examples/macbook-pro.tsx')
  const loaded = await loadLayerFile(macbook)
  if (loaded.kind !== 'node') throw new Error('macbook-pro.tsx 没有导出一个 layer')
  const painted = await renderLayer(loaded.node, { baseDir: dirname(macbook), format: 'rgba', meshCache: false })
  const { rgba, width, height, png } = painted
  if (outDir && png) writeFileSync(join(outDir, 'macbook-pro.png'), png)

  const edges = EDGES.map((edge) => {
    const samples = sampleRow(rgba, width, edge.y, edge.x0, edge.x1)
    const stats = edgeLineCv(samples)
    return {
      name: edge.name,
      ...edge,
      mean: round(stats?.mean, 2),
      sd: round(stats?.sd, 2),
      cv: round(stats?.cv, 4),
      peakShare: round(stats?.peakShare, 4),
    }
  })

  const speakerMoire = moireEnergy(
    rgba,
    width,
    height,
    (x, y) => x >= SPEAKER.x0 && x <= SPEAKER.x1 && y >= SPEAKER.y0 && y <= SPEAKER.y1,
  )

  // Silver chassis body as a coarse mask for residual facet banding.
  const bodyStripe = facetStripe(rgba, width, height, (x, y) => {
    if (y < 400 || y > 1200 || x < 250 || x > 1200) return false
    const i = (y * width + x) * 4
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const yL = luma(rgba, i)
    return yL > 80 && yL < 210 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18
  })

  const report = {
    platform: `${process.platform}-${process.arch}`,
    size: { width, height },
    gates: EXAMPLE_GATES,
    edges,
    worstEdgeSd: round(Math.max(...edges.map((e) => e.sd ?? 0)), 2),
    worstEdgePeak: round(Math.max(...edges.map((e) => e.peakShare ?? 0)), 4),
    speakerMoire: round(speakerMoire, 4),
    bodyStripe: round(bodyStripe, 2),
  }

  console.log(JSON.stringify(report, null, 2))
  if (outDir) writeFileSync(join(outDir, 'examples-metrics.json'), `${JSON.stringify(report, null, 2)}\n`)

  if (check) {
    const errors = []
    if (report.worstEdgeSd != null && report.worstEdgeSd > EXAMPLE_GATES.edgeLineSdMax) {
      errors.push(`edgeLine sd ${report.worstEdgeSd} > ${EXAMPLE_GATES.edgeLineSdMax}`)
    }
    if (report.worstEdgePeak != null && report.worstEdgePeak > EXAMPLE_GATES.edgeLinePeakMax) {
      errors.push(`edgeLine peak ${report.worstEdgePeak} > ${EXAMPLE_GATES.edgeLinePeakMax}`)
    }
    if (report.speakerMoire != null && report.speakerMoire > EXAMPLE_GATES.speakerMoireMax) {
      errors.push(`speaker moire ${report.speakerMoire} > ${EXAMPLE_GATES.speakerMoireMax}`)
    }
    if (report.bodyStripe != null && report.bodyStripe > EXAMPLE_GATES.facetStripeMax) {
      errors.push(`body facetStripe ${report.bodyStripe} > ${EXAMPLE_GATES.facetStripeMax}`)
    }
    if (errors.length) {
      console.error(errors.join('\n'))
      process.exit(1)
    }
  }
}

await main()
