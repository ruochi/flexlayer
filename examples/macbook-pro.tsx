/** @jsxImportSource flexlayer */

// 银色 16 英寸 MacBook Pro 海报，以后渲染用这个场景。
// npx tsx src/cli.ts render examples/macbook-pro.tsx -o examples/macbook-pro.png
// 机身 980 × 670 × 30，屏幕盖 980 × 666 × 10，按 2.755 px/mm 换算。
const SILVER = '#e8ecf2'
// Product aluminum; clearcoat off (wet chrome lip read).
const SHELL = 'finish metal, color #d0d4da, roughness 0.40, metalness 0.55, clearcoat 0'
const KEY = '#2e3138'
const WELL = '#1a1c20'

const W = 980
const D = 670
const T = 30
const TOP = T / 2

const LID_H = 666
const LID_T = 10
const LID_TILT = 15

const STAGE = { x: 310, groundY: 1044 }

function roundRect(w: number, h: number, r: number, x = 0, y = 0) {
  const R = x + w
  const B = y + h
  return `M ${x + r} ${y} H ${R - r} A ${r} ${r} 0 0 1 ${R} ${y + r} V ${B - r} A ${r} ${r} 0 0 1 ${R - r} ${B} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${B - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
}

// 键盘：14.5 个键位宽，6 行，键距 51，键帽 45。
const PITCH = 51
const GAP = 6
const KB = { x: 120, y: 34 }
const ROWS: number[][] = [
  [1.4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.7],
  [2.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.2],
  [1, 1, 1, 1.25, 5, 1.25, 1],
]

type Key = { x: number; y: number; w: number; h: number }

function keys(): Key[] {
  const out: Key[] = []
  ROWS.forEach((row, r) => {
    let u = 0
    const y = KB.y + 8 + r * PITCH
    for (const span of row) {
      out.push({ x: KB.x + 8 + u * PITCH, y, w: span * PITCH - GAP, h: PITCH - GAP })
      u += span
    }
    if (r === 5) {
      const x0 = KB.x + 8 + u * PITCH
      const half = (PITCH - GAP) / 2 - 1
      out.push({ x: x0, y: y + half + 2, w: PITCH - GAP, h: half })
      out.push({ x: x0 + PITCH, y, w: PITCH - GAP, h: half })
      out.push({ x: x0 + PITCH, y: y + half + 2, w: PITCH - GAP, h: half })
      out.push({ x: x0 + 2 * PITCH, y: y + half + 2, w: PITCH - GAP, h: half })
    }
  })
  return out
}

const keyPath = keys().map((k) => roundRect(k.w, k.h, 4, k.x, k.y)).join(' ')

/** Visible legends for the letter rows (blank caps failed §9.2 dual-blind). */
const KEY_LEGENDS: (string | null)[][] = [
  [null, '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', null],
  ['⇥', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '⌫'],
  ['⇪', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", '↩', null],
  [null, 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', null],
  [null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
]

function keyLegends() {
  const out: { x: number; y: number; w: number; h: number; label: string }[] = []
  ROWS.forEach((row, r) => {
    let u = 0
    const y = KB.y + 8 + r * PITCH
    const labels = KEY_LEGENDS[r] || []
    row.forEach((span, i) => {
      const label = labels[i]
      const x = KB.x + 8 + u * PITCH
      const w = span * PITCH - GAP
      const h = PITCH - GAP
      if (label) out.push({ x, y, w, h, label })
      u += span
    })
  })
  return out
}

const WELL_BOX = { x: KB.x, y: KB.y, w: 14.5 * PITCH + 10, h: 6 * PITCH + 10 }

function grille(x: number, y: number, w: number, h: number) {
  // Period under ~2 px on screen reads as moiré (QUALITY-4 §3.4). Keep holes
  // large enough that a pixel footprint covers at most one, and pad the well
  // with the area-average grey so sparse samples still look even.
  const step = 6.5
  const r = 1.55
  let d = ''
  for (let gy = y + step / 2; gy < y + h; gy += step) {
    for (let gx = x + step / 2; gx < x + w; gx += step) {
      d += `M ${(gx - r).toFixed(2)} ${gy.toFixed(2)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z `
    }
  }
  return d
}

const GRILLE_W = 62
const grilleLeft = grille(KB.x - GRILLE_W - 18, KB.y + 4, GRILLE_W, WELL_BOX.h - 8)
const grilleRight = grille(WELL_BOX.x + WELL_BOX.w + 18, KB.y + 4, GRILLE_W, WELL_BOX.h - 8)

const PAD = { w: 444, h: 262 }
const padX = (W - PAD.w) / 2
const padY = D - 30 - PAD.h

function Base() {
  return (
    <layer x={STAGE.x} y={STAGE.groundY - TOP} width={W} height={D} origin={`${W / 2} 0`} rotateX="90" preserve-3d>
      <rect width={W} height={D} rx="24" fill={SILVER} material={SHELL} depth={T} stroke="none" />
      <layer x="0" y="0" width={W} height={D} z={TOP + 0.2} cast-shadow="false">
        <rect x={WELL_BOX.x} y={WELL_BOX.y} width={WELL_BOX.w} height={WELL_BOX.h} rx="8" fill={WELL} />
        <rect x={KB.x - GRILLE_W - 18} y={KB.y + 4} width={GRILLE_W} height={WELL_BOX.h - 8} rx="4" fill="#4a4c51" />
        <rect x={WELL_BOX.x + WELL_BOX.w + 18} y={KB.y + 4} width={GRILLE_W} height={WELL_BOX.h - 8} rx="4" fill="#4a4c51" />
        <path d={grilleLeft} fill="#3c3e43" stroke="none" />
        <path d={grilleRight} fill="#3c3e43" stroke="none" />
        <rect x={padX - 1.5} y={padY - 1.5} width={PAD.w + 3} height={PAD.h + 3} rx="13" fill="#8f9298" />
        <rect x={padX} y={padY} width={PAD.w} height={PAD.h} rx="12" fill="linear-gradient(180deg, #d0d3d7 0%, #c3c6cb 100%)" />
      </layer>
      <path d={keyPath} fill={KEY} material="plastic" depth="4" z={TOP + 1.6} stroke="none" cast-shadow="false" />
      {keyLegends().map((k) => (
        <layer x={k.x + k.w / 2} y={k.y + k.h / 2 - 2} z={TOP + 4} anchor="center" cast-shadow="false">
          <p style="font-family:Inter; font-size:11px; font-weight:600; color:#b8bcc4">{k.label}</p>
        </layer>
      ))}
      <rect x="70" y="-8" width={W - 140} height="18" rx="9" fill="#2a2b2f" material="plastic" depth="18" z={TOP - 3} cast-shadow="false" />
      <layer x={W - T / 2} y="0" width={T} height={D} origin={`${T / 2} 0`} rotateY="90" z="0.3" cast-shadow="false">
        <rect x={T / 2 - 4} y="214" width="8" height="30" rx="3" fill="#1c1d20" />
        <rect x={T / 2 - 3.5} y="300" width="7" height="22" rx="3.5" fill="#1c1d20" />
        <rect x={T / 2 - 1.5} y="452" width="3" height="56" rx="1.5" fill="#1c1d20" />
      </layer>
    </layer>
  )
}

const SCREEN = { x: 24, y: 28, w: 932, h: 602 }

function Wallpaper() {
  const stars = Array.from({ length: 34 }, (_, i) => ({
    cx: (i * 137) % SCREEN.w,
    cy: (i * 83) % 300 + 20,
    r: 0.7 + (i % 4) * 0.35,
    o: 0.2 + (i % 5) * 0.1,
  }))
  const dock = ['#3b82f6', '#30a46c', '#e8a33d', '#d94a52', '#8e5bc4', '#d8b94a', '#7e8088', '#24262b']
  const dockW = dock.length * 40 + 20
  const dockX = (SCREEN.w - dockW) / 2
  return (
    <layer x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} cast-shadow="false">
      <mask>
        <rect x="0" y="0" width={SCREEN.w} height={SCREEN.h} rx="10" />
      </mask>
      <rect x="0" y="0" width={SCREEN.w} height={SCREEN.h} fill="linear-gradient(180deg, #0b0c12 0%, #120c0a 100%)" />
      {stars.map((s) => (
        <circle cx={s.cx} cy={s.cy} r={s.r} fill="#ffe6c7" opacity={s.o} />
      ))}
      <circle cx="660" cy="330" r="200" fill="#ff8a45" opacity="0.22" blur="36" />
      <circle cx="660" cy="330" r="110" fill="radial-gradient(circle at 42% 38%, #fff7dd 0%, #ffd28a 30%, #ff9a4e 64%, #e55934 100%)" />
      <rect x="0" y="0" width={SCREEN.w} height="26" fill="#040408" opacity="0.5" />
      <layer x="20" y="6">
        <div style="display:flex; gap:13px; align-items:center">
          <p style="font-family:Inter; font-size:10px; font-weight:700; color:#ffffffdd">Finder</p>
          {['File', 'Edit', 'View', 'Go', 'Window', 'Help'].map((t) => (
            <p style="font-family:Inter; font-size:10px; color:#ffffffb0">{t}</p>
          ))}
        </div>
      </layer>
      <layer x={SCREEN.w - 20} y="6" anchor="top-right">
        <p style="font-family:Inter; font-size:10px; font-weight:700; color:#ffffffdd">9:41</p>
      </layer>
      <rect x={dockX} y={SCREEN.h - 66} width={dockW} height="54" rx="17" fill="#08080d" opacity="0.66" />
      {dock.map((c, i) => (
        <rect x={dockX + 12 + i * 40} y={SCREEN.h - 56} width="34" height="34" rx="9" fill={c} />
      ))}
    </layer>
  )
}

function Lid() {
  return (
    <layer x={STAGE.x} y={STAGE.groundY - T + 4 - LID_H} width={W} height={LID_H} origin={`${W / 2} ${LID_H}`} rotateX={LID_TILT} cast-shadow="false">
      <rect width={W} height={LID_H} rx="24" fill={SILVER} material={SHELL} depth={LID_T} z={-LID_T / 2 - 1} stroke="none" cast-shadow="false" />
      <rect x="7" y="7" width={W - 14} height={LID_H - 14} rx="18" fill="#050608" cast-shadow="false" />
      <Wallpaper />
      <rect x={W / 2 - 36} y="7" width="72" height="27" rx="8" fill="#050608" cast-shadow="false" />
      <circle cx={W / 2} cy="18" r="2.4" fill="#0e1018" stroke="#23262e" stroke-width="0.6" />
      <layer x={W / 2} y={SCREEN.y + SCREEN.h + 18} anchor="center">
        <p style="font-family:Inter; font-size:10px; letter-spacing:0.4px; color:#5b5e65">MacBook Pro</p>
      </layer>
    </layer>
  )
}

export default (
  <layer width="1440" height="1800" background="#f6f3ee" color="#1c1916" min-font="10" noise="0.012">
    <rect x="0" y="0" width="1440" height="1800" fill="linear-gradient(180deg, #f7f4ef 0%, #efe8df 100%)" />
    <layer width="1440" height="1800" camera="fov 28, orbit 16 14" light="world">
      {/* Soft fill so silver shell keeps midtones under the key (§9.2). */}
      <light type="hemisphere" intensity="0.85" color="#fff8f0" ground-color="#d2ccc4" />
      <light type="directional" intensity="0.45" color="#fff5ea" x="200" y="-400" z="600" target="0 0 0" />
      <Lid />
      <Base />
      <ground y={STAGE.groundY} rotateX="90" fill="#efe8df" shadow-blur="36" shadow-opacity="0.22" />
    </layer>
    <layer x="80" y="66">
      <p style="font-family:Inter; font-size:13px; font-weight:700; letter-spacing:6.2px; color:#c88255">PRO PERFORMANCE · M4 MAX</p>
    </layer>
    <layer x="1360" y="70" anchor="top-right">
      <p style="font-family:Inter; font-size:11px; font-weight:700; letter-spacing:2.6px; color:#6a6158">16″ · M4 MAX</p>
    </layer>
    <layer x="76" y="92">
      <h1 style="font-family:Inter; font-size:132px; font-weight:700; letter-spacing:-7px; line-height:1; color:#1c1916">
        MacBook <span style="color:#de7a43">Pro</span>
      </h1>
    </layer>
    <layer x="82" y="232">
      <h2 style="font-size:44px; font-weight:700; letter-spacing:-0.8px; line-height:1.15; color:#1c1916">把创意，带到更远。</h2>
    </layer>
    <layer x="84" y="300" width="280">
      <p style="font-size:18px; line-height:1.7; color:#5e564e">16 英寸 · M4 Max</p>
    </layer>
    <layer x="760" y="1340" width="720" anchor="top">
      <p style="width:720px; font-size:14px; font-weight:600; letter-spacing:2.2px; color:#5e564e; text-align:center">16 英寸 · 银色 · M4 Max</p>
    </layer>
    <rect x="80" y="1560" width="1280" height="1" fill="#1c1916" opacity="0.12" />
    <layer x="80" y="1410">
      <div style="display:flex; gap:40px">
        {[
          ['M4 MAX', '专业性能，火力全开', '渲染、编译、剪辑，一气呵成'],
          ['LIQUID RETINA XDR', '1600 尼特峰值亮度', 'HDR 细节，亮处更亮，暗处更深'],
          ['THUNDERBOLT 5', '高速连接', '一根线，连接你的整个工作流'],
        ].map(([kicker, title, body]) => (
          <div style="display:flex; flex-direction:column; gap:8px; width:380px">
            <p style="font-family:Inter; font-size:11px; font-weight:700; letter-spacing:2.8px; color:#c77a4e">{kicker}</p>
            <p style="font-size:24px; font-weight:700; color:#1c1916">{title}</p>
            <p style="font-size:14px; line-height:1.55; color:#6a6158">{body}</p>
          </div>
        ))}
      </div>
    </layer>
    <rect x="480" y="1408" width="1" height="118" fill="#1c1916" opacity="0.12" />
    <rect x="900" y="1408" width="1" height="118" fill="#1c1916" opacity="0.12" />
    <layer x="80" y="1614">
      <p style="font-size:22px; letter-spacing:-0.2px; color:#3a342e">让每一次创作，都不被性能限制。</p>
    </layer>
    <layer x="1040" y="1578">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:0 28px; border-radius:999px; background:#d76d36; width:310px; height:64px">
        <p style="font-size:21px; font-weight:700; color:#1b0c06">进一步了解</p>
        <span style="font-family:Inter; font-size:25px; font-weight:700; line-height:1; color:#1b0c06">→</span>
      </div>
    </layer>
    <layer x="80" y="1710">
      <p style="font-size:12px; letter-spacing:1px; color:#8a8178">概念广告 · 非 Apple 官方发布</p>
    </layer>
    <layer x="1360" y="1710" anchor="top-right">
      <p style="font-family:Inter; font-size:11px; font-weight:700; letter-spacing:1.7px; color:#8a8178">DESIGNED FOR THE PRO</p>
    </layer>
  </layer>
)
