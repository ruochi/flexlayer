import type { Issue } from './types.js'

/** 没有指定帧时抽查开头、中间和结尾。帧数不够时去掉重复。 */
export function sampleFrames(durationInFrames: number, explicit?: number): number[] {
  if (explicit != null) return [explicit]
  const last = Math.max(0, durationInFrames - 1)
  const mid = Math.floor(last / 2)
  return [...new Set([0, mid, last])].sort((a, b) => a - b)
}

/**
 * 同一 level、code、path、message 在多帧出现时合成一条。
 * `frame` 是第一次出现的帧，其余帧号写进消息。
 */
export function mergeFrameIssues(parts: Array<{ frame: number; issues: Issue[] }>): Issue[] {
  const groups = new Map<string, { issue: Issue; frames: number[] }>()
  for (const part of parts) {
    for (const issue of part.issues) {
      const key = `${issue.level}\0${issue.code}\0${issue.path}\0${issue.message}`
      const found = groups.get(key)
      if (!found) groups.set(key, { issue: { ...issue, frame: part.frame }, frames: [part.frame] })
      else if (!found.frames.includes(part.frame)) found.frames.push(part.frame)
    }
  }
  return [...groups.values()].map(({ issue, frames }) => {
    if (frames.length > 1) {
      issue.message = `${issue.message}（也出现在第 ${frames.slice(1).join('、')} 帧）`
    }
    return issue
  })
}
