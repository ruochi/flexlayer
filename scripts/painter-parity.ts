/**
 * 用插件把 .layer 画出来，打印尺寸和错误码。JS 绘制器已移除。
 * 用法：npx tsx scripts/painter-parity.ts docs/gallery examples
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { renderLayer } from '../src/render.js'

const roots = process.argv.slice(2).filter((arg) => !arg.includes('='))
const dirs = roots.length > 0 ? roots : ['docs/gallery', 'examples']
const files = dirs.flatMap((dir) => {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return dir.endsWith('.layer') ? [dir] : []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.layer'))
    .map((name) => join(dir, name))
}).sort()

for (const file of files) {
  const name = basename(file)
  const source = readFileSync(file, 'utf8')
  const baseDir = dirname(file)
  delete process.env.FLEXLAYER_PAINTER
  const rust = await renderLayer(source, { baseDir })
  const errors = rust.report.issues.filter((issue) => issue.level === 'error').map((issue) => issue.code)
  if (!rust.png.length) {
    console.log(`${name} empty errors=${errors.join(',')}`)
    continue
  }
  const b = await pixels(rust.png)
  console.log(`${name} ${b.width}x${b.height} errors=${errors.join(',') || '-'}`)
}

async function pixels(png: Buffer) {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data }
}
