import { describe, expect, it } from 'vitest'
import {
  parseFlexShorthand,
  readFlexFactors,
  colorFilterToCss,
  cssFilterPad,
  parseOrigin,
  readOrigin,
  parseBackdropFilter,
  parseBlend,
  parseBlurRadius,
  parseBoxShadow,
  parseBorder,
  parseColorFilter,
  parseCornerRadii,
  parseEdges,
  readBorderStyle,
  readPaddingStyle,
  readRadiusStyle,
  diagnoseStyle,
  parseFontWeight,
  parseGlass,
  parseGlow,
  parseInkStroke,
  strokeTakesInk,
  parseNoise,
  parseOverlay,
  parseLetterSpacing,
  parsePx,
  parseShadow,
} from './style.js'

describe('style', () => {
  it('flex 简写和浏览器一样', () => {
    expect(parseFlexShorthand('1')).toEqual({ grow: 1, shrink: 1, basis: 0 })
    expect(parseFlexShorthand('auto')).toEqual({ grow: 1, shrink: 1, basis: 'auto' })
    expect(parseFlexShorthand('none')).toEqual({ grow: 0, shrink: 0, basis: 'auto' })
    expect(parseFlexShorthand('initial')).toEqual({ grow: 0, shrink: 1, basis: 'auto' })
    expect(parseFlexShorthand('2 3')).toEqual({ grow: 2, shrink: 3, basis: 0 })
    expect(parseFlexShorthand('1 40px')).toEqual({ grow: 1, shrink: 1, basis: 40 })
    expect(parseFlexShorthand('1 1 0')).toEqual({ grow: 1, shrink: 1, basis: 0 })
    expect(parseFlexShorthand('40px')).toEqual({ grow: 1, shrink: 1, basis: 40 })
    expect(parseFlexShorthand('1fr')).toBeNull()
    expect(readFlexFactors('flex-grow:2; flex:1; flex-shrink:0')).toEqual({ grow: 1, shrink: 0, basis: 0 })
  })

  it('origin 接受九宫格、像素和百分比', () => {
    expect(parseOrigin('top-left')).toEqual({
      x: { unit: 'percent', value: 0 },
      y: { unit: 'percent', value: 0 },
    })
    expect(parseOrigin('120 80')).toEqual({
      x: { unit: 'px', value: 120 },
      y: { unit: 'px', value: 80 },
    })
    expect(parseOrigin('30%, 40%')).toEqual({
      x: { unit: 'percent', value: 30 },
      y: { unit: 'percent', value: 40 },
    })
    expect(parseOrigin('top 80')).toEqual(parseOrigin('80 top'))
    expect(parseOrigin('center left')).toEqual(parseOrigin('left'))
    expect(parseOrigin('40')).toEqual({
      x: { unit: 'px', value: 40 },
      y: { unit: 'percent', value: 50 },
    })
    expect(parseOrigin(undefined).x).toEqual({ unit: 'percent', value: 50 })
    expect(readOrigin('left right').invalid).toBe(true)
    expect(readOrigin('nope').invalid).toBe(true)
    expect(readOrigin('').invalid).toBe(false)
  })

  it('parsePx', () => {
    expect(parsePx('12px')).toBe(12)
    expect(parsePx('12')).toBe(12)
  })

  it('parseLetterSpacing 接受 em，并按字号换算', () => {
    expect(parseLetterSpacing('0.5em', 40)).toBe(20)
    expect(parseLetterSpacing('2px', 40)).toBe(2)
    expect(parseLetterSpacing('normal', 40)).toBe(0)
    expect(parseLetterSpacing('-0.05em', 40)).toBeCloseTo(-2)
    expect(parseLetterSpacing('2%', 40)).toBeUndefined()
  })

  it('parseEdges', () => {
    expect(parseEdges('10 20 30 40')).toEqual({ top: 10, right: 20, bottom: 30, left: 40 })
  })

  it('parseBorder', () => {
    expect(parseBorder('2px solid #fff')).toEqual({ width: 2, color: '#fff' })
  })

  it('单边 padding、border 和分角圆角按声明顺序覆盖', () => {
    expect(parseCornerRadii('10px 20px 30px 40px')).toEqual({
      topLeft: 10,
      topRight: 20,
      bottomRight: 30,
      bottomLeft: 40,
    })
    expect(parseCornerRadii('8 0')).toEqual({ topLeft: 8, topRight: 0, bottomRight: 8, bottomLeft: 0 })
    expect(parseCornerRadii('12px / 4px')).toBeUndefined()
    expect(readPaddingStyle({ padding: '10px', 'padding-left': '24px' })).toEqual({
      top: 10,
      right: 10,
      bottom: 10,
      left: 24,
    })
    expect(readPaddingStyle({ 'padding-left': '24px', padding: '10px' }).left).toBe(10)
    expect(readBorderStyle({ 'border-left': '4px solid #c00' })).toEqual({
      top: { width: 0, color: '#000000' },
      right: { width: 0, color: '#000000' },
      bottom: { width: 0, color: '#000000' },
      left: { width: 4, color: '#c00' },
    })
    expect(readBorderStyle({ border: '2px solid #fff', 'border-bottom': 'none' })?.bottom.width).toBe(0)
    expect(readBorderStyle({ 'border-left': '6px solid #c00', border: '2px solid #fff' })?.left).toEqual({
      width: 2,
      color: '#fff',
    })
    expect(readRadiusStyle({ 'border-radius': '0', 'border-top-left-radius': '18px' })).toEqual({
      topLeft: 18,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    })
    expect(readRadiusStyle({ 'border-top-left-radius': '18px', 'border-radius': '4px' }).topLeft).toBe(4)
    expect(diagnoseStyle('padding-left', '12px')).toBeNull()
    expect(diagnoseStyle('border-left', '4px solid #c00')).toBeNull()
    expect(diagnoseStyle('border-top-left-radius', '16')).toBeNull()
    expect(diagnoseStyle('overflow', 'hidden')).toBeNull()
    expect(diagnoseStyle('border-radius', '16 16 0 0')).toBeNull()
    expect(diagnoseStyle('overflow', 'scroll')).toEqual({ hint: expect.stringContaining('hidden') })
  })

  it('parseFontWeight', () => {
    expect(parseFontWeight('bold')).toBe(700)
  })

  it('parseBlurRadius / noise / blend / filter', () => {
    expect(parseBlurRadius('12px')).toBe(12)
    expect(parseBlurRadius('-1')).toBeUndefined()
    expect(parseNoise('0.08 #ffffff')).toEqual({ amount: 0.08, color: '#ffffff' })
    expect(parseNoise('0.08 #ffffff @t')).toEqual({ amount: 0.08, color: '#ffffff', animate: true })
    expect(parseNoise('0.06 @t')).toEqual({ amount: 0.06, animate: true })
    expect(parseNoise('2')).toBeUndefined()
    expect(parseNoise('0.08 @t @t')).toBeUndefined()
    expect(parseBlend('multiply')).toBe('multiply')
    expect(parseBlend('hard-light')).toBeUndefined()
    expect(parseColorFilter('brightness(1.1) hue-rotate(15deg) grayscale(50%)')).toEqual([
      { name: 'brightness', value: 1.1 },
      { name: 'hue-rotate', value: 15 },
      { name: 'grayscale', value: 0.5 },
    ])
    expect(parseColorFilter('blur(4px)')).toEqual([{ name: 'blur', value: 4 }])
    expect(parseColorFilter('opacity(50%) drop-shadow(0 8px 16px rgba(0, 0, 0, 0.4))')).toEqual([
      { name: 'opacity', value: 0.5 },
      { name: 'drop-shadow', x: 0, y: 8, blur: 16, color: 'rgba(0, 0, 0, 0.4)' },
    ])
    expect(parseColorFilter('drop-shadow(#000 2px 3px)')).toEqual([
      { name: 'drop-shadow', x: 2, y: 3, blur: 0, color: '#000' },
    ])
    expect(parseColorFilter('drop-shadow(0 8px)')).toEqual([{ name: 'drop-shadow', x: 0, y: 8, blur: 0 }])
    expect(parseColorFilter('url(#a)')).toBeUndefined()
    expect(parseColorFilter('drop-shadow(inset 0 4px 8px #000)')).toBeUndefined()
    expect(colorFilterToCss([{ name: 'hue-rotate', value: 15 }])).toBe('hue-rotate(15deg)')
    expect(
      colorFilterToCss(
        [
          { name: 'blur', value: 4 },
          { name: 'drop-shadow', x: 1, y: -2, blur: 3, color: '#fff' },
        ],
        2,
      ),
    ).toBe('blur(8px) drop-shadow(2px -4px 6px #fff)')
    expect(
      cssFilterPad([
        { name: 'blur', value: 4 },
        { name: 'drop-shadow', x: 0, y: 10, blur: 3 },
      ]),
    ).toBe(24)
    expect(parseShadow('0 8 #00000055')).toEqual({ x: 0, y: 8, blur: 0, spread: 0, color: '#00000055' })
    expect(parseBoxShadow('0 8px 16px #00000055')).toEqual({
      outer: [{ x: 0, y: 8, blur: 16, spread: 0, color: '#00000055' }],
      inset: [],
    })
    expect(parseBoxShadow('inset 0 4px 8px rgba(0, 0, 0, 0.4), 0 12px 24px #000')).toEqual({
      outer: [{ x: 0, y: 12, blur: 24, spread: 0, color: '#000' }],
      inset: [{ x: 0, y: 4, blur: 8, spread: 0, color: 'rgba(0, 0, 0, 0.4)' }],
    })
    expect(parseBoxShadow('#000 0 8px')).toEqual({
      outer: [{ x: 0, y: 8, blur: 0, spread: 0, color: '#000' }],
      inset: [],
    })
    expect(parseBoxShadow('4px')).toBeUndefined()
    expect(parseBackdropFilter('blur(16px) brightness(1.1) hue-rotate(15deg)')).toEqual([
      { name: 'blur', value: 16 },
      { name: 'brightness', value: 1.1 },
      { name: 'hue-rotate', value: 15 },
    ])
    expect(parseBackdropFilter('drop-shadow(0 8px 16px #000)')).toEqual([
      { name: 'drop-shadow', x: 0, y: 8, blur: 16, color: '#000' },
    ])
    expect(parseBackdropFilter('url(#a)')).toBeUndefined()
    expect(parseBackdropFilter('none')).toBeUndefined()
    expect(parseGlow('48px #f6f1e7')).toEqual({ blur: 48, spread: 0, color: '#f6f1e7' })
    expect(parseInkStroke('6 #000 outside')).toEqual([{ width: 6, color: '#000', position: 'outside' }])
    expect(parseInkStroke('6px #fff, 14 #f00 inside')).toEqual([
      { width: 6, color: '#fff', position: 'outside' },
      { width: 14, color: '#f00', position: 'inside' },
    ])
    expect(parseInkStroke('8 linear-gradient(to bottom, #fff, #000) center')).toEqual([
      { width: 8, color: 'linear-gradient(to bottom, #fff, #000)', position: 'center' },
    ])
    expect(parseInkStroke('none')).toBeUndefined()
    expect(parseInkStroke('0 #000')).toBeUndefined()
    expect(parseInkStroke('6 outside')).toBeUndefined()
    expect(parseInkStroke('#fff')).toBeUndefined()
    expect(strokeTakesInk('6 #000 outside')).toBe(true)
    expect(strokeTakesInk('6 outside')).toBe(true)
    expect(strokeTakesInk('#fff')).toBe(false)
    expect(strokeTakesInk('none')).toBe(false)
    expect(parseGlass('thick')).toMatchObject({ variant: 'thick', blur: 36, refraction: 0.5 })
    expect(parseGlass('clear')).toMatchObject({ variant: 'clear', blur: 0, refraction: 1 })
    expect(parseGlass('24 #ffffff33')).toBeUndefined()
    expect(parseGlass('clear 0 #a8c8ff20')).toBeUndefined()
    expect(parseGlass('0')).toBeUndefined()
    expect(parseGlass('regular, blur 24, tint #ffffff33')).toMatchObject({ variant: 'regular', blur: 24, tint: '#ffffff33' })
    expect(parseGlass('nope')).toBeUndefined()
    expect(parseGlass('clear, blur 8, tint #fff2')).toMatchObject({
      variant: 'clear',
      blur: 8,
      tint: '#fff2',
      refraction: 1,
    })
    expect(parseGlass('thick, refraction 0.4')).toMatchObject({ variant: 'thick', blur: 36, refraction: 0.4 })
    expect(parseGlass('clear,')).toBeUndefined()
    expect(parseGlass('blur 4, nope 1')).toBeUndefined()
  })

  it('parseOverlay：纯色 / 渐变 + opacity + blend', () => {
    expect(parseOverlay('#00000066')).toEqual({ paint: '#00000066', opacity: 1, blend: 'source-over' })
    expect(parseOverlay('#ff8800 0.4 multiply')).toEqual({
      paint: '#ff8800',
      opacity: 0.4,
      blend: 'multiply',
    })
    expect(parseOverlay('multiply 50% #112233')).toBeUndefined()
    expect(parseOverlay('#112233 multiply 50%')).toEqual({
      paint: '#112233',
      opacity: 0.5,
      blend: 'multiply',
    })
    expect(parseOverlay('#112233 50% multiply')).toEqual({
      paint: '#112233',
      opacity: 0.5,
      blend: 'multiply',
    })
    expect(parseOverlay('linear-gradient(to bottom, #fff0, #0008) soft-light')).toEqual({
      paint: 'linear-gradient(to bottom, #fff0, #0008)',
      opacity: 1,
      blend: 'soft-light',
    })
    expect(parseOverlay('multiply')).toBeUndefined()
    expect(parseOverlay('nope 2')).toBeUndefined()
    expect(parseOverlay('none')).toBeUndefined()
  })
})
