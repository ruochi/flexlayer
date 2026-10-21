import { describe, expect, it } from 'vitest'
import { applyGrade, GRADE_PRESETS, parseGrade } from './grade.js'
import { rgbToOklab } from './gradientField.js'
import type { GradeSpec } from './types.js'

function spec(value: string): GradeSpec {
  const parsed = parseGrade(value)
  if (!parsed || !('spec' in parsed)) throw new Error(`grade 解析失败: ${value}`)
  return parsed.spec
}

function solid(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    data[i + 3] = 255
  }
  return data
}

function px(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number] {
  const i = (y * width + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!]
}

describe('parseGrade', () => {
  it('预设展开，后面的项覆盖同名参数', () => {
    const s = spec('lomo 0.8, fade 0.1, vignette 0.3 #120c08')
    expect(s.preset).toBe('lomo')
    expect(s.amount).toBe(0.8)
    expect(s.fade).toBe(0.1)
    expect(s.vignette).toBe(0.3)
    expect(s.vignetteColor).toBe('#120c08')
    expect(s.contrast).toBe(GRADE_PRESETS.lomo.contrast)
    expect(s.shadows).toEqual(GRADE_PRESETS.lomo.shadows)
  })

  it('不写预设时其余参数取中性值', () => {
    const s = spec('shadows #2a6080 0.5, warmth -0.2')
    expect(s.preset).toBeUndefined()
    expect(s).toMatchObject({ amount: 1, contrast: 1, fade: 0, saturate: 1, warmth: -0.2, vignette: 0 })
    expect(s.shadows).toEqual({ color: '#2a6080', amount: 0.5 })
  })

  it('非法写法返回错误说明', () => {
    expect(parseGrade('none')).toBeUndefined()
    expect(parseGrade('contrast 3')).toEqual({ error: expect.stringContaining('contrast') })
    expect(parseGrade('fade 0.1, lomo')).toEqual({ error: expect.stringContaining('第一项') })
    expect(parseGrade('shadows notacolor')).toEqual({ error: expect.stringContaining('颜色') })
    expect(parseGrade('sparkle 1')).toEqual({ error: expect.stringContaining('不认识') })
    expect(parseGrade('lomo,')).toEqual({ error: expect.stringContaining('逗号') })
  })
})

describe('applyGrade', () => {
  const frame = { x: 0, y: 0, width: 40, height: 40 }

  it('mono 输出灰色', () => {
    const data = solid(40, 40, [220, 60, 40])
    applyGrade(data, 40, 40, spec('mono'), frame)
    const [r, g, b] = px(data, 40, 20, 20)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2)
  })

  it('vignette 让四角变暗、中心不变', () => {
    const data = solid(40, 40, [200, 200, 200])
    applyGrade(data, 40, 40, spec('vignette 0.8'), frame)
    expect(px(data, 40, 20, 20)[0]).toBeGreaterThanOrEqual(198)
    expect(px(data, 40, 0, 0)[0]).toBeLessThan(80)
  })

  it('shadows 只改颜色，不改亮度', () => {
    const data = solid(40, 40, [70, 70, 70])
    const before = rgbToOklab(70, 70, 70)
    applyGrade(data, 40, 40, spec('shadows #1a3040'), frame)
    const [r, g, b] = px(data, 40, 20, 20)
    const after = rgbToOklab(r, g, b)
    expect(Math.abs(after.L - before.L)).toBeLessThan(0.01)
    expect(b).toBeGreaterThan(r + 10)
  })

  it('遮罩透明处像素和原图相同', () => {
    const data = solid(40, 40, [180, 90, 60])
    const mask = new Uint8ClampedArray(40 * 40 * 4)
    for (let y = 0; y < 40; y++) for (let x = 20; x < 40; x++) mask[(y * 40 + x) * 4 + 3] = 255
    applyGrade(data, 40, 40, spec('mono'), frame, mask)
    expect(px(data, 40, 5, 20)).toEqual([180, 90, 60])
    const [r, g, b] = px(data, 40, 30, 20)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2)
  })

  it('整体强度 0 不改像素', () => {
    const data = solid(4, 4, [10, 120, 230])
    applyGrade(data, 4, 4, spec('lomo 0'), { x: 0, y: 0, width: 4, height: 4 })
    expect(px(data, 4, 1, 1)).toEqual([10, 120, 230])
  })
})
