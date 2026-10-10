import type { Question } from './regions.js'

export type Answer = { id: number; op: 'add' | 'subtract' }

function stemOf(src: string): string {
  const slash = Math.max(src.lastIndexOf('/'), src.lastIndexOf('\\'))
  const base = slash >= 0 ? src.slice(slash + 1) : src
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function sizeOf(width: number, height: number): string {
  return `style="width:${width}px; height:${height}px"`
}

/** 可以直接放进 `.layer` 的蒙版和预览。`src` 是原图文件名，和缓存放在同一目录。 */
export function cutoutMarkup(input: { src: string; width: number; height: number; shadow?: boolean }): string {
  const size = sizeOf(input.width, input.height)
  const box = `width="${input.width}" height="${input.height}"`
  const cut = [
    `<layer id="cut" ${box}>`,
    `  <mask>`,
    `    <img src="${input.src}" derive="subject" ${size} />`,
    `  </mask>`,
    `  <img src="${input.src}" ${size} />`,
    `  <preview of="#cut" show="overlay checker black white edges" />`,
    `</layer>`,
  ]
  if (!input.shadow) return `${cut.join('\n')}\n`
  const shadow = [`<layer id="shadow" ${box}>`, `  <img src="${stemOf(input.src)}.shadow.png" ${size} />`, `</layer>`]
  return [`<layer ${box}>`, ...cut.map((line) => `  ${line}`), ...shadow.map((line) => `  ${line}`), `</layer>`, ''].join('\n')
}

/** 把选择题的答案写回标记。已选又要去掉的用 subtract，没选上又要留下的用 add。 */
export function answersFromChoices(questions: Question[], choices: Array<{ id: number; keep: boolean }>): Answer[] {
  const byId = new Map(questions.map((question) => [question.id, question]))
  const out: Answer[] = []
  for (const choice of choices) {
    const question = byId.get(choice.id)
    if (!question) throw new Error(`没有第 ${choice.id} 题`)
    if (question.now === '已选' && !choice.keep) out.push({ id: question.id, op: 'subtract' })
    if (question.now === '未选' && choice.keep) out.push({ id: question.id, op: 'add' })
  }
  return out
}

/** 按 op 合成 pick。再调用一次会换掉上次写进去的编号图。 */
export function applyAnswers(markup: string, answers: Answer[], input: { src: string; width: number; height: number }): string {
  if (!markup.includes('</mask>')) throw new Error('标记里没有 <mask>')
  const cleaned = markup.replace(/^[ \t]*<img\b[^>]*\bderive="regions"[^>]*\/>\r?\n?/gm, '')
  const grouped = new Map<'add' | 'subtract', number[]>()
  for (const answer of answers) {
    if (answer.op !== 'add' && answer.op !== 'subtract') throw new Error(`答案的 op 只能是 add 或 subtract，收到 ${answer.op}`)
    if (!Number.isInteger(answer.id) || answer.id < 1 || answer.id > 255) throw new Error(`编号要在 1 到 255 之间，收到 ${answer.id}`)
    const list = grouped.get(answer.op) ?? []
    if (!list.includes(answer.id)) list.push(answer.id)
    grouped.set(answer.op, list)
  }
  const inserts: string[] = []
  const size = sizeOf(input.width, input.height)
  for (const op of ['add', 'subtract'] as const) {
    const ids = grouped.get(op)
    if (!ids?.length) continue
    ids.sort((a, b) => a - b)
    inserts.push(`    <img src="${input.src}" derive="regions" channel="luma" pick="${ids.join(' ')}" op="${op}" ${size} />`)
  }
  if (inserts.length === 0) return cleaned
  return cleaned.replace('</mask>', `${inserts.join('\n')}\n  </mask>`)
}
