import { describe, expect, it } from 'vitest'
import { GATES, checkGates, metalLumaDelta, platformSlack } from '../scripts/metrics-gates.mjs'

/** The gated numbers, as the proposal states them. */
const gates = {
  ...GATES,
  overexposureMax: 0.005,
  draftFinalLumaDeltaMax: 6,
  draftFinalFlipMax: 0.03,
  metalDarkFractionMax: 0.3,
  metalLumaDeltaMax: 0.15,
  contactRatioMax: 0.75,
  floatGapMin: 8,
  materialFlipMin: 0.05,
  emissiveCoreYMin: 240,
  emissiveHaloRiseMax: 2,
  emissiveOutsideHotMax: 0,
  toonLevelsMax: 4,
  mangaPaperLumaMin: 235,
  mangaPaperChromaMax: 0.02,
  hatchFlipMax: 0.15,
  technicalChromaRatioMin: 0.9,
}

/** A report that passes every gate, so each test can move one number. */
function passing() {
  return {
    pixels: 503360,
    cells: {
      '3d-quality-draft': { overexposure: 0.001, meanY: 200 },
      '3d-shade-toon': { overexposure: 0.0049, meanY: 207 },
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
    materials: [{ a: '3d-mat-matte', b: '3d-mat-clay', flip: 0.39 }],
    toon: [{ id: 'metal-plate', levels: 4 }],
    manga: { meanY: 235, chroma: 0.0136, hatchFlip: 0.124981 },
    technical: { minRatio: 0.9889 },
  }
}

describe('3D 门槛', () => {
  it('全部达标时不报错', () => {
    expect(checkGates(gates, passing())).toEqual([])
  })

  it('同平台零容差：压线通过，越线就失败', () => {
    const exact = passing()
    expect(checkGates(gates, exact)).toEqual([])
    exact.manga = { ...exact.manga, meanY: 234.99 }
    expect(checkGates(gates, exact)[0]).toContain('manga paper Y')
  })

  it('toon 过曝恰好卡在 0.5% 上', () => {
    const onEdge = passing()
    onEdge.cells['3d-shade-toon'].overexposure = 0.005
    expect(checkGates(gates, onEdge)).toEqual([])
    onEdge.cells['3d-shade-toon'].overexposure = 0.0051
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
    drift.manga = { ...drift.manga, meanY: 234.2 }
    expect(checkGates(gates, drift, slack)).toEqual([])

    const broken = passing()
    broken.manga = { ...broken.manga, meanY: 231 }
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
