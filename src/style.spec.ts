import { describe, expect, it } from 'vitest'
import {
  colorFilterToCss,
  parseBlend,
  parseBlurRadius,
  parseBorder,
  parseColorFilter,
  parseEdges,
  parseFontWeight,
  parseGlass,
  parseGlow,
  parseInkStroke,
  parseNoise,
  parseOverlay,
  parsePx,
  parseShadow,
} from './style.js'

describe('style', () => {
  it('parsePx', () => {
    expect(parsePx('12px')).toBe(12)
    expect(parsePx('12')).toBe(12)
  })

  it('parseEdges', () => {
    expect(parseEdges('10 20 30 40')).toEqual({ top: 10, right: 20, bottom: 30, left: 40 })
  })

  it('parseBorder', () => {
    expect(parseBorder('2px solid #fff')).toEqual({ width: 2, color: '#fff' })
  })

  it('parseFontWeight', () => {
    expect(parseFontWeight('bold')).toBe(700)
  })

  it('parseBlurRadius / noise / blend / filter', () => {
    expect(parseBlurRadius('12px')).toBe(12)
    expect(parseBlurRadius('-1')).toBeUndefined()
    expect(parseNoise('0.08 #ffffff')).toEqual({ amount: 0.08, color: '#ffffff' })
    expect(parseNoise('2')).toBeUndefined()
    expect(parseBlend('multiply')).toBe('multiply')
    expect(parseBlend('hard-light')).toBeUndefined()
    expect(parseColorFilter('brightness(1.1) hue-rotate(15deg) grayscale(50%)')).toEqual([
      { name: 'brightness', value: 1.1 },
      { name: 'hue-rotate', value: 15 },
      { name: 'grayscale', value: 0.5 },
    ])
    expect(parseColorFilter('blur(4px)')).toBeUndefined()
    expect(colorFilterToCss([{ name: 'hue-rotate', value: 15 }])).toBe('hue-rotate(15deg)')
    expect(parseShadow('0 8 #00000055')).toEqual({ x: 0, y: 8, blur: 0, spread: 0, color: '#00000055' })
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
    expect(parseGlass('thick')).toMatchObject({ variant: 'thick', blur: 36, refraction: 0.5 })
    expect(parseGlass('clear')).toMatchObject({ variant: 'clear', blur: 0, refraction: 1 })
    expect(parseGlass('24 #ffffff33')).toMatchObject({ variant: 'regular', blur: 24, tint: '#ffffff33' })
    expect(parseGlass('clear 0 #a8c8ff20')).toMatchObject({ variant: 'clear', blur: 0, tint: '#a8c8ff20' })
    expect(parseGlass('0')).toMatchObject({ variant: 'regular', blur: 0 })
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
