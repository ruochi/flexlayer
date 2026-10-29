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
  // Q6 asks for 0.3%. The cel highlight is a paper white (248), not the top of
  // the range, so the cell now measures zero and the ceiling only catches a
  // build that goes back to a blown-out specular.
  overexposureMax: 0.003,
  draftFinalLumaDeltaMax: null,
  draftFinalFlipMax: null,
  /**
   * Share of a metal body that reads as black. A mirror box sat at 0.2366 and a
   * mirror sphere at 0.2097: a mirror reflects the dark room around it, but past
   * a third it stops reading as polished metal and starts reading as a hole.
   * 0.3 leaves the current worst body about 21% of margin.
   */
  metalDarkFractionMax: 0.3,
  metalLumaDeltaMax: null,
  contactRatioMax: null,
  floatGapMin: null,
  /**
   * Adjacent material cells, graded on the sphere's own ink box. A whole-cell
   * flip was diluted by the wall and the floor: the weakest pair measured 0.0587
   * over the cell but 0.342 on the sphere, so the old reading had only 17%
   * headroom against a real regression. On the object the same pairs clear 0.34,
   * and 0.15 leaves more than 100% margin.
   */
  materialFlipMin: 0.15,
  emissiveCoreYMin: null,
  emissiveHaloRiseMax: null,
  emissiveOutsideHotMax: null,
  toonLevelsMax: null,
  mangaPaperLumaMin: 238,
  // The paper covers three quarters of the page in the bench. A sheet that lost
  // its paper colour but kept a handful of bright pixels would still pass the
  // luma gate without this.
  mangaPaperShareMin: 0.7,
  /**
   * How much of the paper area may sit below Y 200. `share` is the mode's own
   * share, so a grey wash over the rest of the page never moved it. The sheet is
   * 235 and the hatch sits inside the solids, so this only sees what spills past
   * them; the plate's own spill is 2.1% of its paper area, and a wash over the
   * page is a quarter. Three percent leaves the spill room without leaving a
   * wash any.
   */
  mangaBackgroundGrayMax: 0.03,
  /**
   * `3d-lines` composition. The sheet is line art: the solids have to reach down
   * the frame, and two of them may not claim the same screen area, because that
   * reads as lines crossing with no geometry behind them. The plate left a
   * quarter of its frame empty below the lowest solid.
   */
  linesEmptyBelowMax: 0.25,
  linesInkGapMin: 16,
  mangaPaperChromaMax: null,
  /**
   * Manga hatch against the legacy raster. The reference is not in this repo,
   * so the gate is only enforced when FLEXLAYER_LEGACY_REFERENCE resolves; a
   * missing reference must not silently pass as a number.
   *
   * Restored to 0.15 (QUALITY-4 §1.2). The previous 0.18 widen was not justified
   * by a broken old measurement: current hatch flip sits at ~0.144, so 0.15
   * still clears with a few percent of headroom and the gate only tightens.
   */
  /**
   * FLIP vs legacy manga (QUALITY-5 §2 / §3.6). Restored to 0.15 — the engine
   * self-baseline cannot catch hatch regressions. A measured ~0.475 on linux
   * means manga is still wrong and must be fixed, not gated away.
   */
  hatchFlipMax: 0.15,
  /**
   * Engine self-baseline: report-only (QUALITY-5 §2). Comparing against the
   * branch's own accepted look cannot catch a shared regression.
   */
  hatchFlipEngineMax: null,
  /** QUALITY-5 §2: technical fill chroma vs studio; 8× AA wash must be fixed. */
  technicalChromaRatioMin: 0.9,
  /**
   * Technical hidden-line ink against the legacy raster. Count ratio stays at
   * 0.7 until the product rule draws inter-body occlusion; the colour match
   * tolerance is ±12 (QUALITY-5 §2), not a ratio raise.
   */
  technicalHiddenRatioMin: 0.7,
  /**
   * Ground defects, per cell. `null` means the probe is still being calibrated
   * against a known-bad commit and must not fail a run yet.
   *
   * `groundSeamsMax` counts screen-aligned steps in the floor shading: a
   * tone-mapped pool that ended in a rectangle read as three per bench cell.
   * `brightBlobsMax` counts lumps 40 levels above their neighbourhood -- the
   * refraction bug showed as one beside the glass sphere.
   * `shadowStairMax` is the share of the shadow ramp drawn along the pixel
   * grid. It barely separates a bilinear lookup from a nearest-neighbour one
   * (0.751 vs 0.7498 on `3d-mat-lamp`), so it is a loose ceiling rather than
   * the Q2 gate.
   *
   * `shadowEdgeFlipMax` is what Q2 is graded on: the penumbra band's FLIP
   * against the same sheet rendered with a 4x shadow map. Calibrated on
   * `3d-mat-lamp -- the worst cell both ways: bilinear reads 0.0535 and a
   * nearest-neighbour lookup reads 0.0888, so 0.06 leaves the current edge
   * about 11% of headroom and still fails a build that stops filtering.
   */
  /** QUALITY-5 §2: draft floor steps are a defect to fix, not a slack to keep. */
  groundSeamsMax: 0,
  /** QUALITY-5 §1.2: metal-plate SSR checkerboard rate ≤ 1%. */
  ssrCheckerMax: 0.01,
  brightBlobsMax: 0,
  shadowStairMax: 0.85,
  shadowEdgeFlipMax: 0.06,
  /**
   * `3d-still`, the plate Q3 grades. Each line is one bullet of the proposal:
   * the lamp pool has to stand clear of open floor, the neon has to read as a
   * hollow ring rather than a disc, every stripe has to stay visible through
   * the glass sphere, and the empty floor below the objects has to stay small.
   */
  /**
   * The peak has to clear open floor by more than the wash's own rounding. At
   * 15 the old addon passed on a peak that was the lamp's bloom rather than a
   * wash, so the bar sits where only a real pool reaches.
   */
  stillPoolRiseMin: 18,
  /**
   * How far the darkest floor pixel under a lamp may sit below open floor. A
   * wash only adds light; a rim that subtracts is the tone curve's black lift
   * leaking out at the pool edge, and it reads as a dark ring around the lamp.
   */
  stillPoolDipMax: 20,
  /**
   * Near-white pixels the bulb leaves outside its own ink, within 30px. Zero on
   * a bulb that ends at its silhouette; a saturated core that blooms past it
   * scores in the tens.
   */
  stillLampBloomMax: 0,
  stillNeonHollowMin: 20,
  /**
   * How much of the neon ring another body may hide. At half, the plate shows a
   * crescent and `hollow` still passes, because the visible part is still a
   * ring. The ring is a composition element, not a texture, so most of it has
   * to be in the open.
   */
  stillNeonOccludedMax: 0.3,
  stillStripeShareMin: 0.2,
  /**
   * Each stripe's hue, as a share of the glass sphere's ink. The stripes are the
   * thing the sphere is there to show; a sphere that paints them out is a grey
   * ball. Ten percent per hue is well below what a visible stripe covers and
   * well above what a tinted sphere leaks.
   */
  stillStripeThroughGlassMin: 0.1,
  stillEmptyFloorMax: 0.25,
  stillBlueTopGapMin: 40,
  /**
   * Circumferential neighbour jump on the still-life gold cylinder wall
   * (mid-band, silhouettes excluded). QUALITY-4 §3.3 asks ≤ 3.
   */
  stillGoldFacetMax: 3,
  /** QUALITY-4 §4.4: metal / mirror / brushed / anisotropy body floor. */
  materialDarkFloorMin: 35,
  /**
   * QUALITY-4 §4.4: clear glass keeps stripe structure (SSIM ≥ 0.6 against the
   * above-sphere column profile); frost washes it (SSIM ≤ 0.3). Edge energy
   * still has to drop from clear to frost so a flat copy cannot pass.
   */
  glassClearSsimMin: 0.6,
  glassFrostSsimMax: 0.3,
  glassClearEdgeMin: 12,
  glassEdgeRatioMin: 1.2,
  /** Adjacent material-grid pairs must differ ≥ 30% on at least one feature. */
  materialPairDeltaMin: 0.3,
  /** QUALITY-4 §4.4: |metal.reflectContent − plastic.reflectContent| ≥ 0.2. */
  metalPlasticReflectDeltaMin: 0.2,
  /**
   * QUALITY-5 §2.1 category constraints. Each rule names the features that must
   * move for that pair; `null` disables the structured check (legacy bestDelta
   * alone). See `checkMaterialPairRules`.
   */
  materialPairRules: true,
  /** Clear glass transmit (SSIM) vs an opaque finish must differ by this much. */
  glassOpaqueTransmitDeltaMin: 0.3,
  /** Anisotropy / brushed highlight aspect vs round metal. Absolute ratio. */
  anisotropyAspectMin: 1.5,
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

function relDelta(a, b) {
  if (a == null || b == null) return null
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-6)
}

/**
 * QUALITY-5 §2.1: category-specific material pair constraints. Returns error
 * strings; empty when every named rule holds or the structured check is off.
 */
export function checkMaterialPairRules(gates, report) {
  if (!gates.materialPairRules) return []
  const errors = []
  const byCell = new Map((report.materialTraits ?? []).map((t) => [t.cell, t]))
  const push = (msg) => errors.push(msg)

  const roughnessPair = (smooth, rough, label) => {
    const A = byCell.get(smooth)
    const B = byCell.get(rough)
    if (!A || !B) {
      push(`${label}: traits missing`)
      return
    }
    for (const key of ['highlightArea', 'highlightSharpness']) {
      const d = relDelta(A[key], B[key])
      if (d == null) {
        push(`${label} ${key} missing`)
        continue
      }
      if (d < (gates.materialPairDeltaMin ?? 0.3)) {
        push(`${label} ${key} delta ${d.toFixed(4)} < ${gates.materialPairDeltaMin ?? 0.3}`)
      }
    }
    // Higher roughness → larger, softer highlight.
    if (A.highlightArea != null && B.highlightArea != null && !(B.highlightArea > A.highlightArea)) {
      push(`${label} highlightArea not monotonic (rough ${B.highlightArea} ≤ smooth ${A.highlightArea})`)
    }
    if (A.highlightSharpness != null && B.highlightSharpness != null && !(A.highlightSharpness > B.highlightSharpness)) {
      push(`${label} highlightSharpness not monotonic (smooth ${A.highlightSharpness} ≤ rough ${B.highlightSharpness})`)
    }
  }

  roughnessPair('3d-mat-plastic-0-12', '3d-mat-plastic-0-85', 'plastic roughness')
  roughnessPair('3d-mat-metal-0-08', '3d-mat-metal-0-8', 'metal roughness')

  // Glass clear vs frost: transmittance (SSIM against behind) must move ≥ 0.3.
  const gClear = report.glassSsim?.clear
  const gFrost = report.glassSsim?.frost
  const gDelta = relDelta(gClear, gFrost)
  if (gClear == null || gFrost == null) push('glass transmit traits missing')
  else if (gDelta < (gates.materialPairDeltaMin ?? 0.3)) {
    push(`glass clear/frost transmit delta ${gDelta.toFixed(4)} < ${gates.materialPairDeltaMin ?? 0.3}`)
  }

  // Glass vs opaque: clear glass transmit must clear the opaque floor by ≥ 0.3.
  const opaqueFloor = 0
  if (gClear != null && gates.glassOpaqueTransmitDeltaMin != null) {
    const d = gClear - opaqueFloor
    if (d < gates.glassOpaqueTransmitDeltaMin) {
      push(`glass vs opaque transmit ${d.toFixed(4)} < ${gates.glassOpaqueTransmitDeltaMin}`)
    }
  }

  // Clearcoat vs plastic base: highlight sharpness ≥ 30%.
  {
    const base = byCell.get('3d-mat-plastic-0-12')
    const coat = byCell.get('3d-mat-clearcoat-1')
    const d = relDelta(base?.highlightSharpness, coat?.highlightSharpness)
    if (d == null) push('clearcoat vs plastic highlightSharpness missing')
    else if (d < (gates.materialPairDeltaMin ?? 0.3)) {
      push(`clearcoat vs plastic highlightSharpness ${d.toFixed(4)} < ${gates.materialPairDeltaMin ?? 0.3}`)
    }
  }

  // Anisotropy / brushed: highlight aspect ≥ 1.5 (and ahead of round metal).
  const aspectMin = gates.anisotropyAspectMin ?? 1.5
  for (const cell of ['3d-mat-anisotropy-0-9', '3d-mat-brushed']) {
    const t = byCell.get(cell)
    if (!t || t.anisotropy == null) {
      push(`${cell} anisotropy missing`)
      continue
    }
    if (t.anisotropy < aspectMin) {
      push(`${cell} highlight aspect ${t.anisotropy} < ${aspectMin}`)
    }
  }

  // Mirror sharper reflection than metal 0.08.
  {
    const metal = byCell.get('3d-mat-metal-0-08')
    const mirror = byCell.get('3d-mat-mirror')
    if (!metal || !mirror || metal.highlightSharpness == null || mirror.highlightSharpness == null) {
      push('mirror vs metal highlightSharpness missing')
    } else if (!(mirror.highlightSharpness > metal.highlightSharpness)) {
      push(`mirror highlightSharpness ${mirror.highlightSharpness} ≤ metal 0.08 ${metal.highlightSharpness}`)
    }
  }

  return errors
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
      // Only the sphere is graded. The whole-cell flip is diluted by the wall and
      // the floor, and `side` sits outside the sphere's refraction path, so
      // gating those would fail every clear material for being clear.
      minOf(gates.materialFlipMin, pair.sphereFlip, `${pair.a} vs ${pair.b} on sphere`)
    }
  }
  for (const item of report.toon ?? []) {
    maxOf(gates.toonLevelsMax, item.levels, `toon ${item.id}`)
  }
  // `paperY` is the paper colour itself; `meanY` is what the whole page averages
  // to and includes decor that is not paper. The share keeps a single bright
  // pixel from standing in for a sheet.
  minOf(gates.mangaPaperLumaMin, report.manga?.paperY, 'manga paper Y', slack.luma)
  minOf(gates.mangaPaperShareMin, report.manga?.share, 'manga paper share', slack.fraction)
  maxOf(gates.mangaBackgroundGrayMax, report.manga?.grayShare, 'manga page grey', slack.fraction)
  if (report.lines) {
    maxOf(gates.linesEmptyBelowMax, report.lines.emptyBelow, 'lines empty floor below', slack.fraction)
    minOf(gates.linesInkGapMin, report.lines.inkGap, 'lines ink gap', slack.luma)
  }
  maxOf(gates.mangaPaperChromaMax, report.manga?.chroma, 'manga paper chroma')
  // A number gate with a null reading means the reference could not be found,
  // not that the render passed. Fail loudly so a missing
  // FLEXLAYER_LEGACY_REFERENCE cannot quietly disable the check.
  if (gates.hatchFlipMax != null) {
    if (report.manga?.hatchFlip == null) errors.push('manga hatch flip missing: set FLEXLAYER_LEGACY_REFERENCE to the renderer repo legacy-reference directory')
    else maxOf(gates.hatchFlipMax, report.manga.hatchFlip, 'manga hatch flip')
  }
  if (gates.hatchFlipEngineMax != null) {
    if (report.manga?.hatchFlipEngine == null) {
      errors.push('manga engine hatch flip missing: set FLEXLAYER_LEGACY_REFERENCE (sibling engine-baseline) or FLEXLAYER_ENGINE_BASELINE')
    } else {
      maxOf(gates.hatchFlipEngineMax, report.manga.hatchFlipEngine, 'manga engine hatch flip')
    }
  }
  minOf(gates.technicalChromaRatioMin, report.technical?.minRatio, 'technical/studio chroma', slack.fraction)
  if (gates.technicalHiddenRatioMin != null) {
    if (report.technicalHidden?.ratio == null) errors.push('technical hidden lines missing: set FLEXLAYER_LEGACY_REFERENCE to the renderer repo legacy-reference directory')
    else minOf(gates.technicalHiddenRatioMin, report.technicalHidden.ratio, 'technical hidden vs legacy', slack.fraction)
  }
  minOf(gates.floatGapMin, report.floatGap, 'blue-float recovered px', 1)
  minOf(gates.emissiveCoreYMin, report.emissive?.coreY, 'emissive core Y', slack.luma)
  maxOf(gates.emissiveHaloRiseMax, report.emissive?.haloRise, 'emissive halo rise', slack.luma)
  maxOf(gates.emissiveOutsideHotMax, report.emissive?.outsideHot, 'emissive Y>250 outside core', 1)
  for (const cell of report.groundDefects ?? []) {
    maxOf(gates.groundSeamsMax, cell.seams, `${cell.cell} ground seams`)
    maxOf(gates.brightBlobsMax, cell.blobs, `${cell.cell} bright blobs`)
    maxOf(gates.shadowStairMax, cell.stair, `${cell.cell} shadow stair`, slack.fraction)
    maxOf(gates.shadowEdgeFlipMax, cell.edgeFlip, `${cell.cell} shadow edge flip`)
  }
  const still = report.still
  if (still) {
    // The peak is over open floor only, so a stripe's white highlight cannot
    // stand in for a lamp pool.
    minOf(gates.stillPoolRiseMin, still.poolRise, 'still floor pool rise', slack.luma)
    maxOf(gates.stillPoolDipMax, still.poolDip, 'still floor pool dip', slack.luma)
    maxOf(gates.stillLampBloomMax, still.objectBlobs?.lampBloom, 'still lamp bloom')
    minOf(gates.stillNeonHollowMin, still.neon?.hollow, 'still neon hollow', slack.luma)
    maxOf(gates.stillNeonOccludedMax, still.neon?.occluded, 'still neon occluded', slack.fraction)
    for (const [name, item] of Object.entries(still.stripes ?? {})) {
      if (name === 'throughGlass') continue
      minOf(gates.stillStripeShareMin, item?.share, `still ${name} through glass`, slack.fraction)
    }
    for (const [hue, share] of Object.entries(still.stripes?.throughGlass ?? {})) {
      if (hue === 'total') continue
      minOf(gates.stillStripeThroughGlassMin, share, `still ${hue} hue inside glass`, slack.fraction)
    }
    maxOf(gates.stillEmptyFloorMax, still.emptyFloor, 'still empty floor', slack.fraction)
    minOf(gates.stillBlueTopGapMin, still.blueTopGap, 'still blue-float top gap', 1)
    maxOf(gates.stillGoldFacetMax, still.goldFacetStripe, 'still gold facetStripe')
    maxOf(gates.ssrCheckerMax, still.ssrChecker, 'still metal-plate SSR checker')
  }
  if (gates.materialDarkFloorMin != null) {
    for (const trait of report.materialTraits ?? []) {
      if (!/metal|mirror|brushed|anisotropy/.test(trait.cell)) continue
      minOf(gates.materialDarkFloorMin, trait.darkFloor, `${trait.cell} dark floor`, slack.luma)
    }
  }
  if (gates.glassClearSsimMin != null) {
    minOf(gates.glassClearSsimMin, report.glassSsim?.clear, 'glass 0.06 SSIM')
  }
  if (gates.glassFrostSsimMax != null) {
    maxOf(gates.glassFrostSsimMax, report.glassSsim?.frost, 'glass 0.72 SSIM')
  }
  if (gates.glassClearEdgeMin != null) {
    minOf(gates.glassClearEdgeMin, report.glassSsim?.clearEdge, 'glass 0.06 edge')
  }
  if (gates.glassEdgeRatioMin != null && report.glassSsim?.clearEdge != null && report.glassSsim?.frostEdge != null && report.glassSsim.frostEdge > 0) {
    minOf(gates.glassEdgeRatioMin, report.glassSsim.clearEdge / report.glassSsim.frostEdge, 'glass clear/frost edge ratio')
  }
  if (gates.materialPairDeltaMin != null) {
    for (const pair of report.materialPairDeltas ?? []) {
      let delta = pair.bestDelta
      // Glass pair also counts the stripe-edge ratio when feature probes are flat.
      if (pair.a?.includes('glass') && pair.b?.includes('glass') && report.glassSsim?.clearEdge && report.glassSsim?.frostEdge) {
        const edgeDelta = Math.abs(report.glassSsim.clearEdge - report.glassSsim.frostEdge) / Math.max(report.glassSsim.clearEdge, report.glassSsim.frostEdge)
        if (delta == null || edgeDelta > delta) delta = edgeDelta
      }
      minOf(gates.materialPairDeltaMin, delta, `${pair.a} vs ${pair.b} feature delta`)
    }
  }
  if (gates.metalPlasticReflectDeltaMin != null) {
    minOf(gates.metalPlasticReflectDeltaMin, report.metalPlasticReflectDelta, 'metal vs plastic reflectContent Δ')
  }
  errors.push(...checkMaterialPairRules(gates, report))
  return errors
}
