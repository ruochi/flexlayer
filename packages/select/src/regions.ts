const SOLID = 128
const SOFT_LOW = 8
const SOFT_HIGH = 247

export type Where = '左上' | '右上' | '左下' | '右下' | '中间'
export type Question = {
  id: number
  /** 这块占整张图的比例。 */
  area: number
  where: Where
  /** 现在的蒙版里，这块大部分已经留下，还是还没选上。 */
  now: '已选' | '未选'
  ask: string
}

type Comp = {
  pixels: number[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function round4(n: number): number {
  const rounded = Math.round(n * 10000) / 10000
  return Object.is(rounded, -0) ? 0 : rounded
}

function components(width: number, height: number, keep: (i: number) => boolean): Comp[] {
  const seen = new Uint8Array(width * height)
  const stack = new Int32Array(width * height)
  const out: Comp[] = []
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !keep(start)) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    const pixels: number[] = []
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    while (top > 0) {
      const i = stack[--top]!
      pixels.push(i)
      const x = i % width
      const y = (i / width) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (seen[ni] || !keep(ni)) continue
          seen[ni] = 1
          stack[top++] = ni
        }
      }
    }
    out.push({ pixels, minX, minY, maxX, maxY })
  }
  out.sort((a, b) => b.pixels.length - a.pixels.length)
  return out
}

function whereOf(comp: Comp, width: number, height: number): Where {
  let sx = 0
  let sy = 0
  for (const i of comp.pixels) {
    sx += i % width
    sy += (i / width) | 0
  }
  const cx = sx / comp.pixels.length
  const cy = sy / comp.pixels.length
  const left = cx < width * 0.4
  const right = cx > width * 0.6
  const top = cy < height * 0.4
  const bottom = cy > height * 0.6
  if (left && top) return '左上'
  if (right && top) return '右上'
  if (left && bottom) return '左下'
  if (right && bottom) return '右下'
  return '中间'
}

function touchesBorder(comp: Comp, width: number, height: number): boolean {
  return comp.minX === 0 || comp.minY === 0 || comp.maxX === width - 1 || comp.maxY === height - 1
}

/**
 * 不确定的地方编上号：离开主体的小块、主体里的洞、够宽的软边。
 * 灰度图的值就是编号，0 是背景。编号从 1 起，最多 255。
 */
export function buildRegions(alpha: Uint8ClampedArray, width: number, height: number): { ids: Uint8ClampedArray; questions: Question[] } {
  const ids = new Uint8ClampedArray(width * height)
  const questions: Question[] = []
  const total = width * height
  const minPixels = Math.max(4, Math.round(total * 0.002))
  let next = 1

  const take = (comp: Comp, now: Question['now'], ask: string) => {
    if (next > 255 || comp.pixels.length < minPixels) return
    const id = next++
    for (const i of comp.pixels) ids[i] = id
    questions.push({
      id,
      area: total > 0 ? round4(comp.pixels.length / total) : 0,
      where: whereOf(comp, width, height),
      now,
      ask,
    })
  }

  const solids = components(width, height, (i) => alpha[i]! >= SOLID)
  for (const comp of solids.slice(1)) {
    take(comp, '已选', '这块离开主体的小块，要不要从选区里去掉？')
  }

  const holes = components(width, height, (i) => alpha[i]! < SOFT_LOW && ids[i] === 0)
  for (const comp of holes) {
    if (touchesBorder(comp, width, height)) continue
    take(comp, '未选', '主体上的这个洞，要不要补进选区？')
  }

  const soft = components(width, height, (i) => {
    const value = alpha[i]!
    return ids[i] === 0 && value >= SOFT_LOW && value <= SOFT_HIGH
  })
  for (const comp of soft) {
    const bw = comp.maxX - comp.minX + 1
    const bh = comp.maxY - comp.minY + 1
    const fill = comp.pixels.length / (bw * bh)
    if (comp.pixels.length < 12 || Math.min(bw, bh) < 3 || fill < 0.45) continue
    let chosen = 0
    for (const i of comp.pixels) if (alpha[i]! >= SOLID) chosen += 1
    const now: Question['now'] = chosen * 2 >= comp.pixels.length ? '已选' : '未选'
    const ask = now === '已选' ? '这条软边现在大部分已经选上，要不要从选区里拿掉？' : '这条软边现在大部分还没选上，要不要收进选区？'
    take(comp, now, ask)
  }

  return { ids, questions }
}
