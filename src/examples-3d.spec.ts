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

describe('材质粗糙度', () => {
  /**
   * Bright-highlight area on the finish cell's sphere, at a fixed luma cut. The
   * cell is the gallery one because the finish only reads under the lamp there:
   * a bare sphere on paper is flat at every roughness, so the comparison has to
   * run on the lit scene.
   */
  async function highlight(cell: string): Promise<number> {
    const source = readFileSync(join(root, 'docs', 'gallery', '3d', `${cell}.layer`), 'utf8')
    const painted = await renderLayer(source, { baseDir: join(root, 'docs', 'gallery', '3d'), format: 'rgba', meshCache: false })
    const ink = painted.report?.elements?.find((el) => el.tag === 'sphere')?.ink
    if (!ink) return 0
    let area = 0
    for (let y = Math.ceil(ink.y); y < Math.floor(ink.y + ink.height); y++) {
      for (let x = Math.ceil(ink.x); x < Math.floor(ink.x + ink.width); x++) {
        const i = (y * painted.width + x) * 4
        const luma = 0.2126 * painted.rgba[i]! + 0.7152 * painted.rgba[i + 1]! + 0.0722 * painted.rgba[i + 2]!
        if (luma >= 200) area += 1
      }
    }
    return area
  }

  // A rougher finish spreads its highlight over more pixels: the specular lobe
  // widens and dims, so a fixed cut sees a bigger patch. If roughness only moved
  // the peak brightness the pairs would be indistinguishable at a glance, which
  // is what the gallery review reported.
  it('plastic 的高光面积随粗糙度增大', async () => {
    expect(await highlight('3d-mat-plastic-0-85')).toBeGreaterThan(await highlight('3d-mat-plastic-0-12'))
  }, 60000)

  it('metal 的高光面积随粗糙度增大', async () => {
    expect(await highlight('3d-mat-metal-0-8')).toBeGreaterThan(await highlight('3d-mat-metal-0-08'))
  }, 60000)

  it('glass 的高光面积随粗糙度增大', async () => {
    expect(await highlight('3d-mat-glass-0-72')).toBeGreaterThan(await highlight('3d-mat-glass-0-06'))
  }, 60000)
})

describe('brushed 的条纹', () => {
  it('盒面上有一组密集的平行细纹', async () => {
    // Q5: stripes used to be sampled along the sphere's local y at frequency
    // 0.12, which on a sphere is latitude: the finish came out as a few broad
    // concentric rings and read as wood grain. Sampling across the brush
    // direction at 0.55 gives many narrow bands, so a scan across a box face
    // crosses far more light/dark alternations than the old finish did.
    const source = readFileSync(join(root, 'docs', 'gallery', '3d', '3d-mat-brushed.layer'), 'utf8')
    const painted = await renderLayer(source, { baseDir: join(root, 'docs', 'gallery', '3d'), format: 'rgba', meshCache: false })
    const ink = painted.report?.elements?.find((el) => el.id === 'box')?.ink
    expect(ink).toBeTruthy()
    const luma = (x: number, y: number) => {
      const i = (y * painted.width + x) * 4
      return 0.2126 * painted.rgba[i]! + 0.7152 * painted.rgba[i + 1]! + 0.0722 * painted.rgba[i + 2]!
    }
    // The box has several faces, so the scan is taken on whichever axis carries
    // the bands; both are counted and the stronger one is graded.
    const bands = (dx: number, dy: number) => {
      const cx = Math.round(ink!.x + ink!.width / 2)
      const cy = Math.round(ink!.y + ink!.height / 2)
      const r = Math.floor(Math.min(ink!.width, ink!.height) / 3)
      let n = 0
      let prev = 0
      for (let t = -r; t <= r; t++) {
        const d = luma(cx + dx * t, cy + dy * t) - luma(cx + dx * (t - 1), cy + dy * (t - 1))
        const sign = d > 0.5 ? 1 : d < -0.5 ? -1 : 0
        if (sign !== 0 && prev !== 0 && sign !== prev) n += 1
        if (sign !== 0) prev = sign
      }
      return n
    }
    expect(Math.max(bands(1, 0), bands(0, 1))).toBeGreaterThan(18)
  }, 60000)
})
