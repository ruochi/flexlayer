import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractZipEntry } from './zip-entry.js'

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStored(name: string, payload: Buffer, method: 0 | 8): Buffer {
  const compressed = method === 8 ? deflateRawSync(payload) : payload
  const nameBytes = Buffer.from(name, 'utf8')
  const crc = crc32(payload)
  const local = Buffer.alloc(30 + nameBytes.length + compressed.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x800, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  nameBytes.copy(local, 30)
  compressed.copy(local, 30 + nameBytes.length)

  const central = Buffer.alloc(46 + nameBytes.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x800, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)
  nameBytes.copy(central, 46)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, eocd])
}

describe('zip 条目', () => {
  it('取出存储和 deflate 的条目', () => {
    const payload = Buffer.from('寒蝉', 'utf8')
    expect(extractZipEntry(zipStored('寒蝉端黑宋/a.otf', payload, 0), '寒蝉端黑宋/a.otf').equals(payload)).toBe(true)
    expect(extractZipEntry(zipStored('寒蝉端黑宋/a.otf', payload, 8), '寒蝉端黑宋/a.otf').equals(payload)).toBe(true)
  })

  it('没有这个条目就报错', () => {
    const zip = zipStored('a.otf', Buffer.from('x'), 0)
    expect(() => extractZipEntry(zip, 'b.otf')).toThrow(/没有 b\.otf/)
  })
})
