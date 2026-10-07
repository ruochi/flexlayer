import type { Issue } from './types.js'

export type SampleSpec = {
  /** 抽查每一帧。和 `range` 同时写时以 `range` 为准。 */
  all?: boolean
  /** 含两端。 */
  range?: [number, number]
  step?: number
}

/** 没有指定帧时抽查开头、中间和结尾。帧数不够时去掉重复。 */
export function sampleFrames(durationInFrames: number, explicit?: number | SampleSpec): number[] {
  if (typeof explicit === 'number') return [explicit]
  const last = Math.max(0, durationInFrames - 1)
  const step = explicit?.step ?? 1
  if (!Number.isInteger(step) || step < 1) throw new Error('step 至少为 1')
  if (explicit?.range || explicit?.all) {
    const from = explicit.range?.[0] ?? 0
    const to = explicit.range?.[1] ?? last
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > last || from > to) {
      throw new Error(`帧范围 ${from}-${to} 超出 0-${last}`)
    }
    const frames: number[] = []
    for (let frame = from; frame <= to; frame += step) frames.push(frame)
    return frames
  }
  const mid = Math.floor(last / 2)
  return [...new Set([0, mid, last])].sort((a, b) => a - b)
}

function issueKey(issue: Issue): string {
  return `${issue.level}\0${issue.code}\0${issue.path}\0${issue.message}`
}

/**
 * 同一 level、code、path、message 在抽查序列里连续出现时合成一条。
 * `frame` 是这一段第一次出现的帧。`frames` 是含两端的区间；中间有一帧没出现就另起一段。
 * 抽查步长大于 1 时，相邻的抽查帧也算连续，例如 120、125、130 合成 [120, 130]。
 */
export function mergeFrameIssues(parts: Array<{ frame: number; issues: Issue[] }>): Issue[] {
  const open = new Map<string, { issue: Issue; start: number; end: number }>()
  const closed: Array<{ issue: Issue; frames: Array<[number, number]> }> = []
  const byKey = new Map<string, { issue: Issue; frames: Array<[number, number]> }>()

  const closeMissing = (present: Set<string>) => {
    for (const key of [...open.keys()]) {
      if (present.has(key)) continue
      const run = open.get(key)!
      const found = byKey.get(key)
      if (found) found.frames.push([run.start, run.end])
      else {
        const entry = { issue: run.issue, frames: [[run.start, run.end]] as Array<[number, number]> }
        byKey.set(key, entry)
        closed.push(entry)
      }
      open.delete(key)
    }
  }

  for (const part of parts) {
    const present = new Set<string>()
    for (const issue of part.issues) {
      const key = issueKey(issue)
      present.add(key)
      const run = open.get(key)
      if (!run) open.set(key, { issue: { ...issue, frame: part.frame }, start: part.frame, end: part.frame })
      else run.end = part.frame
    }
    closeMissing(present)
  }
  closeMissing(new Set())

  return closed.map(({ issue, frames }) => {
    issue.frames = frames
    return issue
  })
}
