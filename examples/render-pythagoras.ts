import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContactSheet, mergeFrameIssues, renderFrames } from '../src/index.js'
import type { Issue } from '../src/index.js'
import { KEYFRAMES, pythagoras } from './pythagoras.js'

const dir = dirname(fileURLToPath(import.meta.url))
const mp4Path = join(dir, 'pythagoras.mp4')
const sheetPath = join(dir, 'pythagoras-sheet.png')
const keyframesPath = join(dir, 'pythagoras-keyframes.png')

async function main() {
  const ff = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(pythagoras.fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  )
  const encoded = new Promise<void>((resolve, reject) => {
    ff.on('error', reject)
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))))
  })
  const sheet = createContactSheet({
    count: pythagoras.durationInFrames,
    width: pythagoras.width,
    height: pythagoras.height,
  })
  const keySheet = createContactSheet({
    count: KEYFRAMES.length,
    width: pythagoras.width,
    height: pythagoras.height,
  })
  const keySet = new Set(KEYFRAMES)
  const parts: Array<{ frame: number; issues: Issue[] }> = []
  let frames = 0
  for await (const rendered of renderFrames(pythagoras)) {
    const png = rendered.png!
    if (!ff.stdin.write(png)) await once(ff.stdin, 'drain')
    await sheet.add(png)
    if (keySet.has(rendered.frame)) await keySheet.add(png)
    parts.push({ frame: rendered.frame, issues: rendered.report.issues })
    frames++
  }
  ff.stdin.end()
  await encoded

  const issues = mergeFrameIssues(parts)
  console.log(`frames ${frames}`)
  if (issues.length === 0) console.log('report: no issues in any frame')
  for (const issue of issues) {
    const span = issue.frames?.map(([start, end]) => (start === end ? String(start) : `${start}-${end}`)).join(',')
    console.log(`report: ${issue.level} ${issue.code} frames ${span} ${issue.path} ${issue.message}`)
  }

  await writeFile(sheetPath, sheet.toPng())
  await writeFile(keyframesPath, keySheet.toPng())
  console.log(mp4Path)
  console.log(keyframesPath)

  if (issues.some((issue) => issue.level === 'error')) process.exitCode = 1
}

main()
