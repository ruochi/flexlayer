import { describe, expect, it } from 'vitest'
import {
  ANIM_GATES,
  bevelPop,
  contactEdgeJitter,
  temporalFlicker,
  temporalFlip,
} from '../scripts/anim-metrics.mjs'

/**
 * The animation metrics have to fail on the defect they name, or a green gate
 * means nothing. Each test builds the smallest frame sequence that shows the
 * defect and checks the metric sees it, then the stable sequence and checks it
 * does not.
 */

type Frame = { Y: Float32Array; width: number; height: number; rgba?: Uint8ClampedArray }

const W = 24
const H = 16

/** A frame of flat grey with a horizontal edge at `edgeY`. */
function edgeFrame(edgeY: number, top = 220, bottom = 60): Frame {
  const Y = new Float32Array(W * H)
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      Y[p] = y < edgeY ? top : bottom
      rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = Y[p]!
      rgba[p * 4 + 3] = 255
    }
  }
  return { Y, width: W, height: H, rgba }
}

/** A flat frame whose brightness changes with `value`. */
function flatFrame(value: number): Frame {
  const Y = new Float32Array(W * H).fill(value)
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let p = 0; p < W * H; p++) {
    rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = value
    rgba[p * 4 + 3] = 255
  }
  return { Y, width: W, height: H, rgba }
}

describe('temporalFlicker', () => {
  it('sees a flat patch that toggles and reports its share', () => {
    // The whole frame is flat, and it alternates. Every pixel is a flicker.
    const frames = [flatFrame(100), flatFrame(140), flatFrame(100), flatFrame(140)]
    const r = temporalFlicker(frames)
    expect(r.count).toBeGreaterThan(0)
    expect(r.share).toBeGreaterThan(ANIM_GATES.temporalFlickerMax)
  })

  it('ignores an edge that slides, which is motion and not flicker', () => {
    // A hard edge crossing a pixel and coming back — the aliasing a moving
    // camera produces. The pixel reverses twice, so the raw count sees it, but
    // the neighbourhood is never flat, so the flicker count does not.
    const frames = [edgeFrame(6), edgeFrame(7), edgeFrame(6), edgeFrame(7)]
    expect(temporalFlip(frames).count).toBeGreaterThan(0)
    expect(temporalFlicker(frames).count).toBe(0)
  })

  it('scores a static sequence at zero', () => {
    const frames = [edgeFrame(6), edgeFrame(6), edgeFrame(6), edgeFrame(6)]
    expect(temporalFlicker(frames).share).toBe(0)
  })
})

describe('contactEdgeJitter', () => {
  // A body is found by fill colour; make a red one.
  const RED = { name: 'body', test: (r: number, g: number, b: number) => r > 120 && r - g > 60 && r - b > 60 }

  function bodyFrame(edgeY: number): Frame {
    const Y = new Float32Array(W * H)
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x
        // Rows 0..edgeY-1 are the red body, below is dark shadow then floor.
        if (y < edgeY) {
          rgba[p * 4] = 200
          rgba[p * 4 + 1] = 40
          rgba[p * 4 + 2] = 40
          Y[p] = 90
        } else {
          rgba[p * 4] = 231
          rgba[p * 4 + 1] = 224
          rgba[p * 4 + 2] = 212
          Y[p] = y < edgeY + 3 ? 40 : 220
        }
        rgba[p * 4 + 3] = 255
      }
    }
    return { Y, width: W, height: H, rgba }
  }

  it('scores a contact edge that slides smoothly at nearly zero', () => {
    const frames = [bodyFrame(6), bodyFrame(7), bodyFrame(8), bodyFrame(9)]
    const r = contactEdgeJitter(frames, [RED])
    expect(r.worst).toBeLessThan(0.5)
  })

  it('sees an edge that jumps back and forth', () => {
    const frames = [bodyFrame(6), bodyFrame(9), bodyFrame(6), bodyFrame(9)]
    const r = contactEdgeJitter(frames, [RED])
    expect(r.worst).toBeGreaterThan(ANIM_GATES.contactJitterMax)
  })
})

describe('bevelPop', () => {
  const WINDOW = { x0: 4, x1: 20, y0: 3, y1: 12 }

  function bevelFrame(bright: boolean): Frame {
    const Y = new Float32Array(W * H).fill(60)
    const rgba = new Uint8ClampedArray(W * H * 4)
    if (bright) for (let x = 4; x <= 20; x++) Y[7 * W + x] = 140
    for (let p = 0; p < W * H; p++) {
      rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = Y[p]!
      rgba[p * 4 + 3] = 255
    }
    return { Y, width: W, height: H, rgba }
  }

  it('counts a bevel that appears and disappears', () => {
    const frames = [bevelFrame(false), bevelFrame(true), bevelFrame(false), bevelFrame(true)]
    expect(bevelPop(frames, WINDOW).flips).toBeGreaterThan(ANIM_GATES.bevelPopMax)
  })

  it('does not count a bevel that stays put', () => {
    const frames = [bevelFrame(true), bevelFrame(true), bevelFrame(true)]
    expect(bevelPop(frames, WINDOW).flips).toBe(0)
  })
})
