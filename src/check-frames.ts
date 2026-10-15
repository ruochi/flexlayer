import type { Box, ElementReport, Issue } from './types.js'

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

export type FramePart = {
  frame: number
  issues: Issue[]
  /** 这一帧的元素表。给了才能认出入场和出场。 */
  elements?: Array<Pick<ElementReport, 'path' | 'ink' | 'opacity'>>
}

/** 入场、出场时贴边或出界是常态。 */
const EDGE_CODES = new Set(['overflow-canvas', 'outside-safe', 'effect-clipped'])
const VISIBLE_OPACITY = 0.01

function issueKey(issue: Issue): string {
  return `${issue.level}\0${issue.code}\0${issue.path}\0${issue.message}`
}

type Seen = { ink: Box } | null

function seenAt(part: FramePart | undefined, path: string): Seen | undefined {
  if (!part?.elements) return undefined
  const el = part.elements.find((e) => e.path === path)
  if (!el || el.opacity < VISIBLE_OPACITY) return null
  return { ink: el.ink }
}

function sameInk(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
}

function hasEdgeIssue(part: FramePart | undefined, path: string): boolean {
  return !!part?.issues.some((issue) => EDGE_CODES.has(issue.code) && issue.path === path)
}

/**
 * 一段贴边的问题是不是元素在进出画面。先把相邻的贴边帧连起来：出界之后紧跟着出安全区，算同一次进出。
 * 入场：连起来的这段从序列开头起，或前一个抽查帧里元素还不可见；之后一个抽查帧里元素在画面里，且着墨动过。
 * 出场：前一个抽查帧里元素在画面里；这段之后的抽查帧里元素已经不可见，且着墨动过。
 * 这段不止一帧时，段内着墨也要变过。序列末尾才跳出画面的、静止不动的、没有元素表可比的，都不算。
 */
function edgeMotion(parts: FramePart[], start: number, end: number, path: string): '入场' | '出场' | null {
  let s = start
  let e = end
  while (s > 0 && hasEdgeIssue(parts[s - 1], path)) s--
  while (e < parts.length - 1 && hasEdgeIssue(parts[e + 1], path)) e++
  const first = seenAt(parts[s], path)
  const last = seenAt(parts[e], path)
  if (!first || !last) return null
  if (s !== e && sameInk(first.ink, last.ink)) return null
  const before = s > 0 ? seenAt(parts[s - 1], path) : undefined
  const after = e < parts.length - 1 ? seenAt(parts[e + 1], path) : undefined
  if ((s === 0 || before === null) && after && !sameInk(after.ink, last.ink)) return '入场'
  if (before && after === null && !sameInk(before.ink, first.ink)) return '出场'
  return null
}

/** 先按抽查序列找出每条问题连续出现的段，把进出画面的那几段降成 info。 */
function labelMotion(parts: FramePart[]): Issue[][] {
  const out = parts.map((part) => part.issues.slice())
  const hits = new Map<string, number[]>()
  parts.forEach((part, index) => {
    for (const issue of part.issues) {
      if (!EDGE_CODES.has(issue.code) || issue.level === 'info') continue
      const key = issueKey(issue)
      const list = hits.get(key)
      if (list) list.push(index)
      else hits.set(key, [index])
    }
  })
  for (const [key, indices] of hits) {
    let runStart = 0
    for (let k = 1; k <= indices.length; k++) {
      if (k < indices.length && indices[k] === indices[k - 1]! + 1) continue
      const start = indices[runStart]!
      const end = indices[k - 1]!
      const path = parts[start]!.issues.find((issue) => issueKey(issue) === key)!.path
      const motion = edgeMotion(parts, start, end, path)
      if (motion) {
        for (let i = start; i <= end; i++) {
          out[i] = out[i]!.map((issue) => (issueKey(issue) === key ? { ...issue, level: 'info', expected: motion } : issue))
        }
      }
      runStart = k
    }
  }
  return out
}

/**
 * 同一 level、code、path、message 在抽查序列里连续出现时合成一条。
 * `frames` 是含两端的区间；中间有一帧没出现就另起一段。
 * 抽查步长大于 1 时，相邻的抽查帧也算连续，例如 120、125、130 合成 [120, 130]。
 * 带了 `elements` 时，入场、出场那几帧的出界和出安全区降成 info，`expected` 写 `入场` 或 `出场`。
 */
export function mergeFrameIssues(parts: FramePart[]): Issue[] {
  const labeled = labelMotion(parts)
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

  parts.forEach((part, index) => {
    const present = new Set<string>()
    for (const issue of labeled[index]!) {
      const key = `${issueKey(issue)}\0${issue.expected ?? ''}`
      present.add(key)
      const run = open.get(key)
      if (!run) open.set(key, { issue: { ...issue }, start: part.frame, end: part.frame })
      else run.end = part.frame
    }
    closeMissing(present)
  })
  closeMissing(new Set())

  return closed
    .map(({ issue, frames }) => {
      issue.frames = frames
      return issue
    })
    .filter((issue) => issue.code !== 'unused-expect' || !expectUsedIn(parts, issue))
}

function expectUsedIn(parts: FramePart[], issue: Issue): boolean {
  const code = issue.expect?.code
  if (!code) return false
  for (const part of parts) {
    for (const other of part.issues) {
      if (other.code !== code) continue
      if (other.path === issue.path || other.path.startsWith(`${issue.path}/`)) return true
    }
  }
  return false
}
