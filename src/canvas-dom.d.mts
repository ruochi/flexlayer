import type { Canvas } from '@napi-rs/canvas'

export type CanvasDomSpec = {
  path: string
  id?: string
  width: number
  height: number
  bitmapWidth: number
  bitmapHeight: number
  x: number
  y: number
  style: Record<string, string>
  computed: { color: string; fontFamily: string; fontSize: number; fontWeight: number; opacity: number }
  text: string
  attrs: Record<string, string>
  rgba?: string
}

export type CanvasDomScript = {
  path: string
  body?: string
}

export type CanvasDomInput = {
  canvases: CanvasDomSpec[]
  scripts?: CanvasDomScript[]
  timeMs: number
  fps: number
  frame: number
  dpr: number
  seed: number
  sources?: Record<string, string>
}

export type CanvasDomIssue = {
  level: 'error' | 'warn' | 'info'
  code: string
  path: string
  message: string
  hint?: string
  source?: string
}

export type CanvasSession = {
  installGlobals(): void
  restoreGlobals(): void
  run(body: string, path: string): void
  runFn(fn: () => void, path: string): void
  flush(): void
  readonly issues: CanvasDomIssue[]
  live(): Array<{ path: string; canvas: Canvas }>
  exportJSON(): { issues: CanvasDomIssue[]; canvases: Array<{ path: string; width: number; height: number; rgba: string }> }
}

export function createCanvasSession(input: CanvasDomInput): CanvasSession
