import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkLayer } from 'flexlayer'
import { describe, expect, it } from 'vitest'
import { runSelect } from './cli.js'
import { layers } from './layers.js'
import { writePng } from './pixels.js'

function paint(file: string) {
  const width = 48
  const height = 36
  const rgba = new Uint8ClampedArray(width * height * 4)
  const depth = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inTower = x >= 18 && x <= 30 && y >= 8 && y <= 24
      const ground = y >= 26
      const o = (y * width + x) * 4
      rgba[o] = inTower ? 220 : 16
      rgba[o + 1] = inTower ? 160 : 18
      rgba[o + 2] = inTower ? 40 : 28
      rgba[o + 3] = 255
      depth[y * width + x] = inTower ? 140 : ground ? 220 : y >= 14 ? 48 : 0
    }
  }
  writePng(file, rgba, width, height)
  return depth
}

describe('layers', () => {
  it('写出主体、净背景和天际线', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-layers-'))
    const src = join(dir, 'photo.png')
    const depth = paint(src)
    const result = await layers(src, { depth: () => depth })
    expect(result.flat).toBe(false)
    const scene = JSON.parse(readFileSync(result.scene, 'utf8')) as { srcHash: string; skyline: number[]; spire: { x: number; y: number }; flat: boolean }
    expect(scene.flat).toBe(false)
    expect(scene.skyline).toHaveLength(48)
    expect(scene.skyline[24]).toBeLessThan(12)
    expect(scene.spire.x).toBeGreaterThan(17)
    expect(scene.srcHash).toBe(createHash('sha256').update(readFileSync(src)).digest('hex'))
    const meta = JSON.parse(readFileSync(result.meta, 'utf8')) as { tool: string; preset: string }
    expect(meta.tool).toBe('layers')
    expect(meta.preset).toBe('layers')
    expect(result.markup).toContain('photo.subject.png')
    expect(result.markup).toContain('id="subject"')
    const report = await checkLayer(result.markup, { baseDir: dir })
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
  })

  it('命令行把标题夹进两层之间', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-layers-cli-'))
    const src = join(dir, 'photo.png')
    const depth = paint(src)
    const logs: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
    try {
      await runSelect(['layers', src, '--title', '塔', '--cover', '0.2'], { depth: () => depth })
    } finally {
      console.log = log
    }
    const text = logs.join('\n')
    expect(text).toContain('塔')
    expect(text).toContain('layers 2')
    const layer = readFileSync(join(dir, 'photo.layers.layer'), 'utf8')
    expect(layer).toContain('<h1')
    expect(layer).toContain('photo.subject.png')
    const report = await checkLayer(layer, { baseDir: dir })
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
  })
})
