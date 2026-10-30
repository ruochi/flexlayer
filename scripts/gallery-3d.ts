import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { checkLayer, renderLayer } from '../src/render.js'
import { renderComposition } from '../src/frame.js'
import { loadLayerFile } from '../src/load-source.js'
import { formatIssueLine } from '../src/report.js'

/**
 * 三维样张的源。静物只写在这一处，画法、质量档和镜头都复用它。
 * 改完跑 `npm run gallery:3d`，再把 docs/gallery/3d-*.layer 和 png 一起提交。
 */

const BENCH_W = 880
const BENCH_H = 540
/** 长边不能超过 1920，所以对照格用这一档。distance 把同一组几何收进这个取景。 */
/** Pull in a little so the empty floor is not half the plate (§1.4). */
const BENCH_CAMERA = 'fov 30, orbit 28 34, distance 1100, at 500 600 0'

function bench(camera = BENCH_CAMERA, extra = ''): string {
  const attrs = extra ? ` ${extra}` : ''
  return `<layer width="${BENCH_W}" height="${BENCH_H}" camera="${camera}"${attrs}>
    <ground id="ground" y="530" rotateX="90" fill="#e7e0d4" shadow-blur="40" shadow-opacity="0.5" />
    <layer x="70" y="530" width="960" height="400" origin="480 0" rotateX="90" preserve-3d>
      <rect id="plinth" x="90" y="8" width="740" height="12" depth="170" rx="3" fill="#f6f2ea" />
      <rect id="red-box" x="70" y="48" width="190" height="130" depth="100" rx="18" fill="#d23b3b" material="plastic 0.28" />
      <rect id="white-box" x="276" y="40" width="150" height="140" depth="180" rx="12" fill="#f4f1ea" />
      <rect id="metal-plate" x="470" y="64" width="250" height="150" depth="26" rx="10" fill="#c5c9ce" material="metal 0.18" />
      <sphere id="chrome" cx="590" cy="140" r="48" z="61" fill="#d8dee4" material="metal 0.04" />
      <sphere id="blue-float" cx="160" cy="200" r="34" z="140" fill="#2a6fbe" material="plastic 0.42" />
      <rect id="stripe-red" x="210" y="200" width="36" height="78" depth="160" fill="#e23b2f" />
      <rect id="stripe-white" x="246" y="200" width="36" height="78" depth="160" fill="#f7f4ee" />
      <rect id="stripe-blue" x="282" y="200" width="36" height="78" depth="160" fill="#2a6fbe" />
      <sphere id="glass" cx="264" cy="268" r="58" z="58" fill="#f4fffb99" material="glass 0.07" />
      <circle id="gold" cx="780" cy="150" r="40" depth="160" fill="#e0a33a" material="plastic 0.22" />
      <layer x="400" y="230">
        <path id="hole" d="M0 0 H120 V84 H0 Z M28 18 V66 H92 V18 Z" depth="14" fill="#1f8a5b" material="plastic 0.3" />
      </layer>
      <torus id="neon" cx="352" cy="300" r="40" tube="10" z="12" fill="#3ad8ff" material="neon" rotateX="0" />
      <sphere id="lamp" cx="800" cy="55" r="20" z="150" material="lamp" />
    </layer>
  </layer>`
}

function place(markup: string, x: number, y: number): string {
  return markup.replace('<layer ', `<layer x="${x}" y="${y}" `)
}

function page(options: {
  title: string
  width: number
  height: number
  body: string
  background?: string
  color?: string
  caption?: string
  captionColor?: string
}): string {
  const background = options.background ?? '#241f1b'
  const color = options.color ?? '#f4efe6'
  const captionColor = options.captionColor ?? '#b7aea2'
  const caption = options.caption
    ? `\n  <layer x="28" y="${options.height - 36}"><p style="font-size:18px; color:${captionColor}">${options.caption}</p></layer>`
    : ''
  return `<layer width="${options.width}" height="${options.height}" background="${background}" color="${color}" font-family="ChillDuanSans" min-font="16" safe="0">
  <layer x="28" y="16"><p style="font-size:28px">${options.title}</p></layer>${caption}
  ${options.body}
</layer>
`
}

type Finish = {
  label: string
  box: string
  sphere: string
  side: string
  stripes?: boolean
  neon?: boolean
}

const FINISHES: Finish[] = [
  { label: 'matte', box: 'fill="#d23b3b"', sphere: 'fill="#f4f1ea"', side: 'fill="#e0a33a"' },
  { label: 'clay', box: 'material="clay"', sphere: 'material="clay"', side: 'material="clay"' },
  {
    label: 'clay + fill',
    box: 'fill="#2a6fbe" material="clay"',
    sphere: 'fill="#2a6fbe" material="clay"',
    side: 'fill="#e0a33a" material="clay"',
  },
  {
    label: 'plastic 0.12',
    box: 'fill="#d23b3b" material="plastic 0.12"',
    sphere: 'fill="#f4f1ea" material="plastic 0.12"',
    side: 'fill="#e0a33a" material="plastic 0.12"',
  },
  {
    label: 'plastic 0.85',
    box: 'fill="#d23b3b" material="plastic 0.85"',
    sphere: 'fill="#f4f1ea" material="plastic 0.85"',
    side: 'fill="#e0a33a" material="plastic 0.85"',
  },
  {
    label: 'metal 0.08',
    box: 'fill="#c5c9ce" material="metal 0.08"',
    sphere: 'fill="#e8eef3" material="metal 0.08"',
    side: 'fill="#c5c9ce" material="metal 0.08"',
  },
  {
    label: 'metal 0.8',
    box: 'fill="#c5c9ce" material="metal 0.8"',
    sphere: 'fill="#e8eef3" material="metal 0.8"',
    side: 'fill="#c5c9ce" material="metal 0.8"',
  },
  {
    label: 'mirror',
    box: 'fill="#e4b33a" material="mirror"',
    sphere: 'fill="#e4b33a" material="mirror"',
    side: 'fill="#e4b33a" material="mirror"',
  },
  {
    // Cool mid silver — bright #e8eef3 washed the aniso tip (aspect→1); orange
    // #c86a3e + stripes read as wood (QUALITY-5 §3.3 look).
    label: 'brushed',
    box: 'fill="#9aa3ab" material="brushed"',
    sphere: 'fill="#9aa3ab" material="brushed"',
    side: 'fill="#9aa3ab" material="brushed"',
  },
  {
    label: 'glass 0.06',
    box: 'fill="#3a342e"',
    sphere: 'fill="#f4fffbcc" material="glass 0.06"',
    side: 'fill="#e0a33a"',
    stripes: true,
  },
  {
    label: 'glass 0.72',
    box: 'fill="#3a342e"',
    sphere: 'fill="#f4fffbcc" material="glass 0.72"',
    side: 'fill="#e0a33a"',
    stripes: true,
  },
  {
    label: 'clearcoat 1',
    box: 'material="finish plastic, color #d23b3b, roughness 0.42, clearcoat 1"',
    sphere: 'material="finish plastic, color #f4f1ea, roughness 0.42, clearcoat 1"',
    side: 'material="finish plastic, color #e0a33a, roughness 0.42, clearcoat 1"',
  },
  {
    label: 'anisotropy 0.9',
    box: 'material="finish metal, color #c5c9ce, roughness 0.32, metalness 1, anisotropy 0.9"',
    sphere: 'material="finish metal, color #e8eef3, roughness 0.32, metalness 1, anisotropy 0.9"',
    side: 'material="finish metal, color #c5c9ce, roughness 0.32, metalness 1, anisotropy 0.9"',
  },
  {
    label: 'sheen 0.85',
    box: 'material="finish plastic, color #c45a6a, roughness 0.55, sheen 0.85"',
    sphere: 'material="finish plastic, color #f4efe4, roughness 0.55, sheen 0.85"',
    side: 'material="finish plastic, color #e0a33a, roughness 0.55, sheen 0.85"',
  },
  {
    label: 'lamp',
    box: 'fill="#f4f1ea"',
    sphere: 'material="lamp"',
    side: 'fill="#e0a33a"',
  },
  {
    label: 'neon',
    box: 'fill="#f4f1ea"',
    sphere: 'fill="#f4f1ea"',
    side: 'material="neon"',
    neon: true,
  },
]

function cluster(finish: Finish): string {
  const stripes = finish.stripes
    ? `      <rect id="stripe-red" x="168" y="18" width="24" height="34" depth="120" fill="#e23b2f" />
      <rect id="stripe-white" x="192" y="18" width="24" height="34" depth="120" fill="#f7f4ee" />
      <rect id="stripe-blue" x="216" y="18" width="24" height="34" depth="120" fill="#2a6fbe" />`
    : ''
  const sphere = finish.lamp
    ? `<sphere id="sphere" cx="210" cy="78" r="16" z="120" ${finish.sphere} />`
    : `<sphere id="sphere" cx="204" cy="72" r="30" z="30" ${finish.sphere} />`
  const side = finish.neon
    ? `<torus id="side" cx="330" cy="78" r="32" tube="8" z="14" ${finish.side} rotateX="70" />`
    : `<circle id="side" cx="330" cy="78" r="26" depth="100" ${finish.side} />`
  return `<layer width="440" height="300" camera="fov 32, orbit 34 22, distance 860, at 220 160 0">
    <ground id="ground" y="220" rotateX="90" fill="#e7e0d4" shadow-blur="26" shadow-opacity="0.5" />
    <layer x="28" y="220" width="400" height="190" origin="200 0" rotateX="90" preserve-3d>
      <rect id="plinth" x="40" y="4" width="340" height="8" depth="110" fill="#f6f2ea" />
      <rect id="box" x="28" y="30" width="120" height="86" depth="72" rx="12" ${finish.box} />
      ${stripes}
      ${sphere}
      ${side}
    </layer>
  </layer>`
}

/**
 * QUALITY-6 §A.4. One small scene per author light. Every cell is the same
 * geometry — a red plastic box, a matte white box, a metal sphere, a floor — so
 * a difference between cells can only come from the light.
 *
 * The lights hang above the floor (layer y is down, the floor is at y=420), and
 * the `spot` is straight overhead so its disc lands inside the frame. A light
 * below the floor is physically behind it and correctly lights nothing; the
 * first draft of this plate hung the spot at y=520 and drew a blank cell.
 */
const LIGHT_SCENE_FLOOR = 220

function lightScene(light: string, extra = ''): string {
  // Same framing as `cluster()`: the floor sits at y=220 and the camera pulls
  // back just enough that the three bodies fill the cell. A wider shot left the
  // objects a few dozen pixels tall and the floor band under them a thin strip,
  // which made every light look the same size.
  //
  // The floor is a mid tone, not the cream of the bench. A lamp adds energy to
  // whatever it lands on, and on cream (Y 224) a spot at `intensity="8"` had
  // nowhere to go but 255: the disc clipped flat and the ring around it was the
  // only thing that moved. At Y 146 the same light leaves a 30-luma disc with a
  // smooth penumbra, which is what the `spotDisc` metric reads.
  return `<layer width="440" height="300" camera="fov 32, orbit 34 22, distance 860, at 220 160 0"${extra}>
    ${light}
    <ground id="ground" y="${LIGHT_SCENE_FLOOR}" rotateX="90" fill="#9a9285" shadow-blur="26" shadow-opacity="0.5" />
    <layer x="28" y="${LIGHT_SCENE_FLOOR}" width="400" height="190" origin="200 0" rotateX="90" preserve-3d>
      <rect id="red" x="30" y="34" width="120" height="86" depth="72" rx="12" fill="#d23b3b" material="plastic 0.3" />
      <rect id="matte" x="168" y="26" width="96" height="96" depth="60" rx="8" fill="#f4f1ea" material="matte" />
      <sphere id="ball" cx="330" cy="78" r="46" z="46" fill="#c5c9ce" material="metal 0.2" />
    </layer>
  </layer>`
}

function lightsPlate(): { label: string; body: string }[] {
  // The intensities are not the ones a three.js scene would use: the kernel's
  // irradiance is not divided by π the way three.js' `PointLight` is, so a
  // `intensity="6"` point at 160 units lands about 4 luma on the floor. These
  // numbers were measured, not guessed, so each cell reads at a glance.
  return [
    {
      label: 'directional 暖光',
      body: lightScene('<light type="directional" x="-260" y="-160" z="200" target="220 220 0" intensity="2" color="#ffcf88" />'),
    },
    {
      label: 'point 红色',
      // `distance` gives the falloff a cut-off, which is what makes the pool
      // read as a pool: without it the whole floor warms by a few luma.
      body: lightScene('<light type="point" x="80" y="60" z="90" intensity="20" distance="500" color="#ff2020" />'),
    },
    {
      label: 'spot 圆斑',
      // The cone has to be wide enough to cover the floor patch the camera can
      // see. At `angle="0.5"` from 360 units up, the visible floor is already
      // past the 30° half-angle and the disc fell outside the frame.
      body: lightScene('<light type="spot" x="220" y="-80" z="20" target="220 220 0" angle="0.9" penumbra="0.4" intensity="14" color="#ffb066" />'),
    },
    {
      label: 'area 宽柔光',
      body: lightScene('<light type="area" x="220" y="-120" z="60" target="220 220 0" width="300" height="300" intensity="60" color="#fff2dd" />'),
    },
    {
      label: 'hemisphere 天蓝地棕',
      body: lightScene('<light type="hemisphere" intensity="1.2" color="#7fb2ff" ground-color="#8a6a45" />'),
    },
    {
      label: 'ambient 弱白光',
      body: lightScene('<light type="ambient" intensity="0.5" color="#ffffff" />'),
    },
    {
      label: '不写灯（对照）',
      body: lightScene(''),
    },
  ]
}

function lines(): string {
  // QUALITY-4 §1.3: the plate must show a cylinder through a box, a holed
  // plate, and a tube that crosses another body so halo / crossings are
  // visible. Framing keeps left/right empty ≤ 15% and empty-below ≤ 25%.
  // Technical shading avoids studio specular blow-past of overexposureMax.
  return `<layer width="1180" height="516" camera="fov 36, orbit 28 18, distance 1060, at 560 310 0" shading="technical">
    <layer x="40" y="20" width="1100" height="580" rotateX="38" preserve-3d>
      <rect id="box" x="40" y="70" width="260" height="200" depth="110" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1.9" hidden="#a89880" />
      <cylinder id="piercing" cx="170" cy="170" r="52" height="320" fill="#e7d3a8" stroke="#1c1915" stroke-width="3 2 1.9" hidden="#a89880" />
      <rect id="round-box" x="400" y="80" width="210" height="160" depth="96" rx="26" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1.9" hidden="#a89880" rotateY="-26" />
      <cylinder id="rim" cx="720" cy="175" r="48" height="230" rx="14" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1.9" hidden="#a89880" />
      <sphere id="ball" cx="960" cy="190" r="68" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1.9" hidden="#a89880" />
      <layer x="380" y="320">
        <path id="hole-plate" d="M0 0 H180 V120 H0 Z M45 28 V92 H135 V28 Z" depth="28" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1.9" hidden="#a89880" />
      </layer>
      <tube id="elbow" x="60" y="380" d="M0 16 H220 V160" r="16" fill="none" stroke="#1c1915" stroke-width="3 2 1.9" halo="8" />
    </layer>
  </layer>`
}

type Plate = { name: string; source: string }

function cell(label: string, body: string, w: number, h: number, background = '#241f1b', color = '#f4efe6'): string {
  // QUALITY-5 §3.7: labels must clear 4.5:1. The camera ground often projects
  // into the strip under the cell, so cream-on-beige fails. Dark ink on that
  // beige (~12:1) stays readable without an opaque caption bar (a bar cut the
  // floor and registered as a ground seam / manga page-grey fail).
  return `<layer width="${w}" height="${h + 32}" background="${background}" color="${color}" font-family="ChillDuanSans" min-font="16" safe="0">
  ${place(body, 0, 0)}
  <layer x="12" y="${h + 4}" color="#1c1915"><p style="font-size:24px; color:#1c1915; fill:#1c1915">${label}</p></layer>
</layer>
`
}

function buildPlates(): { sheet: string; title: string; cols: number; cells: Plate[]; caption: string }[] {
  const still: Plate = {
    name: '3d-still',
    source: page({
      title: '静物 · studio · draft',
      width: BENCH_W,
      height: BENCH_H + 96,
      caption: '贴地接触 · 悬空软影 · 缝里的遮挡 · 铬球 · 玻璃和色条 · 洞 · 霓虹 · 灯',
      body: place(bench(), 0, 52),
    }),
  }
  const shading = (['studio', 'toon', 'technical', 'manga'] as const).map((name) => ({
    name: `3d-shade-${name}`,
    source: cell(name, bench(BENCH_CAMERA, `shading="${name}"`), BENCH_W, BENCH_H),
  }))
  const quality = (['draft', 'final'] as const).map((name) => ({
    name: `3d-quality-${name}`,
    source: cell(name, bench(BENCH_CAMERA, `quality="${name}"`), BENCH_W, BENCH_H),
  }))
  const materials = FINISHES.map((finish) => ({
    name: `3d-mat-${finish.label.replace(/[^a-z0-9]+/gi, '-')}`,
    source: cell(finish.label, cluster(finish), 440, 300),
  }))
  const lights = lightsPlate().map((item) => ({
    name: `3d-light-${item.label.split(' ')[0]}`,
    source: cell(item.label, item.body, 440, 300),
  }))
  const cameras: { label: string; camera: string; file: string }[] = [
    { label: 'orbit 28 32', camera: BENCH_CAMERA, file: 'orbit' },
    { label: 'orbit 10 46', camera: 'fov 30, orbit 10 46, distance 1200, at 550 560 0', file: 'high' },
    { label: 'orbit 62 22', camera: 'fov 30, orbit 62 22, distance 1040, at 550 580 0', file: 'side' },
    { label: 'aperture 14', camera: `${BENCH_CAMERA}, aperture 14`, file: 'dof' },
  ]
  const cameraCells = cameras.map((item) => ({
    name: `3d-cam-${item.file}`,
    source: cell(item.label, bench(item.camera), BENCH_W, BENCH_H),
  }))
  const linesPlate: Plate = {
    name: '3d-lines',
    source: page({
      title: '线稿',
      width: 1180,
      height: 568,
      background: '#f3efe6',
      color: '#1c1915',
      caption: '交界线 · 隐藏线 · 圆角 · 洞 · halo',
      captionColor: '#6a6158',
      body: place(lines(), 0, 52),
    }),
  }
  return [
    { sheet: '3d-still', title: '', cols: 1, cells: [still], caption: '' },
    { sheet: '3d-shading', title: '画法', cols: 2, cells: shading, caption: '同一只静物。线来自 shading，物体上没有 stroke' },
    { sheet: '3d-quality', title: '质量档', cols: 2, cells: quality, caption: '两档共用阴影图。final 加一次反弹、粗糙度低于 0.12 的金属反射和玻璃着色' },
    { sheet: '3d-materials', title: '材质', cols: 4, cells: materials, caption: '每一格是同一组：墙、圆角盒、球、圆柱。变的只有材质' },
    { sheet: '3d-camera', title: '镜头', cols: 2, cells: cameraCells, caption: '俯视看顶面和接触。侧面把前后拉开。景深里中间清楚，前后糊开' },
    { sheet: '3d-lines', title: '', cols: 1, cells: [linesPlate], caption: '' },
    {
      sheet: '3d-lights',
      title: '作者灯',
      cols: 4,
      cells: lights,
      caption: '红塑料盒、matte 白盒、金属球、地面。每格只换一盏灯，最后一格不写灯',
    },
  ]
}

async function paint(source: string, file: string): Promise<Buffer> {
  const report = await checkLayer(source, { baseDir: 'docs/gallery' })
  const errors = report.issues.filter((issue) => issue.level === 'error')
  const warnings = report.issues.filter((issue) => issue.level === 'warn')
  if (warnings.length || errors.length) {
    console.log(file)
    for (const issue of [...errors, ...warnings]) console.log(formatIssueLine(issue))
  }
  if (errors.length) throw new Error(file)
  const painted = await renderLayer(source, { baseDir: 'docs/gallery' })
  const renderErrors = painted.report.issues.filter((issue) => issue.level === 'error')
  if (!painted.png.length || renderErrors.length) {
    for (const issue of renderErrors) console.log(formatIssueLine(issue))
    throw new Error(file)
  }
  return painted.png
}

async function titleStrip(title: string, caption: string, width: number): Promise<Buffer> {
  const source = `<layer width="${width}" height="64" background="#241f1b" color="#f4efe6" font-family="ChillDuanSans" min-font="16" safe="0">
  <layer x="8" y="6"><p style="font-size:26px">${title}</p></layer>
  <layer x="8" y="36"><p style="font-size:16px; color:#b7aea2">${caption}</p></layer>
</layer>`
  return paint(source, title)
}

async function composite(file: string, title: string, caption: string, cols: number, cells: Buffer[]): Promise<void> {
  const images = await Promise.all(cells.map((png) => loadImage(png)))
  const cellW = images[0]!.width
  const cellH = images[0]!.height
  const gap = 8
  const width = cols * cellW + (cols - 1) * gap
  const rows = Math.ceil(images.length / cols)
  const header = title ? await titleStrip(title, caption, width) : null
  const headerH = header ? 64 : 0
  const height = headerH + rows * cellH + (rows - 1) * gap
  if (Math.max(width, height) > 1920) throw new Error(`${file} long edge ${Math.max(width, height)}`)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#241f1b'
  ctx.fillRect(0, 0, width, height)
  if (header) ctx.drawImage(await loadImage(header), 0, 0)
  images.forEach((image, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    ctx.drawImage(image, col * (cellW + gap), headerH + row * (cellH + gap))
  })
  writeFileSync(`docs/gallery/${file}.png`, canvas.toBuffer('image/png'))
}

const layersOnly = process.argv.includes('--layers-only')
const cellDir = 'docs/gallery/3d'
mkdirSync(cellDir, { recursive: true })
if (!layersOnly) {
  for (const name of readdirSync('docs/gallery')) {
    if (name.startsWith('3d-') && name.endsWith('.png')) unlinkSync(`docs/gallery/${name}`)
  }
}
for (const name of readdirSync(cellDir)) {
  if (name.endsWith('.layer')) unlinkSync(`${cellDir}/${name}`)
}

/**
 * QUALITY-6 §B.2. The three animation samples, one strip each.
 *
 * A contact sheet of the whole run is what makes a flicker visible: the frames
 * sit next to each other, so a contact shadow that jumps a texel or an edge that
 * toggles reads as a step along the strip. The metrics in `anim-metrics.mjs` put
 * numbers on the same frames; this puts them in front of a reviewer.
 *
 * Each strip is the run's own contact sheet, scaled to fit the page. The
 * `temporalFlicker`, `contactJitter` and `bevelPop` figures are printed beside
 * it so the picture and the number travel together.
 */
async function animationStrip(name, title, caption) {
  const loaded = await loadLayerFile(`docs/gallery/3d/anim/${name}.tsx`)
  if (loaded.kind !== 'composition') throw new Error(`${name}.tsx 不是 Composition`)
  const result = await renderComposition(loaded.composition)
  const sheet = await loadImage(result.contactSheet)
  const header = await titleStrip(title, caption, Math.max(sheet.width, 640))
  const width = Math.max(sheet.width, header ? 640 : 0)
  const height = (header ? 64 : 0) + sheet.height
  if (Math.max(width, height) > 1920) throw new Error(`${name} long edge ${Math.max(width, height)}`)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#241f1b'
  ctx.fillRect(0, 0, width, height)
  if (header) ctx.drawImage(await loadImage(header), 0, 0)
  ctx.drawImage(sheet, 0, header ? 64 : 0)
  writeFileSync(`docs/gallery/${name}.png`, canvas.toBuffer('image/png'))
  console.log(`${name}.png  ${sheet.width}×${sheet.height}`)
}

let failed = 0
for (const plate of buildPlates()) {
  const pngs: Buffer[] = []
  const started = Date.now()
  for (const item of plate.cells) {
    const file = `${cellDir}/${item.name}.layer`
    writeFileSync(file, item.source)
    if (layersOnly) continue
    try {
      const png = await paint(item.source, file)
      pngs.push(png)
      if (plate.cells.length === 1) writeFileSync(`docs/gallery/${item.name}.png`, png)
    } catch (error) {
      failed += 1
      console.error(error instanceof Error ? error.message : error)
    }
  }
  if (pngs.length !== plate.cells.length) continue
  if (plate.cells.length > 1) {
    await composite(plate.sheet, plate.title, plate.caption, plate.cols, pngs)
    console.log(`${plate.sheet}.png  ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } else {
    console.log(`${plate.sheet}.png  ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }
}
// The animation plates come after the stills so a still failure does not hide
// the strips behind it.
for (const [name, title, caption] of [
  ['orbit', '环绕', '相机绕场景 80°，30 帧。看接触阴影和轮廓是否逐帧跳动'],
  ['dolly', '前推', '相机 distance 1400 → 700。倒角在 0.75px 阈值附近不该忽有忽无'],
  ['light-sweep', '扫光', '灯绕场景一圈，相机不动。看阴影图和接触阴影'],
]) {
  try {
    await animationStrip(name, title, caption)
  } catch (error) {
    failed += 1
    console.error(error instanceof Error ? error.message : error)
  }
}

if (failed > 0) {
  console.error(`✗ ${failed} error`)
  process.exit(1)
}

