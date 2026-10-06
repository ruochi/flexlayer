import type { CanvasRenderingContext2D } from '@napi-rs/canvas'
import { h, interpolate, spring, type Composition, type DrawElSnapshot, type FvgNode } from '../src/index.js'

const W = 1920
const H = 1080
const FPS = 30
const DURATION = 990
const LAST_T = (DURATION - 1) / FPS

const BG = '#0e1219'
const INK = '#f4f1ea'
const MUTED = '#9aa6b5'
const IDLE = '#334054'
const A = '#3ecfc4'
const B = '#7aa2ff'
const C = '#f5c16c'
const TRI = '#ff8a7a'

type Pt = [number, number]
type EquationPart = string | [string, string]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (v: number) => v * v * (3 - 2 * v)
/** `from` 到 `to` 之间从 0 平滑升到 1。 */
const ramp = (frame: number, from: number, to: number) => smooth(interpolate(frame, [from, to], [0, 1]))
/** 在 `from` 淡入、在 `to` 淡出，区间外为 0。 */
const envelope = (frame: number, from: number, to: number, fade: number) =>
  Math.min(ramp(frame, from, from + fade), 1 - ramp(frame, to - fade, to))
const pop = (frame: number, from: number) =>
  spring({ frame: frame - from, fps: FPS, config: { damping: 11, stiffness: 140 } })

const n = (v: number) => String(Math.round(v * 100) / 100)
const add = (p: Pt, q: Pt, k = 1): Pt => [p[0] + q[0] * k, p[1] + q[1] * k]
const lerp = (p: Pt, q: Pt, k: number): Pt => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]
const points = (list: Pt[]) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')

function chip(content: string, color: string, size: number) {
  return h(
    'div',
    {
      style: `padding:2px ${Math.round(size * 0.4)}px; border-radius:${Math.round(size * 0.3)}px; background:${color}; color:${BG}; font-size:${size}px`,
    },
    content,
  )
}

function equation(parts: EquationPart[], size: number, gap: number, opacity = 1) {
  return h(
    'div',
    { style: `display:flex; gap:${gap}px; align-items:center; opacity:${n(opacity)}` },
    ...parts.map((part) =>
      typeof part === 'string'
        ? h('p', { style: `font-size:${size}px; color:${INK}` }, part)
        : chip(part[0], part[1], size),
    ),
  )
}

function label(content: string, color: string, at: Pt, anchor: string, opacity: number, size = 48) {
  return h(
    'layer',
    { x: n(at[0]), y: n(at[1]), anchor, opacity: n(opacity) },
    h('p', { style: `font-size:${size}px; color:${color}` }, content),
  )
}

function drawDots(ctx: CanvasRenderingContext2D, el: DrawElSnapshot) {
  const step = 48
  const drift = (el.t * 6) % step
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  for (let y = step / 2; y < el.h; y += step) {
    for (let x = drift - step; x < el.w + step; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function pill(ctx: CanvasRenderingContext2D, width: number, height: number) {
  if (width <= 0) return
  const r = Math.min(height / 2, width / 2)
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(width - r, 0)
  ctx.arc(width - r, r, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(r, height)
  ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5)
  ctx.closePath()
  ctx.fill()
}

function drawProgress(ctx: CanvasRenderingContext2D, el: DrawElSnapshot) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  pill(ctx, el.w, el.h)
  ctx.fillStyle = C
  pill(ctx, el.w * clamp01(el.t / LAST_T), el.h)
}

function intro(frame: number) {
  const opacity = 1 - ramp(frame, 80, 98)
  const rise = pop(frame, 0)
  return h(
    'layer',
    { x: '960', y: n(540 + (1 - rise) * 40), anchor: 'center', opacity: n(opacity) },
    h(
    'div',
    { style: 'display:flex; flex-direction:column; gap:36px; align-items:center' },
    h('h1', { style: `font-size:150px; color:${INK}; opacity:${n(ramp(frame, 0, 18))}` }, '勾股定理'),
    h('p', { style: `font-size:52px; color:${MUTED}; opacity:${n(ramp(frame, 14, 32))}` }, '直角三角形三条边之间的关系'),
    equation([['a²', A], '+', ['b²', B], '=', ['c²', C]], 72, 20, ramp(frame, 28, 46)),
    ),
  )
}

const STEPS = ['三角形', '正方形', '拼图', '结论']

function stepIndex(frame: number) {
  if (frame < 300) return 0
  if (frame < 520) return 1
  if (frame < 870) return 2
  return 3
}

function header(frame: number) {
  const opacity = ramp(frame, 90, 110)
  const active = stepIndex(frame)
  return h(
    'layer',
    { x: '120', y: '64', anchor: 'top-left', opacity: n(opacity) },
    h(
    'div',
    { style: 'display:flex; gap:40px; align-items:center' },
    h('h2', { style: `font-size:56px; color:${INK}` }, '勾股定理'),
    h(
      'div',
      { style: 'display:flex; gap:14px; align-items:center' },
      ...STEPS.map((step, i) =>
        h(
          'div',
          {
            style:
              i === active
                ? `padding:6px 24px; border-radius:999px; background:${C}; color:${BG}; font-size:44px`
                : `padding:4px 22px; border-radius:999px; border:2px solid ${IDLE}; color:${MUTED}; font-size:44px`,
          },
          `${i + 1} ${step}`,
        ),
      ),
    ),
    ),
  )
}

/** body 每一项是一行，断行由这里决定，不交给自动换行。 */
type Caption = { from: number; to: number; step: string; body: string[]; equation?: EquationPart[] }

const CAPTIONS: Caption[] = [
  { from: 105, to: 300, step: '第一步', body: ['直角三角形有两条直角边 a、b', '和一条斜边 c'] },
  { from: 305, to: 455, step: '第二步', body: ['在三条边上', '各向外画一个正方形'] },
  { from: 460, to: 520, step: '第二步', body: ['数一数小方格'], equation: [['9', A], '+', ['16', B], '=', ['25', C]] },
  { from: 525, to: 625, step: '第三步', body: ['四个相同的直角三角形', '拼进边长 a + b 的正方形'] },
  { from: 630, to: 715, step: '第三步', body: ['中间空出一个正方形', '面积是 c²'] },
  { from: 720, to: 800, step: '第三步', body: ['只挪动三角形', '大正方形不变'] },
  { from: 805, to: 870, step: '第三步', body: ['现在空出两个正方形', 'a² 和 b²'] },
]

function caption(frame: number) {
  const c = CAPTIONS.find((item) => frame >= item.from && frame < item.to)
  if (!c) return null
  const opacity = envelope(frame, c.from, c.to, 12)
  return h(
    'layer',
    { x: '120', y: '260', anchor: 'top-left', opacity: n(opacity) },
    h(
    'div',
    { style: 'display:flex; flex-direction:column; gap:28px; align-items:start' },
    h('p', { style: `font-size:44px; color:${C}` }, c.step),
    h(
      'div',
      { style: 'display:flex; flex-direction:column; gap:12px; align-items:start' },
      ...c.body.map((line) => h('p', { style: `font-size:56px; color:${INK}; white-space:nowrap` }, line)),
    ),
    c.equation ? equation(c.equation, 56, 16) : null,
    ),
  )
}

const U = 64
const P0: Pt = [372, 496]
const P1: Pt = [372 + 4 * U, 496]
const P2: Pt = [372, 496 - 3 * U]
const OUT_A: Pt = [-3 * U, 0]
const OUT_B: Pt = [0, 4 * U]
const OUT_C: Pt = [3 * U, -4 * U]

function edge(from: Pt, to: Pt, progress: number, color: string) {
  if (progress <= 0) return null
  const end = lerp(from, to, progress)
  return h('line', {
    x1: n(from[0]),
    y1: n(from[1]),
    x2: n(end[0]),
    y2: n(end[1]),
    stroke: color,
    'stroke-width': '8',
  })
}

/** 以 p→q 为一边、沿 out 方向长出的正方形；progress 为 0 到 1。 */
function squareOn(p: Pt, q: Pt, out: Pt, progress: number, color: string, fill: string) {
  if (progress <= 0) return null
  return h('polygon', {
    points: points([p, q, add(q, out, progress), add(p, out, progress)]),
    fill,
    stroke: color,
    'stroke-width': '4',
  })
}

function grid(p: Pt, q: Pt, out: Pt, cells: number, color: string, opacity: number): FvgNode[] {
  const along: Pt = [(q[0] - p[0]) / cells, (q[1] - p[1]) / cells]
  const across: Pt = [out[0] / cells, out[1] / cells]
  const line = (from: Pt, to: Pt) =>
    h('line', {
      x1: n(from[0]),
      y1: n(from[1]),
      x2: n(to[0]),
      y2: n(to[1]),
      stroke: color,
      'stroke-width': '2',
      opacity: n(opacity),
    })
  const lines: FvgNode[] = []
  for (let k = 1; k < cells; k++) {
    const s1 = add(p, along, k)
    lines.push(line(s1, add(s1, out)))
    const s2 = add(p, across, k)
    lines.push(line(s2, add(s2, along, cells)))
  }
  return lines
}

const squareCenter = (p: Pt, q: Pt, out: Pt): Pt => add(lerp(p, q, 0.5), out, 0.5)

function dot(at: Pt, scale: number) {
  if (scale <= 0.001) return null
  return h('circle', { cx: n(at[0]), cy: n(at[1]), r: '10', fill: INK, scale: n(scale) })
}

function areaTag(content: string, color: string, at: Pt, frame: number, from: number) {
  const opacity = ramp(frame, from, from + 15)
  return h(
    'layer',
    {
      x: n(at[0]),
      y: n(at[1] + (1 - opacity) * 18),
      anchor: 'center',
      opacity: n(opacity),
    },
    h(
      'div',
      { style: `padding:2px 12px; border-radius:12px; background:rgba(14,18,25,0.85); color:${color}; font-size:44px` },
      content,
    ),
  )
}

function figure(frame: number) {
  const opacity = frame < 100 ? 0 : 1 - ramp(frame, 520, 535)
  const labelsOut = 1 - ramp(frame, 300, 312)
  const gridOpacity = ramp(frame, 435, 465)
  const fillOpacity = ramp(frame, 240, 270)
  const markerOpacity = ramp(frame, 170, 190)
  return h(
    'layer',
    { x: '0', y: '0', width: '1000', height: '800', opacity: n(opacity) },
    h('polygon', {
      points: points([P0, P1, P2]),
      fill: 'rgba(122,162,255,0.10)',
      stroke: 'none',
      opacity: n(fillOpacity),
    }),
    squareOn(P2, P0, OUT_A, ramp(frame, 315, 365), A, 'rgba(62,207,196,0.16)'),
    squareOn(P0, P1, OUT_B, ramp(frame, 345, 395), B, 'rgba(122,162,255,0.16)'),
    squareOn(P2, P1, OUT_C, ramp(frame, 375, 435), C, 'rgba(245,193,108,0.16)'),
    ...grid(P2, P0, OUT_A, 3, 'rgba(62,207,196,0.55)', gridOpacity),
    ...grid(P0, P1, OUT_B, 4, 'rgba(122,162,255,0.55)', gridOpacity),
    ...grid(P2, P1, OUT_C, 5, 'rgba(245,193,108,0.55)', gridOpacity),
    h('polyline', {
      points: points([
        [P0[0], P0[1] - 28],
        [P0[0] + 28, P0[1] - 28],
        [P0[0] + 28, P0[1]],
      ]),
      stroke: INK,
      'stroke-width': '3',
      opacity: n(markerOpacity),
    }),
    edge(P0, P2, ramp(frame, 110, 150), A),
    edge(P0, P1, ramp(frame, 150, 190), B),
    edge(P2, P1, ramp(frame, 190, 240), C),
    dot(P0, pop(frame, 110)),
    dot(P2, pop(frame, 150)),
    dot(P1, pop(frame, 190)),
    label('a = 3', A, [P0[0] - 28, (P0[1] + P2[1]) / 2], 'right', Math.min(ramp(frame, 140, 155), labelsOut)),
    label('b = 4', B, [(P0[0] + P1[0]) / 2, P0[1] + 24], 'top', Math.min(ramp(frame, 180, 195), labelsOut)),
    label('c = 5', C, add(lerp(P2, P1, 0.5), [0.6, -0.8], 36), 'bottom-left', Math.min(ramp(frame, 230, 245), labelsOut)),
    areaTag('a² = 9', A, squareCenter(P2, P0, OUT_A), frame, 465),
    areaTag('b² = 16', B, squareCenter(P0, P1, OUT_B), frame, 480),
    areaTag('c² = 25', C, squareCenter(P2, P1, OUT_C), frame, 495),
  )
}

const PU = 80
const PA = 3 * PU
const PB = 4 * PU
const PS = 7 * PU
const PO: Pt = [220, 120]
const inProof = (x: number, y: number): Pt => [PO[0] + x, PO[1] + y]

/** 四个三角形在两种拼法之间只平移：move 是从第一种拼法到第二种的位移。 */
const PIECES: Array<{ corners: Pt[]; enterFrom: Pt; move: Pt; moveAt: number }> = [
  { corners: [[0, 0], [PA, 0], [0, PB]], enterFrom: [-1, -1], move: [0, PA], moveAt: 720 },
  { corners: [[PA, 0], [PS, 0], [PS, PA]], enterFrom: [1, -1], move: [0, 0], moveAt: 720 },
  { corners: [[PS, PA], [PS, PS], [PB, PS]], enterFrom: [1, 1], move: [-PB, 0], moveAt: 745 },
  { corners: [[PB, PS], [0, PS], [0, PB]], enterFrom: [-1, 1], move: [PA, -PB], moveAt: 770 },
]

/** 三角形用固定的局部顶点，平移只改它所在 layer 的位置。 */
function pieceLayer(piece: (typeof PIECES)[number], index: number, frame: number) {
  const enter = ramp(frame, 560 + 15 * index, 585 + 15 * index)
  const moved = ramp(frame, piece.moveAt, piece.moveAt + 40)
  const offset = add(
    [piece.enterFrom[0] * 48 * (1 - enter), piece.enterFrom[1] * 48 * (1 - enter)],
    piece.move,
    moved,
  )
  const minX = Math.min(...piece.corners.map((p) => p[0]))
  const minY = Math.min(...piece.corners.map((p) => p[1]))
  const width = Math.max(...piece.corners.map((p) => p[0])) - minX
  const height = Math.max(...piece.corners.map((p) => p[1])) - minY
  return h(
    'layer',
    {
      x: n(minX + offset[0]),
      y: n(minY + offset[1]),
      anchor: 'top-left',
      width: n(width),
      height: n(height),
      opacity: n(enter),
    },
    h('polygon', {
      points: points(piece.corners.map(([x, y]) => [x - minX, y - minY])),
      fill: 'rgba(255,138,122,0.30)',
      stroke: TRI,
      'stroke-width': '4',
    }),
  )
}

function proof(frame: number) {
  const opacity = Math.min(ramp(frame, 540, 555), 1 - ramp(frame, 855, 870))
  const outlineScale = interpolate(
    spring({ frame: frame - 540, fps: FPS, config: { damping: 14, stiffness: 120 } }),
    [0, 1],
    [0.85, 1],
    { extrapolateRight: 'extend' },
  )
  const cOpacity = Math.min(ramp(frame, 630, 655), 1 - ramp(frame, 700, 715))
  const abOpacity = ramp(frame, 805, 830)
  const sideOpacity = ramp(frame, 600, 620)
  const tick = (x: number) =>
    h('line', {
      x1: n(PO[0] + x),
      y1: n(PO[1] - 30),
      x2: n(PO[0] + x),
      y2: n(PO[1] - 10),
      stroke: MUTED,
      'stroke-width': '3',
      opacity: n(sideOpacity),
    })

  return h(
    'layer',
    { x: '0', y: '0', width: '1000', height: '800', opacity: n(opacity) },
    h(
      'layer',
      {
        x: n(PO[0]),
        y: n(PO[1]),
        anchor: 'top-left',
        width: String(PS),
        height: String(PS),
        scale: n(outlineScale),
      },
      h('rect', {
        x: '0',
        y: '0',
        width: String(PS),
        height: String(PS),
        fill: 'rgba(255,255,255,0.03)',
        stroke: INK,
        'stroke-width': '4',
      }),
      ...PIECES.map((piece, i) => pieceLayer(piece, i, frame)),
    ),
    h('rect', {
      x: n(PO[0] + PS / 2 - (5 * PU) / 2),
      y: n(PO[1] + PS / 2 - (5 * PU) / 2),
      width: String(5 * PU),
      height: String(5 * PU),
      rotate: n((Math.atan2(PA, PB) * 180) / Math.PI),
      fill: 'rgba(245,193,108,0.22)',
      stroke: C,
      'stroke-width': '4',
      opacity: n(cOpacity),
    }),
    h('rect', {
      x: n(PO[0]),
      y: n(PO[1]),
      width: String(PA),
      height: String(PA),
      fill: 'rgba(62,207,196,0.22)',
      stroke: A,
      'stroke-width': '4',
      opacity: n(abOpacity),
    }),
    h('rect', {
      x: n(PO[0] + PA),
      y: n(PO[1] + PA),
      width: String(PB),
      height: String(PB),
      fill: 'rgba(122,162,255,0.22)',
      stroke: B,
      'stroke-width': '4',
      opacity: n(abOpacity),
    }),
    tick(0),
    tick(PA),
    tick(PS),
    label('a', A, [PO[0] + PA / 2, PO[1] - 16], 'bottom', sideOpacity),
    label('b', B, [PO[0] + PA + PB / 2, PO[1] - 16], 'bottom', sideOpacity),
    label('c²', C, inProof(PS / 2, PS / 2), 'center', cOpacity, 80),
    label('a²', A, inProof(PA / 2, PA / 2), 'center', abOpacity, 72),
    label('b²', B, inProof(PA + PB / 2, PA + PB / 2), 'center', abOpacity, 80),
  )
}

function outro(frame: number) {
  const opacity = ramp(frame, 880, 900)
  return h(
    'layer',
    { x: '960', y: n(580 + (1 - opacity) * 30), anchor: 'center', opacity: n(opacity) },
    h(
    'div',
    { style: 'display:flex; flex-direction:column; gap:44px; align-items:center' },
    h('p', { style: `font-size:56px; color:${MUTED}` }, '空出的面积相等，所以'),
    equation([['a²', A], '+', ['b²', B], '=', ['c²', C]], 110, 28),
    h('p', { style: `font-size:52px; color:${INK}` }, '3² + 4² = 5²，也就是 9 + 16 = 25'),
    ),
  )
}

export const pythagoras: Composition = {
  id: 'pythagoras',
  width: W,
  height: H,
  fps: FPS,
  durationInFrames: DURATION,
  component: ({ frame }) =>
    h(
      'layer',
      { width: String(W), height: String(H), background: BG, color: INK },
      h('Dots', { x: '0', y: '0', width: String(W), height: String(H), draw: drawDots }),
      intro(frame),
      header(frame),
      caption(frame),
      h('layer', { x: '860', y: '200', width: '1000', height: '800' }, figure(frame), proof(frame)),
      outro(frame),
      h('Progress', { x: String(W / 2 - 840), y: '1033', width: '1680', height: '6', draw: drawProgress }),
    ),
}

export const KEYFRAMES = [40, 200, 290, 420, 515, 610, 690, 760, 840, 960]
