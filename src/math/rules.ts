/** 公式的标签、运算符分类和间距。版式常量来自数学字体的 MATH 表，见 font.ts。 */

export const MATH_TAGS = new Set([
  'math',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mspace',
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
  'mstyle',
  'mphantom',
  'semantics',
  'annotation',
  'annotation-xml',
])

/** 行内公式的分子分母字号倍数。显示样式（`display="block"`）的最外层分数不缩小。 */
export const MFRAC_SCRIPT_SCALE = 0.85
/** 分数线左右各探出内容的宽度，em。 */
export const MFRAC_RULE_OVERHANG_EM = 0.08
/** 最小字号，相对 `<math>` 的字号。 */
export const SCRIPT_MIN_RATIO = 0.45
export const MTABLE_ROW_GAP_EM = 0.2
export const MTABLE_COLUMN_GAP_EM = 0.8
/** 矩阵每行至少这么高，em。上下各一段，相邻两行基线距离至少 1.2em。 */
export const MTABLE_STRUT_ASCENT_EM = 0.7
export const MTABLE_STRUT_DESCENT_EM = 0.3
/** `<math>` 的盒子把基线放在盒子中心下方这么远，和同字号的一行文字对齐。 */
export const MATH_BASELINE_BELOW_CENTER_EM = 0.35
export const MATH_STRUT_ASCENT_EM = 0.95
export const MATH_STRUT_DESCENT_EM = 0.25

/** TeX 的原子类别。决定相邻两项之间的空隙。 */
export type Atom = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' | 'inner' | 'none'

const ATOM_INDEX: Record<Exclude<Atom, 'none'>, number> = {
  ord: 0,
  op: 1,
  bin: 2,
  rel: 3,
  open: 4,
  close: 5,
  punct: 6,
  inner: 7,
}

/**
 * TeX 的原子间距表，单位 mu（1/18 em）。负数表示只在非上下标里生效。
 * 行：左边一项；列：右边一项。
 */
const SPACING: number[][] = [
  [0, 3, -4, -5, 0, 0, 0, -3],
  [3, 3, 0, -5, 0, 0, 0, -3],
  [-4, -4, 0, 0, -4, 0, 0, -4],
  [-5, -5, 0, 0, -5, 0, 0, -5],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 3, -4, -5, 0, 0, 0, -3],
  [-3, -3, 0, -3, -3, -3, -3, -3],
  [-3, 3, -4, -5, -3, 0, -3, -3],
]

export function atomSpacingMu(left: Atom, right: Atom, script: boolean): number {
  if (left === 'none' || right === 'none') return 0
  const v = SPACING[ATOM_INDEX[left]]![ATOM_INDEX[right]]!
  if (v < 0) return script ? 0 : -v
  return v
}

const REL_OPS = new Set(
  Array.from(
    '=≠<>≤≥≦≧≪≫≈≃≅≡≢∼≁∝≺≻⪯⪰∈∉∋∌⊂⊃⊆⊇⊄⊅⊊⊋→←↔⇒⇐⇔↦⟶⟵⟷⟹⟸⟺⟼↑↓↕⇑⇓∣∤∥∦⊥⊢⊣⊨:≔≕≝≐∶⇝↪↩⇀⇁⇌≍≜≟⩽⩾≲≳',
  ),
)
const BIN_OPS = new Set(Array.from('+−-±∓×÷·⋅∘∙∗*⊕⊖⊗⊘⊙∪∩∧∨⊎⊓⊔∖⋆◦⋄⊞⊠⋉⋊≀†‡⨯⊛⊚⊝'))
const OPEN_FENCES = new Set(Array.from('([{⟨⌈⌊⟦⦃⟮〈⦅⦇⟪'))
const CLOSE_FENCES = new Set(Array.from(')]}⟩⌉⌋⟧⦄⟯〉⦆⦈⟫!'))
const AMBIGUOUS_FENCES = new Set(Array.from('|‖∣∥'))
const PUNCT = new Set(Array.from(',;'))
const LARGE_OPS = new Set(Array.from('∑∏∐⋀⋁⋂⋃⨀⨁⨂⨄⨆∫∬∭∮∯∰∱∲∳⨌'))
const MOVABLE_LIMITS = new Set(Array.from('∑∏∐⋀⋁⋂⋃⨀⨁⨂⨄⨆'))
const INTEGRALS = new Set(Array.from('∫∬∭∮∯∰∱∲∳⨌'))
const MOVABLE_WORDS = new Set(['lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf', 'det', 'gcd', 'argmax', 'argmin'])
const VERTICAL_STRETCHY = new Set(Array.from('()[]{}⟨⟩⌈⌉⌊⌋⟦⟧|‖∣∥⟪⟫'))
const OVER_ACCENTS = new Set(Array.from('^ˆ\u0302~˜\u0303¯‾\u0305˙\u0307¨\u0308ˇ\u030C´`\u20D7→˘°˚'))
const UNDER_ACCENTS = new Set(Array.from('_‿\u0332'))
/** 上下的横线，画成一条和基座一样宽的线。 */
const BAR_CHARS = new Set(Array.from('¯‾_\u0305\u0332'))

/** 上方重音换成组合附加符号，数学字体只给这些字做了加宽的变体。 */
const ACCENT_GLYPHS: Record<string, string> = {
  '^': '\u0302',
  'ˆ': '\u0302',
  '~': '\u0303',
  '˜': '\u0303',
  '→': '\u20D7',
  '˙': '\u0307',
  '¨': '\u0308',
  'ˇ': '\u030C',
  '´': '\u0301',
  '`': '\u0300',
  '˘': '\u0306',
  '°': '\u030A',
  '˚': '\u030A',
}

export function accentGlyph(text: string): string {
  return ACCENT_GLYPHS[text.trim()] ?? text.trim()
}

const PRIMES = /^[′″‴⁗]+$/

export function isPrime(text: string): boolean {
  return PRIMES.test(text.trim())
}

/** `mo` 里常见的替身：连字符写成减号，星号写成运算星。 */
export function normalizeOperator(text: string): string {
  if (text === '-') return '−'
  if (text === '*') return '∗'
  if (text === "'") return '′'
  return text
}

export type OperatorInfo = {
  atom: Atom
  largeop: boolean
  movableLimits: boolean
  integral: boolean
  stretchy: boolean
  fence: boolean
}

export function operatorInfo(text: string, position: 'first' | 'last' | 'middle' | 'only'): OperatorInfo {
  const t = text.trim()
  const largeop = LARGE_OPS.has(t)
  let atom: Atom = 'ord'
  if (largeop || MOVABLE_WORDS.has(t.toLowerCase()) || /^[A-Za-z]{2,}$/.test(t)) atom = 'op'
  else if (REL_OPS.has(t)) atom = 'rel'
  else if (BIN_OPS.has(t)) atom = 'bin'
  else if (OPEN_FENCES.has(t)) atom = 'open'
  else if (CLOSE_FENCES.has(t)) atom = 'close'
  else if (PUNCT.has(t)) atom = 'punct'
  else if (AMBIGUOUS_FENCES.has(t)) atom = position === 'first' ? 'open' : position === 'last' ? 'close' : 'ord'
  return {
    atom,
    largeop,
    movableLimits: MOVABLE_LIMITS.has(t) || MOVABLE_WORDS.has(t.toLowerCase()),
    integral: INTEGRALS.has(t),
    stretchy: VERTICAL_STRETCHY.has(t),
    fence: OPEN_FENCES.has(t) || CLOSE_FENCES.has(t) || AMBIGUOUS_FENCES.has(t),
  }
}

export function isMovableWord(text: string): boolean {
  return MOVABLE_WORDS.has(text.trim().toLowerCase())
}

export function isOverAccent(text: string): boolean {
  return OVER_ACCENTS.has(text.trim())
}

export function isUnderAccent(text: string): boolean {
  return UNDER_ACCENTS.has(text.trim())
}

export function isBarChar(text: string): boolean {
  return BAR_CHARS.has(text.trim())
}

type Alphabet = { upper?: number; lower?: number; digit?: number; greekUpper?: number; greekLower?: number; holes?: Record<string, number> }

/** Unicode 数学字母区。缺的字母落在“字母类符号”区，写在 holes 里。 */
const ALPHABETS: Record<string, Alphabet> = {
  bold: { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce, greekUpper: 0x1d6a8, greekLower: 0x1d6c2 },
  italic: { upper: 0x1d434, lower: 0x1d44e, greekUpper: 0x1d6e2, greekLower: 0x1d6fc, holes: { h: 0x210e } },
  'bold-italic': { upper: 0x1d468, lower: 0x1d482, greekUpper: 0x1d71c, greekLower: 0x1d736 },
  'double-struck': {
    upper: 0x1d538,
    lower: 0x1d552,
    digit: 0x1d7d8,
    holes: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
  },
  script: {
    upper: 0x1d49c,
    lower: 0x1d4b6,
    holes: { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b, e: 0x212f, g: 0x210a, o: 0x2134 },
  },
  fraktur: { upper: 0x1d504, lower: 0x1d51e, holes: { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 } },
  'sans-serif': { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
}

export const MATH_VARIANTS = new Set(['normal', ...Object.keys(ALPHABETS)])

/** 把文字换到数学字母区。不认识的字照原样留下。 */
export function mapMathVariant(text: string, variant: string): string {
  const alphabet = ALPHABETS[variant]
  if (!alphabet) return text
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const hole = alphabet.holes?.[ch]
    if (hole) out += String.fromCodePoint(hole)
    else if (alphabet.upper && cp >= 0x41 && cp <= 0x5a) out += String.fromCodePoint(alphabet.upper + cp - 0x41)
    else if (alphabet.lower && cp >= 0x61 && cp <= 0x7a) out += String.fromCodePoint(alphabet.lower + cp - 0x61)
    else if (alphabet.digit && cp >= 0x30 && cp <= 0x39) out += String.fromCodePoint(alphabet.digit + cp - 0x30)
    else if (alphabet.greekUpper && cp >= 0x391 && cp <= 0x3a9 && cp !== 0x3a2) out += String.fromCodePoint(alphabet.greekUpper + cp - 0x391)
    else if (alphabet.greekLower && cp >= 0x3b1 && cp <= 0x3c9) out += String.fromCodePoint(alphabet.greekLower + cp - 0x3b1)
    else out += ch
  }
  return out
}

/** 单个字母的 `mi` 默认斜体：拉丁字母和小写希腊字母。大写希腊字母保持直立。 */
export function autoItalic(text: string): boolean {
  const chars = Array.from(text)
  if (chars.length !== 1) return false
  const cp = chars[0]!.codePointAt(0)!
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0x3b1 && cp <= 0x3c9)
}
