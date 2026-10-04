type PathCommand = { op: string; args: number[] }

const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
}

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)/g

function num(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** 把 SVG 路径拆成显式命令。M/m 之后隐式重复的点按 L/l 处理。 */
export function parseSvgPath(d: string): PathCommand[] {
  const tokens: Array<string | number> = []
  for (const match of d.matchAll(TOKEN)) {
    tokens.push(match[1] ?? Number(match[2]))
  }
  const out: PathCommand[] = []
  let i = 0
  let cmd = 'M'
  while (i < tokens.length) {
    const token = tokens[i]
    if (typeof token === 'string') {
      cmd = token
      i++
      if (cmd === 'Z' || cmd === 'z') {
        out.push({ op: cmd, args: [] })
        continue
      }
    }
    const count = ARITY[cmd.toUpperCase()]
    if (count == null) break
    if (i + count > tokens.length) break
    const args: number[] = []
    for (let k = 0; k < count; k++) args.push(Number(tokens[i + k]))
    i += count
    out.push({ op: cmd, args })
    if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
  }
  return out
}

function translateArgs(op: string, args: number[], dx: number, dy: number): number[] {
  const next = args.slice()
  const upper = op.toUpperCase()
  if (op !== upper) return next
  if (upper === 'H') next[0] = (next[0] ?? 0) + dx
  else if (upper === 'V') next[0] = (next[0] ?? 0) + dy
  else if (upper === 'A') {
    next[5] = (next[5] ?? 0) + dx
    next[6] = (next[6] ?? 0) + dy
  } else {
    for (let i = 0; i + 1 < next.length; i += 2) {
      next[i] = (next[i] ?? 0) + dx
      next[i + 1] = (next[i + 1] ?? 0) + dy
    }
  }
  return next
}

export function serializeSvgPath(commands: PathCommand[]): string {
  return commands
    .map((command) => {
      if (command.args.length === 0) return command.op
      return `${command.op} ${command.args.map(num).join(' ')}`
    })
    .join(' ')
}

/**
 * 把路径整体平移。绝对坐标加上偏移，相对命令保持原样。
 * 绘制时路径要落在盒子局部坐标里，所以这里传入的是盒子原点的相反数。
 */
export function translateSvgPath(d: string, dx: number, dy: number): string {
  if (!d.trim() || (dx === 0 && dy === 0)) return d
  const commands = parseSvgPath(d).map((command) => ({
    op: command.op,
    args: translateArgs(command.op, command.args, dx, dy),
  }))
  return serializeSvgPath(commands)
}

export type PathRing = { points: Array<{ x: number; y: number }>; closed: boolean }

function pushPoint(points: Array<{ x: number; y: number }>, x: number, y: number) {
  const last = points[points.length - 1]
  if (last && Math.abs(last.x - x) < 1e-6 && Math.abs(last.y - y) < 1e-6) return
  points.push({ x, y })
}

function sampleCubic(
  points: Array<{ x: number; y: number }>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  steps: number,
) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    pushPoint(
      points,
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    )
  }
}

function sampleQuad(
  points: Array<{ x: number; y: number }>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  steps: number,
) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    pushPoint(points, u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2)
  }
}

function sampleArc(
  points: Array<{ x: number; y: number }>,
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
) {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return
  if (rx === 0 || ry === 0) {
    pushPoint(points, x2, y2)
    return
  }
  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) {
    const s = Math.sqrt(lam)
    rx *= s
    ry *= s
  }
  const sign = large === sweep ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const coef = sign * Math.sqrt(Math.max(0, num / (den || 1)))
  const cxp = (coef * rx * y1p) / ry
  const cyp = (coef * -ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1
    let ang = Math.acos(Math.min(1, Math.max(-1, dot / len)))
    if (ux * vy - uy * vx < 0) ang = -ang
    return ang
  }
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dtheta > 0) dtheta -= Math.PI * 2
  if (sweep && dtheta < 0) dtheta += Math.PI * 2
  const steps = Math.max(2, Math.ceil(Math.abs(dtheta) / (Math.PI / 8)))
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (dtheta * i) / steps
    const ct = Math.cos(t)
    const st = Math.sin(t)
    pushPoint(points, cos * rx * ct - sin * ry * st + cx, sin * rx * ct + cos * ry * st + cy)
  }
}

/** 把 SVG 路径收成折线环。曲线和圆弧会采样。坐标仍是路径自己的 y 向下。 */
export function tessellateSvgPath(d: string, steps = 8): PathRing[] {
  const rings: PathRing[] = []
  let ring: Array<{ x: number; y: number }> | null = null
  let closed = false
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let lastCx = 0
  let lastCy = 0
  let lastQx = 0
  let lastQy = 0
  let cubic = false
  let quad = false
  const flush = () => {
    if (ring && ring.length > 0) rings.push({ points: ring, closed })
    ring = null
    closed = false
  }
  const start = (x: number, y: number) => {
    flush()
    ring = []
    pushPoint(ring, x, y)
    cx = sx = x
    cy = sy = y
  }
  const abs = (op: string, args: number[], ix: number, iy: number) => {
    if (op === op.toUpperCase()) return { x: args[ix] ?? 0, y: args[iy] ?? 0 }
    return { x: cx + (args[ix] ?? 0), y: cy + (args[iy] ?? 0) }
  }
  for (const command of parseSvgPath(d)) {
    const op = command.op
    const upper = op.toUpperCase()
    const rel = op !== upper
    if (upper !== 'C' && upper !== 'S') cubic = false
    if (upper !== 'Q' && upper !== 'T') quad = false
    if (upper === 'M') {
      const p = abs(op, command.args, 0, 1)
      start(p.x, p.y)
      continue
    }
    if (!ring) start(cx, cy)
    if (upper === 'Z') {
      closed = true
      cx = sx
      cy = sy
      flush()
      continue
    }
    if (upper === 'L') {
      const p = abs(op, command.args, 0, 1)
      pushPoint(ring!, p.x, p.y)
      cx = p.x
      cy = p.y
    } else if (upper === 'H') {
      const x = rel ? cx + (command.args[0] ?? 0) : (command.args[0] ?? 0)
      pushPoint(ring!, x, cy)
      cx = x
    } else if (upper === 'V') {
      const y = rel ? cy + (command.args[0] ?? 0) : (command.args[0] ?? 0)
      pushPoint(ring!, cx, y)
      cy = y
    } else if (upper === 'C') {
      const c1 = abs(op, command.args, 0, 1)
      const c2 = abs(op, command.args, 2, 3)
      const p = abs(op, command.args, 4, 5)
      sampleCubic(ring!, cx, cy, c1.x, c1.y, c2.x, c2.y, p.x, p.y, steps)
      lastCx = c2.x
      lastCy = c2.y
      cubic = true
      cx = p.x
      cy = p.y
    } else if (upper === 'S') {
      const c1 = cubic ? { x: 2 * cx - lastCx, y: 2 * cy - lastCy } : { x: cx, y: cy }
      const c2 = abs(op, command.args, 0, 1)
      const p = abs(op, command.args, 2, 3)
      sampleCubic(ring!, cx, cy, c1.x, c1.y, c2.x, c2.y, p.x, p.y, steps)
      lastCx = c2.x
      lastCy = c2.y
      cubic = true
      cx = p.x
      cy = p.y
    } else if (upper === 'Q') {
      const c1 = abs(op, command.args, 0, 1)
      const p = abs(op, command.args, 2, 3)
      sampleQuad(ring!, cx, cy, c1.x, c1.y, p.x, p.y, steps)
      lastQx = c1.x
      lastQy = c1.y
      quad = true
      cx = p.x
      cy = p.y
    } else if (upper === 'T') {
      const c1 = quad ? { x: 2 * cx - lastQx, y: 2 * cy - lastQy } : { x: cx, y: cy }
      const p = abs(op, command.args, 0, 1)
      sampleQuad(ring!, cx, cy, c1.x, c1.y, p.x, p.y, steps)
      lastQx = c1.x
      lastQy = c1.y
      quad = true
      cx = p.x
      cy = p.y
    } else if (upper === 'A') {
      const rx = command.args[0] ?? 0
      const ry = command.args[1] ?? 0
      const rot = command.args[2] ?? 0
      const large = command.args[3] ?? 0
      const sweep = command.args[4] ?? 0
      const p = abs(op, command.args, 5, 6)
      sampleArc(ring!, cx, cy, rx, ry, rot, large ? 1 : 0, sweep ? 1 : 0, p.x, p.y)
      cx = p.x
      cy = p.y
    }
  }
  flush()
  return rings
}
