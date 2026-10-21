import { describe, expect, it } from 'vitest'
import { translateSvgPath } from './path.js'

describe('translateSvgPath', () => {
  it('绝对命令平移，相对命令不动', () => {
    expect(translateSvgPath('M 80 90 L 140 90', -80, -90)).toBe('M 0 0 L 60 0')
    expect(translateSvgPath('M 80 90 l 40 10', -80, -90)).toBe('M 0 0 l 40 10')
  })

  it('弧线只移动终点', () => {
    expect(translateSvgPath('M 10 10 A 20 20 0 0 1 50 30', -10, -10)).toBe('M 0 0 A 20 20 0 0 1 40 20')
  })

  it('水平和垂直命令按各自的轴移动', () => {
    expect(translateSvgPath('M 10 20 H 40 V 50', -10, -20)).toBe('M 0 0 H 30 V 30')
  })
})
