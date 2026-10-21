/**
 * 比较两棵目录里同名的 PNG。
 * 用法：npx tsx scripts/png-diff.ts <left> <right> [out-dir]
 * left、right 是仓库根。比较 docs/gallery 和 examples 下的 png。
 * 有差异的图写到 out-dir，默认 /tmp/gallery-diff。
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const leftRoot = process.argv[2]
const rightRoot = process.argv[3]
const outDir = process.argv[4] ?? '/tmp/gallery-diff'

if (!leftRoot || !rightRoot) {
  console.error('usage: npx tsx scripts/png-diff.ts <left> <right> [out-dir]')
  process.exit(1)
}

function pngs(root: string, dir: string): string[] {
  const abs = join(root, dir)
  let names: string[] = []
  try {
    names = readdirSync(abs)
  } catch {
    return []
  }
  return names.filter((name) => name.endsWith('.png')).map((name) => `${dir}/${name}`)
}

type Diff = {
  file: string
  status: 'same' | 'changed' | 'size' | 'only-left' | 'only-right'
  pixels?: number
  maxDelta?: number
  box?: string
}

async function compare(rel: string): Promise<Diff> {
  const left = await loadImage(join(leftRoot, rel)).catch(() => null)
  const right = await loadImage(join(rightRoot, rel)).catch(() => null)
  if (!left && right) return { file: rel, status: 'only-right' }
  if (left && !right) return { file: rel, status: 'only-left' }
  if (!left || !right) return { file: rel, status: 'only-left' }
  if (left.width !== right.width || left.height !== right.height) {
    return { file: rel, status: 'size', box: `${left.width}x${left.height} vs ${right.width}x${right.height}` }
  }
  const canvas = createCanvas(left.width, left.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(left, 0, 0)
  const a = ctx.getImageData(0, 0, left.width, left.height).data
  ctx.clearRect(0, 0, left.width, left.height)
  ctx.drawImage(right, 0, 0)
  const b = ctx.getImageData(0, 0, right.width, right.height).data
  let pixels = 0
  let maxDelta = 0
  let minX = left.width
  let minY = left.height
  let maxX = 0
  let maxY = 0
  const diff = createCanvas(left.width, left.height)
  const dctx = diff.getContext('2d')
  const image = dctx.createImageData(left.width, left.height)
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.max(
      Math.abs(a[i]! - b[i]!),
      Math.abs(a[i + 1]! - b[i + 1]!),
      Math.abs(a[i + 2]! - b[i + 2]!),
      Math.abs(a[i + 3]! - b[i + 3]!),
    )
    if (delta === 0) continue
    pixels += 1
    if (delta > maxDelta) maxDelta = delta
    const p = i / 4
    const x = p % left.width
    const y = Math.floor(p / left.width)
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    image.data[i] = 255
    image.data[i + 1] = 0
    image.data[i + 2] = 0
    image.data[i + 3] = Math.min(255, 40 + delta)
  }
  if (pixels === 0) return { file: rel, status: 'same', pixels: 0, maxDelta: 0 }
  dctx.putImageData(image, 0, 0)
  mkdirSync(outDir, { recursive: true })
  const name = rel.replaceAll('/', '__')
  writeFileSync(join(outDir, name), diff.toBuffer('image/png'))
  return {
    file: rel,
    status: 'changed',
    pixels,
    maxDelta,
    box: `${minX},${minY} ${maxX - minX + 1}x${maxY - minY + 1}`,
  }
}

async function main() {
  const files = [...new Set([...pngs(leftRoot, 'docs/gallery'), ...pngs(rightRoot, 'docs/gallery'), ...pngs(leftRoot, 'examples'), ...pngs(rightRoot, 'examples')])].sort()
  const rows: Diff[] = []
  for (const file of files) rows.push(await compare(file))
  const lines = ['| file | status | pixels | max delta | box |', '| --- | --- | ---: | ---: | --- |']
  for (const row of rows) {
    lines.push(`| ${row.file} | ${row.status} | ${row.pixels ?? ''} | ${row.maxDelta ?? ''} | ${row.box ?? ''} |`)
  }
  const changed = rows.filter((row) => row.status !== 'same')
  process.stdout.write(`${lines.join('\n')}\n\nchanged: ${changed.length} / ${rows.length}\n`)
  if (changed.length > 0) process.stdout.write(`diff images: ${outDir}\n`)
}

main()
