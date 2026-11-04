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

// 桌上的配件，各用一种 finish：HomePod mini 布面（matte），马克杯（奶油釉面 + 侧面贴图），六角铅笔
// （漆面 plastic、木头 matte、铝箍 metal、橡皮 matte），AirTag（白 plastic + 不锈钢 metal），
// AirPods Pro 盒（白色注塑：plastic 0.3 + 薄 clearcoat），钻石（glass）。
// 和机身同一块地。y 是进深，往镜头为正；z 是离地高度。尺寸按机身同一比例，约 2.64 px/mm：
// HomePod mini Ø98×84、马克杯 Ø80×95、铅笔 175 × 对角 8、AirTag Ø32×8、AirPods Pro 盒 61×22×45。
// 音箱在左后，马克杯在右侧中段，AirPods 盒、AirTag、铅笔、钻石在前沿错开进深。
// 模型都用低面数 lathe 和六棱柱，不拖慢渲染。
const FLOOR = { w: 1440, h: 1300 }

// 机身占 floor 上 x∈[290,1230]、y∈[0,656]。
const SPEAKER = { x: 30, y: -60, r: 129 }
// turn：印花朝镜头偏中心，把手在右侧露出。
const MUG = { cx: 1462, cy: 330, r: 106, turn: -42 }
const PENCIL = { x: 860, y: 1060, r: 11, turn: -26 }
const TAG = { x: 1110, y: 1205, r: 42, turn: 0 }
const POD = { x: 1530, y: 1130, w: 160, d: 57, h: 119, turn: 18 }
const GEM = { x: 560, y: 1250, r: 36, turn: 32 }

const mat = (color: string, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })

/** 马克杯外壁卷标（lathe 只有外轮廓时，v 从底到口）。奶油釉 + 中腰印花带。 */
function mugWrapMap() {
  const w = 768
  const h = 384
  const rgba = new Uint8ClampedArray(w * h * 4)
  const clamp = (n: number) => Math.max(0, Math.min(255, n | 0))
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return n - Math.floor(n)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / (h - 1)
      const speck = (hash(x, y) - 0.5) * 5
      // 素釉底
      let r = 242 + speck
      let g = 235 + speck * 0.9
      let b = 224 + speck * 0.75
      // 中腰印花带（深蓝）
      const bandLo = 0.38
      const bandHi = 0.68
      if (v > bandLo && v < bandHi) {
        const edge = Math.min((v - bandLo) / 0.03, (bandHi - v) / 0.03, 1)
        const t = Math.max(0, Math.min(1, edge))
        // 徽标在 u≈0.5（-X）；杯子再 yaw，使这一面转向镜头
        const dx = (u - 0.5) * 0.95
        const dy = (v - 0.53) * 2.1
        const rad2 = dx * dx + dy * dy
        const inBadge = rad2 < 0.055
        const inRing = rad2 < 0.078 && rad2 > 0.048
        const rail = (Math.abs(v - 0.4) < 0.014 || Math.abs(v - 0.66) < 0.014) && Math.abs(u - 0.5) > 0.14
        let br = 48
        let bg = 62
        let bb = 82
        if (rail) {
          br = 220
          bg = 210
          bb = 196
        }
        if (inRing) {
          br = 240
          bg = 234
          bb = 222
        }
        if (inBadge) {
          br = 250
          bg = 246
          bb = 238
          const cup = Math.abs(dx) < 0.08 && dy > -0.055 && dy < 0.085
          const lip = Math.abs(dx) < 0.095 && Math.abs(dy - 0.085) < 0.014
          const handle = dx > 0.055 && dx < 0.12 && Math.abs(dy) < 0.055
          if (cup || lip || handle) {
            br = 36
            bg = 46
            bb = 60
          }
        }
        r = r * (1 - t) + br * t
        g = g * (1 - t) + bg * t
        b = b * (1 - t) + bb * t
      }
      // 底脚略深一点
      if (v < 0.08) {
        const t = 1 - v / 0.08
        r -= 10 * t
        g -= 10 * t
        b -= 12 * t
      }
      const i = (y * w + x) * 4
      rgba[i] = clamp(r)
      rgba[i + 1] = clamp(g)
      rgba[i + 2] = clamp(b)
      rgba[i + 3] = 255
    }
  }
  const map = new THREE.DataTexture(rgba, w, h)
  map.flipY = false
  map.needsUpdate = true
  return map
}

/**
 * 在 three 里按 y 向上建模。这里整体转到地面层的 z 向上，并让最低点落在 z=0，
 * 所以每件 <model> 不用再算离地高度。tilt 先作用，用来做侧躺。
 */
function seated(parts: [THREE.BufferGeometry, THREE.Material][], tilt?: THREE.Euler) {
  const group = new THREE.Group()
  const box = new THREE.Box3()
  for (const [geo] of parts) {
    if (tilt) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(tilt))
    geo.rotateX(Math.PI / 2)
    geo.computeBoundingBox()
    box.union(geo.boundingBox!)
  }
  for (const [geo, m] of parts) {
    geo.translate(0, 0, -box.min.z)
    group.add(new THREE.Mesh(geo, m))
  }
  return group
}

const lathe = (pts: [number, number][], seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)

// 马克杯：外壁车削（带贴图）+ 内壁深色 + 粗 C 形把手。半径约 1，高约 2.35。
// 印花在 u=0.5（-X，朝舞台中心）；把手在 +X（朝外）。
const mug = (() => {
  const H = 2.35
  const outer: [number, number][] = [
    [0, 0],
    [0.7, 0],
    [0.9, 0.035],
    [0.97, 0.1],
    [1.0, 0.26],
    [0.995, 0.85],
    [0.99, 1.65],
    [1.0, 2.12],
    [1.03, 2.26],
    [1.0, H],
    [0.92, H],
  ]
  const body = lathe(outer, 48)
  const glaze = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.78,
    clearcoatRoughness: 0.16,
    map: mugWrapMap(),
  })
  // 内壁：略矮一圈，深咖啡釉，开口读得出厚度
  const inner = lathe(
    [
      [0, 0.16],
      [0.55, 0.16],
      [0.82, 0.2],
      [0.9, 0.4],
      [0.905, 1.65],
      [0.9, 2.2],
      [0.88, H - 0.02],
      [0, H - 0.02],
    ],
    36,
  )
  const liner = new THREE.MeshStandardMaterial({ color: '#3a342e', roughness: 0.72, metalness: 0 })
  // C 形把手：两端略伸进杯壁，中段更粗；截面压扁
  const handlePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.88, 1.88, 0),
    new THREE.Vector3(1.18, 2.05, 0),
    new THREE.Vector3(1.52, 1.72, 0),
    new THREE.Vector3(1.58, 1.25, 0),
    new THREE.Vector3(1.52, 0.78, 0),
    new THREE.Vector3(1.18, 0.42, 0),
    new THREE.Vector3(0.88, 0.5, 0),
  ])
  const handle = new THREE.TubeGeometry(handlePath, 48, 0.175, 16, false)
  handle.scale(1, 1, 0.82)
  handle.computeVertexNormals()
  // 根部两颗圆角衔接，盖住管子切口
  const stubMat = new THREE.MeshPhysicalMaterial({
    color: '#f0e9e0',
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  })
  const stubTop = new THREE.SphereGeometry(0.22, 16, 12)
  stubTop.translate(0.93, 1.88, 0)
  const stubBot = new THREE.SphereGeometry(0.22, 16, 12)
  stubBot.translate(0.93, 0.5, 0)
  return seated([
    [body, glaze],
    [inner, liner],
    [handle, stubMat],
    [stubTop, stubMat],
    [stubBot, stubMat],
  ])
})()

// AirTag：两片鼓面。下面是不锈钢，只有中心一小圈挨地，边缘翘起；上面是白色鼓面。半径 1。
const airtag = seated([
  [lathe([[0, 0], [0.4, 0.02], [0.7, 0.06], [0.88, 0.12], [0.95, 0.18]]), mat('#d9dce1', 0.14, 1)],
  [lathe([[0.95, 0.18], [0.995, 0.23], [1, 0.29], [0.97, 0.35], [0.84, 0.42], [0.6, 0.475], [0.3, 0.5], [0, 0.505]]), mat('#f4f3ef', 0.3)],
])

// HomePod mini：上下各削平的球，顶面一块微凸的触控面。太空灰在这个尺寸下顶面会压成
// 黑洞，读成开口，所以用浅一点的灰，顶面跟机身同色同料。半径 1。
const homepod = (() => {
  const c = 0.86
  const top = 2 * c
  const rim = Math.sqrt(1 - c * c)
  const pts: [number, number][] = [[0, 0]]
  for (let i = 0; i <= 14; i++) {
    const y = (i / 14) * top
    pts.push([Math.sqrt(Math.max(0, 1 - (y - c) ** 2)), y])
  }
  pts.push([rim * 0.7, top + 0.012], [0, top + 0.02])
  return seated([[lathe(pts, 36), mat('#6b6e75', 0.95)]])
})()

// 黄色六角铅笔，沿 x 躺着，一个平面贴地。木色削尖、石墨笔芯、铝箍、粉橡皮。
// 外接圆半径 1，长度按 175 / 4 的比例。
const pencil = (() => {
  const L = 34
  const along = (geo: THREE.BufferGeometry, x: number) => geo.rotateZ(Math.PI / 2).translate(x, 0, 0)
  const hex = (r0: number, r1: number, len: number, x: number) => along(new THREE.CylinderGeometry(r1, r0, len, 6), x)
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [hex(1, 1, L, 0), mat('#f2b52a', 0.32)],
    [hex(1, 0.3, 4, -L / 2 - 2), mat('#e3c08f', 0.85)],
    [hex(0.3, 0.02, 1, -L / 2 - 4.5), mat('#2e2e31', 0.45)],
    [along(new THREE.CylinderGeometry(1.03, 1.03, 2.2, 16), L / 2 + 1.1), mat('#c9ccd1', 0.25, 1)],
    [along(new THREE.CylinderGeometry(0.96, 0.96, 1.8, 16), L / 2 + 3.1), mat('#e7877f', 0.7)],
  ]
  // 六棱柱默认一条棱朝上；转 30° 让平面朝下。seated 会把 y 转到 z，所以截面先从 y-z 转回来。
  for (const [geo] of parts) geo.rotateX(Math.PI / 6).rotateX(-Math.PI / 2)
  // 六棱柱的法线默认平滑过渡，拆开三角形重算，六个面才各自一个明暗。
  const faceted = parts.map(([geo, m], i): [THREE.BufferGeometry, THREE.Material] => {
    if (i > 2) return [geo, m]
    const flat = geo.toNonIndexed()
    flat.computeVertexNormals()
    return [flat, m]
  })
  return seated(faceted)
})()

// 明亮式切工：八面冠部压在八面亭部上。侧躺时亭部一条斜棱和腰棱一起挨地，
// 轴线倾斜 90° 减亭部半角。单位半径 1。
const diamond = (() => {
  const glass = mat('#eef3f8', 0.06)
  const crown = new THREE.CylinderGeometry(0.55, 1, 0.38, 8).translate(0, 0.19, 0)
  const pavilion = new THREE.ConeGeometry(1, 0.95, 8).rotateX(Math.PI).translate(0, -0.475, 0)
  const lean = Math.PI / 2 - Math.atan2(1, 0.95)
  return seated([[crown, glass], [pavilion, glass]], new THREE.Euler(0, 0.4, lean))
})()

function Props() {
  return (
    <layer x="0" y={STAGE.groundY} width={FLOOR.w} height={FLOOR.h} origin={`${FLOOR.w / 2} 0`} rotateX="90" preserve-3d>
      {/* 左后：HomePod mini */}
      <model object={homepod} unit={SPEAKER.r} x={SPEAKER.x} y={SPEAKER.y} />
      {/* 右侧中段：奶油釉马克杯，印花朝舞台中心，C 形把手朝外 */}
      <layer x={MUG.cx} y={MUG.cy} width="0" height="0" rotate={MUG.turn} preserve-3d>
        <model object={mug} unit={MUG.r} x="0" y="0" />
      </layer>
      {/* 前沿：铅笔斜放，笔尖指向左前的钻石 */}
      <layer x={PENCIL.x} y={PENCIL.y} width="0" height="0" rotate={PENCIL.turn} preserve-3d>
        <model object={pencil} unit={PENCIL.r} x="0" y="0" />
      </layer>
      {/* 前沿中间：AirTag 白面朝上 */}
      <model object={airtag} unit={TAG.r} x={TAG.x} y={TAG.y} />
      {/* 前沿偏右：竖放的 AirPods Pro 盒，转一点角 */}
      <rect x={POD.x - POD.w / 2} y={POD.y - POD.d / 2} width={POD.w} height={POD.d} depth={POD.h} rx="24" z={POD.h / 2} fill="#f7f6f2" material="finish plastic, color #f7f6f2, roughness 0.3, clearcoat 0.5" rotate={POD.turn} />
      <rect x={POD.x - POD.w / 2 - 0.6} y={POD.y - POD.d / 2 - 0.6} width={POD.w + 1.2} height={POD.d + 1.2} depth="1.4" rx="24" round="z" z={POD.h * 0.72} fill="#c9c9c4" material="plastic 0.3" rotate={POD.turn} />
      {/* 左前：钻石侧躺在桌面上 */}
      <layer x={GEM.x} y={GEM.y} width="0" height="0" rotate={GEM.turn} preserve-3d>
        <model object={diamond} unit={GEM.r} x="0" y="0" />
      </layer>
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
