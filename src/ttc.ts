/**
 * `.ttc` / `.otc` 里有多套字形。`@napi-rs/canvas` 的 `registerFromPath` 没有序号，
 * 不写序号时用第 0 套。思源、Noto CJK 的第 0 套是日文。
 * 这里把选中的那一套拆成独立的 sfnt 再注册。集合里表的偏移相对文件开头，拆出来要改成相对新文件。
 */

type TableRecord = { tag: Buffer; checksum: number; offset: number; length: number }

export function extractCollectionFace(data: Buffer, index: number): Buffer {
  if (data.length < 12 || data.toString('ascii', 0, 4) !== 'ttcf') throw new Error('字体集合已损坏')
  const numFonts = data.readUInt32BE(8)
  if (numFonts < 1 || numFonts > 4096 || 12 + numFonts * 4 > data.length) throw new Error('字体集合已损坏')
  if (!Number.isInteger(index) || index < 0 || index >= numFonts) {
    throw new Error(`字体集合只有 ${numFonts} 套字形，没有 #${index}`)
  }
  return repackSfnt(data, data.readUInt32BE(12 + index * 4))
}

function repackSfnt(data: Buffer, offset: number): Buffer {
  if (offset + 12 > data.length) throw new Error('字体集合已损坏')
  const numTables = data.readUInt16BE(offset + 4)
  if (numTables < 1 || numTables > 512 || offset + 12 + numTables * 16 > data.length) throw new Error('字体集合已损坏')
  const records: TableRecord[] = []
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16
    const tableOffset = data.readUInt32BE(rec + 8)
    const length = data.readUInt32BE(rec + 12)
    if (length > data.length || (length > 0 && tableOffset > data.length - length)) throw new Error('字体集合已损坏')
    records.push({
      tag: Buffer.from(data.subarray(rec, rec + 4)),
      checksum: data.readUInt32BE(rec + 4),
      offset: tableOffset,
      length,
    })
  }
  const headerSize = 12 + numTables * 16
  let cursor = headerSize
  const placed = records.map((rec) => {
    const at = (cursor + 3) & ~3
    cursor = at + rec.length
    return { rec, at }
  })
  const out = Buffer.alloc(cursor)
  data.copy(out, 0, offset, offset + 12)
  const searchUnits = 1 << Math.floor(Math.log2(numTables))
  out.writeUInt16BE(numTables, 4)
  out.writeUInt16BE(searchUnits * 16, 6)
  out.writeUInt16BE(Math.floor(Math.log2(numTables)), 8)
  out.writeUInt16BE(numTables * 16 - searchUnits * 16, 10)
  for (let i = 0; i < placed.length; i++) {
    const item = placed[i]!
    const at = 12 + i * 16
    item.rec.tag.copy(out, at)
    out.writeUInt32BE(item.rec.checksum, at + 4)
    out.writeUInt32BE(item.at, at + 8)
    out.writeUInt32BE(item.rec.length, at + 12)
    if (item.rec.length > 0) data.copy(out, item.at, item.rec.offset, item.rec.offset + item.rec.length)
  }
  return out
}
