#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { checkFvg, renderFvg } from './render.js'
import { formatIssueLine } from './report.js'

function usage(): never {
  console.error(`用法:
  flexlayer render <file.layer> [-o out.png] [--report out.json] [--scale 0.5] [--debug] [--mesh webgl|canvas2d]
  flexlayer check <file.layer> [--report out.json]`)
  process.exit(2)
}

function parseArgs(argv: string[]) {
  const cmd = argv[0]
  const file = argv[1]
  if (!cmd || !file) usage()
  let out: string | undefined
  let report: string | undefined
  let scale = 1
  let debug = false
  let mesh: 'webgl' | 'canvas2d' | undefined
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '-o') out = argv[++i]
    else if (a === '--report') report = argv[++i]
    else if (a === '--scale') scale = Number(argv[++i])
    else if (a === '--debug') debug = true
    else if (a === '--mesh') {
      const value = argv[++i]
      if (value !== 'webgl' && value !== 'canvas2d') usage()
      mesh = value
    } else usage()
  }
  return { cmd, file, out, report, scale, debug, mesh }
}

async function main() {
  const { cmd, file, out, report, scale, debug, mesh } = parseArgs(process.argv.slice(2))
  const abs = resolve(file)
  const source = await readFile(abs, 'utf8')
  const baseDir = dirname(abs)

  if (cmd === 'check') {
    const rep = await checkFvg(source, { baseDir })
    for (const issue of rep.issues) console.log(formatIssueLine(issue))
    if (report) await writeFile(report, JSON.stringify(rep, null, 2))
    const errors = rep.issues.filter((i) => i.level === 'error').length
    if (errors > 0) process.exit(1)
    return
  }

  if (cmd !== 'render') usage()

  const { png, report: rep } = await renderFvg(source, { baseDir, scale, debug, mesh })
  const outPath = out ?? abs.replace(/\.(layer|fvg)$/i, '.png')
  await writeFile(outPath, png)
  for (const issue of rep.issues) console.log(formatIssueLine(issue))
  console.log(`✓ ${outPath}  ${rep.width}×${rep.height}  ${rep.elements.length} 个元素`)
  if (report) await writeFile(report, JSON.stringify(rep, null, 2))
  const errors = rep.issues.filter((i) => i.level === 'error').length
  if (errors > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
