import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initFontsForMeasure, resolveFontSrcSync } from './fonts.js'
import { layoutSource } from './layout.js'

const SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
const BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
const MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
const WQY = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'

function packCollection(fonts: Buffer[]): Buffer {
  const headerSize = 12 + 4 * fonts.length
  let cursor = headerSize
  const placed = fonts.map((font) => {
    const start = (cursor + 3) & ~3
    const shifted = Buffer.from(font)
    const numTables = shifted.readUInt16BE(4)
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      shifted.writeUInt32BE(shifted.readUInt32BE(rec + 8) + start, rec + 8)
    }
    cursor = start + font.length
    return { start, shifted }
  })
  const out = Buffer.alloc(cursor)
  out.write('ttcf', 0, 'ascii')
  out.writeUInt16BE(1, 4)
  out.writeUInt16BE(0, 6)
  out.writeUInt32BE(fonts.length, 8)
  for (let i = 0; i < placed.length; i++) {
    const item = placed[i]!
    out.writeUInt32BE(item.start, 12 + i * 4)
    item.shifted.copy(out, item.start)
  }
  return out
}

async function textWidth(src: string, family: string, sample: string, baseDir = process.cwd()): Promise<number> {
  const doc = await layoutSource(
    `<layer width="800" height="120"><font family="${family}" src="${src}" /><p style="font-family:${family}; font-size:64px">${sample}</p></layer>`,
    baseDir,
  )
  const node = doc.root.children.find((child) => child.kind === 'text')
  if (!node || node.kind !== 'text') throw new Error('没有文字')
  expect(doc.issues.filter((issue) => issue.level === 'error')).toEqual([])
  return node.width
}

describe('ttc 字形', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flexlayer-ttc-'))

  beforeAll(async () => {
    await initFontsForMeasure()
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('写 #2 时按字体文件本身检查，序号不是文件名', () => {
    writeFileSync(join(dir, 'missing-face.ttc'), Buffer.from('ttcf'))
    expect(() => resolveFontSrcSync('gone.ttc#2', dir)).toThrow(`字体文件不存在: ${join(dir, 'gone.ttc')}`)
    expect(() => resolveFontSrcSync(join(dir, 'missing-face.ttc#2'), dir)).toThrow(/字体集合已损坏/)
    if (existsSync(SANS)) {
      expect(resolveFontSrcSync(`${SANS}#0`, dir)).toBe(SANS)
      expect(() => resolveFontSrcSync(`${SANS}#2`, dir)).toThrow(`这不是字体集合，不能写 #2: ${SANS}`)
    }
  })

  it('#2 用集合里的那一套，而不是第 0 套', async () => {
    if (!existsSync(SANS) || !existsSync(BOLD) || !existsSync(MONO)) return
    const ttc = join(dir, 'faces.ttc')
    writeFileSync(ttc, packCollection([readFileSync(SANS), readFileSync(BOLD), readFileSync(MONO)]))
    const sample = 'WWW'
    const face0 = await textWidth(`${ttc}#0`, 'TtcFace0', sample, dir)
    const face2 = await textWidth('faces.ttc#2', 'TtcFace2', sample, dir)
    const direct = await textWidth(MONO, 'TtcMonoDirect', sample, dir)
    expect(Math.abs(face2 - direct)).toBeLessThan(0.5)
    expect(Math.abs(face0 - face2)).toBeGreaterThan(1)
  })

  it('真实字体集合的序号和默认第 0 套', async () => {
    if (!existsSync(WQY)) return
    const sample = 'iiii'
    const face0 = await textWidth(`${WQY}#0`, 'WqyFace0', sample)
    const face1 = await textWidth(`${WQY}#1`, 'WqyFace1', sample)
    const plain = await textWidth(WQY, 'WqyPlain', sample)
    expect(Math.abs(face0 - face1)).toBeGreaterThan(1)
    expect(plain).toBeCloseTo(face0, 1)
    expect(() => resolveFontSrcSync(`${WQY}#2`, dir)).toThrow('字体集合只有 2 套字形，没有 #2')
  })
})
