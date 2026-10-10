import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

export const DERIVE_KINDS = ['subject', 'mask', 'regions'] as const
export type DeriveKind = (typeof DERIVE_KINDS)[number]

export function isDeriveKind(value: string): value is DeriveKind {
  return (DERIVE_KINDS as readonly string[]).includes(value)
}

/** 原图 `photo.jpg` 对应 `photo.subject.png` 和 `photo.cutout.json`。网址和 data URL 没有落点。 */
export function derivePaths(src: string, baseDir: string, kind: DeriveKind): { srcFile: string; file: string; meta: string } | null {
  const trimmed = src.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  const srcFile = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
  const slash = Math.max(srcFile.lastIndexOf('/'), srcFile.lastIndexOf('\\'))
  const dot = srcFile.lastIndexOf('.')
  const stem = dot > slash ? srcFile.slice(0, dot) : srcFile
  return { srcFile, file: `${stem}.${kind}.png`, meta: `${stem}.cutout.json` }
}

export function fileHash(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export type DeriveStatus =
  | { status: 'remote' }
  | { status: 'missing'; command: string }
  | { status: 'stale'; file: string; command: string }
  | { status: 'ok'; file: string }

function commandFor(srcFile: string, preset: string): string {
  return `npx flexlayer-select cutout ${basename(srcFile)} --preset ${preset}`
}

/** 缓存不存在、或原图哈希和配方对不上。文件在但过期时仍返回 file，调用方可以先画再警告。 */
export function checkDerive(src: string, baseDir: string, kind: DeriveKind): DeriveStatus {
  const paths = derivePaths(src, baseDir, kind)
  if (!paths) return { status: 'remote' }
  let preset = 'portrait'
  let recorded: string | undefined
  if (existsSync(paths.meta)) {
    try {
      const meta = JSON.parse(readFileSync(paths.meta, 'utf8')) as { srcHash?: string; preset?: string }
      if (typeof meta.preset === 'string' && meta.preset.trim()) preset = meta.preset.trim()
      if (typeof meta.srcHash === 'string') recorded = meta.srcHash
    } catch {
      recorded = undefined
    }
  }
  const command = commandFor(paths.srcFile, preset)
  if (!existsSync(paths.file)) return { status: 'missing', command }
  let current = ''
  try {
    current = existsSync(paths.srcFile) ? fileHash(paths.srcFile) : ''
  } catch {
    current = ''
  }
  if (!recorded || recorded !== current) return { status: 'stale', file: paths.file, command }
  return { status: 'ok', file: paths.file }
}
