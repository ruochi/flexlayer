import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { renderLayer } from '../src/render.js'
import { formatIssueLine } from '../src/report.js'

function layerFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.layer'))
    .map((name) => `${dir}/${name}`)
}

/** 给 object-fit 示例用的色块图，宽高不成比例。 */
function writeSwatch() {
  const canvas = createCanvas(240, 120)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1a2430'
  ctx.fillRect(0, 0, 240, 120)
  ctx.fillStyle = '#f7931a'
  ctx.fillRect(0, 0, 80, 120)
  ctx.fillStyle = '#3ecfc4'
  ctx.beginPath()
  ctx.arc(160, 60, 36, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f4efe4'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('FL', 96, 70)
  writeFileSync('docs/gallery/swatch.png', canvas.toBuffer('image/png'))
}

/** 调色六格共用的一张风景，不是外部照片。 */
function writeScene() {
  const width = 640
  const height = 400
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#1d3a6e')
  sky.addColorStop(0.45, '#e7a15a')
  sky.addColorStop(1, '#3a2a22')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffe7a3'
  ctx.beginPath()
  ctx.arc(470, 120, 46, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#152033'
  ctx.fillRect(48, 230, 64, 170)
  ctx.fillRect(130, 180, 96, 220)
  ctx.fillRect(246, 250, 46, 150)
  ctx.fillStyle = '#f4efe4'
  ctx.fillRect(152, 214, 16, 22)
  ctx.fillRect(186, 260, 16, 22)
  ctx.fillStyle = '#2f6b4f'
  ctx.beginPath()
  ctx.arc(540, 300, 52, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#6b3a22'
  ctx.fillRect(532, 300, 16, 100)
  writeFileSync('docs/gallery/scene.png', canvas.toBuffer('image/png'))
}

writeSwatch()
writeScene()

/** 说明图始终重写。examples 里已有的 png（如 draw-layer.png）一并重写，其余只检测。 */
async function renderOne(file: string, writePng: boolean) {
  const source = readFileSync(file, 'utf8')
  const { png, report } = await renderLayer(source, { baseDir: dirname(file) })
  const errors = report.issues.filter((issue) => issue.level === 'error')
  if (report.issues.some((issue) => issue.level !== 'info')) {
    console.log(file)
    for (const issue of report.issues) {
      if (issue.level === 'info') continue
      console.log(formatIssueLine(issue))
    }
  }
  if (writePng) {
    const out = file.replace(/\.layer$/, '.png')
    writeFileSync(out, png)
    console.log(out)
  } else {
    console.log(`checked ${file}`)
  }
  return errors.length
}

let errors = 0
for (const file of layerFiles('docs/gallery')) {
  errors += await renderOne(file, true)
}
for (const file of layerFiles('examples')) {
  const png = file.replace(/\.layer$/, '.png')
  errors += await renderOne(file, existsSync(png))
}
if (errors > 0) {
  console.error(`✗ ${errors} error`)
  process.exit(1)
}
