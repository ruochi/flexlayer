import { loadImage, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { emitLayer } from './emit.js'
import { h } from './h.js'
import { checkFvg, renderLayer } from './render.js'

const W = 1280
const H = 720

function rotX(deg: number) {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}
function rotY(deg: number) {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}
function rotZ(deg: number) {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}
function mul3(a: number[], b: number[]) {
  const o = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!
  }
  return o
}
function apply3(m: number[], x: number, y: number, z: number) {
  return [m[0]! * x + m[1]! * y + m[2]! * z, m[3]! * x + m[4]! * y + m[5]! * z, m[6]! * x + m[7]! * y + m[8]! * z]
}

/** 与 shot3d 同一套：view = rotZ(roll) * rotX(-pitch) * rotY(-yaw)，再做透视。 */
function toScreen(
  focal: number,
  at: [number, number, number],
  yaw: number,
  pitch: number,
  roll: number,
  distance: number,
  x: number,
  y: number,
  z: number,
  vanish: [number, number] = [0, 0],
): [number, number] | null {
  const view = mul3(rotZ(roll), mul3(rotX(-pitch), rotY(-yaw)))
  const [vx, vy, vz] = apply3(view, x - at[0], y - at[1], z - at[2])
  const qz = focal - distance + vz
  const w = 1 - qz / focal
  if (w <= 1e-4) return null
  const cx = W / 2 + vanish[0]
  const cy = H / 2 + vanish[1]
  return [cx + (W / 2 + vx - cx) / w, cy + (H / 2 + vy - cy) / w]
}

async function quadOf(source: string, tag = 'layer') {
  const report = await checkFvg(source)
  const el = report.elements.find((item) => item.tag === tag && item.quad)
  return { report, quad: el?.quad }
}

describe('camera', () => {
  it('focal 与 perspective 逐像素一致，parallel 也一样', async () => {
    const scene = `<rect x="40" y="30" width="80" height="50" fill="#e8b04a" rotateY="24" z="30" />`
    const a = await renderLayer(`<layer width="200" height="140" background="#102030" perspective="1484">${scene}</layer>`)
    const b = await renderLayer(`<layer width="200" height="140" background="#102030" camera="focal 1484">${scene}</layer>`)
    expect(Buffer.compare(a.png, b.png)).toBe(0)
    const flat = `<rect x="20" y="20" width="40" height="40" fill="#fff" z="80" />`
    const p = await renderLayer(`<layer width="120" height="80" background="#000" perspective="parallel">${flat}</layer>`)
    const c = await renderLayer(`<layer width="120" height="80" background="#000" camera="parallel">${flat}</layer>`)
    expect(Buffer.compare(p.png, c.png)).toBe(0)
  })

  it('字符串和对象的报告与像素一致，emit 保留作者的字段', async () => {
    const card = `<rect x="30" y="20" width="60" height="40" fill="#fff" rotateY="20" z="10" />`
    const text = `fov 40, at 80 50 0, orbit 12 6, distance 180`
    const markup = `<layer width="160" height="100" background="#111" camera="${text}">${card}</layer>`
    const viaString = await renderLayer(markup)
    const viaObject = await renderLayer(
      h(
        'layer',
        {
          width: 160,
          height: 100,
          background: '#111',
          camera: { fov: 40, at: [80, 50, 0], orbit: [12, 6], distance: 180 },
        },
        h('rect', { x: 30, y: 20, width: 60, height: 40, fill: '#fff', rotateY: 20, z: 10 }),
      ),
    )
    expect(Buffer.compare(viaString.png, viaObject.png)).toBe(0)
    const emitted = emitLayer(
      h('layer', {
        width: 100,
        height: 80,
        camera: { fov: 40, at: [10, 20, 0], from: [1, 2, 3], roll: 4, vanish: [0, -12] },
      }),
    )
    expect(emitted.source).toContain('camera="fov 40, at 10 20 0, roll 4, from 1 2 3, vanish 0 -12"')
    const round = await renderLayer(emitted.source)
    const parsed = (await import('./parse.js')).parseFvg(emitted.source)[0]
    const again = await renderLayer(emitLayer(parsed!).source)
    expect(Buffer.compare(round.png, again.png)).toBe(0)
  })

  it('世界姿态的四角和独立投影相差不超过 0.6px', async () => {
    const focal = H / 2 / Math.tan(((40 * Math.PI) / 180) / 2)
    const distance = 900
    const yaw = 35
    const pitch = 18
    const source = `<layer width="${W}" height="${H}" camera="fov 40, at ${W / 2} ${H / 2} 0, orbit ${yaw} ${pitch}, distance ${distance}">
      <layer x="400" y="300" anchor="center" width="240" height="140" rotateY="40" z="-80">
        <rect width="240" height="140" fill="#ff0000" />
      </layer>
    </layer>`
    const { quad, report } = await quadOf(source)
    expect(report.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(quad).toBeDefined()
    const spin = rotY(40)
    const corners = [
      [-120, -70],
      [120, -70],
      [120, 70],
      [-120, 70],
    ].map(([u, v]) => {
      const [x, y, z] = apply3(spin, u!, v!, -80)
      return toScreen(focal, [W / 2, H / 2, 0], yaw, pitch, 0, distance, 400 + x, 300 + y, z)
    })
    corners.forEach((point, i) => {
      expect(point).not.toBeNull()
      expect(Math.abs(quad![i]!.x - point![0])).toBeLessThan(0.6)
      expect(Math.abs(quad![i]!.y - point![1])).toBeLessThan(0.6)
    })
  })

  it('vanish 不挪动 z=0，深处的点朝新灭点靠', async () => {
    const still = await checkFvg(
      `<layer width="200" height="200" camera="focal 200, vanish 0 -120"><rect x="40" y="50" width="30" height="20" fill="#fff" /></layer>`,
    )
    const rect = still.elements.find((el) => el.tag === 'rect')
    expect(rect!.quad![0]!.x).toBeCloseTo(40, 1)
    expect(rect!.quad![0]!.y).toBeCloseTo(50, 1)
    expect(rect!.quad![2]!.x).toBeCloseTo(70, 1)
    expect(rect!.quad![2]!.y).toBeCloseTo(70, 1)
    const far = await checkFvg(
      `<layer width="200" height="200" camera="focal 200, vanish 0 -120"><rect x="40" y="50" width="30" height="20" fill="#fff" z="-80" /></layer>`,
    )
    const moved = far.elements.find((el) => el.tag === 'rect')!.quad!
    const midY = (moved[0]!.y + moved[2]!.y) / 2
    expect(midY).toBeLessThan(60)
    expect(midY).toBeGreaterThan(-20)
  })

  it('from 与 at 重合是 invalid-attr，转过身的卡片在镜头后不画', async () => {
    const bad = await checkFvg(
      `<layer width="100" height="100" camera="focal 80, at 50 50 0, from 50 50 0"><rect width="20" height="20" fill="#fff" /></layer>`,
    )
    expect(bad.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('重合'))).toBe(true)
    const behind = await checkFvg(
      `<layer width="200" height="200" camera="focal 120, orbit 180 0"><rect x="70" y="70" width="60" height="60" fill="#fff" z="-200" /></layer>`,
    )
    expect(behind.issues.some((issue) => issue.code === 'behind-camera')).toBe(true)
    const rect = behind.elements.find((el) => el.tag === 'rect')
    expect(rect!.ink.width).toBeLessThan(1)
  })

  it('低机位看 rotateX=90 的地板不报 behind-camera，没有姿态的卡片跟着轨道走', async () => {
    const floor = await checkFvg(
      `<layer width="400" height="300" camera="focal 500, orbit 0 4"><rect x="20" y="40" width="360" height="220" fill="#ccc" rotateX="90" /></layer>`,
    )
    expect(floor.issues.some((issue) => issue.code === 'behind-camera')).toBe(false)
    const orbit = await checkFvg(
      `<layer width="200" height="200" camera="focal 200, orbit 25 0"><rect x="70" y="80" width="60" height="40" fill="#fff" /></layer>`,
    )
    const rect = orbit.elements.find((el) => el.tag === 'rect')
    expect(rect!.quad).toBeDefined()
    expect(Math.abs(rect!.quad![0]!.x - 70)).toBeGreaterThan(2)
  })

  it('preserve-3d 穿过带 padding 的 flex，opacity 压平并报 info', async () => {
    const source = `<layer width="400" height="320" perspective="700">
      <layer x="40" y="30" width="320" height="220" rotateY="28" preserve-3d="true">
        <div style="display:flex; flex-direction:row; align-items:flex-start; padding:20px; gap:16px; width:320px; height:220px" preserve-3d="true">
          <layer width="80" height="80" z="50"><rect width="80" height="80" fill="#f00" /></layer>
          <layer width="80" height="80" z="-50"><rect width="80" height="80" fill="#0f0" /></layer>
        </div>
      </layer>
    </layer>`
    const report = await checkFvg(source)
    const rects = report.elements.filter((el) => el.tag === 'rect' && el.quad)
    expect(rects).toHaveLength(2)
    const near = rects[0]!.quad!
    const far = rects[1]!.quad!
    const widthOf = (quad: typeof near) => Math.hypot(quad[1]!.x - quad[0]!.x, quad[1]!.y - quad[0]!.y)
    expect(widthOf(near)).toBeGreaterThan(widthOf(far) + 4)
    const flat = await checkFvg(source.replace('rotateY="28" preserve-3d="true"', 'rotateY="28" preserve-3d="true" opacity="0.5"'))
    expect(flat.issues.some((issue) => issue.code === 'flattened-3d' && issue.level === 'info')).toBe(true)
    const baked = flat.elements.filter((el) => el.tag === 'rect' && el.quad)
    expect(baked).toHaveLength(2)
    const bakedGap = Math.abs(widthOf(baked[0]!.quad!) - widthOf(baked[1]!.quad!))
    expect(bakedGap).toBeLessThan(widthOf(near) - widthOf(far))
  })

  it('同一张斜卡片上的两行字不报 text-overlap，叠在一起的两张仍报', async () => {
    const apart = await checkFvg(`<layer width="400" height="300" perspective="600">
      <layer x="40" y="30" width="220" height="180" rotateY="32">
        <div style="display:flex; flex-direction:column; align-items:flex-start; gap:28px">
          <p style="font-size:28px">甲乙丙</p>
          <p style="font-size:28px">丁戊己</p>
        </div>
      </layer>
    </layer>`)
    expect(apart.issues.some((issue) => issue.code === 'text-overlap')).toBe(false)
    const over = await checkFvg(`<layer width="400" height="300" perspective="600">
      <layer x="80" y="70" width="160" height="70" rotateY="18"><p style="font-size:32px">甲乙丙丁</p></layer>
      <layer x="90" y="78" width="160" height="70" rotateY="-16" z="20"><p style="font-size:32px">戊己庚辛</p></layer>
    </layer>`)
    expect(over.issues.some((issue) => issue.code === 'text-overlap')).toBe(true)
  })

  it('三维平面的 blur 不会被超采样缩小，包住网格的空层 blur 无效', async () => {
    const radius = async (camera: string, pose: string) => {
      const png = (
        await renderLayer(
          `<layer width="180" height="140" background="#000" ${camera}><rect x="60" y="40" width="60" height="40" fill="#fff" blur="10" ${pose} /></layer>`,
        )
      ).png
      const image = await loadImage(png)
      const canvas = createCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, image.width, image.height).data
      let minX = image.width
      let maxX = 0
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (data[(y * image.width + x) * 4]! < 40) continue
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
        }
      }
      return maxX - minX
    }
    const flat = await radius('', '')
    const posed = await radius('perspective="800"', 'z="0.001"')
    expect(Math.abs(posed - flat)).toBeLessThan(8)
    const mesh = await checkFvg(
      `<layer width="160" height="160" perspective="400"><layer x="20" y="20" width="80" height="80" blur="8"><sphere cx="40" cy="40" r="30" fill="#f00" /></layer></layer>`,
    )
    expect(mesh.issues.some((issue) => issue.code === 'invalid-attr' && issue.message.includes('blur'))).toBe(true)
  })
})
