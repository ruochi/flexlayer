import { extname } from 'node:path'
import ts from 'typescript'

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

const NONDET_CALLS = new Set(['Math.random', 'Date.now', 'crypto.randomUUID', 'crypto.getRandomValues'])

const LEXICAL = ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using

type ValueFunction =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration

type Scope = { names: Set<string>; parent: Scope | null }

export type DrawSource = { body: string; free: string[] }

export type CallSite = { name: string; line: number; column: number }

function childScope(parent: Scope | null): Scope {
  return { names: new Set(), parent }
}

function resolves(scope: Scope | null, name: string): boolean {
  for (let current = scope; current; current = current.parent) {
    if (current.names.has(name)) return true
  }
  return false
}

function isVarList(list: ts.VariableDeclarationList): boolean {
  return (list.flags & LEXICAL) === 0
}

function isValueFunction(node: ts.Node): node is ValueFunction {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

function bindName(name: ts.BindingName, scope: Scope): void {
  if (ts.isIdentifier(name)) {
    scope.names.add(name.text)
    return
  }
  for (const element of name.elements) {
    if (!ts.isBindingElement(element)) continue
    bindName(element.name, scope)
  }
}

function bindList(list: ts.VariableDeclarationList, scope: Scope): void {
  for (const decl of list.declarations) bindName(decl.name, scope)
}

function bindLexicalStatement(stmt: ts.Statement, scope: Scope): void {
  if (ts.isVariableStatement(stmt) && !isVarList(stmt.declarationList)) bindList(stmt.declarationList, scope)
  else if ((ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
    scope.names.add(stmt.name.text)
  }
}

/** `var` 提升到函数。停在内层函数和 class，不把它们的 var 算进来。 */
function bindHoistedVars(node: ts.Node, scope: Scope): void {
  if (ts.isVariableDeclarationList(node) && isVarList(node)) bindList(node, scope)
  ts.forEachChild(node, (child) => {
    if (isValueFunction(child) || ts.isClassLike(child)) return
    bindHoistedVars(child, scope)
  })
}

function isReference(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!parent) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false
  if (ts.isMethodSignature(parent) && parent.name === node) return false
  if ((ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) && parent.name === node) return false
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false
  if (ts.isEnumMember(parent) && parent.name === node) return false
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false
  if (ts.isParameter(parent) && parent.name === node) return false
  if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) && parent.name === node) return false
  if ((ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) && parent.name === node) return false
  if (ts.isLabeledStatement(parent) && parent.label === node) return false
  if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return false
  if (ts.isMetaProperty(parent)) return false
  if (ts.isJsxAttribute(parent) && parent.name === node) return false
  if (
    (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) &&
    parent.tagName === node
  ) {
    return /^[A-Z_$]/.test(node.text)
  }
  return true
}

function noteFree(node: ts.Identifier, scope: Scope, free: string[], seen: Set<string>): void {
  if (!isReference(node)) return
  const name = node.text
  if (resolves(scope, name) || ALLOWED_FREE.has(name) || seen.has(name)) return
  seen.add(name)
  free.push(name)
}

function visit(node: ts.Node, scope: Scope, free: string[], seen: Set<string>): void {
  if (isValueFunction(node)) {
    visitFunction(node, scope, free, seen)
    return
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    visitClass(node, scope, free, seen)
    return
  }
  if (ts.isBlock(node)) {
    visitBlock(node, scope, free, seen)
    return
  }
  if (ts.isForStatement(node)) {
    visitFor(node, scope, free, seen)
    return
  }
  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    visitForInOf(node, scope, free, seen)
    return
  }
  if (ts.isTryStatement(node)) {
    visit(node.tryBlock, scope, free, seen)
    if (node.catchClause) {
      const caught = childScope(scope)
      const binding = node.catchClause.variableDeclaration
      if (binding) bindName(binding.name, caught)
      visit(node.catchClause.block, caught, free, seen)
    }
    if (node.finallyBlock) visit(node.finallyBlock, scope, free, seen)
    return
  }
  if (ts.isSwitchStatement(node)) {
    visit(node.expression, scope, free, seen)
    const inner = childScope(scope)
    for (const clause of node.caseBlock.clauses) {
      for (const stmt of clause.statements) bindLexicalStatement(stmt, inner)
    }
    for (const clause of node.caseBlock.clauses) {
      for (const stmt of clause.statements) visit(stmt, inner, free, seen)
    }
    return
  }
  if (ts.isIdentifier(node)) {
    noteFree(node, scope, free, seen)
    return
  }
  ts.forEachChild(node, (child) => visit(child, scope, free, seen))
}

function visitBlock(node: ts.Block, scope: Scope, free: string[], seen: Set<string>): void {
  const inner = childScope(scope)
  for (const stmt of node.statements) bindLexicalStatement(stmt, inner)
  for (const stmt of node.statements) visit(stmt, inner, free, seen)
}

function visitFunction(fn: ValueFunction, parent: Scope | null, free: string[], seen: Set<string>): void {
  const scope = childScope(parent)
  if ((ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) && fn.name) scope.names.add(fn.name.text)
  for (const param of fn.parameters) bindName(param.name, scope)
  if (fn.body && ts.isBlock(fn.body)) bindHoistedVars(fn.body, scope)
  for (const param of fn.parameters) {
    if (param.initializer) visit(param.initializer, scope, free, seen)
  }
  if (fn.body) visit(fn.body, scope, free, seen)
}

function visitClass(node: ts.ClassDeclaration | ts.ClassExpression, scope: Scope, free: string[], seen: Set<string>): void {
  const inner = childScope(scope)
  if (ts.isClassExpression(node) && node.name) inner.names.add(node.name.text)
  for (const heritage of node.heritageClauses ?? []) visit(heritage, scope, free, seen)
  for (const member of node.members) visit(member, inner, free, seen)
}

function visitDeclarators(list: ts.VariableDeclarationList, scope: Scope, free: string[], seen: Set<string>): void {
  for (const decl of list.declarations) {
    if (decl.initializer) visit(decl.initializer, scope, free, seen)
  }
}

function visitFor(node: ts.ForStatement, scope: Scope, free: string[], seen: Set<string>): void {
  const inner = childScope(scope)
  if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
    const lexical = !isVarList(node.initializer)
    if (lexical) bindList(node.initializer, inner)
    visitDeclarators(node.initializer, lexical ? inner : scope, free, seen)
  } else if (node.initializer) visit(node.initializer, scope, free, seen)
  if (node.condition) visit(node.condition, inner, free, seen)
  if (node.incrementor) visit(node.incrementor, inner, free, seen)
  visit(node.statement, inner, free, seen)
}

function visitForInOf(node: ts.ForInStatement | ts.ForOfStatement, scope: Scope, free: string[], seen: Set<string>): void {
  const inner = childScope(scope)
  if (ts.isVariableDeclarationList(node.initializer)) {
    if (!isVarList(node.initializer)) bindList(node.initializer, inner)
  } else visit(node.initializer, scope, free, seen)
  visit(node.expression, scope, free, seen)
  visit(node.statement, inner, free, seen)
}

function parseDiagnostics(sf: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
}

function scriptKind(fileName: string): ts.ScriptKind {
  switch (extname(fileName).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.ts':
      return ts.ScriptKind.TS
    default:
      return ts.ScriptKind.JS
  }
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/** 从 `Function#toString` 的结果里取出函数体，并列出函数里读不到的名字。解析失败返回 null。 */
export function readDrawFunction(source: string): DrawSource | null {
  const text = source.trim()
  if (!text || text.includes('[native code]')) return null
  const sf = ts.createSourceFile('draw.js', `(${text}\n)`, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  if (parseDiagnostics(sf).length > 0) return null
  const stmt = sf.statements[0]
  if (!stmt || !ts.isExpressionStatement(stmt)) return null
  const expr = unwrap(stmt.expression)
  if (!ts.isArrowFunction(expr) && !ts.isFunctionExpression(expr)) return null
  if (!expr.body) return null
  const body = ts.isBlock(expr.body)
    ? expr.body.getText(sf).replace(/^\{/, '').replace(/\}$/, '')
    : `return ${expr.body.getText(sf)}`
  const free: string[] = []
  visitFunction(expr, null, free, new Set())
  return { body, free }
}

function propertyCallName(expression: ts.Expression): string | undefined {
  const callee = unwrap(expression)
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression) || !ts.isIdentifier(callee.name)) return
  return `${callee.expression.text}.${callee.name.text}`
}

/** 源码里真正调用了 `Math.random()` 这一类函数的位置。字符串、注释和类型位置不算。 */
export function nondeterministicCalls(source: string, fileName: string): CallSite[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, scriptKind(fileName))
  const found: CallSite[] = []
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = propertyCallName(node.expression)
      if (name && NONDET_CALLS.has(name)) {
        const start = node.expression.getStart(sf)
        const pos = sf.getLineAndCharacterOfPosition(start)
        found.push({ name, line: pos.line + 1, column: pos.character + 1 })
      }
    }
    if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}
