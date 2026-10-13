import { ensureGradeFilter, ensureGradeFilterSync, gradeReady } from './filter.js'
import { ensureMathLayout, ensureMathLayoutSync, mathReady } from './math/load.js'
import { MATH_TAGS } from './math/rules.js'
import type { LayerNode } from './parse.js'

const MATH_TAG_SOURCE =
  'math|mrow|mi|mn|mo|mtext|mspace|mfrac|msubsup|msub|msup|msqrt|mroot|munderover|munder|mover|mtable|mtr|mtd|mstyle|mphantom|semantics|annotation-xml|annotation'

function sourceNeedsMath(source: string): boolean {
  const tag = new RegExp(`<\\s*(?:${MATH_TAG_SOURCE})\\b`, 'i')
  if (tag.test(source)) return true
  const call = new RegExp(`\\bh\\(\\s*['"](?:${MATH_TAG_SOURCE})['"]`)
  return call.test(source)
}

function sourceNeedsGrade(source: string): boolean {
  return /\bgrade(?:-mask)?\s*=/.test(source) || /['"]grade(?:-mask)?['"]\s*:/.test(source)
}

export function authorNeeds(root: LayerNode): { math: boolean; grade: boolean } {
  let math = false
  let grade = false
  const walk = (node: LayerNode) => {
    if (MATH_TAGS.has(node.tag.toLowerCase())) math = true
    const attrs = node.attrs
    if ((attrs.grade != null && attrs.grade !== '') || (attrs['grade-mask'] != null && attrs['grade-mask'] !== '')) grade = true
    for (const child of node.children) {
      if (typeof child !== 'string') walk(child)
    }
  }
  walk(root)
  return { math, grade }
}

/** 排版之前。没写公式或 grade 时什么模块都不装。 */
export async function ensureAuthorFeatures(root: LayerNode): Promise<void> {
  const need = authorNeeds(root)
  if (need.math) await ensureMathLayout()
  if (need.grade) await ensureGradeFilter()
}

/** 同步排版入口。异步准备已经装过的模块在这里只是确认。 */
export function installAuthorFeaturesSync(root: LayerNode): void {
  const need = authorNeeds(root)
  if (need.math && !mathReady()) ensureMathLayoutSync()
  if (need.grade && !gradeReady()) ensureGradeFilterSync()
}

/** 执行 .tsx 之前扫源码。`canvas.create` 在模块求值时就会排版，来不及再等。 */
export async function ensureAuthorSource(source: string): Promise<void> {
  if (sourceNeedsMath(source)) await ensureMathLayout()
  if (sourceNeedsGrade(source)) await ensureGradeFilter()
}
