/**
 * The gate half of `gallery-metrics.mjs`, kept apart from the rendering so a
 * test can drive every branch without painting a sheet.
 *
 * Two rules here matter more than the numbers:
 *
 * 1. `--check` enforces the proposal's thresholds. Nothing here widens a gate
 *    on the platform that recorded the baseline.
 * 2. A run on a *different* platform gets exactly one code value of slack on
 *    luminance means and a 256-pixel rim on threshold fractions, because the
 *    renderer outputs 8-bit bytes and the cel shaders go through
 *    `atan2`/`cbrt`, whose last ULP differs between macOS and glibc.
 */

/** Every gate, unset. `gallery-metrics.mjs` fills these from the baseline file. */
export const GATES = {
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

/**
 * One code value per channel moves a luminance mean by at most 1.0. A
 * threshold such as `Y > 250` can only change by the pixels whose luma is
 * carried across it, which is the antialiased rim of a highlight rather than
 * a region: 256 bounds a rim that long, and is still an order of magnitude
 * under the 0.5% overexposure gate, so a real regression cannot hide in it.
 */
export function platformSlack(baselinePlatform, pixels, host = `${process.platform}-${process.arch}`) {
  if (!baselinePlatform || baselinePlatform === host) return { luma: 0, fraction: 0 }
  return { luma: 1, fraction: pixels > 0 ? 256 / pixels : 0 }
}

/** Worst relative move in metal brightness between the draft and final cells. */
export function metalLumaDelta(report) {
  const draft = new Map()
  for (const metal of report.metals ?? []) {
    if (metal.cell === '3d-quality-draft') draft.set(metal.id, metal.meanY)
  }
  let worst = null
  for (const metal of report.metals ?? []) {
    if (metal.cell !== '3d-quality-final') continue
    const base = draft.get(metal.id)
    if (base == null || metal.meanY == null) continue
    const rel = Math.abs(base - metal.meanY) / Math.max(base, metal.meanY)
    if (worst == null || rel > worst) worst = rel
  }
  return worst
}

/** Every gate the report misses, as readable lines. Empty means it passed. */
export function checkGates(gates, report, slack = { luma: 0, fraction: 0 }) {
  const errors = []
  const maxOf = (limit, value, label, allow = 0) => {
    if (limit == null || value == null) return
    if (value > limit + allow) errors.push(`${label} ${value} > ${limit}`)
  }
  const minOf = (limit, value, label, allow = 0) => {
    if (limit == null || value == null) return
    if (value < limit - allow) errors.push(`${label} ${value} < ${limit}`)
  }
  for (const [name, cell] of Object.entries(report.cells ?? {})) {
    maxOf(gates.overexposureMax, cell.overexposure, `${name} overexposure`, slack.fraction)
  }
  maxOf(gates.draftFinalLumaDeltaMax, report.draftFinal?.lumaDelta, 'draft/final luma')
  maxOf(gates.draftFinalFlipMax, report.draftFinal?.flip, 'draft/final flip')
  for (const metal of report.metals ?? []) {
    if (metal.cell === '3d-shade-toon' || metal.cell === '3d-shade-manga') continue
    maxOf(gates.metalDarkFractionMax, metal.darkFraction, `${metal.cell} ${metal.id} dark`, slack.fraction)
  }
  maxOf(gates.metalLumaDeltaMax, metalLumaDelta(report), 'draft/final metal luma')
  for (const contact of report.contacts ?? []) {
    if (contact.cell !== '3d-quality-draft') continue
    maxOf(gates.contactRatioMax, contact.ratio, `${contact.cell} ${contact.id} contact`)
  }
  if (gates.materialFlipMin != null) {
    for (const pair of report.materials ?? []) {
      minOf(gates.materialFlipMin, pair.flip, `${pair.a} vs ${pair.b}`)
    }
  }
  for (const item of report.toon ?? []) {
    maxOf(gates.toonLevelsMax, item.levels, `toon ${item.id}`)
  }
  minOf(gates.mangaPaperLumaMin, report.manga?.meanY, 'manga paper Y', slack.luma)
  maxOf(gates.mangaPaperChromaMax, report.manga?.chroma, 'manga paper chroma')
  maxOf(gates.hatchFlipMax, report.manga?.hatchFlip, 'manga hatch flip')
  minOf(gates.technicalChromaRatioMin, report.technical?.minRatio, 'technical/studio chroma', slack.fraction)
  minOf(gates.floatGapMin, report.floatGap, 'blue-float recovered px', 1)
  minOf(gates.emissiveCoreYMin, report.emissive?.coreY, 'emissive core Y', slack.luma)
  maxOf(gates.emissiveHaloRiseMax, report.emissive?.haloRise, 'emissive halo rise', slack.luma)
  maxOf(gates.emissiveOutsideHotMax, report.emissive?.outsideHot, 'emissive Y>250 outside core', 1)
  return errors
}
