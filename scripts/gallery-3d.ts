import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { checkLayer, renderLayer } from '../src/render.js'
import { formatIssueLine } from '../src/report.js'

/**
 * 三维样张的源。静物只写在这一处，画法、质量档和镜头都复用它。
 * 改完跑 `npm run gallery:3d`，再把 docs/gallery/3d-*.layer 和 png 一起提交。
 */

const BENCH_W = 880
const BENCH_H = 540
/** 长边不能超过 1920，所以对照格用这一档。distance 把同一组几何收进这个取景。 */
const BENCH_CAMERA = 'fov 30, orbit 28 18, distance 1280, at 550 400 0'

function bench(camera = BENCH_CAMERA, extra = ''): string {
  const attrs = extra ? ` ${extra}` : ''
  return `<layer width="${BENCH_W}" height="${BENCH_H}" camera="${camera}"${attrs}>
    <ground y="530" rotateX="90" fill="#e7e0d4" shadow-blur="40" shadow-opacity="0.5" />
    <layer x="70" y="530" width="960" height="400" origin="480 0" rotateX="90" preserve-3d>
      <rect x="90" y="8" width="740" height="12" depth="170" rx="3" fill="#f6f2ea" />
      <rect x="70" y="48" width="190" height="130" depth="100" rx="18" fill="#d23b3b" material="plastic 0.28" />
      <rect x="276" y="40" width="150" height="140" depth="180" rx="12" fill="#f4f1ea" />
      <rect x="470" y="64" width="250" height="150" depth="26" rx="10" fill="#c5c9ce" material="metal 0.18" />
      <sphere cx="590" cy="140" r="36" z="49" fill="#e8eef3" material="metal 0.05" />
      <sphere cx="160" cy="200" r="34" z="140" fill="#2a6fbe" material="plastic 0.42" />
      <rect x="210" y="200" width="36" height="78" depth="160" fill="#e23b2f" />
      <rect x="246" y="200" width="36" height="78" depth="160" fill="#f7f4ee" />
      <rect x="282" y="200" width="36" height="78" depth="160" fill="#2a6fbe" />
      <sphere cx="264" cy="268" r="46" z="46" fill="#f4fffbcc" material="glass 0.07" />
      <circle cx="780" cy="150" r="40" depth="160" fill="#e0a33a" material="plastic 0.22" />
      <layer x="400" y="230">
        <path d="M0 0 H120 V84 H0 Z M28 18 V66 H92 V18 Z" depth="14" fill="#1f8a5b" material="plastic 0.3" />
      </layer>
      <torus cx="180" cy="250" r="40" tube="10" z="12" fill="#3ad8ff" material="neon" rotateX="72" />
      <sphere cx="860" cy="40" r="18" z="150" material="lamp" />
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
    ? `\n  <layer x="28" y="${options.height - 32}"><p style="font-size:16px; color:${captionColor}">${options.caption}</p></layer>`
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
    label: 'brushed',
    box: 'fill="#c86a3e" material="brushed"',
    sphere: 'fill="#c86a3e" material="brushed"',
    side: 'fill="#c86a3e" material="brushed"',
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
    ? `<rect x="168" y="18" width="24" height="34" depth="120" fill="#e23b2f" />
      <rect x="192" y="18" width="24" height="34" depth="120" fill="#f7f4ee" />
      <rect x="216" y="18" width="24" height="34" depth="120" fill="#2a6fbe" />`
    : ''
  const sphere = finish.lamp
    ? `<sphere cx="210" cy="78" r="16" z="120" ${finish.sphere} />`
    : `<sphere cx="204" cy="72" r="30" z="30" ${finish.sphere} />`
  const side = finish.neon
    ? `<torus cx="330" cy="78" r="32" tube="8" z="14" ${finish.side} rotateX="70" />`
    : `<circle cx="330" cy="78" r="26" depth="100" ${finish.side} />`
  return `<layer width="440" height="300" camera="fov 32, orbit 34 22, distance 860, at 220 160 0">
    <ground y="220" rotateX="90" fill="#e7e0d4" shadow-blur="26" shadow-opacity="0.5" />
    <layer x="28" y="220" width="400" height="190" origin="200 0" rotateX="90" preserve-3d>
      <rect x="40" y="4" width="340" height="8" depth="110" fill="#f6f2ea" />
      <rect x="28" y="30" width="120" height="86" depth="72" rx="12" ${finish.box} />
      ${stripes}
      ${sphere}
      ${side}
    </layer>
  </layer>`
}

function lines(): string {
  return `<layer width="1180" height="680" camera="fov 36, orbit 32 22, distance 1500, at 560 360 0">
    <layer x="70" y="30" width="1040" height="600" rotateX="56" preserve-3d>
      <rect x="40" y="70" width="260" height="190" depth="110" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1" hidden="#a89880" />
      <cylinder cx="170" cy="165" r="48" height="280" fill="#e7d3a8" stroke="#1c1915" stroke-width="3 2 1" hidden="#a89880" />
      <rect x="390" y="80" width="210" height="150" depth="96" rx="26" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1" hidden="#a89880" rotateY="-26" />
      <cylinder cx="740" cy="175" r="44" height="200" rx="14" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1" hidden="#a89880" />
      <sphere cx="960" cy="160" r="62" fill="none" stroke="#1c1915" stroke-width="3 2 1" />
      <layer x="400" y="280">
        <path d="M0 0 H160 V108 H0 Z M40 26 V82 H120 V26 Z" depth="28" fill="#f7f4ee" stroke="#1c1915" stroke-width="3 2 1" hidden="#a89880" />
      </layer>
      <tube x="48" y="340" d="M0 16 H180 V140" r="14" fill="none" stroke="#1c1915" stroke-width="3 2 1" halo="8" />
    </layer>
  </layer>`
}

type Plate = { name: string; source: string }

function cell(label: string, body: string, w: number, h: number, background = '#241f1b', color = '#f4efe6'): string {
  return `<layer width="${w}" height="${h + 32}" background="${background}" color="${color}" font-family="ChillDuanSans" min-font="16" safe="0">
  ${place(body, 0, 0)}
  <layer x="12" y="${h + 4}"><p style="font-size:16px">${label}</p></layer>
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
  const cameras: { label: string; camera: string; file: string }[] = [
    { label: 'orbit 28 18', camera: BENCH_CAMERA, file: 'orbit' },
    { label: 'orbit 10 46', camera: 'fov 30, orbit 10 46, distance 1680, at 550 400 0', file: 'high' },
    { label: 'orbit 62 14', camera: 'fov 30, orbit 62 14, distance 1700, at 550 400 0', file: 'side' },
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
      height: 780,
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
    { sheet: '3d-quality', title: '质量档', cols: 2, cells: quality, caption: 'final 才加宽半影、缝里的遮蔽、一次反弹、锐金属反射和玻璃着色' },
    { sheet: '3d-materials', title: '材质', cols: 4, cells: materials, caption: '每一格是同一组：墙、圆角盒、球、圆柱。变的只有材质' },
    { sheet: '3d-camera', title: '镜头', cols: 2, cells: cameraCells, caption: '俯视看顶面和接触。侧面把前后拉开。景深里中间清楚，前后糊开' },
    { sheet: '3d-lines', title: '', cols: 1, cells: [linesPlate], caption: '' },
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

const cellDir = 'docs/gallery/3d'
mkdirSync(cellDir, { recursive: true })
for (const name of readdirSync('docs/gallery')) {
  if (name.startsWith('3d-') && name.endsWith('.png')) unlinkSync(`docs/gallery/${name}`)
}
for (const name of readdirSync(cellDir)) {
  if (name.endsWith('.layer')) unlinkSync(`${cellDir}/${name}`)
}

let failed = 0
for (const plate of buildPlates()) {
  const pngs: Buffer[] = []
  const started = Date.now()
  for (const item of plate.cells) {
    const file = `${cellDir}/${item.name}.layer`
    writeFileSync(file, item.source)
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
if (failed > 0) {
  console.error(`✗ ${failed} error`)
  process.exit(1)
}

