import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initFontsForMeasure } from './fonts.js'
import { renderFvg } from './render.js'

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..')
const helloPath = join(pkgDir, 'examples', 'hello.layer')

beforeAll(async () => {
  for (const dir of [join(homedir(), '.cache', 'flexlayer', 'fonts'), '/tmp/flexlayer-test']) {
    if (await initFontsForMeasure({ fontsCacheDir: dir })) break
  }
})

describe('render hello.layer', () => {
  it('生成 PNG', async () => {
    const source = await readFile(helloPath, 'utf8')
    const { png, report } = await renderFvg(source, {
      baseDir: join(pkgDir, 'examples'),
      fontsCacheDir: join(homedir(), '.cache', 'flexlayer', 'fonts'),
    })
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(report.width).toBe(1080)
    expect(report.height).toBe(1920)
    expect(report.elements.length).toBeGreaterThan(0)
  })

  it('check 没有问题时打印 ✓ 0 issues', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flexlayer-check-'))
    const file = join(dir, 'ok.layer')
    writeFileSync(file, `<layer width="40" height="40" background="#000"><rect x="0" y="0" width="10" height="10" fill="#fff" /></layer>`)
    const result = spawnSync(join(pkgDir, 'node_modules/.bin/tsx'), [join(pkgDir, 'src/cli.ts'), 'check', file], {
      cwd: pkgDir,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('✓ 0 issues')
  })
})

const tsxBin = join(pkgDir, 'node_modules/.bin/tsx')
const cliPath = join(pkgDir, 'src/cli.ts')

function runCli(args: string[]) {
  return spawnSync(tsxBin, [cliPath, ...args], { cwd: pkgDir, encoding: 'utf8' })
}

function runCliBuffer(args: string[]) {
  return spawnSync(tsxBin, [cliPath, ...args], { cwd: pkgDir })
}

describe('帧序列命令行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flexlayer-frames-'))
  const scene = join(dir, 'scene.tsx')
  writeFileSync(
    scene,
    `import type { Composition } from 'flexlayer'
export const composition: Composition = {
  id: 'span',
  width: 40,
  height: 40,
  fps: 1,
  durationInFrames: 6,
  component: ({ frame }) => (
    <layer width="40" height="40" background="#000">
      <rect x="4" y="4" width="8" height="8" fill="#ccc" />
      <circle cx={frame === 4 ? 80 : 20} cy="20" r="4" fill="#fff" />
    </layer>
  ),
}
`,
  )

  it('check --frames 0-5 --step 2 把问题收成区间', () => {
    const reportPath = join(dir, 'report.json')
    const result = runCli(['check', scene, '--frames', '0-5', '--step', '2', '--report', reportPath])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('overflow-canvas')
    expect(result.stdout).toContain('第4帧')
    expect(result.stdout).not.toContain('也出现在')
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      issues: Array<{ code: string; frame?: number; frames?: Array<[number, number]> }>
    }
    const overflow = report.issues.filter((issue) => issue.code === 'overflow-canvas')
    expect(overflow).toEqual([expect.objectContaining({ frame: 4, frames: [[4, 4]] })])
  })

  it('--frames 边写边出，只包含 from 到 to', () => {
    const framesDir = join(dir, 'frames')
    const result = runCli(['render', scene, '--frames', framesDir, '--from', '1', '--to', '3'])
    expect(result.status).toBe(0)
    expect(readdirSync(framesDir).sort()).toEqual(['frame-0001.png', 'frame-0002.png', 'frame-0003.png'])
    expect(existsSync(join(dir, 'scene.png'))).toBe(true)
  })

  it('没装 flexlayer-select 时提示安装命令', () => {
    const result = runCli(['select', 'cutout', 'photo.jpg'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('没有安装 flexlayer-select')
    expect(result.stderr).toContain('packages/select')
  })

  it('--rgba - 的标准输出只有像素', () => {
    const result = runCliBuffer(['render', scene, '--rgba', '-'])
    expect(result.stdout.length).toBe(6 * 40 * 40 * 4)
    expect(result.stdout[0]).toBe(0)
    const err = result.stderr.toString('utf8')
    expect(err).toContain('-f rawvideo -pix_fmt rgba -s 40x40 -r 1 -i -')
    expect(err).toContain('overflow-canvas')
    expect(result.stdout.subarray(0, 8).toString('utf8')).not.toContain('ffmpeg')
    expect(result.status).toBe(1)
  })
})
