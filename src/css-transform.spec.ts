import { describe, expect, it } from 'vitest'
import { apply, cssMotionMatrix } from './matrix.js'
import { renderLayer } from './render.js'
import { diagnoseStyle, parseAngle, parseCssTransform } from './style.js'
import type { CssMotion } from './types.js'

function page(style: string, extra = '') {
  return `<layer width="200" height="160" background="#000000"><div style="width:80px; height:20px; background:#ffffff; ${style}"${extra}></div></layer>`
}

describe('parseAngle', () => {
  it('接受 deg、rad、grad、turn，0 可以不带单位', () => {
    expect(parseAngle('30deg')).toEqual({ degrees: 30, unitless: false })
    expect(parseAngle('-45deg')?.degrees).toBe(-45)
    expect(parseAngle('0.5rad')?.degrees).toBeCloseTo((0.5 * 180) / Math.PI)
    expect(parseAngle('100grad')?.degrees).toBeCloseTo(90)
    expect(parseAngle('0.25turn')?.degrees).toBeCloseTo(90)
    expect(parseAngle('0')).toEqual({ degrees: 0, unitless: true })
    expect(parseAngle('0deg')).toEqual({ degrees: 0, unitless: false })
    expect(parseAngle('none')).toEqual({ degrees: 0, unitless: false })
    expect(parseAngle('30')).toEqual({ degrees: 30, unitless: true })
    expect(parseAngle('30px')).toBeUndefined()
  })

  it('transform 里的 rotate() 不接受不带单位的非 0 角度', () => {
    expect(parseCssTransform('rotate(30)')).toEqual({ ok: false })
    expect(parseCssTransform('rotate(0)')).toEqual({ ok: true, steps: [{ op: 'rotate', degrees: 0 }] })
    expect(parseCssTransform('translate(10px, 0) rotate(30deg) scale(1.2)').ok).toBe(true)
    expect(parseCssTransform('skew(10deg)')).toEqual({ ok: false })
    expect(parseCssTransform('none')).toEqual({ ok: true, steps: [] })
    expect(diagnoseStyle('rotate', '30deg')).toBeNull()
    expect(diagnoseStyle('rotate', '30')).toBeNull()
    expect(diagnoseStyle('rotate', '30px')).toEqual({ hint: expect.stringContaining('30deg') })
    expect(diagnoseStyle('transform', 'rotate(30deg)')).toBeNull()
    expect(diagnoseStyle('transform-origin', '0 0')).toBeNull()
  })
})

describe('css motion matrix', () => {
  it('translate 在 rotate 之后作用到点上，和 CSS 从左到右的写法一致', () => {
    const motion: CssMotion = {
      translateX: { unit: 'px', value: 0 },
      translateY: { unit: 'px', value: 0 },
      rotate: 0,
      scaleX: 1,
      scaleY: 1,
      steps: [
        { op: 'translate', x: { unit: 'px', value: 10 }, y: { unit: 'px', value: 0 } },
        { op: 'rotate', degrees: 30 },
      ],
    }
    const origin = { x: { unit: 'px' as const, value: 0 }, y: { unit: 'px' as const, value: 0 } }
    const [x, y] = apply(cssMotionMatrix(motion, origin, 80, 20), 1, 0)
    const rad = (30 * Math.PI) / 180
    expect(x).toBeCloseTo(10 + Math.cos(rad))
    expect(y).toBeCloseTo(Math.sin(rad))
  })
})

describe('css rotate render', () => {
  it('30deg、等值 rad、等值 turn 和 transform:rotate 画在同一处', async () => {
    const rad = String(Math.PI / 6)
    const turn = String(30 / 360)
    const deg = await renderLayer(page('rotate: 30deg'))
    const fromRad = await renderLayer(page(`rotate: ${rad}rad`))
    const fromTurn = await renderLayer(page(`rotate: ${turn}turn`))
    const fromTransform = await renderLayer(page('transform: rotate(30deg)'))
    const bare = await renderLayer(page('rotate: 30'))
    expect(fromTransform.png.equals(deg.png)).toBe(true)
    expect(bare.png.equals(deg.png)).toBe(true)
    const degInk = deg.report.elements.find((el) => el.tag === 'div')!.ink
    for (const report of [fromRad.report, fromTurn.report]) {
      const ink = report.elements.find((el) => el.tag === 'div')!.ink
      expect(ink.x).toBeCloseTo(degInk.x, 1)
      expect(ink.y).toBeCloseTo(degInk.y, 1)
      expect(ink.width).toBeCloseTo(degInk.width, 1)
      expect(ink.height).toBeCloseTo(degInk.height, 1)
    }
    expect(parseAngle(`${rad}rad`)!.degrees).toBeCloseTo(30, 6)
    expect(parseAngle(`${turn}turn`)!.degrees).toBeCloseTo(30, 6)
    expect(parseAngle('0.5236rad')!.degrees).toBeCloseTo(30, 1)
    expect(parseAngle('0.0833turn')!.degrees).toBeCloseTo(30, 1)
    const approx = await renderLayer(page('rotate: 0.5236rad'))
    const approxInk = approx.report.elements.find((el) => el.tag === 'div')!.ink
    expect(approxInk.x).toBeCloseTo(degInk.x, 0)
    expect(approxInk.y).toBeCloseTo(degInk.y, 0)
  })

  it('rotate: 30 出图，并只有一条兼容警告', async () => {
    const result = await renderLayer(page('rotate: 30'))
    const compat = result.report.issues.filter((issue) => issue.code === 'non-canonical')
    expect(compat).toHaveLength(1)
    expect(compat[0]?.message).toContain('30')
    expect(compat[0]?.hint).toContain('30deg')
    expect(result.report.issues.some((issue) => issue.code === 'invalid-attr')).toBe(false)
    expect(result.png.length).toBeGreaterThan(8)
  })

  it('rotate: 0 不警告，30px 警告并当成没有旋转', async () => {
    const zero = await renderLayer(page('rotate: 0'))
    expect(zero.report.issues.filter((issue) => issue.code === 'non-canonical' || issue.code === 'invalid-attr')).toEqual([])
    const bad = await renderLayer(page('rotate: 30px'))
    const plain = await renderLayer(page(''))
    expect(bad.report.issues.filter((issue) => issue.code === 'invalid-attr')).toHaveLength(1)
    expect(bad.png.equals(plain.png)).toBe(true)
  })

  it('transform-origin: 0 0 绕左上角，布局盒不变', async () => {
    const bar = (origin: string) =>
      `<layer width="200" height="160" background="#000000"><div style="display:flex; padding:40px"><div style="display:flex; width:80px; height:20px; background:#ffffff; rotate:90deg; ${origin}"><div style="width:80px; height:20px; background:#ffffff"></div></div></div></layer>`
    const centered = await renderLayer(bar(''))
    const corner = await renderLayer(bar('transform-origin: 0 0'))
    const spun = corner.report.elements.find((el) => el.tag === 'div' && el.box.width === 80)!
    expect(spun.box.width).toBe(80)
    expect(spun.box.height).toBe(20)
    expect(spun.ink.width).toBeCloseTo(20, 3)
    expect(spun.ink.height).toBeCloseTo(80, 3)
    expect(spun.ink.x).toBeCloseTo(spun.box.x - 20, 3)
    expect(spun.ink.y).toBeCloseTo(spun.box.y, 3)
    const centerBar = centered.report.elements.find((el) => el.tag === 'div' && el.box.width === 80)!
    expect(centerBar.box.x).toBeCloseTo(spun.box.x, 3)
    expect(centerBar.ink.x).not.toBeCloseTo(spun.ink.x, 0)
  })

  it('旋转不推动 flex 里的下一个兄弟', async () => {
    const result = await renderLayer(
      `<layer width="200" height="80" background="#000000"><div style="display:flex"><div style="width:40px; height:20px; background:#ffffff; rotate:90deg"></div><div style="width:40px; height:20px; background:#ffffff"></div></div></layer>`,
    )
    const bars = result.report.elements.filter((el) => el.tag === 'div' && el.box.width === 40)
    expect(bars.map((el) => el.box.x)).toEqual([0, 40])
    expect(bars[0]?.box.width).toBe(40)
    expect(bars[0]?.box.height).toBe(20)
  })

  it('属性 rotate="30" 不发出兼容警告', async () => {
    const result = await renderLayer(
      `<layer width="120" height="80" background="#000000"><rect x="20" y="20" width="60" height="20" fill="#ffffff" rotate="30" /></layer>`,
    )
    expect(result.report.issues.filter((issue) => issue.code === 'non-canonical')).toEqual([])
    const rect = result.report.elements.find((el) => el.tag === 'rect')!
    expect(rect.ink.width).toBeGreaterThan(rect.box.width)
  })

  it('layer 和形状上的 rotate 接受 deg、rad、turn，写错的单位要报并且不转', async () => {
    const layer = (rotate: string) =>
      `<layer width="200" height="160" background="#000000" rotate="${rotate}"><rect x="70" y="70" width="60" height="20" fill="#ffffff" /></layer>`
    const shape = (rotate: string) =>
      `<layer width="200" height="160" background="#000000"><rect x="70" y="70" width="60" height="20" fill="#ffffff" rotate="${rotate}" /></layer>`
    const bare = await renderLayer(layer('30'))
    const deg = await renderLayer(layer('30deg'))
    const rad = await renderLayer(layer(`${Math.PI / 6}rad`))
    const turn = await renderLayer(layer(`${30 / 360}turn`))
    expect(deg.png.equals(bare.png)).toBe(true)
    expect(rad.png.equals(bare.png)).toBe(true)
    expect(turn.png.equals(bare.png)).toBe(true)
    expect(deg.report.issues.filter((issue) => issue.code === 'invalid-attr' || issue.code === 'non-canonical')).toEqual([])
    const shapeDeg = await renderLayer(shape('30deg'))
    const shapeBare = await renderLayer(shape('30'))
    expect(shapeDeg.png.equals(shapeBare.png)).toBe(true)
    const tilt = await renderLayer(shape('90deg'))
    const tiltTurn = await renderLayer(shape('0.25turn'))
    expect(tiltTurn.png.equals(tilt.png)).toBe(true)
    const bad = await renderLayer(layer('30px'))
    const plain = await renderLayer(layer('0'))
    const hit = bad.report.issues.filter((issue) => issue.code === 'invalid-attr')
    expect(hit).toHaveLength(1)
    expect(hit[0]?.message).toContain('rotate')
    expect(hit[0]?.hint).toContain('30deg')
    expect(bad.png.equals(plain.png)).toBe(true)
  })

  it('写错的 transform 被忽略，渲染不中断', async () => {
    const bad = await renderLayer(page('transform: rotate(30px)'))
    const plain = await renderLayer(page(''))
    expect(bad.report.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('transform'))).toBe(true)
    expect(bad.png.equals(plain.png)).toBe(true)
    await expect(renderLayer(page('transform: translate(10px, 0) rotate(30deg)'))).resolves.toEqual(
      expect.objectContaining({ png: expect.any(Buffer) }),
    )
  })
})
