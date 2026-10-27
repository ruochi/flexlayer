/**
 * Left/right comparison sheets for looking at the 3D plates, plus a FLIP heat
 * map underneath.
 *
 *   npx tsx scripts/gallery-compare.mjs test/reference/legacy docs/gallery/3d /tmp/compare
 *
 * Two directories of same-named PNGs. Every stem that appears in both becomes
 * one image: the reference on the left, the current render on the right, and
 * the per-pixel FLIP below them. A heat map answers "where" while the mean only
 * answers "how much", which is the mistake the first round kept making.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { flipValues } from './flip-diff.ts'

const [refDir, newDir, outDir] = process.argv.slice(2)
if (!refDir || !newDir || !outDir) {
  console.error('usage: npx tsx scripts/gallery-compare.mjs <refDir> <newDir> <outDir>')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const pngs = (dir) => readdirSync(dir).filter((name) => name.endsWith('.png')).sort()
const newFiles = new Set(pngs(newDir))
const stems = pngs(refDir).map((name) => basename(name, '.png')).filter((stem) => newFiles.has(`${stem}.png`))
if (!stems.length) {
  console.error(`no shared stems between ${refDir} and ${newDir}`)
  process.exit(1)
}

const GAP = 8
const CAPTION = 28
/** Values above this share the hottest colour so a small artifact still shows. */
const HOT = 0.25

async function rgbaOf(path) {
  const image = await loadImage(path)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return { rgba: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height }
}

function heatColor(value) {
  const t = Math.min(1, value / HOT)
  if (Number.isNaN(value)) return [24, 22, 20]
  // Black through deep blue and green to yellow, so the hot pixels are the
  // only ones that read as bright.
  const stops = [
    [10, 12, 28],
    [24, 52, 150],
    [20, 190, 140],
    [250, 220, 60],
  ]
  const scaled = t * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const f = scaled - index
  const a = stops[index]
  const b = stops[index + 1]
  return [0, 1, 2].map((c) => Math.round(a[c] + (b[c] - a[c]) * f))
}

for (const stem of stems) {
  const ref = await rgbaOf(join(refDir, `${stem}.png`))
  const next = await rgbaOf(join(newDir, `${stem}.png`))
  const width = Math.max(ref.width, next.width)
  const height = Math.max(ref.height, next.height)
  const same = ref.width === next.width && ref.height === next.height
  const canvas = createCanvas(width * 2 + GAP, CAPTION + height * 2 + GAP)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#14120f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#f4efe6'
  ctx.font = '16px sans-serif'
  ctx.fillText(`${stem}   左：参照 ${ref.width}x${ref.height}   右：新图 ${next.width}x${next.height}`, 8, 19)
  ctx.drawImage(await loadImage(join(refDir, `${stem}.png`)), 0, CAPTION)
  ctx.drawImage(await loadImage(join(newDir, `${stem}.png`)), width + GAP, CAPTION)
  if (same) {
    const values = flipValues(ref.rgba, next.rgba, ref.width, ref.height)
    let sum = 0
    let n = 0
    const pixels = ctx.createImageData(width, height)
    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      if (!Number.isNaN(value)) {
        sum += value
        n += 1
      }
      const [r, g, b] = heatColor(value)
      pixels.data[i * 4] = r
      pixels.data[i * 4 + 1] = g
      pixels.data[i * 4 + 2] = b
      pixels.data[i * 4 + 3] = 255
    }
    ctx.putImageData(pixels, 0, CAPTION + height + GAP)
    const mean = n ? sum / n : 0
    ctx.fillStyle = '#14120f'
    ctx.fillRect(0, CAPTION + height + GAP, 460, 20)
    ctx.fillStyle = '#f4efe6'
    ctx.fillText(`FLIP 均值 ${mean.toFixed(4)}   热图上限 ${HOT}`, 8, CAPTION + height + GAP + 15)
    console.log(`${stem}  flip ${mean.toFixed(4)}`)
  } else {
    console.log(`${stem}  size mismatch, no flip`)
  }
  writeFileSync(join(outDir, `${stem}.png`), canvas.toBuffer('image/png'))
}
