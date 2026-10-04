import type { FvgNode } from './parse.js'
import type { DrawFn, Issue } from './types.js'

const ALLOWED_FREE = new Set([
  'Math',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'Date',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'undefined',
  'NaN',
  'Infinity',
  'console',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'URIError',
  'Symbol',
  'BigInt',
  'Intl',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
])

const KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'return',
  'new',
  'typeof',
  'instanceof',
  'in',
  'of',
  'void',
  'delete',
  'await',
  'async',
  'yield',
  'try',
  'catch',
  'finally',
  'throw',
  'import',
  'export',
  'from',
  'default',
  'extends',
  'super',
  'this',
  'with',
  'debugger',
  'true',
  'false',
  'null',
  'class',
  'const',
  'let',
  'var',
  'function',
])

export type EmitResult = {
  source: string
  issues: Issue[]
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

/** 把字符串和注释换成空白，模板里的 `${}` 表达式留下来。 */
function blankLiterals(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]!
    const n = code[i + 1]
    if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (c === '/' && n === '*') {
      out += '  '
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' '
        i++
      }
      out += '  '
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      out += ' '
      i++
      while (i < code.length) {
        if (code[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        if (code[i] === c) {
          out += ' '
          i++
          break
        }
        out += code[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (c === '`') {
      out += ' '
      i++
      while (i < code.length) {
        if (code[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          out += '  '
          i += 2
          let depth = 1
          while (i < code.length && depth > 0) {
            if (code[i] === '{') depth++
            else if (code[i] === '}') depth--
            if (depth === 0) {
              out += ' '
              i++
              break
            }
            out += code[i]!
            i++
          }
          continue
        }
        if (code[i] === '`') {
          out += ' '
          i++
          break
        }
        out += code[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

function readPattern(source: string, start: number, names: Set<string>): number {
  let i = start
  while (i < source.length && /\s/.test(source[i]!)) i++
  if (i >= source.length) return i
  const open = source[i]
  if (open !== '{' && open !== '[') {
    const ident = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))
    if (ident) names.add(ident[0])
    return i + (ident?.[0].length ?? 0)
  }
  const close = open === '{' ? '}' : ']'
  i++
  while (i < source.length && source[i] !== close) {
    while (i < source.length && /[\s,]/.test(source[i]!)) i++
    if (source[i] === close) break
    if (source[i] === '{' || source[i] === '[') {
      i = readPattern(source, i, names)
      continue
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))
    if (!ident) {
      i++
      continue
    }
    i += ident[0].length
    let j = i
    while (j < source.length && /\s/.test(source[j]!)) j++
    if (open === '{' && source[j] === ':') {
      i = readPattern(source, j + 1, names)
      continue
    }
    names.add(ident[0])
  }
  return i + 1
}

function declaredNames(stripped: string, params: string[]): Set<string> {
  const names = new Set(params)
  const re = /\b(?:const|let|var|function|class|catch)\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(stripped)) !== null) {
    let i = match.index + match[0].length
    if (match[0] === 'catch') {
      while (i < stripped.length && stripped[i] !== '(' && stripped[i] !== '{') i++
      if (stripped[i] === '(') i++
    }
    const end = readPattern(stripped, i, names)
    if (match[0] !== 'catch') {
      let j = end
      while (j < stripped.length && stripped[j] !== '=' && stripped[j] !== ';' && stripped[j] !== '\n') {
        if (stripped[j] === ',') {
          j = readPattern(stripped, j + 1, names)
          continue
        }
        j++
      }
    }
  }
  return names
}

function freeIdentifiers(body: string, params: string[]): string[] {
  const stripped = blankLiterals(body)
  const declared = declaredNames(stripped, params)
  const found: string[] = []
  const seen = new Set<string>()
  const re = /[A-Za-z_$][\w$]*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(stripped)) !== null) {
    const name = match[0]
    const prev = stripped[match.index - 1]
    if (prev === '.') continue
    if (declared.has(name) || KEYWORDS.has(name) || ALLOWED_FREE.has(name) || seen.has(name)) continue
    seen.add(name)
    found.push(name)
  }
  return found
}

function paramNames(raw: string): string[] {
  const bucket = new Set<string>()
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) readPattern(trimmed, 0, bucket)
  else {
    for (const part of trimmed.split(',')) {
      const ident = /[A-Za-z_$][\w$]*/.exec(part)
      if (ident) bucket.add(ident[0])
    }
  }
  return [...bucket]
}

type SplitFn = { params: string[]; body: string }

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i++
  return i
}

function extractFunction(text: string): SplitFn | null {
  const src = text.trim()
  if (!src || src.includes('[native code]')) return null
  let i = 0
  if (src.startsWith('async')) i = skipSpace(src, 5)
  if (src.startsWith('function', i)) {
    i = skipSpace(src, i + 8)
    const name = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))
    if (name && name[0] !== 'constructor') i += name[0].length
    i = skipSpace(src, i)
    if (src[i] !== '(') return null
    const close = src.indexOf(')', i)
    if (close < 0) return null
    const params = paramNames(src.slice(i + 1, close))
    const brace = src.indexOf('{', close)
    if (brace < 0) return null
    return { params, body: src.slice(brace + 1, src.lastIndexOf('}')) }
  }
  const arrow = src.indexOf('=>')
  if (arrow < 0) return null
  let paramsRaw = src.slice(i, arrow).trim()
  if (paramsRaw.startsWith('(') && paramsRaw.endsWith(')')) paramsRaw = paramsRaw.slice(1, -1)
  const params = paramNames(paramsRaw)
  let body = src.slice(arrow + 2).trim()
  if (body.startsWith('{')) body = body.slice(1, body.lastIndexOf('}'))
  else body = `return ${body}`
  return { params, body }
}

function drawIssue(path: string, message: string, hint: string): Issue {
  return { level: 'warn', code: 'emit-draw', path, message, hint }
}

function emitDraw(fn: DrawFn, path: string, indent: string, issues: Issue[]): string {
  const extracted = extractFunction(Function.prototype.toString.call(fn))
  if (!extracted) {
    issues.push(drawIssue(path, '读不出 draw 函数的源码，没有写回 <draw>', '把绘制写进只使用 ctx 和 el 的函数，或手写 <draw>'))
    return ''
  }
  const free = freeIdentifiers(extracted.body, extracted.params)
  if (free.length > 0) {
    const listed = free.slice(0, 4).join('、')
    issues.push(
      drawIssue(
        path,
        `draw 引用了外部变量 ${listed}，写回的 <draw> 读不到`,
        'draw 里只用 ctx 和 el。颜色和尺寸写进 el.attr，或继续用 .tsx 渲染',
      ),
    )
  }
  const body = extracted.body.replace(/<\//g, '<\\/').replace(/^\n/, '').replace(/\s+$/, '')
  if (!body.trim()) {
    issues.push(drawIssue(path, 'draw 函数体是空的', '写入 canvas 绘制代码，例如 ctx.fillRect(0, 0, el.w, el.h)'))
    return ''
  }
  const pad = `${indent}  `
  const lines = body.split('\n').map((line) => (line.trim() ? `${pad}${line.trimEnd()}` : ''))
  return `${indent}<draw>\n${lines.join('\n')}\n${indent}</draw>\n`
}

function emitNode(node: FvgNode, indent: string, path: string, issues: Issue[]): string {
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('')
  const childIndent = `${indent}  `
  const parts: string[] = []
  let elementIndex = 0
  for (const child of node.children) {
    if (typeof child === 'string') {
      if (child.length > 0) parts.push(`${childIndent}${escapeText(child)}\n`)
      continue
    }
    parts.push(emitNode(child, childIndent, `${path}/${child.tag}[${elementIndex}]`, issues))
    elementIndex++
  }
  if (node.draw) parts.push(emitDraw(node.draw, path, childIndent, issues))
  if (parts.length === 0) return `${indent}<${node.tag}${attrs} />\n`
  return `${indent}<${node.tag}${attrs}>\n${parts.join('')}${indent}</${node.tag}>\n`
}

/** 把节点树写回 `.layer` 文本。闭包里的 draw 会留下 warn，仍然写出函数体。 */
export function emitLayer(node: FvgNode): EmitResult {
  const issues: Issue[] = []
  const source = emitNode(node, '', 'layer', issues).replace(/\n$/, '')
  return { source: `${source}\n`, issues }
}
