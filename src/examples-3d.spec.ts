import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadLayerFile } from './load-source.js'
import { renderLayer } from './render.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const examples = join(root, 'examples')

/** Root-level `background`, so a painted pixel can be told from the empty sheet. */
function background(source: string): [number, number, number] {
  const root = /<layer\b[^>]*>/.exec(source)?.[0] ?? ''
  const hex = /background="#([0-9a-fA-F]{6})"/.exec(root)?.[1]
  if (!hex) return [255, 255, 255]
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

function paintedPixels(rgba: Uint8ClampedArray | Uint8Array, bg: [number, number, number]): number {
  let painted = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < 250) {
      painted++
      continue
    }
    const d = Math.max(
      Math.abs(rgba[i]! - bg[0]),
      Math.abs(rgba[i + 1]! - bg[1]),
      Math.abs(rgba[i + 2]! - bg[2]),
    )
    if (d > 8) painted++
  }
  return painted
}

const cameraLayers = readdirSync(examples)
  .filter((name) => name.endsWith('.layer'))
  .filter((name) => /camera=/.test(readFileSync(join(examples, name), 'utf8')))
  .sort()
const cameraTsx = readdirSync(examples)
  .filter((name) => name.endsWith('.tsx'))
  .filter((name) => /camera=/.test(readFileSync(join(examples, name), 'utf8')))
  .sort()

describe('带 camera 的 examples', () => {
  it('每个都真的画出内容，不是一张空背景', async () => {
    expect(cameraLayers.length).toBeGreaterThanOrEqual(12)
    expect(cameraTsx.length).toBeGreaterThanOrEqual(3)
    const empty: string[] = []
    for (const name of cameraLayers) {
      const source = readFileSync(join(examples, name), 'utf8')
      const painted = await renderLayer(source, { baseDir: examples, format: 'rgba', meshCache: false })
      const errors = painted.report.issues.filter((issue) => issue.level === 'error')
      const paintedCount = paintedPixels(painted.rgba, background(source))
      const share = paintedCount / (painted.width * painted.height)
      if (errors.length > 0 || share < 0.02) {
        empty.push(`${name}: ${errors.map((issue) => issue.code).join(', ') || `${(share * 100).toFixed(1)}% painted`}`)
      }
    }
    for (const name of cameraTsx) {
      const file = join(examples, name)
      const loaded = await loadLayerFile(file)
      if (loaded.kind !== 'node') throw new Error(`${name} 没有导出一个 layer`)
      const source = readFileSync(file, 'utf8')
      const painted = await renderLayer(loaded.node, { baseDir: dirname(file), format: 'rgba', meshCache: false })
      const errors = painted.report.issues.filter((issue) => issue.level === 'error')
      const paintedCount = paintedPixels(painted.rgba, background(source))
      const share = paintedCount / (painted.width * painted.height)
      if (errors.length > 0 || share < 0.02) {
        empty.push(`${name}: ${errors.map((issue) => issue.code).join(', ') || `${(share * 100).toFixed(1)}% painted`}`)
      }
    }
    expect(empty).toEqual([])
  }, 120000)

  it('中灰实体在 camera 下保持中性，没有整体偏色', async () => {
    // A cast would come from sRGB bytes entering the linear accumulator. A gray
    // fill must come back gray on every finish the kernel can reach.
    const source = (material: string) =>
      `<layer width="240" height="180" background="#f4f1ea" camera="fov 30, orbit 28 26, distance 900, at 120 96 0"><sphere cx="120" cy="90" r="46" fill="#808080"${material} /></layer>`
    for (const material of ['', ' material="matte"', ' material="clay"', ' material="plastic 0.5"', ' material="metal 0.9"', ' material="metal"', ' material="brushed"', ' material="mirror"']) {
      const painted = await renderLayer(source(material), { format: 'rgba', meshCache: false })
      const bg: [number, number, number] = [244, 241, 234]
      let n = 0
      let r = 0
      let g = 0
      let b = 0
      let chroma = 0
      for (let i = 0; i < painted.rgba.length; i += 4) {
        if (Math.abs(painted.rgba[i]! - bg[0]) < 5 && Math.abs(painted.rgba[i + 1]! - bg[1]) < 5 && Math.abs(painted.rgba[i + 2]! - bg[2]) < 6) continue
        n++
        r += painted.rgba[i]!
        g += painted.rgba[i + 1]!
        b += painted.rgba[i + 2]!
        const mx = Math.max(painted.rgba[i]!, painted.rgba[i + 1]!, painted.rgba[i + 2]!)
        const mn = Math.min(painted.rgba[i]!, painted.rgba[i + 1]!, painted.rgba[i + 2]!)
        chroma += (mx - mn) / Math.max(1, mx)
      }
      expect(n, material || 'flat').toBeGreaterThan(200)
      // Dielectrics come back at 0.002. Metal reflects the studio key, which is
      // warm by design, so its ceiling is 0.04 rather than 0.02.
      expect(chroma / n, material || 'flat').toBeLessThanOrEqual(0.04)
      // What a global cast actually looks like: the mean of a gray surface
      // drifts toward one channel. This stays within 4/255 on every finish.
      expect(Math.max(r, g, b) / n - Math.min(r, g, b) / n, material || 'flat').toBeLessThanOrEqual(4)
    }
  }, 60000)
})
