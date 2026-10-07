/** 公式间距。文档里写死的数字照用；其余暂定，方便以后整份换成 operatorDict。 */

export const MATH_TAGS = new Set([
  'math',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mfrac',
  'msub',
  'msup',
  'msubsup',
  'msqrt',
  'mroot',
  'munder',
  'mover',
  'munderover',
  'mtable',
  'mtr',
  'mtd',
])

export const MFRAC_SCRIPT_SCALE = 0.85
export const MFRAC_GAP_EM = 0.28
export const SUP_SUB_SIZE_RATIO = 0.7
export const INTEGRAL_SIZE_RATIO = 1.35
export const MSQRT_SURD_WIDTH_EM = 0.7
export const MSQRT_SURD_WIDTH_RATIO = 0.08
/** 根号横线与被开方内容之间的缝，em 相对当前公式字号。 */
export const MSQRT_GAP_EM = 0.12
export const MTABLE_ROW_GAP_EM = 0.2
export const MTABLE_CELL_GAP_EM = 0.45

const REL_OPS = new Set(['=', '≈', '<', '>'])
const BIN_OPS = new Set(['+', '−', '-', '·', '×'])
const MOVABLE_LIMITS = new Set(['∑', '∏', '∐', '⋀', '⋁', '⋂', '⋃'])
const MOVABLE_WORDS = new Set(['lim', 'max', 'min', 'sup', 'inf'])
const INTEGRALS = new Set(['∫', '∬', '∭', '∮', '∯', '∰'])

export function moSpacingEm(op: string): { left: number; right: number } {
  const t = op.trim()
  if (REL_OPS.has(t)) return { left: 0.28, right: 0.28 }
  if (BIN_OPS.has(t)) return { left: 0.22, right: 0.22 }
  return { left: 0, right: 0 }
}

export function isMovableLimitsOp(text: string): boolean {
  const t = text.trim()
  if (MOVABLE_LIMITS.has(t)) return true
  return MOVABLE_WORDS.has(t.toLowerCase())
}

export function isIntegralOp(text: string): boolean {
  return INTEGRALS.has(text.trim())
}

export function mathRuleThicknessPx(fontSize: number): number {
  return Math.max(1, fontSize * 0.06)
}

export function surdWidthPx(fontSize: number, contentHeight: number): number {
  return fontSize * MSQRT_SURD_WIDTH_EM + contentHeight * MSQRT_SURD_WIDTH_RATIO
}
