import { describe, expect, it } from 'vitest'
import { GATES, checkGates, metalLumaDelta, platformSlack } from '../scripts/metrics-gates.mjs'

/** The gated numbers, as the proposal states them. */
const gates = {
  ...GATES,
  overexposureMax: 0.003,
  draftFinalLumaDeltaMax: 6,
  draftFinalFlipMax: 0.03,
  metalDarkFractionMax: 0.3,
  metalLumaDeltaMax: 0.15,
  contactRatioMax: 0.75,
  floatGapMin: 8,
  materialFlipMin: 0.15,
  emissiveCoreYMin: 240,
  emissiveHaloRiseMax: 2,
  emissiveOutsideHotMax: 0,
  toonLevelsMax: 4,
  mangaPaperLumaMin: 238,
  mangaPaperShareMin: 0.7,
  mangaPaperChromaMax: 0.02,
  hatchFlipMax: null,
  hatchFlipEngineMax: 0.02,
  technicalChromaRatioMin: 0.9,
  technicalHiddenRatioMin: 0.7,
  stillPoolRiseMin: 15,
  stillNeonHollowMin: 20,
  stillStripeShareMin: 0.2,
  stillEmptyFloorMax: 0.25,
  stillBlueTopGapMin: 40,
  materialPairRules: true,
  glassOpaqueTransmitDeltaMin: 0.3,
  anisotropyAspectMin: 1.5,
}

/** A report that passes every gate, so each test can move one number. */
function passing() {
  return {
    pixels: 503360,
    cells: {
      '3d-quality-draft': { overexposure: 0.001, meanY: 200 },
      '3d-shade-toon': { overexposure: 0.0011, meanY: 207 },
    },
    draftFinal: { lumaDelta: 0.74, flip: 0.011 },
    metals: [
      { cell: '3d-quality-draft', id: 'chrome', meanY: 125.31, darkFraction: 0.053 },
      { cell: '3d-quality-final', id: 'chrome', meanY: 132, darkFraction: 0.05 },
      { cell: '3d-shade-toon', id: 'chrome', meanY: 181.09, darkFraction: 0.6 },
    ],
    contacts: [{ cell: '3d-quality-draft', id: 'plinth', ratio: 0.3589 }],
    floatGap: 143,
    emissive: { coreY: 245.18, haloRise: 0, outsideHot: 0 },
    materials: [{ a: '3d-mat-matte', b: '3d-mat-clay', flip: 0.39, sphereFlip: 0.4675 }],
    toon: [{ id: 'metal-plate', levels: 4 }],
    manga: { meanY: 234.6, paperY: 239, share: 0.7552, chroma: 0.0136, grayShare: 0.011, hatchFlip: 0.124981, hatchFlipEngine: 0.008 },
    lines: { emptyBelow: 0.027, inkGap: 24 },
    groundDefects: [{ cell: '3d-quality-final', seams: 0, blobs: 0, stair: 0.5, edgeFlip: 0.03 }],
    technical: { minRatio: 0.9889 },
    technicalHidden: { count: 3432, legacy: 3406, ratio: 1.0076 },
    glassSsim: { clear: 0.65, frost: 0.2, clearEdge: 20, frostEdge: 8 },
    metalPlasticReflectDelta: 0.45,
    materialTraits: [
      { cell: '3d-mat-plastic-0-12', highlightArea: 0.02, highlightSharpness: 40, darkFloor: 80, anisotropy: 1.1, reflectContent: 0.2 },
      { cell: '3d-mat-plastic-0-85', highlightArea: 0.08, highlightSharpness: 12, darkFloor: 90, anisotropy: 1.1, reflectContent: 0.15 },
      { cell: '3d-mat-metal-0-08', highlightArea: 0.03, highlightSharpness: 50, darkFloor: 45, anisotropy: 1.2, reflectContent: 0.65 },
      { cell: '3d-mat-metal-0-8', highlightArea: 0.1, highlightSharpness: 15, darkFloor: 55, anisotropy: 1.2, reflectContent: 0.4 },
      { cell: '3d-mat-clearcoat-1', highlightArea: 0.04, highlightSharpness: 70, darkFloor: 75, anisotropy: 1.1, reflectContent: 0.25 },
      { cell: '3d-mat-anisotropy-0-9', highlightArea: 0.04, highlightSharpness: 35, darkFloor: 48, anisotropy: 2.2, reflectContent: 0.55 },
      { cell: '3d-mat-brushed', highlightArea: 0.04, highlightSharpness: 30, darkFloor: 50, anisotropy: 1.8, reflectContent: 0.5 },
      { cell: '3d-mat-mirror', highlightArea: 0.02, highlightSharpness: 80, darkFloor: 40, anisotropy: 1.1, reflectContent: 0.7 },
    ],
    materialPairDeltas: [
      { a: '3d-mat-plastic-0-12', b: '3d-mat-plastic-0-85', bestDelta: 0.75 },
      { a: '3d-mat-glass-0-06', b: '3d-mat-glass-0-72', bestDelta: 0.7 },
      { a: '3d-mat-metal-0-08', b: '3d-mat-metal-0-8', bestDelta: 0.7 },
      { a: '3d-mat-plastic-0-12', b: '3d-mat-clearcoat-1', bestDelta: 0.43 },
      { a: '3d-mat-metal-0-08', b: '3d-mat-anisotropy-0-9', bestDelta: 0.45 },
      { a: '3d-mat-metal-0-08', b: '3d-mat-brushed', bestDelta: 0.33 },
      { a: '3d-mat-metal-0-08', b: '3d-mat-mirror', bestDelta: 0.38 },
    ],
    still: {
      openMedian: 224.6,
      openPeak: 245.2,
      poolRise: 20.6,
      lampPoolRise: 20.6,
      poolDip: 6,
      neon: { ring: 113, core: 79.5, hollow: 33.4, occluded: 0.12 },
      glassBase: 118.9,
      stripes: {
        'stripe-red': { peak: 255, share: 0.5725 },
        'stripe-white': { peak: 255, share: 0.5478 },
        'stripe-blue': { peak: 255, share: 0.5774 },
        throughGlass: { red: 0.42, white: 0.38, blue: 0.31 },
      },
      objectBlobs: { lampBloom: 0 },
      emptyFloor: 0.23,
      blueTopGap: 102,
    },
  }
}

describe('3D 门槛', () => {
  it('全部达标时不报错', () => {
    expect(checkGates(gates, passing())).toEqual([])
  })

  it('同平台零容差：压线通过，越线就失败', () => {
    const exact = passing()
    expect(checkGates(gates, exact)).toEqual([])
    // The gate watches the paper colour itself, not the page average: decor
    // that is not paper must not be able to pull a good sheet under the floor.
    exact.manga = { ...exact.manga, paperY: 237.99 }
    expect(checkGates(gates, exact)[0]).toContain('manga paper Y')
  })

  it('toon 过曝恰好卡在 0.3% 上', () => {
    const onEdge = passing()
    onEdge.cells['3d-shade-toon'].overexposure = 0.003
    expect(checkGates(gates, onEdge)).toEqual([])
    onEdge.cells['3d-shade-toon'].overexposure = 0.0031
    expect(checkGates(gates, onEdge)[0]).toContain('overexposure')
  })

  it('超出的那一条会写清是哪个指标', () => {
    const hot = passing()
    hot.contacts[0]!.ratio = 0.9
    hot.metals[0]!.darkFraction = 0.4
    hot.toon = [{ id: 'plinth', levels: 5 }]
    const text = checkGates(gates, hot).join('\n')
    expect(text).toContain('3d-quality-draft plinth contact 0.9 > 0.75')
    expect(text).toContain('dark 0.4 > 0.3')
    expect(text).toContain('toon plinth 5 > 4')
  })

  it('toon 和 manga 的金属暗部不参与 dark 门槛', () => {
    // A flat cel band is meant to be dark; the gate is about studio metal.
    const sharp = passing()
    sharp.metals[2]!.darkFraction = 0.95
    expect(checkGates(gates, sharp)).toEqual([])
  })

  it('draft/final 金属亮度按相对差算', () => {
    expect(metalLumaDelta({ metals: passing().metals })).toBeCloseTo(6.69 / 132, 4)
    expect(metalLumaDelta({ metals: [] })).toBe(null)
  })
})

describe('地面缺陷门槛', () => {
  /** The bench as the tone-mapped pool left it: three screen-aligned steps. */
  const measured = {
    ...gates,
    groundSeamsMax: 0,
    brightBlobsMax: 0,
    shadowStairMax: 0.6,
  }

  function defects(overrides = {}) {
    const report = passing()
    report.groundDefects = [{ cell: '3d-quality-draft', seams: 0, blobs: 0, stair: 0.5, ...overrides }]
    return report
  }

  it('干净的地面通过', () => {
    expect(checkGates(measured, defects())).toEqual([])
  })

  it('矩形光池留下的三条接缝会被拦住', () => {
    expect(checkGates(measured, defects({ seams: 3 }))[0]).toContain('3d-quality-draft ground seams 3 > 0')
  })

  it('玻璃球旁的白色鼓包会被拦住', () => {
    expect(checkGates(measured, defects({ blobs: 1 }))[0]).toContain('bright blobs')
  })

  it('阴影阶梯超过标定值会被拦住', () => {
    expect(checkGates(measured, defects({ stair: 0.7 }))[0]).toContain('shadow stair')
  })

  it('null 的门槛只记录不判', () => {
    // Q0 records these before Q2 calibrates the stair limit. A null gate must
    // not fail a run, or the whole sheet cannot be measured at all.
    expect(checkGates({ ...gates, groundSeamsMax: null, brightBlobsMax: null, shadowStairMax: null }, defects({ seams: 9, blobs: 4, stair: 0.99 }))).toEqual([])
  })
})

describe('跨平台容差', () => {
  it('同平台不给任何余量', () => {
    expect(platformSlack('darwin-arm64', 503360, 'darwin-arm64')).toEqual({ luma: 0, fraction: 0 })
  })

  it('没有基线时也不给余量', () => {
    expect(platformSlack(null, 503360, 'linux-x64')).toEqual({ luma: 0, fraction: 0 })
  })

  it('另一个平台给一个码值和一条抗锯齿边', () => {
    const slack = platformSlack('darwin-arm64', 503360, 'linux-x64')
    expect(slack.luma).toBe(1)
    expect(slack.fraction).toBeCloseTo(256 / 503360, 10)
  })

  it('余量只够容下一次编码漂移，盖不住真实回归', () => {
    const slack = platformSlack('darwin-arm64', 503360, 'linux-x64')
    const drift = passing()
    drift.manga = { ...drift.manga, paperY: 237.2 }
    expect(checkGates(gates, drift, slack)).toEqual([])

    const broken = passing()
    broken.manga = { ...broken.manga, paperY: 231 }
    expect(checkGates(gates, broken, slack)[0]).toContain('manga paper Y')

    const over = passing()
    over.cells['3d-shade-toon']!.overexposure = 0.01
    expect(checkGates(gates, over, slack)[0]).toContain('overexposure')
  })

  it('抗锯齿边的余量远小于 0.5% 过曝门槛', () => {
    const slack = platformSlack('darwin-arm64', 503360, 'linux-x64')
    expect(slack.fraction).toBeLessThan(gates.overexposureMax! / 4)
  })
})

describe('still 样张', () => {
  function plate(overrides = {}) {
    const report = passing()
    report.still = { ...report.still, ...overrides }
    return report
  }

  it('光池压在门槛上算过，掉到门槛以下就失败', () => {
    expect(checkGates(gates, plate({ poolRise: 15 }))).toEqual([])
    expect(checkGates(gates, plate({ poolRise: 14.9 }))[0]).toContain('still floor pool rise')
  })

  it('霓虹吞成一团时环心不暗就失败', () => {
    expect(checkGates(gates, plate({ neon: { ring: 240, core: 238, hollow: 2 } }))[0]).toContain('still neon hollow')
  })

  it('色条被玻璃压没就失败', () => {
    const report = passing()
    report.still = { ...report.still, stripes: { ...report.still!.stripes, 'stripe-red': { peak: 130, share: 0.01 } } }
    const errors = checkGates(gates, report)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('still stripe-red through glass')
  })

  it('空地面超过四分之一就失败，蓝球贴顶也失败', () => {
    expect(checkGates(gates, plate({ emptyFloor: 0.2706 }))[0]).toContain('still empty floor')
    expect(checkGates(gates, plate({ blueTopGap: 12 }))[0]).toContain('still blue-float top gap')
  })
})

describe('manga 排线对照', () => {
  it('对照图找不到时失败，而不是当作通过', () => {
    const report = passing()
    report.manga = { ...report.manga!, hatchFlip: null }
    const errors = checkGates(gates, report)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('FLEXLAYER_LEGACY_REFERENCE')
  })

  it('排线漂移超过门槛时失败', () => {
    const report = passing()
    report.manga = { ...report.manga!, hatchFlip: 0.19 }
    expect(checkGates(gates, report)[0]).toContain('manga hatch flip')
  })

  it('门槛为 null 时只记录不判', () => {
    const report = passing()
    report.manga = { ...report.manga!, hatchFlip: null, hatchFlipEngine: null }
    expect(checkGates({ ...gates, hatchFlipMax: null, hatchFlipEngineMax: null }, report)).toEqual([])
  })

  it('引擎基线排线漂移超过门槛时失败', () => {
    const report = passing()
    report.manga = { ...report.manga!, hatchFlipEngine: 0.05 }
    expect(checkGates({ ...gates, hatchFlipEngineMax: 0.02 }, report)[0]).toContain('manga engine hatch flip')
  })

  it('引擎基线找不到时失败，而不是当作通过', () => {
    const report = passing()
    report.manga = { ...report.manga!, hatchFlipEngine: null }
    const errors = checkGates({ ...gates, hatchFlipMax: null, hatchFlipEngineMax: 0.02 }, report)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('engine-baseline')
  })

  it('QUALITY-5 §2.1：金属粗糙度高光不单调会失败', () => {
    const report = passing()
    report.materialTraits = report.materialTraits!.map((t) =>
      t.cell === '3d-mat-metal-0-8' ? { ...t, highlightArea: 0.01, highlightSharpness: 60 } : t,
    )
    const text = checkGates(gates, report).join('\n')
    expect(text).toMatch(/metal roughness/)
  })
})

describe('technical 隐藏线', () => {
  it('隐藏线掉到 legacy 的九成以下就失败', () => {
    const report = passing()
    report.technicalHidden = { count: 2300, legacy: 3406, ratio: 0.6753 }
    expect(checkGates(gates, report)[0]).toContain('technical hidden vs legacy')
  })

  it('对照图找不到时失败，而不是当作通过', () => {
    const report = passing()
    report.technicalHidden = { count: 3432, ratio: null }
    const errors = checkGates(gates, report)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('FLEXLAYER_LEGACY_REFERENCE')
  })
})

describe('材质物体区 FLIP', () => {
  it('只量球体，整格被地面稀释不再决定通过', () => {
    // A pair can move the plate a lot and the sphere not at all. The sphere is
    // the body the finish is applied to, so a low whole-cell flip with an
    // unchanged sphere has to fail.
    const report = passing()
    report.materials = [{ a: '3d-mat-matte', b: '3d-mat-clay', flip: 0.39, sphereFlip: 0.02 }]
    expect(checkGates(gates, report)[0]).toContain('on sphere')
  })

  it('球体差别够大就通过，即使整格 FLIP 很小', () => {
    const report = passing()
    report.materials = [{ a: '3d-mat-matte', b: '3d-mat-clay', flip: 0.01, sphereFlip: 0.34 }]
    expect(checkGates(gates, report)).toEqual([])
  })
})

describe('补盲：每个门槛越线都要报错', () => {
  // 3.4 asked for each blind spot to be proven able to catch a defect before
  // its threshold was tightened. These move one number at a time and name the
  // metric that has to appear in the message, so a check that silently reads
  // `undefined` (and therefore passes) fails here instead of in production.

  it('manga 页面发灰', () => {
    const r = passing()
    r.manga.grayShare = 0.05
    expect(checkGates(gates, r)[0]).toContain('manga page grey')
  })

  it('3d-lines 下方留白', () => {
    const r = passing()
    r.lines.emptyBelow = 0.4
    expect(checkGates(gates, r)[0]).toContain('lines empty floor below')
  })

  it('3d-lines 相邻物体墨线粘连', () => {
    const r = passing()
    r.lines.inkGap = 6
    expect(checkGates(gates, r)[0]).toContain('lines ink gap')
  })

  it('阴影边缘的 penumbra 没有过渡', () => {
    const r = passing()
    r.groundDefects[0]!.edgeFlip = 0.12
    expect(checkGates(gates, r)[0]).toContain('shadow edge flip')
  })

  it('光池边缘被压暗', () => {
    const r = passing()
    r.still.poolDip = 30
    expect(checkGates(gates, r)[0]).toContain('still floor pool dip')
  })

  it('灯本体溢出发白', () => {
    const r = passing()
    r.still.objectBlobs.lampBloom = 3
    expect(checkGates(gates, r)[0]).toContain('still lamp bloom')
  })

  it('霓虹被前景挡住太多', () => {
    const r = passing()
    r.still.neon.occluded = 0.5
    expect(checkGates(gates, r)[0]).toContain('still neon occluded')
  })

  it('色条透过玻璃后褪色', () => {
    const r = passing()
    r.still.stripes.throughGlass.red = 0.02
    expect(checkGates(gates, r)[0]).toContain('red hue inside glass')
  })
})
