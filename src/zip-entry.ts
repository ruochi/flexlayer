import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50

/** 从 zip 中央目录取出一个文件。只接受存储和 deflate。 */
export function extractZipEntry(data: Buffer, entryName: string): Buffer {
  let eocd = -1
  const min = Math.max(0, data.length - 22 - 65535)
  for (let i = data.length - 22; i >= min; i--) {
    if (data.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`不是 zip，无法取出 ${entryName}`)
  const count = data.readUInt16LE(eocd + 10)
  let pos = data.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (pos + 46 > data.length || data.readUInt32LE(pos) !== CENTRAL) {
      throw new Error(`zip 目录损坏，无法取出 ${entryName}`)
    }
    const method = data.readUInt16LE(pos + 10)
    const compSize = data.readUInt32LE(pos + 20)
    const nameLen = data.readUInt16LE(pos + 28)
    const extraLen = data.readUInt16LE(pos + 30)
    const commentLen = data.readUInt16LE(pos + 32)
    const localOff = data.readUInt32LE(pos + 42)
    const name = data.toString('utf8', pos + 46, pos + 46 + nameLen)
    if (name === entryName) {
      if (localOff + 30 > data.length) throw new Error(`zip 本地头损坏: ${entryName}`)
      const localNameLen = data.readUInt16LE(localOff + 26)
      const localExtraLen = data.readUInt16LE(localOff + 28)
      const start = localOff + 30 + localNameLen + localExtraLen
      const compressed = data.subarray(start, start + compSize)
      if (compressed.length !== compSize) throw new Error(`zip 条目被截断: ${entryName}`)
      if (method === 0) return Buffer.from(compressed)
      if (method === 8) return Buffer.from(inflateRawSync(compressed))
      throw new Error(`zip 压缩方式 ${method} 不支持: ${entryName}`)
    }
    pos += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`zip 里没有 ${entryName}`)
}
