/** @jsxImportSource flexlayer */
import * as THREE from 'three'
import { createCanvas, Path2D } from '@napi-rs/canvas'

// 银色 16 英寸 MacBook Pro 海报，同时是一张材质对照：机身阳极氧化铝，
// 桌上的配件各用一种 finish，见 Props。
// 成片（抗锯齿最足的一条路）：先在 ../flexlayer-render 里 `npm run build:unlimited`，
// 然后 FLEXLAYER_RENDER=../flexlayer-render/dist/unlimited/index.cjs
//   npx tsx src/cli.ts render examples/macbook-pro.tsx -o examples/macbook-pro.png --scale 2
// 2× 出 2880×3600，再 LANCZOS 收回 1440×1800：每个成片像素 4 个样本，棱线没有锯齿。
// 单倍直接出图：npx tsx src/cli.ts render examples/macbook-pro.tsx -o examples/macbook-pro.png --mesh-samples 4
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

const GRILLE_W = 56
const GRILLE_GAP = 16
const grilleBox = (side: -1 | 1) => ({
  x: side < 0 ? KB.x - GRILLE_W - GRILLE_GAP : KB.x + KB_W + GRILLE_GAP,
  y: KB.y + 4,
  w: GRILLE_W,
  h: WELL_BOX.h - 8,
})
const grilles = ([-1, 1] as const).map((side) => grilleBox(side))

// 扬声器孔直接开在顶壳上：孔圈追加到机身外轮廓的同一条 path 里，
// `fill-rule="evenodd"` 把每个孔都变成真正的洞，斜视角能看到孔壁。
// 单独抬一块「穿孔板」会让金属反射在矩形边界处断开，看起来像贴了块不同色的补丁。
function grilleHoles(w: number, h: number, ox = 0, oy = 0) {
  // 镜头下约 0.6 px / 单位，孔径和孔距都得够大，否则孔在屏幕上一像素宽、
  // 采出来是一片条纹而不是孔。
  const step = 9
  const holeRadius = 2.75
  let d = ''
  for (let gy = step / 2; gy < h; gy += step) {
    for (let gx = step / 2; gx < w; gx += step) {
      const cx = ox + gx + holeRadius
      const cy = oy + gy + holeRadius
      d += `M ${cx.toFixed(2)} ${(cy - holeRadius).toFixed(2)} a ${holeRadius} ${holeRadius} 0 1 0 0 ${(2 * holeRadius).toFixed(2)} a ${holeRadius} ${holeRadius} 0 1 0 0 ${(-2 * holeRadius).toFixed(2)} Z `
    }
  }
  return d
}
// 机身外轮廓 + 两片扬声器孔，一次挤出：顶壳是完整的一片铝。
const grilleHolePath = grilles
  .map((g) => grilleHoles(g.w, g.h, g.x, g.y))
  .join('')
const deckPath = roundRect(W, D, CORNER) + grilleHolePath

// 16 英寸触控板约 160 × 100 mm，离前沿 11 mm。
const PAD = { w: 424, h: 262 }
const padX = (W - PAD.w) / 2
const padY = D - 28 - PAD.h

function Base() {
  return (
    <layer x={STAGE.x} y={STAGE.groundY - TOP} width={W} height={D} origin={`${W / 2} 0`} rotateX="90" preserve-3d>
      <path d={deckPath} fill-rule="evenodd" fill={SILVER} material={SHELL} depth={T} stroke="none" />
      {/* 键盘井：有厚度的哑光黑托板。用 path 挤出，圆角不受薄壁的 rx 限制 */}
      <rect
        x={WELL_BOX.x}
        y={WELL_BOX.y}
        width={WELL_BOX.w}
        height={WELL_BOX.h}
        rx="8"
        round="z"
        fill={WELL}
        material={{ finish: 'plastic', roughness: 0.72, clearcoat: 0.1 }}
        depth="4"
        z={TOP + 0.04 - 2}
        stroke="none"
      />
      {/* 扬声器：深色腔体藏在顶壳内侧，孔本身是顶壳挤出体上的洞，
          所以孔壁也是铝、孔底才是黑腔。 */}

      {grilles.map((g) => (
        <rect
          x={g.x + 1}
          y={g.y + 1}
          width={g.w - 2}
          height={g.h - 2}
          rx="3"
          round="z"
          fill="#131518"
          material={{ finish: 'plastic', roughness: 0.9 }}
          depth="2"
          z={TOP - 1.4}
          stroke="none"
        />
      ))}
      <rect
        x={touchId.x - 1.5}
        y={touchId.y - 1.5}
        width={touchId.w + 3}
        height={touchId.h + 3}
        rx="5.5"
        round="z"
        fill="#a9acb2"
        material={{ finish: 'metal', roughness: 0.3 }}
        depth="2"
        z={TOP + 0.05 - 1}
        stroke="none"
      />
      {/* 触控板：先压一圈深色缝隙，再放玻璃面。真机是玻璃，比掌托略暗、
          低粗糙度，边缘靠这道缝隙分界，不靠描边。 */}
      <rect
        x={padX - 1}
        y={padY - 1}
        width={PAD.w + 2}
        height={PAD.h + 2}
        rx="12.5"
        round="z"
        fill="#7c8085"
        material={{ finish: 'plastic', roughness: 0.6 }}
        depth="1.4"
        z={TOP + 0.02 - 0.7}
        stroke="none"
      />
      <rect
        x={padX}
        y={padY}
        width={PAD.w}
        height={PAD.h}
        rx="12"
        round="z"
        fill="#dfe3e8"
        material={{ finish: 'plastic', color: '#dfe3e8', roughness: 0.26, clearcoat: 0.5 }}
        depth="1.2"
        z={TOP + 0.05 - 0.6}
        stroke="none"
      />
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

// 桌上的配件，各用一种 finish：马克杯（奶油釉面 + 侧面贴图），六角铅笔
// （漆面 plastic、木头 matte、铝箍 metal、橡皮 matte），AirTag（白 plastic + 不锈钢 metal），
// AirPods Pro 盒（白色注塑：plastic 0.3 + 薄 clearcoat），钻石（glass）。
// 和机身同一块地。y 是进深，往镜头为正；z 是离地高度。尺寸按机身同一比例，约 2.64 px/mm：
// 马克杯 Ø80×95、铅笔 175 × 对角 8、AirTag Ø32×8、AirPods Pro 盒 61×22×45。
// 左边这块空桌面留给机身本身，马克杯在右侧中段，AirPods 盒、AirTag、铅笔、钻石在前沿错开进深。
// 模型都用低面数 lathe 和六棱柱，不拖慢渲染。
const FLOOR = { w: 1440, h: 1300 }

// 机身占 floor 上 x∈[290,1230]、y∈[0,656]。道具围在机身两侧和前沿，互相挨着、

// 杯子挪到机身前沿中段，右前角（接口那一侧）整个露出来。
// turn：印花朝镜头偏中心，把手朝右前。
const MUG = { cx: 690, cy: 1055, r: 105.7, turn: -34 }
// 铅笔横在机身前沿，笔尖朝左，和钻石之间留一段空桌面。
// 相机俯角 14°，进深每差 20px 屏幕上只差约 14px，所以尾端要在平面上离机身前沿
// 留出 100px 以上，屏幕上才有 30px 左右看得见的空隙。再往里推，橡皮尾巴就会
// 压到机身轮廓线上，读起来像插进电脑里。turn 也随之收到 -9°，让笔不那么斜。
const PENCIL = { x: 630, y: 838, r: 11, turn: -9 }
// AirTag 斜靠在马克杯右前的外壁上。位置是解出来的，不是目测的：把 AirTag 的
// 实际顶点（含倾角的盘体和顶面圆盘）投到地面，对杯子的旋转轮廓求最小距离，
// 取间隙 ≈ 1.5px 的那一档。注意桌面层有 rotateX 90°，平面的 +y 指向镜头，
// y 越大越靠前——写反了会整只躲到杯子后面，只剩一道边露出来。
// 它和 MUG 绑定，杯子一动要跟着走。
const TAG = { x: 757, y: 1171, r: 42.2, turn: 0 }
// AirPods Pro 盒盖朝上平放。模型宽度是 60.6 / 21.7。
const POD_W = 60.6 / 21.7
const POD = { x: 1040, y: 990, w: 148, turn: -18 }
const GEM = { x: 425, y: 985, r: 48, turn: 30 }

const mat = (color: string, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })

// Starbucks 塞壬：simple-icons 的 24×24 单色路径。用 evenodd 填充，
// 王冠、双尾之间的镂空和脸部才留得下来。
const STARBUCKS_PATH = [
  'M13.2072 5.2801c-.1052-.0188-.6126-.104-1.2072-.104s-1.102.0848-1.2072.104c-.0605.0108-.0837-.04',
  '84-.0377-.0828.0417-.0308 1.2445-.9463 1.2445-.9463l1.244.9463c.0469.0344.024.0936-.0364.0828zm-',
  '2.0783 5.9446s-.0636.0228-.0804.0788c.252.1937.4257.6343.9515.6343s.6995-.4406.9511-.6343c-.0164',
  '-.0564-.08-.0788-.08-.0788s-.3293.0776-.8711.0776c-.5418 0-.8711-.0776-.8711-.0776zM12 10.4832c-',
  '.146 0-.178-.0552-.2777-.0548-.0948.0004-.2789.076-.319.1453a.1542.1542 0 00.0413.0948c.2129.032',
  '.309.1505.5558.1505.2469 0 .3425-.1185.5558-.1505a.1579.1579 0 00.0412-.0948c-.0396-.0692-.224-.',
  '1445-.3193-.1453-.1-.0008-.1324.0548-.2781.0548zm11.9868 2.27a11.964 11.964 0 01-.076.8528c-1.35',
  '9.2249-1.8447-.986-3.2368-.9252.0832.2954.1508.5963.2029.9036 1.148-.0008 1.6105 1.0724 2.8878.9',
  '143-.0672.3281-.148.6519-.2413.9708-1.01.0992-1.3657-.9044-2.5345-.8767.0096.1664.0148.3345.0148',
  '.5041l-.0048.2805 2.2696.866a12.04 12.04 0 01-.3965.9479c-.6823-.0376-.9175-.9127-1.9555-.8431a9',
  '.0882 9.0882 0 01-.118.665c.9015-.0632 1.0955.7667 1.7414.834a12.2317 12.2317 0 01-.5302.8767c-.',
  '3826-.205-.7143-.8231-1.4398-.8612a8.6035 8.6035 0 00.195-.6994c-.6435 0-1.3794-.2509-1.9964-.81',
  '27.2-1.1388-1.5674-2.2984-1.5674-3.1324 0-.9059.4582-1.4073.4582-2.6285 0-.9063-.4402-1.8895-1.1',
  '04-2.5614a2.2175 2.2175 0 00-.4114-.3309c.6098.7547 1.078 1.6494 1.078 2.6858 0 1.15-.535 1.757-',
  '.535 2.8186 0 1.0612 1.5526 1.9796 1.5526 3.074 0 .4305-.1377.851-.5914 1.677.697.6962 1.605 1.0',
  '76 2.1908 1.076.19 0 .292-.058.3601-.2073a9.0925 9.0925 0 00.1665-.391c.631.0245.9199.5979 1.269',
  '2.8268-.1916.2573-.393.5057-.6038.7462-.234-.2593-.5486-.6954-1.0092-.8167a9.2087 9.2087 0 01-.2',
  '613.473c.3966.108.6679.5082.878.7715a12.1305 12.1305 0 01-.7075.6754c-.1532-.2384-.3917-.541-.65',
  '9-.7042a8.3639 8.3639 0 01-.3077.391c.2272.154.4277.4313.5586.6574-.2833.2272-.5763.443-.8796.64',
  '46-.1496-1.2192-1.8138-2.0548-1.3653-3.4693-.1472.2493-.3229.561-.3229.9364 0 1.024 1.0908 1.836',
  '6 1.1776 2.8542-.226.1353-.4573.2625-.693.383-.0392-1.1185-1.194-2.3425-1.194-3.2604 0-1.0248 1.',
  '342-2.054 1.342-3.2636 0-1.2105-1.5485-2.0484-1.5485-3.1112 0-1.062.6586-1.673.6586-3.0343 0-.99',
  '72-.4738-2.0063-1.2056-2.651-.1297-.1144-.2573-.2052-.4106-.2849.6903.828 1.0904 1.579 1.0904 2.',
  '7186 0 1.2801-.7546 1.9908-.7546 3.244 0 1.2537 1.5197 1.9507 1.5197 3.1192 0 1.1684-1.4145 2.15',
  '32-1.4145 3.3536 0 1.092 1.2468 2.182 1.2653 3.4777a11.7704 11.7704 0 01-.8327.3257c.1584-1.3089',
  '-1.245-2.659-1.245-3.727 0-1.1676 1.4674-2.1712 1.4674-3.43 0-1.2597-1.4917-1.8451-1.4917-3.138 ',
  '0-1.292.9151-2.0075.9151-3.4352 0-1.1129-.5494-2.1136-1.352-2.7338l-.0509-.0385c-.0756-.056-.138',
  '.0116-.0844.078.5682.7095.8719 1.427.8719 2.4894 0 1.306-1.0512 2.3673-1.0512 3.6325 0 1.4934 1.',
  '4117 1.9203 1.4117 3.1456 0 1.2248-1.5137 2.2048-1.5137 3.5053 0 1.206 1.4325 2.5445 1.1868 3.93',
  '66a11.6645 11.6645 0 01-.8743.192c.2689-1.7334-1.1364-2.9782-1.1364-4.1122 0-1.2277 1.5677-2.322',
  ' 1.5677-3.5217 0-1.1316-1.1252-1.5014-1.2732-2.659-.0204-.158-.1473-.2753-.3221-.2461-.2285.0416',
  '-.5214.192-.9816.192-.4602 0-.753-.1508-.982-.192-.1744-.0288-.3013.0884-.3217.246-.1476 1.1577-',
  '1.2736 1.527-1.2736 2.659 0 1.1997 1.5681 2.2937 1.5681 3.5218 0 1.134-1.4053 2.3788-1.1368 4.11',
  '23a12.1233 12.1233 0 01-.8743-.1921c-.2457-1.3921 1.1872-2.7306 1.1872-3.9366 0-1.3005-1.5141-2.',
  '2805-1.5141-3.5053 0-1.2253 1.412-1.6522 1.412-3.1456 0-1.2652-1.0515-2.326-1.0515-3.6325 0-1.06',
  '2.3037-1.7795.8723-2.4893.0532-.0665-.0088-.134-.0848-.078l-.0504.0384c-.802.6186-1.351 1.6193-1',
  '.351 2.7322 0 1.4277.9152 2.1431.9152 3.4352 0 1.2925-1.4917 1.878-1.4917 3.138 0 1.2588 1.4673 ',
  '2.2624 1.4673 3.43 0 1.0684-1.4033 2.4181-1.2445 3.727a11.8995 11.8995 0 01-.833-.3257c.0188-1.2',
  '957 1.2648-2.3861 1.2648-3.4777 0-1.2004-1.4137-2.1852-1.4137-3.3536 0-1.1685 1.519-1.8655 1.519',
  '-3.1192 0-1.2532-.7543-1.9639-.7543-3.244 0-1.1396.3997-1.8907 1.09-2.7186-.1537.0797-.281.1705-',
  '.4102.285-.7318.6446-1.2052 1.6537-1.2052 2.651 0 1.3612.6586 1.9722.6586 3.0342 0 1.0628-1.5485',
  ' 1.9007-1.5485 3.1112 0 1.2096 1.342 2.2392 1.342 3.2636 0 .9183-1.1556 2.1423-1.1944 3.2604a11.',
  '8754 11.8754 0 01-.693-.383c.0872-1.0176 1.1776-1.8303 1.1776-2.8542 0-.3754-.1753-.687-.323-.93',
  '64.4486 1.4145-1.2156 2.25-1.3652 3.4693a12.1204 12.1204 0 01-.8796-.6446c.1305-.2257.331-.5034.',
  '5586-.6575a7.9134 7.9134 0 01-.3077-.391c-.2677.1633-.5066.4659-.6594.7043a12.2459 12.2459 0 01-',
  '.707-.6754c.21-.2633.4813-.6635.8779-.7715a9.0433 9.0433 0 01-.2613-.473c-.4606.1213-.7755.5574-',
  '1.0092.8167a12.141 12.141 0 01-.6038-.7462c.3493-.229.6382-.8027 1.2688-.8267.0529.1312.1085.261',
  '7.1669.3909.068.1493.1705.2073.3601.2073.5858 0 1.4934-.3798 2.1908-1.076-.4537-.826-.5914-1.246',
  '5-.5914-1.677 0-1.094 1.5526-2.0124 1.5526-3.074 0-1.0615-.535-1.6686-.535-2.8186 0-1.0364.4682-',
  '1.9311 1.078-2.6858a2.2175 2.2175 0 00-.4114.331c-.6638.6722-1.104 1.655-1.104 2.5613 0 1.2212.4',
  '586 1.7226.4586 2.6285 0 .834-1.7679 1.9936-1.5678 3.1324-.617.5618-1.3529.8127-1.9967.8127a9.30',
  '5 9.305 0 00.1949.6994c-.7251.0385-1.0568.6567-1.4398.8612a12.0872 12.0872 0 01-.5302-.8768c.645',
  '5-.0672.84-.897 1.7419-.8339a9.1275 9.1275 0 01-.1185-.665c-1.038-.0696-1.2732.8059-1.9555.8431a',
  '12.04 12.04 0 01-.3965-.948l2.27-.8659-.0048-.2805c0-.1696.0052-.3377.0144-.5041-1.1688-.0273-1.',
  '5246.976-2.5345.8767a12.106 12.106 0 01-.241-.9708c1.2766.158 1.7395-.9151 2.888-.9143a8.7482 8.',
  '7482 0 01.2024-.9036c-1.392-.0604-1.8779 1.1505-3.2364.9252a11.7352 11.7352 0 01-.076-.8527c1.57',
  '94.1764 2.1716-1.122 3.6097-.9632a8.4303 8.4303 0 01.471-.9963c-1.803-.317-2.4153 1.1908-4.0935.',
  '9591C.1813 5.2805 5.4844.0898 12 .0898S23.8187 5.2805 24 11.753c-1.6786.2317-2.2908-1.2757-4.093',
  '5-.9591.1773.32.335.6526.471.9963 1.4373-.1592 2.0295 1.1396 3.6093.9632zm-17.147-5.035c-.884-.3',
  '613-1.954-.278-2.868.309-.1416-.8504-.603-1.6058-1.26-2.0616-.0908-.0628-.1853-.0032-.1769.102.1',
  '389 1.7967-.9115 3.3569-2.2032 4.7282 1.3313.4001 2.4645-1.3141 4.1912-.7159a9.0364 9.0364 0 012',
  '.3168-2.3617zM12 6.6314c-1.1144 0-2.048.6303-2.2924 1.4446-.0188.0624.0068.1028.0788.0704.2005-.',
  '09.4285-.1333.6762-.1333.4546 0 .8551.1669 1.092.4574.1049.3457.1137.8463-.0048 1.132-.1872-.042',
  '-.2545-.1868-.4373-.1868-.1829 0-.3245.1284-.6347.1284-.3097 0-.346-.1465-.5498-.1465-.2396 0-.2',
  '837.247-.2837.5254 0 1.2417 1.1413 2.9503 2.3553 2.9503 1.2136 0 2.3549-1.7086 2.3549-2.9503 0-.',
  '2785-.0573-.517-.3077-.5494-.1249.09-.2397.1705-.5254.1705-.3102 0-.3958-.1284-.5783-.1284-.2204',
  ' 0-.1984.465-.4601.491-.1745-.4194-.1829-.9572-.038-1.4362.2373-.2905.6374-.4574 1.092-.4574.247',
  '7 0 .4773.0437.6758.1333.0724.0324.0976-.0084.0788-.0704-.244-.8143-1.1772-1.4446-2.2916-1.4446z',
  'm1.7743 1.7815c-.2673 0-.5807.082-.7775.3013-.0204.0596-.0204.1484.0084.2077.4845-.166.9119-.172',
  '5 1.1184.0584.11-.1.1452-.19.1452-.2945 0-.1613-.164-.273-.4945-.273zm-3.8979.5674c.2337-.234.72',
  '63-.224 1.238-.0352.0225-.2545-.4333-.5326-.8887-.5326-.3309 0-.4945.1116-.4945.2733 0 .1044.035',
  '2.1949.1452.2945zm7.6804-4.2031c-.8799.0628-1.6442.3649-2.2624.8683.2625-.7443.5958-1.3953 1.018',
  '4-2.0264-1.1204.1189-2.0572.5286-2.7406 1.2289l-.535-1.4025 1.1876-1.0488-1.5902-.1125L12 .8053l',
  '-.635 1.479-1.5902.1124 1.1876 1.0488-.5346 1.4025c-.6838-.7003-1.6206-1.11-2.7402-1.2289.4218.6',
  '315.7551 1.2825 1.0176 2.0264-.6178-.5038-1.3821-.806-2.262-.8683.5278.6786.9955 1.402 1.342 2.1',
  '8.0393.0876.1233.1164.2141.0712 1.2053-.599 2.5634-.936 4.0003-.936 1.437 0 2.7946.3374 4.0007.9',
  '36.0908.0452.1748.0164.2136-.0712.347-.778.8147-1.5014 1.343-2.18zm1.9211 5.3035c1.7259-.5982 2.',
  '8595 1.1156 4.1908.7159-1.2917-1.3713-2.3417-2.9315-2.2028-4.7282.0084-.1052-.0865-.1652-.1769-.',
  '102-.6574.4558-1.1188 1.2112-1.26 2.0615-.9144-.587-1.984-.6706-2.868-.3089a9.0431 9.0431 0 012.',
  '317 2.3617z',
].join('')

/**
 * 马克杯外壁贴图。
 *
 * 整只杯子是素白瓷，只有正面一枚绿色圆形塞壬标。
 * 画布尺寸按杯面展开的真实比例给（横向一圈 ARC_U，纵向整条轮廓 ARC_V），
 * 于是画布像素在两个方向是同一个世界尺度，画圆就是圆；贴上去用 three 的
 * 默认 UV 采样，不需要任何额外的拉伸校正。
 */
// 外轮廓：圈足是唯一落地的一圈，侧壁略收腰，口沿是一圈带圆角的唇 ——
// 真实马克杯的口沿是卷起来的圆边，不是一条水平的切面；平口会在低机位下
// 读成一根厚壁管子，所以这里用五段弧把 0.12 的壁厚收成一个圆唇。
const MUG_OUTER: [number, number][] = [
  [0, 0.028],
  [0.58, 0.028],
  [0.7, 0],
  [0.79, 0.006],
  [0.9, 0.05],
  [0.955, 0.14],
  [0.975, 0.4],
  [0.962, 1.2],
  [0.978, 1.95],
  [0.992, 2.2],
  [0.999, 2.28],
  // 唇顶：从外壁翻过口沿，再落回内径
  [1.0, 2.302],
  [0.996, 2.325],
  [0.982, 2.342],
  [0.958, 2.35],
  [0.93, 2.35],
  [0.903, 2.342],
  [0.884, 2.326],
  [0.876, 2.302],
  [0.875, 2.28],
]
const MUG_H = 2.35
const MUG_GREEN = '#006241'
// 贴图的 v 是整条轮廓的弧长归一化，不是杯高：从杯底圆心绕到杯口内侧一共约 3.3。
// 画圆必须用这个总弧长，用杯高算出来的"圆"贴上去会被纵向拉长 1.4 倍。
const MUG_ARC = (() => {
  let total = 0
  for (let i = 1; i < MUG_OUTER.length; i++) {
    total += Math.hypot(MUG_OUTER[i]![0] - MUG_OUTER[i - 1]![0], MUG_OUTER[i]![1] - MUG_OUTER[i - 1]![1])
  }
  return total
})()
// v 是弧长归一化，不是高度：口沿那圈圆唇的弧长占比很大，直接对 v 取中点
// 会落到接近口沿的位置。要按"杯身高度"摆印花，就得先把目标高度换算成 v。
// 这里沿轮廓累加弧长，返回高度落在 targetY 时对应的 v。
function mugVAtHeight(targetY: number): number {
  let arc = 0
  for (let i = 1; i < MUG_OUTER.length; i++) {
    const [r0, y0] = MUG_OUTER[i - 1]!
    const [r1, y1] = MUG_OUTER[i]!
    const seg = Math.hypot(r1 - r0, y1 - y0)
    if (y1 >= targetY && y1 > y0) {
      const t = (targetY - y0) / (y1 - y0)
      return (arc + seg * t) / MUG_ARC
    }
    arc += seg
  }
  return arc / MUG_ARC
}
// 杯身从圈足顶面量到唇顶。
const MUG_BODY_BOTTOM = 0.05
const MUG_BODY_TOP = 2.35

function mugWrapMap() {
  // 贴图尺寸按杯面的真实展开比例给：横向一整圈是 ARC_U，纵向整条轮廓是 ARC_V。
  // 这样画布上的像素在两个方向上是同一个世界尺度，画圆就是圆——不需要在
  // 采样阶段再做任何拉伸校正。这就是 three 里最普通的贴图用法。
  const R_CUP = 0.96
  const ARC_U = 2 * Math.PI * R_CUP
  const ARC_V = MUG_ARC
  const texelPerUnit = 300
  const w = Math.round(ARC_U * texelPerUnit)
  const h = Math.round(ARC_V * texelPerUnit)

  const canvas = createCanvas(w, h)
  const g = canvas.getContext('2d')

  // 素釉底：暖白瓷。极细的噪点让大面积白面不至于死平。
  g.fillStyle = '#f6f3ec'
  g.fillRect(0, 0, w, h)

  // 徽标中心：u = 0.5 + turn/360（屏幕正中那条经线），
  // 高度取杯身正中，再换算成弧长参数 v。
  const BADGE_U = 0.5 + MUG.turn / 360
  const BADGE_V = mugVAtHeight((MUG_BODY_BOTTOM + MUG_BODY_TOP) / 2)
  // 直径按世界长度给：杯径 211mm 的杯子，标大约 60mm 宽。
  const BADGE_R = 0.30 * MUG_H
  // revolve 的 v 从杯底圆心（0）走到杯口（1），画布的 y 也是从上往下，
  // 而 CanvasTexture 默认 flipY 会把图再翻一次。净效果是 v=1 落在画布顶端，
  // 所以纵坐标要用 (1 - v) * h，否则印花会掉到杯脚。
  const cx = BADGE_U * w
  const cy = (1 - BADGE_V) * h
  const radius = BADGE_R * texelPerUnit

  // 绿底圆
  g.fillStyle = MUG_GREEN
  g.beginPath()
  g.arc(cx, cy, radius, 0, Math.PI * 2)
  g.fill()

  // 塞壬：24×24 的路径缩放到绿底内，居中，白色 evenodd 填充。
  const side = radius * 2 * 0.86
  const scale = side / 24
  g.save()
  g.translate(cx - side / 2, cy - side / 2)
  g.scale(scale, scale)
  g.fillStyle = '#ffffff'
  g.fill(new Path2D(STARBUCKS_PATH), 'evenodd')
  g.restore()

  const map = new THREE.CanvasTexture(canvas)
  // CanvasTexture 默认 flipY = true，正好对上 three 的 v 轴朝上；
  // 渲染器的 UV 也是同一套约定，直接沿用即可。
  map.colorSpace = THREE.SRGBColorSpace
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

/**
 * 自建回转体：u = θ/2π（θ=0 在 +X），v = 轮廓弧长归一化。
 *
 * `LatheGeometry` 的 v 是轮廓点序号（i/(n-1)），点密的地方纹理就被压扁：
 * 印花带的位置会随轮廓点数跳变，杯口和圈足那几段尤其明显。这里按弧长算 v，
 * 贴图在杯面上才是等距的。
 */
function revolve(profile: [number, number][], segments: number, startAngle = 0) {
  const arc: number[] = [0]
  for (let i = 1; i < profile.length; i++) {
    const dr = profile[i]![0] - profile[i - 1]![0]
    const dy = profile[i]![1] - profile[i - 1]![1]
    arc.push(arc[i - 1]! + Math.hypot(dr, dy))
  }
  const total = Math.max(1e-9, arc[arc.length - 1]!)
  const pos: number[] = []
  const uv: number[] = []
  // 接缝只放一圈顶点：j = segments 那一圈直接复用 j = 0 的索引。
  // 如果两圈各自算顶点，位置重合但法线独立，光照在接缝处会裂出一条亮线。
  for (let j = 0; j < segments; j++) {
    const u = j / segments
    const th = startAngle + u * Math.PI * 2
    const c = Math.cos(th)
    const s = Math.sin(th)
    for (let i = 0; i < profile.length; i++) {
      const [r, y] = profile[i]!
      pos.push(r * c, y, r * s)
      uv.push(u, arc[i]! / total)
    }
  }
  const idx: number[] = []
  const rows = profile.length
  for (let j = 0; j < segments; j++) {
    const next = (j + 1) % segments
    for (let i = 0; i < rows - 1; i++) {
      const a = j * rows + i
      const b = next * rows + i
      // 绕序必须让法线朝外：θ 增加是 +z 方向，轮廓向上是 +y，
      // 先上后绕才是右手系的外法线，否则整只杯子的外壁被背面剔除。
      idx.push(a, a + 1, b + 1, a, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  // 轮廓收到 r = 0 时，中心那一圈只有退化三角形，平均出来的法线是零向量。
  // 零法线在三个扇形三角形里插值会塌成一块暗楔——杯底那条硬斜边就是它。
  // 这只回转体的轴线是 +Y，底面朝上，所以零法线补成 (0,1,0)。
  const normalAttr = geo.getAttribute('normal')
  const nrm = normalAttr.array as Float32Array
  for (let i = 0; i < nrm.length; i += 3) {
    if (Math.hypot(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!) < 0.5) {
      nrm[i] = 0
      nrm[i + 1] = 1
      nrm[i + 2] = 0
    }
  }
  normalAttr.needsUpdate = true
  return geo
}

/**
 * 变半径扫掠。`TubeGeometry` 的半径是常数，把手两端就直接插进杯壁。
 * 这里用平行移动标架避免扭转，半径在根部鼓到 1.6 倍，读起来是根部过渡而不是一刀切口。
 */
function taperTube(curve: THREE.Curve<THREE.Vector3>, segments: number, radial: number, radiusAt: (t: number) => number) {
  const pos: number[] = []
  const idx: number[] = []
  const pts = curve.getSpacedPoints(segments)
  const tangents = pts.map((_, i) => curve.getTangentAt(Math.min(1, Math.max(0, i / segments))).normalize())
  let normal = new THREE.Vector3(0, 0, 1)
  if (Math.abs(tangents[0]!.dot(normal)) > 0.9) normal = new THREE.Vector3(1, 0, 0)
  normal.crossVectors(tangents[0]!, normal).normalize()
  const normals: THREE.Vector3[] = []
  for (let i = 0; i < pts.length; i++) {
    const t = tangents[i]!
    normal = normal.clone().sub(t.clone().multiplyScalar(normal.dot(t))).normalize()
    normals.push(normal.clone())
  }
  for (let i = 0; i < pts.length; i++) {
    const t = tangents[i]!
    const n = normals[i]!
    const b = new THREE.Vector3().crossVectors(t, n).normalize()
    const rad = radiusAt(i / segments)
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const cx = Math.cos(a)
      const cy = Math.sin(a)
      pos.push(pts[i]!.x + (n.x * cx + b.x * cy) * rad, pts[i]!.y + (n.y * cx + b.y * cy) * rad, pts[i]!.z + (n.z * cx + b.z * cy) * rad)
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j
      const b = a + radial + 1
      // 同理：扫掠方向 T 与环向 b̂ 的叉积才是外法线，反过来整根把手会被剔除。
      idx.push(a, a + 1, b + 1, a, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

// 马克杯：素白瓷，外壁车削（正面一枚绿色塞壬标）+ 白瓷内壁
// + 根部渐粗的 C 形把手。半径约 1，高 2.35。
// 印花在 u = 0.5 + turn/360（屏幕正中）；把手在 +X（朝外）。
const mug = (() => {
  const body = revolve(MUG_OUTER, 96)
  // 釉面：陶瓷的 roughness 很低，靠 clearcoat 出一块干净的高光。
  const glaze = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.14,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    map: mugWrapMap(),
  })
  // 内壁自带杯底（0.195），上缘收进 0.88 的口沿内径。
  const inner = revolve(
    [
      // 上缘从唇顶内侧平滑收进来：直接一刀切到 2.28 会在杯口内圈
      // 留下一条法线硬边，低机位下高光把它照成一道细白线。
      [0.874, 2.335],
      [0.872, 2.3],
      [0.868, 2.24],
      [0.862, 2.1],
      [0.858, 1.2],
      [0.85, 0.55],
      [0.815, 0.3],
      [0.71, 0.215],
      [0.5, 0.195],
      [0, 0.195],
    ],
    72,
    // 接缝转到杯后，避开正面高光。
    Math.PI,
  )
  // 内壁的几何法线朝外，但看得见的是内侧那一面：渲染器按 frag.back 已经
  // 翻过一次，这里再手动取反等于翻回正面，高光会落在错误的一侧，
  // 内壁就会出现一道镜面竖条，读成不锈钢内胆。
  // 同一层釉。内壁背光，高光比外壁柔一档，避免深处的摄影棚卡片被反射成
  // 一道锐利竖条；但它仍然是瓷，不是金属内胆。
  const liner = new THREE.MeshPhysicalMaterial({
    color: '#fbf8f2',
    roughness: 0.26,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  })
  // 把手：上下两个根部都落在杯腹中段（0.78 与 1.66），不贴口沿也不挨桌面。
  // 轮廓是一条外扩的 C：出杯后先向外抬一点，再竖直走一段，收口时压回杯壁。
  // 用 CatmullRom 太容易在根部起鼓包，这里直接给一条平滑的三次曲线。
  // 控制点按一个椭圆的一半来布：最外点 1.55，纵向从 1.66 跨到 0.78，
  // 拐角处多给一个点，避免 CatmullRom 在肩部把圆弧拉成方角。
  const handlePath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0.9, 1.7, 0),
      new THREE.Vector3(1.2, 1.74, 0),
      new THREE.Vector3(1.42, 1.64, 0),
      new THREE.Vector3(1.53, 1.44, 0),
      new THREE.Vector3(1.56, 1.22, 0),
      new THREE.Vector3(1.52, 1.0, 0),
      new THREE.Vector3(1.4, 0.86, 0),
      new THREE.Vector3(1.16, 0.78, 0),
      new THREE.Vector3(0.9, 0.76, 0),
    ],
    false,
    'catmullrom',
    0.5,
  )
  const R_HANDLE = 0.108
  const handle = taperTube(handlePath, 110, 28, (t) => {
    // 根部渐扩：用 smoothstep 而不是平方，避免在根部末端收得太急、
    // 留下一个外凸的尖角。中段保持等径。
    const end = Math.min(t, 1 - t)
    const k = Math.max(0, 1 - end / 0.26)
    const eased = k * k * (3 - 2 * k)
    return R_HANDLE * (1 + 0.42 * eased)
  })
  handle.scale(1, 1, 0.9)
  const handleMat = new THREE.MeshPhysicalMaterial({
    color: '#f6f3ec',
    roughness: 0.14,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  })
  // 内壁的可见面是背面，把法线翻过来，光照才落在内侧。
  const innerFlipped = inner.clone()

  return seated([
    [body, glaze],
    [innerFlipped, liner],
    [handle, handleMat],
  ])
})()

// 顶面不锈钢：中间一只刻上去的苹果，外圈一环刻字。直径约 31.9，厚 8，半径 1。
// 苹果标志用 simple-icons 的 Apple 轮廓（viewBox 0 0 24 24），不再手搓圆和缺口。
const APPLE_PATH =
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701'

const TAG_TEX = 1024

function airtagFace() {
  const n = TAG_TEX
  const cv = createCanvas(n, n)
  const g = cv.getContext('2d')
  const c = n / 2
  const R = n / 2

  // 拉丝钢底。金属通道里这张图不是"颜色"，而是反射的乘数：光斑、渐变、
  // 明暗全部由环境反射给，贴图只负责蚀刻出来的那几个灰阶差。
  // 所以底色必须整体留在中高灰的一小段里——写近白会把每个像素都乘成
  // 过曝的白斑，写近黑则整块钢被乘成黑片。这里刻意压平：
  // 底色 #c8ccd1，再叠一道只差 6~10 级的径向。
  g.fillStyle = '#c8ccd1'
  g.fillRect(0, 0, n, n)
  const sheen = g.createRadialGradient(c * 0.78, c * 0.7, 0, c, c, R)
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)')
  sheen.addColorStop(0.4, 'rgba(238,243,248,0.05)')
  sheen.addColorStop(1, 'rgba(120,126,134,0.16)')
  g.fillStyle = sheen
  g.fillRect(0, 0, n, n)
  // 拉丝纹：从圆心散开的极细线，疏密和明暗都带一点随机，免得读成同心圆。
  // 用固定种子的序列，重跑一次是同一张贴图。
  let seed = 20261105
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < 1600; i++) {
    const a = rnd() * Math.PI * 2
    const r0 = R * (0.05 + rnd() * 0.08)
    const r1 = R * (0.86 + rnd() * 0.14)
    g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(130,138,148,0.045)'
    g.lineWidth = 0.6 + rnd() * 1.5
    g.beginPath()
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
    g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1)
    g.stroke()
  }

  // 刻字：沿圆周逐字摆，先垫一道白边再压一道深灰，错开 1px 才读成凹槽。
  const arcText = (text: string, size: number, track: number, radius: number, top: boolean) => {
    g.save()
    g.font = `500 ${size}px Helvetica`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const widths = [...text].map((ch) => g.measureText(ch).width + track)
    const total = widths.reduce((a, b) => a + b, 0)
    let acc = -total / 2
    const base = top ? -Math.PI / 2 : Math.PI / 2
    for (let i = 0; i < text.length; i++) {
      const w = widths[i]!
      const along = acc + w / 2
      acc += w
      const theta = base + (top ? 1 : -1) * (along / radius)
      g.save()
      g.translate(c + Math.cos(theta) * radius, c + Math.sin(theta) * radius)
      g.rotate(top ? theta + Math.PI / 2 : theta - Math.PI / 2)
      // 激光蚀刻的读法是一条亮边压着一条暗边，两条都只比钢底浅/深几级。
      g.fillStyle = 'rgba(255,255,255,0.30)'
      g.fillText(text[i]!, 0, -1.6)
      g.fillStyle = 'rgba(96,104,116,0.40)'
      g.fillText(text[i]!, 0, 0)
      g.restore()
    }
    g.restore()
  }
  arcText('AirTag', 42, 11, R * 0.83, true)
  arcText('Designed by Apple in California', 29, 4, R * 0.83, false)

  // 中央苹果：高度约面径的 38%。同样是蚀刻，不是印刷：
  // 一条比钢底低几级的实心，再在右下补一道更暗的边，才是雕下去的厚度。
  const s = (n * 0.38) / 21.94
  const apple = (dx: number, dy: number, fill: string) => {
    g.save()
    g.translate(c + dx, c + dy)
    g.scale(s, s)
    g.translate(-12, -11.6)
    g.fillStyle = fill
    g.fill(new Path2D(APPLE_PATH))
    g.restore()
  }
  // 蚀刻只比钢底低几级：这是一层哑光氧化面，不是印上去的深色标。
  apple(1.4, 2.0, 'rgba(104,112,124,0.30)')
  apple(0, 0, 'rgba(186,192,203,0.42)')

  const px = g.getImageData(0, 0, n, n).data
  const map = new THREE.DataTexture(new Uint8Array(px.buffer, px.byteOffset, px.byteLength), n, n)
  map.flipY = false
  map.needsUpdate = true
  return map
}

// 白塑料圆盘，顶上一块不锈钢。金属面略小于白圈，侧面能看见一圈白边。
const airtag = (() => {
  const white = new THREE.MeshPhysicalMaterial({
    color: '#f4f1eb',
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  })
  // 真不锈钢：metalness 1，让环境反射单独负责明暗。贴图只乘在反射上，
  // 所以它里面不能有大反差，只能有蚀刻的那几级灰（见 airtagFace）。
  // 加一层很薄的 clearcoat 当抛光：AirTag 的钢面出厂就是镜面拉丝的。
  const steel = new THREE.MeshPhysicalMaterial({
    color: '#f2f5f8',
    roughness: 0.22,
    metalness: 1,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
    map: airtagFace(),
  })
  const body = lathe([
    [0, 0.03],
    [0.42, 0],
    [0.72, 0.05],
    [0.9, 0.14],
    [0.99, 0.26],
    [0.96, 0.36],
    [0.84, 0.44],
    [0.74, 0.48],
  ])
  // 钢面不是一个平盘，是一只很浅的球冠（AirTag 正面肉眼可见地鼓）。
  // 平盘的法线处处相同，反射方向就处处相同，整块面只能是一个色值；
  // 球冠让法线扫过一小段仰角，反射才会走完"顶光→侧面→地面"的整条梯度，
  // 这是不锈钢读起来像不锈钢的关键，跟贴图无关。
  //
  // 用圆盘顶点做位移，不用 SphereGeometry：圆盘的 uv 是贴图要的那套径向布局，
  // 球体的 uv 是经纬网，直接贴会把刻字和苹果拉成一块楔形。
  const faceR = 0.72
  const face = new THREE.CircleGeometry(faceR, 72)
  {
    const pos = face.getAttribute('position')
    const domeH = 0.055
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const t = Math.min(1, Math.hypot(x, y) / faceR)
      pos.setZ(i, domeH * (1 - t * t))
    }
    pos.needsUpdate = true
    face.computeVertexNormals()
  }
  face.rotateX(-Math.PI / 2).translate(0, 0.455, 0)
  // 机位很低，平放只能看见一条边。钢面朝镜头倾过来，底边仍然挨着桌面。
  return seated(
    [
      [body, white],
      [face, steel],
    ],
    new THREE.Euler(1.05, 0, 0),
  )
})()

// 黄色六角铅笔，沿 x 躺着，一个平面贴地。木色削尖、石墨笔芯，尾端是一截棕红色橡皮。
// 外接圆半径 1，长度按 175 / 4 的比例。
const pencil = (() => {
  const L = 34
  const along = (geo: THREE.BufferGeometry, x: number) => geo.rotateZ(Math.PI / 2).translate(x, 0, 0)
  const hex = (r0: number, r1: number, len: number, x: number) => along(new THREE.CylinderGeometry(r1, r0, len, 6), x)
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [hex(1, 1, L, 0), mat('#f2b52a', 0.32)],
    [hex(1, 0.3, 4, -L / 2 - 2), mat('#e3c08f', 0.85)],
    [hex(0.3, 0.02, 1, -L / 2 - 4.5), mat('#2e2e31', 0.45)],
    [along(new THREE.CylinderGeometry(1.03, 1.03, 2.2, 16), L / 2 + 1.1), mat('#7a382c', 0.42, 0.2)],
    [along(new THREE.CylinderGeometry(0.96, 0.96, 1.8, 16), L / 2 + 3.1), mat('#a34b3c', 0.72)],
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

// 明亮式切工：八面冠部压在八面亭部上。单位半径 1，腰在 y=0，台面 y=0.38，亭尖 y=-0.95。
// 姿态是"侧躺再翻一点"：rx 把模型翻过 138°，rz 转到一侧冠部先着地，
// 于是接触是"一侧冠面 + 亭尖"两点支撑，而不是原来只用一条腰棱和亭尖支着——
// 后者在地面上只有一条零宽度的线，看着就像翘起来了。
// 这个姿态台面朝上 69°、朝镜头 62°，俯视能看到完整的台面和冠部刻面。
// 角度是用支撑点解出来的，改切工比例（台面半径 / 冠高 / 亭深）时要重解。
const diamond = (() => {
  // 真正的透射玻璃。`MeshStandardMaterial` 没有 transmission 字段，会被归到
  // 塑料（metalness 0 → plastic），钻石于是变成一块不透光的白多面体。
  // transmission/ior 是 three 的 MeshPhysicalMaterial 默认贴图路径，内核据此
  // 走玻璃通道：菲涅尔反射、环境反射、折射，以及 draft 的屏幕空间透射。
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.015,
    metalness: 0,
    transmission: 1,
    ior: 2.42,
    thickness: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.01,
  })
  // A cut stone's whole read is its facet mosaic, so every facet has to be
  // built as its own plane. The first version used CylinderGeometry +
  // ConeGeometry with the vertices split: geometrically that is an 8-sided
  // crown and an 8-sided pavilion, and `toNonIndexed` only makes each of those
  // sixteen planes flat. One plane covers a third of the stone, so the table
  // came out as a single grey polygon and no shader could recover a mosaic
  // from it.
  //
  // A round brilliant is built from rings of points instead: table, 8 bezels
  // (kites), 16 upper-girdle facets, girdle, 16 lower-girdle facets, 8 pavilion
  // mains, culet. Each strip of triangles between two rings is one facet, and
  // alternating the two rings' angular offset by half a step is what makes the
  // zigzag that reads as a cut.
  const ring = (radius: number, y: number, count: number, phase: number) => {
    const points: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      const angle = ((i + phase) / count) * Math.PI * 2
      points.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius))
    }
    return points
  }
  const TABLE_Y = 0.30
  const GIRDLE_Y = 0.0
  const CULET_Y = -0.86
  const TABLE_R = 0.54
  const girdleR = 1.0
  // Crown: table ring (8) → bezel ring (8, radius of the kite's outer point,
  // same phase) → upper girdle ring (16, half-step offset) → girdle (16).
  const tableRing = ring(TABLE_R, TABLE_Y, 8, 0)
  const bezelRing = ring(0.82, 0.20, 8, 0)
  const upperRing = ring(0.955, 0.075, 16, 0.5)
  const girdleRing = ring(girdleR, GIRDLE_Y, 16, 0)
  // Pavilion: girdle → lower girdle (16, half-step) → pavilion mains (8) → culet.
  const lowerRing = ring(0.86, -0.28, 16, 0.5)
  const mainRing = ring(0.30, -0.66, 8, 0)
  const culet = new THREE.Vector3(0, CULET_Y, 0)

  const pos: number[] = []
  const push = (p: THREE.Vector3) => pos.push(p.x, p.y, p.z)
  // A fan between two rings. `outer` is the wider ring; the triangle winding is
  // chosen so the normal points away from the stone's axis (see below).
  const band = (inner: THREE.Vector3[], outer: THREE.Vector3[], flip = false) => {
    const n = outer.length
    for (let i = 0; i < n; i++) {
      const a = inner[Math.floor((i * inner.length) / n)]!
      const b = inner[Math.floor(((i + 1) * inner.length) / n) % inner.length]!
      const c = outer[(i + 1) % n]!
      const d = outer[i]!
      if (flip) {
        push(a); push(c); push(b)
        push(a); push(d); push(c)
      } else {
        push(a); push(b); push(c)
        push(a); push(c); push(d)
      }
    }
  }
  // Table: a fan from its centre, one triangle per table edge.
  for (let i = 0; i < tableRing.length; i++) {
    const a = tableRing[i]!
    const b = tableRing[(i + 1) % tableRing.length]!
    push(new THREE.Vector3(0, TABLE_Y, 0)); push(b); push(a)
  }
  band(bezelRing, tableRing, true)
  band(upperRing, bezelRing, true)
  band(girdleRing, upperRing, true)
  band(lowerRing, girdleRing, true)
  band(mainRing, lowerRing, true)
  for (let i = 0; i < mainRing.length; i++) {
    const a = mainRing[i]!
    const b = mainRing[(i + 1) % mainRing.length]!
    push(culet); push(a); push(b)
  }
  const cut = new THREE.BufferGeometry()
  cut.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  // Every triangle is its own facet: split, then one normal per face. Without
  // this the renderer averages the vertices shared by two facets and the cut
  // shades as a smooth pebble again.
  const geometry = cut.toNonIndexed()
  geometry.computeVertexNormals()
  return seated([[geometry, glass]], new THREE.Euler(2.15, 0.25, 2.50))
})()

// AirPods Pro 充电盒平放，正面（60.6 × 45.2）朝上，厚度 21.7 贴地的方向朝下。
// 参考图（正视图 + 底面端视图）量出来的形状：平面轮廓是 60.6 × 45.2、四角 14.2mm 的圆角矩形；
// 沿厚度方向的整圈棱是半径 9.4mm 的大圆滚，所以正面只剩一块 41.8 × 26.4 的平台。
// 这个滚圆必须真的建出来：倒一圈小斜角会读成带硬棱的方砖，滚满则正面没有落笔的平面。
// 轮廓点和法线都解析给出（直边给常法线、圆角给径向法线），滚圆按滚角多圈采样，
// 法线随滚角一起转，所以棱上没有 ExtrudeGeometry 那种一圈圈的硬条带。
// +Y 是盖子上沿（合页那头，画面远边），-Y 是底边（USB-C，朝镜头）。
// 厚度建在挤出的 z 上。seated 会把 y 转到朝上的 z，所以先绕 x 转 -90°，两步抵消，盒子仍然平放。
const pod = (() => {
  const mm = 1 / 21.7
  const halfW = (60.6 / 2) * mm
  const halfD = (45.2 / 2) * mm
  const halfT = 0.5
  const cornerR = 14.2 * mm
  const rollR = 9.4 * mm
  // 正面平台的边界 = 平面轮廓沿法线内缩一个滚圆半径。
  const ax = halfW - rollR
  const by = halfD - rollR
  const cr = cornerR - rollR
  // 侧壁只在 z ∈ [-zFace, zFace] 这一段是竖直的，再往外才开始滚。
  const zFace = halfT - rollR
  const topZ = halfT
  const yFromTop = (dMm: number) => halfD - dMm * mm
  // 白塑料的明暗几乎全来自漫射加一层薄清漆；环境图那扇近距离的亮窗会被滚圆反射成
  // 一枚边界死硬的椭圆，所以整层走 environment="none"（见文件末尾的相机层），
  // 光由一块大面积柔光给。这里保留正常塑料的粗糙度和清漆，白面才不会发灰。
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: '#f4f4f2',
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.45,
  })

  // 平面轮廓：逆时针一圈，每个点带单位外法线。滚圆就从这条线往外偏 rollR 再绕上去。
  const rim: { x: number; y: number; nx: number; ny: number }[] = []
  const pushRim = (x: number, y: number, nx: number, ny: number) => {
    const last = rim[rim.length - 1]
    if (last && Math.abs(last.x - x) < 1e-9 && Math.abs(last.y - y) < 1e-9) return
    rim.push({ x, y, nx, ny })
  }
  const rimEdge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      pushRim(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny)
    }
  }
  // 圆弧要把末端点也算进去：直边只推到起点，接缝处少一个点就会留一条比邻边宽六倍的
  // 长条三角形，远处的滚圆上会直接变成一块亮斑。
  const rimArc = (cx: number, cy: number, from: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = from + (i / steps) * (Math.PI / 2)
      pushRim(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr, Math.cos(a), Math.sin(a))
    }
  }
  const EDGE_STEPS = 14
  const BEND_STEPS = 20
  rimEdge(-(ax - cr), -by, ax - cr, -by, 0, -1, EDGE_STEPS)
  rimArc(ax - cr, -(by - cr), -Math.PI / 2, BEND_STEPS)
  rimEdge(ax, -(by - cr), ax, by - cr, 1, 0, EDGE_STEPS)
  rimArc(ax - cr, by - cr, 0, BEND_STEPS)
  rimEdge(ax - cr, by, -(ax - cr), by, 0, 1, EDGE_STEPS)
  rimArc(-(ax - cr), by - cr, Math.PI / 2, BEND_STEPS)
  rimEdge(-ax, by - cr, -ax, -(by - cr), -1, 0, EDGE_STEPS)
  rimArc(-(ax - cr), -(by - cr), Math.PI, BEND_STEPS)

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const ringStart: number[] = []
  const segments = rim.length
  // phi 是滚角：0 在竖直侧壁上，π/2 到平台边。offset = rollR·cos(phi)，高度 = zFace + rollR·sin(phi)。
  const addRing = (side: 1 | -1, phi: number) => {
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    const offset = rollR * cos
    const z = side * (zFace + rollR * sin)
    ringStart.push(positions.length / 3)
    for (const p of rim) {
      positions.push(p.x + p.nx * offset, p.y + p.ny * offset, z)
      normals.push(p.nx * cos, p.ny * cos, side * sin)
    }
  }
  const ROLL_STEPS = 22
  for (let k = 0; k <= ROLL_STEPS; k++) addRing(-1, (Math.PI / 2) * (1 - k / ROLL_STEPS))
  addRing(1, 0)
  for (let k = 1; k <= ROLL_STEPS; k++) addRing(1, (Math.PI / 2) * (k / ROLL_STEPS))

  const rings = ringStart.length
  for (let r = 0; r < rings - 1; r++) {
    const lo = ringStart[r]!
    const hi = ringStart[r + 1]!
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments
      indices.push(lo + i, lo + next, hi + next, lo + i, hi + next, hi + i)
    }
  }
  // 两块平台：法线严格朝下/朝上。底圈轮廓逆时针，从下面看是反的，绕序要跟着翻。
  const underCenter = positions.length / 3
  positions.push(0, 0, -halfT)
  normals.push(0, 0, -1)
  const overCenter = positions.length / 3
  positions.push(0, 0, halfT)
  normals.push(0, 0, 1)
  const underRing = ringStart[0]!
  const overRing = ringStart[rings - 1]!
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments
    indices.push(underCenter, underRing + next, underRing + i)
    indices.push(overCenter, overRing + i, overRing + next)
  }

  const body = new THREE.BufferGeometry()
  body.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  body.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  body.setIndex(indices)

  // 躺在正面上的胶囊：长轴 X，短轴 Y，厚度 Z。用来做指槽和盖缝。
  const pill = (lenMm: number, widMm: number, deepMm: number) => {
    const r = (widMm / 2) * mm
    const straight = Math.max(0, (lenMm * mm) / 2 - r)
    const s = new THREE.Shape()
    s.absarc(straight, 0, r, -Math.PI / 2, Math.PI / 2, false)
    s.absarc(-straight, 0, r, Math.PI / 2, Math.PI * 1.5, false)
    const g = new THREE.ExtrudeGeometry(s, { depth: deepMm * mm, bevelEnabled: false, curveSegments: 8 })
    g.translate(0, 0, -(deepMm * mm) / 2)
    return g
  }
  // 指槽：盖缝上方一条浅的圆角槽。外圈略深、内圈回一点，读成凹槽而不是白条。
  // 平台沿 Y 只剩 by = 13.2mm，槽和缝都得落在里面，不然会飘到滚圆上下不来。
  // 这个相机角只有 16°，正面沿进深被压到三成，槽和缝挨得太近就会糊成一道灰杠，
  // 所以槽压窄、反差调低，缝再细一档。
  // 参考正视图：盖缝在正面 32% 高度、指槽 36%、LED 在正中 50%。
  // 换算到"离远边的距离"正好都落在 9.4~35.8mm 的平台内。
  const grooveY = yFromTop(16.3)
  const grooveShade = pill(26, 2.6, 0.3)
  grooveShade.translate(0, grooveY, topZ + 0.003)
  const groove = pill(22.6, 1.5, 0.3)
  groove.translate(0, grooveY, topZ + 0.008)
  // 合盖缝：横贯正面、停在平台边之前的一条细线。
  const seam = pill(40, 0.34, 0.24)
  seam.translate(0, yFromTop(14.5), topZ + 0.005)
  // 状态灯在盖缝下方，琥珀色小点。
  const led = new THREE.SphereGeometry(0.7 * mm, 12, 8)
  led.translate(0, yFromTop(22.6), topZ + 0.55 * mm)
  const ledMat = new THREE.MeshStandardMaterial({
    color: '#ffb067',
    emissive: '#ff7a32',
    emissiveIntensity: 0.85,
    roughness: 0.4,
  })
  // 朝镜头的底边：USB-C、配对键、三颗出音孔。
  // 滚圆在 phi=0 时正好落在 y = -halfD，竖直段只有 z ∈ ±zFace（约 2.9mm 高），
  // 这三样都贴在 y = -halfD 这一层薄壁上，别挪到平台边缘。
  const yFace = -halfD - 0.008
  const onBottom = (lenMm: number, widMm: number, deepMm: number) => {
    const g = pill(lenMm, widMm, deepMm)
    g.rotateX(Math.PI / 2)
    return g
  }
  const port = onBottom(8.8, 3.05, 0.22)
  port.translate(0, yFace, 0)
  // 配对键是一枚几乎齐平的浅灰圆点：凸出来的圆柱在这个角度会顶出一块硬高光，
  // 尺寸也只做到 0.55mm 半径。
  const button = new THREE.CylinderGeometry(0.55 * mm, 0.55 * mm, 0.16 * mm, 16)
  button.translate(-15.5 * mm, yFace, 0)
  const holes = [-2.15, 0, 2.15].map((dx) => {
    const h = new THREE.CylinderGeometry(0.48 * mm, 0.48 * mm, 0.14 * mm, 12)
    h.translate((13.2 + dx) * mm, yFace, 0)
    return h
  })
  const ink = mat('#1c1c1a', 0.62)
  const holeInk = mat('#33332f', 0.85)
  const geos: [THREE.BufferGeometry, THREE.Material][] = [
    [body, shellMat],
    [grooveShade, mat('#dcdcd6', 0.72)],
    [groove, mat('#f1f1ec', 0.55)],
    [seam, mat('#adada8', 0.8)],
    [led, ledMat],
    [port, ink],
    [button, holeInk],
    ...holes.map((h) => [h, holeInk] as [THREE.BufferGeometry, THREE.Material]),
  ]
  for (const [geo] of geos) geo.rotateX(-Math.PI / 2)
  return seated(geos)
})()

function Props() {
  return (
    <layer x="0" y={STAGE.groundY} width={FLOOR.w} height={FLOOR.h} origin={`${FLOOR.w / 2} 0`} rotateX="90" preserve-3d>
      {/* 前沿中段：白瓷马克杯，印花朝镜头，把手朝右前。右前角留给接口 */}
      <layer x={MUG.cx} y={MUG.cy} width="0" height="0" rotate={MUG.turn} preserve-3d>
        <model object={mug} unit={MUG.r} x="0" y="0" />
      </layer>
      {/* 前沿：铅笔斜放，笔尖指向左前的钻石 */}
      <layer x={PENCIL.x} y={PENCIL.y} width="0" height="0" rotate={PENCIL.turn} preserve-3d>
        <model object={pencil} unit={PENCIL.r} x="0" y="0" />
      </layer>
      {/* 铅笔尖旁边：AirTag 白面朝上，半压在笔杆阴影里 */}
      <model object={airtag} unit={TAG.r} x={TAG.x} y={TAG.y} />
      {/* 右前桌面：AirPods Pro 盒盖朝上，平放 */}
      <layer x={POD.x} y={POD.y} width="0" height="0" rotate={POD.turn} preserve-3d>
        <model object={pod} unit={POD.w * 21.7 / 60.6} x="0" y="0" />
      </layer>
      {/* 左前：钻石侧躺在桌面上，笔尖压着它的一角 */}
      <layer x={GEM.x} y={GEM.y} width="0" height="0" rotate={GEM.turn} preserve-3d>
        <model object={diamond} unit={GEM.r} x="0" y="0" />
      </layer>
    </layer>
  )
}

export default (
  <layer width="1440" height="1800" background="#f6f3ee" color="#1c1916" min-font="10" noise="0.012">
    <rect x="0" y="0" width="1440" height="1800" fill="linear-gradient(180deg, #f7f4ef 0%, #efe8df 100%)" />
    {/* 环境图里有一扇近距离的亮窗，正对盒体左端滚圆时会被反射成一枚死白的椭圆；
        参考图的白盒也不吃环境反射，所以关掉环境图，改由一块大面积柔光当主光。 */}
    <layer width="1440" height="1800" camera={CAMERA}>
      <light type="area" x="560" y="-900" z="1500" target="900 760 0" width="3000" height="1600" intensity="2.4" />
      {/* area 光对金属只给 f0，没有方向性；补一盏弱方向光给钢面提供 GGX 高光梯度。 */}
      <light type="directional" x="-0.55" y="-0.62" z="0.56" intensity="0.30" />
      <Lid />
      <Base />
      <Props />
      <ground y={STAGE.groundY} rotateX="90" fill="#efe8df" shadow-blur="42" shadow-opacity="1.0" />
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
