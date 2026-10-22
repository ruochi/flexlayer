/**
 * 同一批 .layer 用 JS 绘制器和 native 插件各出一张，打印平均差和最大差。
 * FLEXLAYER_RENDER 要指到带 render 的插件。
 * 用法：FLEXLAYER_RENDER=../flexlayer-render npx tsx scripts/painter-parity.ts docs/gallery
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { renderLayer } from '../src/render.js'

const dir = process.argv[2] ?? 'docs/gallery'
const skip = new Set((process.argv[3] ?? '').split(',').filter(Boolean))

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.layer') && !skip.has(name))
  .sort()

for (const name of files) {
  const file = join(dir, name)
  const source = readFileSync(file, 'utf8')
  const baseDir = dirname(file)
  process.env.FLEXLAYER_PAINTER = 'js'
  const js = await renderLayer(source, { baseDir })
  process.env.FLEXLAYER_PAINTER = 'native'
  const rust = await renderLayer(source, { baseDir })
  const errors = rust.report.issues.filter((issue) => issue.level === 'error').map((issue) => issue.code)
  if (!js.png.length || !rust.png.length) {
    console.log(`${name} empty js=${js.png.length} rust=${rust.png.length} errors=${errors.join(',')}`)
    continue
  }
  const a = await pixels(js.png)
  const b = await pixels(rust.png)
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${name} size ${a.width}x${a.height} vs ${b.width}x${b.height} errors=${errors.join(',')}`)
    continue
  }
  let sum = 0
  let max = 0
  let changed = 0
  const n = a.data.length / 4
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(a.data[i]! - b.data[i]!),
      Math.abs(a.data[i + 1]! - b.data[i + 1]!),
      Math.abs(a.data[i + 2]! - b.data[i + 2]!),
      Math.abs(a.data[i + 3]! - b.data[i + 3]!),
    )
    sum += delta
    if (delta > max) max = delta
    if (delta > 0) changed += 1
  }
  console.log(
    `${name} mean=${(sum / n).toFixed(2)} max=${max} changed=${((changed / n) * 100).toFixed(1)}% errors=${errors.join(',') || '-'}`,
  )
}

async function pixels(png: Buffer) {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data }
}
