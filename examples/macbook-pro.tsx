/** @jsxImportSource flexlayer */
import * as THREE from 'three'

// 银色 16 英寸 MacBook Pro 海报，同时是一张材质对照：机身阳极氧化铝，
// 桌上的配件各用一种 finish，见 Props。
// npx tsx src/cli.ts render examples/macbook-pro.tsx -o examples/macbook-pro.png
// 机身 940 × 656 × 28，屏幕盖 940 × 630 × 10，约 2.64 px/mm。
// 真机是平顶、竖直侧壁、俯视四角中等圆角，棱上只有很小的倒角：
// 所以圆角只给竖直的四条棱（round="z"），顶面和底面的折棱交给屏幕尺度倒角。
const SILVER = '#c6c9ce'
const SHELL = 'metal'
const KEY = '#1f2024'
const WELL = '#060607'

const W = 940
const D = 656
const T = 28
const TOP = T / 2
const CORNER = 30

const LID_H = 630
const LID_T = 10
const LID_TILT = 14

const STAGE = { x: 290, groundY: 1060 }
const CAMERA = "fov 28, orbit 16 14, distance 4900, at 720 1000 0"

function roundRect(w: number, h: number, r: number, x = 0, y = 0) {
  const R = x + w
  const B = y + h
  return `M ${x + r} ${y} H ${R - r} A ${r} ${r} 0 0 1 ${R} ${y + r} V ${B - r} A ${r} ${r} 0 0 1 ${R - r} ${B} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${B - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
}

// 键盘：14.5 个键位宽，6 行全高（2021 款起功能键也是全高），键距 49，键帽 43。
// 方向键是倒 T：左右半高，上下各半高叠在中间。
const PITCH = 49
const GAP = 6
const KB_W = 14.5 * PITCH + 10
const KB = { x: (W - KB_W) / 2, y: 30 }
const ROWS: number[][] = [
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
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

const allKeys = keys()
// 最后一个功能键位是 Touch ID：没有键帽字，外圈一道银边。
const touchId = allKeys[ROWS[0]!.length - 1]!
const keyPath = allKeys.map((k) => roundRect(k.w, k.h, 4, k.x, k.y)).join(' ')
const WELL_BOX = { x: KB.x, y: KB.y, w: KB_W, h: 6 * PITCH + 10 }

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

const GRILLE_W = 56
const GRILLE_GAP = 16
const grilleBox = (side: -1 | 1) => ({
  x: side < 0 ? KB.x - GRILLE_W - GRILLE_GAP : KB.x + KB_W + GRILLE_GAP,
  y: KB.y + 4,
  w: GRILLE_W,
  h: WELL_BOX.h - 8,
})
const grilles = ([-1, 1] as const).map((side) => {
  const g = grilleBox(side)
  return { ...g, d: grille(g.x, g.y, g.w, g.h) }
})

// 16 英寸触控板约 160 × 100 mm，离前沿 11 mm。
const PAD = { w: 424, h: 262 }
const padX = (W - PAD.w) / 2
const padY = D - 28 - PAD.h

function Base() {
  return (
    <layer x={STAGE.x} y={STAGE.groundY - TOP} width={W} height={D} origin={`${W / 2} 0`} rotateX="90" preserve-3d>
      <rect width={W} height={D} rx={CORNER} round="z" fill={SILVER} material={SHELL} depth={T} stroke="none" />
      <layer x="0" y="0" width={W} height={D} z={TOP + 0.2} cast-shadow="false">
        <rect x={WELL_BOX.x} y={WELL_BOX.y} width={WELL_BOX.w} height={WELL_BOX.h} rx="8" fill={WELL} />
        {grilles.map((g) => (
          <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="4" fill="#a2a5ab" />
        ))}
        {grilles.map((g) => (
          <path d={g.d} fill="#2c2d32" stroke="none" />
        ))}
        <rect x={touchId.x - 1.5} y={touchId.y - 1.5} width={touchId.w + 3} height={touchId.h + 3} rx="5.5" fill="#a9acb2" />
        <rect x={padX - 1.5} y={padY - 1.5} width={PAD.w + 3} height={PAD.h + 3} rx="13" fill="#8f9298" />
        <rect x={padX} y={padY} width={PAD.w} height={PAD.h} rx="12" fill="linear-gradient(180deg, #d0d3d7 0%, #c3c6cb 100%)" />
      </layer>
      <path d={keyPath} fill={KEY} material="plastic" depth="4" z={TOP + 1.6} stroke="none" />
      {/* 转轴：黑色的转轴盖，左右收在机身圆角里 */}
      <rect x={CORNER + 24} y="-8" width={W - 2 * CORNER - 48} height="18" rx="9" fill="#2a2b2f" material="plastic" depth="18" z={TOP - 3} />
      {/* 右侧接口：雷雳、HDMI、SDXC。层的 x 横跨机身厚度，y 沿进深 */}
      <layer x={W - T / 2} y="0" width={T} height={D} origin={`${T / 2} 0`} rotateY="90" z="0.3" cast-shadow="false">
        <rect x={T / 2 - 4} y="150" width="8" height="24" rx="4" fill="#1c1d20" />
        <rect x={T / 2 - 4.5} y="196" width="9" height="36" rx="2" fill="#1c1d20" />
        <rect x={T / 2 - 1.5} y="292" width="3" height="62" rx="1.5" fill="#1c1d20" />
      </layer>
    </layer>
  )
}

// 黑色玻璃几乎盖满屏幕盖，外圈只露一道很窄的铝边。显示区 16:10.3，顶边中间是刘海。
const GLASS_INSET = 4
const SCREEN = { x: 18, y: 18, w: W - 36, h: 584 }
const NOTCH = { w: 84, h: 22 }

function Wallpaper() {
  const stars = Array.from({ length: 34 }, (_, i) => ({
    cx: (i * 137) % SCREEN.w,
    cy: (i * 83) % 300 + 30,
    r: 0.7 + (i % 4) * 0.35,
    o: 0.2 + (i % 5) * 0.1,
  }))
  const dock = [
    ['#5aa9ff', '#1f6fe0'],
    ['#5fd58b', '#1f9a52'],
    ['#ffc95c', '#e8892a'],
    ['#ff7b7f', '#d73a4a'],
    ['#b48cf0', '#7442c4'],
    ['#ffe27a', '#d8a92a'],
    ['#a6a9b0', '#5d6068'],
    ['#4b4e57', '#1d1f24'],
  ]
  const dockW = dock.length * 40 + 20
  const dockX = (SCREEN.w - dockW) / 2
  const notchX = (SCREEN.w - NOTCH.w) / 2
  return (
    <layer x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} cast-shadow="false">
      <mask>
        <rect x="0" y="0" width={SCREEN.w} height={SCREEN.h} rx="10" />
      </mask>
      <rect x="0" y="0" width={SCREEN.w} height={SCREEN.h} fill="linear-gradient(180deg, #0b0c12 0%, #160d0a 100%)" />
      {stars.map((s) => (
        <circle cx={s.cx} cy={s.cy} r={s.r} fill="#ffe6c7" opacity={s.o} />
      ))}
      <circle cx="640" cy="330" r="200" fill="#ff8a45" opacity="0.22" blur="36" />
      <circle cx="640" cy="330" r="110" fill="radial-gradient(circle at 42% 38%, #fff7dd 0%, #ffd28a 30%, #ff9a4e 64%, #e55934 100%)" />
      <rect x="0" y="0" width={SCREEN.w} height={NOTCH.h} fill="#ffffff" opacity="0.1" />
      <layer x="18" y="5">
        <div style="display:flex; gap:13px; align-items:center">
          <p style="font-family:Inter; font-size:10px; font-weight:700; color:#ffffffdd">Finder</p>
          {['File', 'Edit', 'View', 'Go', 'Window', 'Help'].map((t) => (
            <p style="font-family:Inter; font-size:10px; color:#ffffffb0">{t}</p>
          ))}
        </div>
      </layer>
      <layer x={SCREEN.w - 18} y="5" anchor="top-right">
        <div style="display:flex; gap:10px; align-items:center">
          {['battery_full', 'wifi', 'search'].map((icon) => (
            <span class="material-symbols-outlined" style="font-size:12px; color:#ffffffcc">{icon}</span>
          ))}
          <p style="font-family:Inter; font-size:10px; font-weight:700; color:#ffffffdd">Sun 9:41</p>
        </div>
      </layer>
      {/* 刘海：方顶，下面两个圆角 */}
      <path
        d={`M ${notchX - 6} 0 Q ${notchX} 0 ${notchX} 6 V ${NOTCH.h - 7} Q ${notchX} ${NOTCH.h} ${notchX + 7} ${NOTCH.h} H ${notchX + NOTCH.w - 7} Q ${notchX + NOTCH.w} ${NOTCH.h} ${notchX + NOTCH.w} ${NOTCH.h - 7} V 6 Q ${notchX + NOTCH.w} 0 ${notchX + NOTCH.w + 6} 0 Z`}
        fill="#050608"
        stroke="none"
      />
      <rect x={dockX} y={SCREEN.h - 64} width={dockW} height="54" rx="17" fill="#2a2a33" opacity="0.5" />
      {dock.map(([a, b], i) => (
        <rect x={dockX + 12 + i * 40} y={SCREEN.h - 54} width="34" height="34" rx="9" fill={`linear-gradient(180deg, ${a} 0%, ${b} 100%)`} />
      ))}
    </layer>
  )
}

function Lid() {
  return (
    <layer x={STAGE.x} y={STAGE.groundY - T + 4 - LID_H} width={W} height={LID_H} origin={`${W / 2} ${LID_H}`} rotateX={LID_TILT}>
      <rect width={W} height={LID_H} rx={CORNER} round="z" fill={SILVER} material={SHELL} depth={LID_T} z={-LID_T / 2 - 1} stroke="none" />
      {/* 屏幕玻璃贴在盖内侧，不再单独投一圈影 */}
      <rect x={GLASS_INSET} y={GLASS_INSET} width={W - 2 * GLASS_INSET} height={LID_H - 2 * GLASS_INSET} rx={CORNER - GLASS_INSET} fill="#050608" cast-shadow="false" />
      <Wallpaper />
      <circle cx={W / 2} cy={SCREEN.y + 10} r="2.4" fill="#0e1018" stroke="#23262e" stroke-width="0.6" />
    </layer>
  )
}

// 桌上的配件，各用一种 finish：布面音箱（matte）配拉丝顶盖（brushed）和指示灯
// （lamp），陶瓷杯（clay），Apple Pencil（plastic 0.3），AirPods 盒（plastic 0.12），
// AirTag（plastic 0.2），钻石（glass）立在黑色展台（matte）上。
// 和机身同一块地。y 是进深，往镜头为正；z 是离地高度。尺寸按机身同一比例，约 2.64 px/mm：
// HomePod mini Ø84×84、马克杯 Ø80×95、Pencil Ø8.9×166、AirTag Ø32×8、
// AirPods Pro 盒 61×22×45。物件贴着机身四沿，不散开。
// 每件只用两三个基本体，面数少，不拖慢渲染。
const FLOOR = { w: 1440, h: 820 }

// 空心杯：外圆减内圆，挤出成杯壁。
function cupPath(cx: number, cy: number, r: number, wall: number) {
  const ring = (rr: number) => `M ${cx - rr} ${cy} a ${rr} ${rr} 0 1 0 ${2 * rr} 0 a ${rr} ${rr} 0 1 0 ${-2 * rr} 0 Z`
  return `${ring(r)} ${ring(r - wall)}`
}

// 机身占 floor 上 x∈[290,1230]、y∈[0,656]。左右高件贴后侧，前沿一条矮件，
// 与机身侧向间隙约 24 px。
const SPEAKER = { cx: 155, cy: 200, r: 111, h: 222 }
const MUG = { cx: 1365, cy: 230, r: 106, h: 250 }
// 前沿 y 约 800：再贴会叠进掌托 metrics 窗；AirPods 偏右，避开右掌托取样区。
const PENCIL = { cx: 720, cy: 800, r: 12, len: 380, turn: -2 }
const POD = { x: 1260, y: 820, w: 160, d: 57, h: 119 }
const TAG = { cx: 1000, cy: 810, r: 42, h: 21 }
// 展台要比钻石腰棱宽、高一点，否则亭部盖住柱身，底下只剩一圈黑边，像半拉空的环。
const GEM = { x: 430, y: 820, r: 28, stand: 52, standR: 36 }

// 明亮式切工：八面冠部压在八面亭部上，台面朝上，尖朝下。单位半径 1。
const diamond = (() => {
  const glass = new THREE.MeshStandardMaterial({ color: '#eef3f8', roughness: 0.06 })
  const crown = new THREE.CylinderGeometry(0.55, 1, 0.38, 8)
  crown.translate(0, 0.19, 0)
  const pavilion = new THREE.ConeGeometry(1, 0.95, 8)
  pavilion.rotateX(Math.PI)
  pavilion.translate(0, -0.475, 0)
  const group = new THREE.Group()
  for (const geo of [crown, pavilion]) {
    // 模型 y 向上；地面层里离地方向是 z，所以把 y 轴转到 z。
    geo.rotateX(Math.PI / 2)
    group.add(new THREE.Mesh(geo, glass))
  }
  return group
})()

function Props() {
  const mugHandle = { r: 55, tube: 14 }
  return (
    <layer x="0" y={STAGE.groundY} width={FLOOR.w} height={FLOOR.h} origin={`${FLOOR.w / 2} 0`} rotateX="90" preserve-3d>
      {/* 左后：HomePod mini 比例圆柱音箱。布面机身，拉丝铝顶盖，顶边一颗暖色指示灯 */}
      <layer x={SPEAKER.cx} y={SPEAKER.cy} width="0" height="0" z={SPEAKER.h / 2} preserve-3d>
        <cylinder cx="0" cy="0" r={SPEAKER.r} height={SPEAKER.h} rx="18" rotateX="90" fill="#3b3e45" material="matte" />
      </layer>
      <circle cx={SPEAKER.cx} cy={SPEAKER.cy} r={SPEAKER.r - 14} depth="2" z={SPEAKER.h + 1} fill="#b9bcc2" material="brushed" />
      <sphere cx={SPEAKER.cx} cy={SPEAKER.cy + SPEAKER.r - 28} r="5" z={SPEAKER.h + 2} fill="#ff9a52" material="lamp" />
      {/* 右后：陶瓷马克杯与音箱对侧同进深，杯把朝外（右） */}
      <path d={cupPath(MUG.cx, MUG.cy, MUG.r, 8)} fill-rule="evenodd" depth={MUG.h} z={MUG.h / 2} fill="#c96a45" material="clay" stroke="none" />
      {/* 同一个元素上 rotateX 会吞掉 z，所以抬高写在外层 */}
      <layer x={MUG.cx + MUG.r + 10} y={MUG.cy} width="0" height="0" z={MUG.h / 2 + 6} preserve-3d>
        <torus cx="0" cy="0" r={mugHandle.r} tube={mugHandle.tube} rotateX="90" fill="#c96a45" material="clay" />
      </layer>
      {/* 正前：Apple Pencil 贴机身前沿，笔尖一小段灰色 */}
      <layer x={PENCIL.cx} y={PENCIL.cy} width="0" height="0" rotate={PENCIL.turn} preserve-3d>
        <cylinder cx="0" cy="0" r={PENCIL.r} height={PENCIL.len} rx="4" z={PENCIL.r} fill="#f4f3ef" material="plastic 0.3" rotate="90" />
        <cylinder cx={-PENCIL.len / 2 - 10} cy="0" r={PENCIL.r - 3} height="20" z={PENCIL.r} fill="#8e9096" material="plastic 0.5" rotate="90" />
      </layer>
      {/* 前沿：AirTag 白面朝上。挤出的薄圆片顶面会读成黑片，所以用带 rx 的圆柱 */}
      <cylinder cx={TAG.cx} cy={TAG.cy} r={TAG.r} height={TAG.h} rx="6" z={TAG.h / 2} rotateX="90" fill="#f4f3ef" material="plastic 0.2" />
      {/* 右前：竖放的 AirPods Pro 盒，偏右避开掌托取样区 */}
      <rect x={POD.x} y={POD.y} width={POD.w} height={POD.d} depth={POD.h} rx="24" z={POD.h / 2} fill="#f4f3ef" material="plastic 0.12" rotate="-6" />
      <rect x={POD.x - 0.6} y={POD.y - 0.6} width={POD.w + 1.2} height={POD.d + 1.2} depth="1.4" rx="24" round="z" z={POD.h * 0.72} fill="#c9c9c4" material="plastic 0.3" rotate="-6" />
      {/* 左前：钻石尖朝下立在黑色绒面展台上。外层抬高 + cylinder，与音箱同一套；
          顶盖单独一块不透明圆片，避免玻璃亭部嵌进顶面读成半拉空的白缺口。 */}
      <layer x={GEM.x} y={GEM.y} width="0" height="0" z={GEM.stand / 2} preserve-3d>
        <cylinder cx="0" cy="0" r={GEM.standR} height={GEM.stand} rx="4" rotateX="90" fill="#2a2c32" material="matte" />
      </layer>
      <cylinder cx={GEM.x} cy={GEM.y} r={GEM.standR - 1} height="3" rx="1" z={GEM.stand + 1} rotateX="90" fill="#35383f" material="matte" />
      <model object={diamond} unit={GEM.r} x={GEM.x} y={GEM.y} z={GEM.stand + 4 + GEM.r * 0.95} material="glass 0.06" />
    </layer>
  )
}

export default (
  <layer width="1440" height="1800" background="#f6f3ee" color="#1c1916" min-font="10" noise="0.012">
    <rect x="0" y="0" width="1440" height="1800" fill="linear-gradient(180deg, #f7f4ef 0%, #efe8df 100%)" />
    <layer width="1440" height="1800" camera={CAMERA}>
      <Lid />
      <Base />
      <Props />
      <ground y={STAGE.groundY} rotateX="90" fill="#efe8df" shadow-blur="42" shadow-opacity="0.42" />
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
    <layer x="84" y="300" width="760">
      <p style="font-size:18px; line-height:1.7; color:#5e564e">16 英寸 · M4 Max · 为专业创作而生</p>
    </layer>
    <layer x="720" y="1340" width="720" anchor="top">
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
    <layer x="1360" y="1578" anchor="top-right">
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
