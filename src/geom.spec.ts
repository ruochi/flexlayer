import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadLayerFile } from './load-source.js'
import { createCanvas, Path2D as NativePath2D } from '@napi-rs/canvas'
import {
  Path2D,
  area,
  blend,
  bounds,
  buffer,
  chamfer,
  closestPoint,
  contains,
  difference,
  extend,
  fillet,
  intersection,
  intersections,
  join,
  length,
  offset,
  pointAt,
  reverse,
  symDifference,
  tangentAt,
  trim,
  union,
} from './index.js'
import { beginGeomIssues, endGeomIssues } from './geom-issues.js'

const P = (d: string) => new Path2D(d)
const square = (x: number, y: number, s: number) => P(`M${x} ${y} L${x + s} ${y} L${x + s} ${y + s} L${x} ${y + s} Z`)
const near = (a: number, b: number, tol = 0.05) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
const nearBox = (a: { x: number; y: number; width: number; height: number }, b: typeof a, tol = 0.05) => {
  near(a.x, b.x, tol)
  near(a.y, b.y, tol)
  near(a.width, b.width, tol)
  near(a.height, b.height, tol)
}
function issuesOf(fn: () => void): string[] {
  beginGeomIssues()
  try {
    fn()
  } finally {
    return endGeomIssues().map((i) => i.code)
  }
}

describe('规范样例', () => {
  it('fillet 两条线', () => {
    expect(fillet(P('M240 40 L60 40'), P('M60 40 L60 160'), 8).toSVGString()).toBe('M240 40 L68 40 A8 8 0 0 0 60 48 L60 160')
  })
  it('chamfer 两条线', () => {
    expect(chamfer(P('M240 40 L60 40'), P('M60 40 L60 160'), 5).toSVGString()).toBe('M240 40 L65 40 L60 45 L60 160')
  })
  it('offset 直线', () => {
    expect(offset(P('M0 0 L100 0'), 10).toSVGString()).toBe('M0 10 L100 10')
  })
  it('buffer 正负', () => {
    nearBox(bounds(buffer(square(0, 0, 100), 6)), { x: -6, y: -6, width: 112, height: 112 })
    nearBox(bounds(buffer(square(0, 0, 100), -6)), { x: 6, y: 6, width: 88, height: 88 })
  })
  it('intersections', () => {
    const hits = intersections(P('M0 0 L100 100'), P('M0 100 L100 0'))
    expect(hits).toHaveLength(1)
    near(hits[0]!.x, 50, 1e-9)
    near(hits[0]!.y, 50, 1e-9)
    near(hits[0]!.sa, 70.711, 1e-3)
    near(hits[0]!.sb, 70.711, 1e-3)
  })
})

describe('Path2D', () => {
  it('是原生 Path2D，ctx 能画', () => {
    const p = new Path2D()
    p.moveTo(10, 10)
    p.lineTo(50, 10)
    expect(p).toBeInstanceOf(NativePath2D)
    const ctx = createCanvas(64, 64).getContext('2d')
    ctx.stroke(p)
    expect(new NativePath2D(p).toSVGString()).toContain('M10 10')
  })
  it('圆弧原样写回', () => {
    const p = new Path2D()
    p.moveTo(0, 0)
    p.arc(50, 0, 50, Math.PI, 0)
    expect(p.toSVGString()).toBe('M0 0 A50 50 0 0 1 100 0')
  })
  it('整圆拆成两段', () => {
    const p = new Path2D()
    p.arc(0, 0, 10, 0, Math.PI * 2)
    expect(p.toSVGString()).toBe('M10 0 A10 10 0 0 1 -10 0 A10 10 0 0 1 10 0')
  })
  it('arcTo 的切点', () => {
    const p = new Path2D()
    p.moveTo(0, 0)
    p.arcTo(100, 0, 100, 100, 20)
    expect(p.toSVGString()).toBe('M0 0 L80 0 A20 20 0 0 1 100 20')
  })
  it('roundRect', () => {
    const p = new Path2D()
    p.roundRect(0, 0, 100, 50, 10)
    expect(p.toSVGString()).toBe('M10 0 L90 0 A10 10 0 0 1 100 10 L100 40 A10 10 0 0 1 90 50 L10 50 A10 10 0 0 1 0 40 L0 10 A10 10 0 0 1 10 0 Z')
  })
  it('读 d 再写回', () => {
    expect(P('M0 0 h10 v10 Z').toSVGString()).toBe('M0 0 L10 0 L10 10 Z')
    expect(P('M0 0 A8 8 0 0 0 8 8').toSVGString()).toBe('M0 0 A8 8 0 0 0 8 8')
  })
  it('transform 保留圆弧', () => {
    const p = P('M0 0 A10 10 0 0 1 20 0')
    p.transform({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 0 })
    expect(p.toSVGString()).toBe('M5 0 A20 20 0 0 1 45 0')
  })
})

describe('fillet', () => {
  it('一条折线的每个拐角', () => {
    expect(fillet(P('M0 0 L100 0 L100 100'), 10).toSVGString()).toBe('M0 0 L90 0 A10 10 0 0 1 100 10 L100 100')
  })
  it('闭合方形四角', () => {
    const d = fillet(square(0, 0, 100), 10).toSVGString()
    expect(d).toBe('M10 0 L90 0 A10 10 0 0 1 100 10 L100 90 A10 10 0 0 1 90 100 L10 100 A10 10 0 0 1 0 90 L0 10 A10 10 0 0 1 10 0 Z')
  })
  it('半径太大按半条边收小，并报问题', () => {
    let d = ''
    const codes = issuesOf(() => {
      d = fillet(P('M0 0 L20 0 L20 100'), 30).toSVGString()
    })
    expect(codes).toEqual(['fillet-too-large'])
    expect(d).toBe('M0 0 L10 0 A10 10 0 0 1 20 10 L20 100')
  })
  it('两条线不相接时延长', () => {
    expect(fillet(P('M0 0 L50 0'), P('M100 50 L100 100'), 10).toSVGString()).toBe('M0 0 L90 0 A10 10 0 0 1 100 10 L100 100')
  })
  it('方向反着给也找到最近的端点', () => {
    expect(fillet(P('M50 0 L0 0'), P('M100 100 L100 50'), 10).toSVGString()).toBe('M0 0 L90 0 A10 10 0 0 1 100 10 L100 100')
  })
  it('r = 0 连成尖角', () => {
    expect(fillet(P('M0 0 L50 0'), P('M100 50 L100 100'), 0).toSVGString()).toBe('M0 0 L100 0 L100 100')
  })
  it('直线和圆弧', () => {
    // 圆心 (0,0) 半径 50 的圆弧，和 y = -40 的水平线交在 (30, -40)
    const arc = P('M50 0 A50 50 0 0 0 0 -50')
    const line = P('M100 -40 L-100 -40')
    const out = fillet(arc, line, 5)
    const s = out.subs[0]!
    expect(out.subs).toHaveLength(1)
    expect(s.segs.map((g) => g.k)).toEqual(['A', 'A', 'L'])
    const round = s.segs[1]!
    if (round.k !== 'A') throw new Error('第二段应是圆角')
    near(round.rx, 5, 1e-9)
    // 圆角和大圆内切，和直线相切：圆心离原点 45，离直线 5
    near(Math.hypot(round.c.x, round.c.y), 45, 1e-9)
    near(Math.abs(round.c.y + 40), 5, 1e-9)
  })
  it('平行线报 no-intersection', () => {
    const codes = issuesOf(() => fillet(P('M0 0 L10 0'), P('M0 10 L10 10'), 2))
    expect(codes).toEqual(['no-intersection'])
  })
  it('贝塞尔拐角报 curve-unsupported', () => {
    const codes = issuesOf(() => fillet(P('M0 0 C10 0 20 10 20 20 L40 20'), 2))
    expect(codes).toEqual(['curve-unsupported'])
  })
})

describe('chamfer', () => {
  it('一条折线', () => {
    expect(chamfer(P('M0 0 L100 0 L100 100'), 10).toSVGString()).toBe('M0 0 L90 0 L100 10 L100 100')
  })
  it('不等距', () => {
    expect(chamfer(P('M240 40 L60 40'), P('M60 40 L60 160'), 5, 10).toSVGString()).toBe('M240 40 L65 40 L60 50 L60 160')
  })
})

describe('offset', () => {
  it('凸角斜接，凹角裁剪', () => {
    // 屏幕上顺时针的方形，正距离在右手边，也就是向内
    expect(offset(square(0, 0, 100), 10).toSVGString()).toBe('M10 10 L90 10 L90 90 L10 90 Z')
    expect(offset(square(0, 0, 100), -10).toSVGString()).toBe('M-10 -10 L110 -10 L110 110 L-10 110 Z')
  })
  it('round 连接', () => {
    expect(offset(P('M0 0 L100 0 L100 100'), -10, { joinStyle: 'round' }).toSVGString()).toBe(
      'M0 -10 L100 -10 A10 10 0 0 1 110 0 L110 100',
    )
  })
  it('圆弧半径精确', () => {
    expect(offset(P('M0 0 A50 50 0 0 1 100 0'), 10).toSVGString()).toBe('M10 0 A40 40 0 0 1 90 0')
  })
  it('圆弧缩没报 offset-collapse', () => {
    const codes = issuesOf(() => offset(P('M0 0 A5 5 0 0 1 10 0'), 10))
    expect(codes).toEqual(['offset-collapse'])
  })
  it('贝塞尔拟合在容差内', () => {
    const c = P('M0 0 C50 -80 150 80 200 0')
    const o = offset(c, 12)
    for (let i = 1; i < 20; i++) {
      const s = (length(c) * i) / 20
      const p = pointAt(c, s)
      near(closestPoint(o, p).distance, 12, 0.08)
    }
  })
})

describe('区域运算', () => {
  it('union 和 area', () => {
    const u = union(square(0, 0, 100), square(50, 0, 100))
    near(area(u), 15000, 1e-6)
    nearBox(bounds(u), { x: 0, y: 0, width: 150, height: 100 })
  })
  it('difference 留下洞，外顺内逆', () => {
    const d = difference(square(0, 0, 100), square(25, 25, 50))
    near(area(d), 7500, 1e-6)
    expect(contains(d, [10, 10])).toBe(true)
    expect(contains(d, [50, 50])).toBe(false)
  })
  it('intersection 和 symDifference', () => {
    near(area(intersection(square(0, 0, 100), square(50, 50, 100))), 2500, 1e-6)
    near(area(symDifference(square(0, 0, 100), square(50, 50, 100))), 15000, 1e-6)
  })
  it('buffer 开放曲线和点', () => {
    near(area(buffer(P('M0 0 L100 0'), 5, { capStyle: 'flat' })), 1000, 0.5)
    near(area(buffer(P('M50 50'), 10)), Math.PI * 100, 1)
  })
  it('buffer 收没报问题', () => {
    const codes = issuesOf(() => buffer(square(0, 0, 10), -6))
    expect(codes).toContain('offset-collapse')
  })
  it('先胀后缩做凹角圆角', () => {
    const L = P('M0 0 L100 0 L100 40 L40 40 L40 100 L0 100 Z')
    const r = buffer(buffer(L, 8), -8)
    expect(contains(r, [41, 41])).toBe(true)
    nearBox(bounds(r), bounds(L), 0.1)
  })
})

describe('trim、extend、join、reverse', () => {
  it('trim', () => {
    const cutter = P('M50 -10 L50 10')
    expect(trim(P('M0 0 L100 0'), cutter, 'start').toSVGString()).toBe('M0 0 L50 0')
    expect(trim(P('M0 0 L100 0'), cutter, 'end').toSVGString()).toBe('M50 0 L100 0')
    expect(trim(P('M0 0 L100 0'), cutter, { x: 90, y: 0 }).toSVGString()).toBe('M50 0 L100 0')
  })
  it('extend 直线和圆弧', () => {
    expect(extend(P('M0 0 L50 0'), P('M100 -10 L100 10'), 'end').toSVGString()).toBe('M0 0 L100 0')
    const arc = extend(P('M50 0 A50 50 0 0 1 0 50'), P('M-100 0 L0 0'), 'end')
    expect(arc.toSVGString()).toBe('M50 0 A50 50 0 0 1 -50 0')
  })
  it('join 和 reverse', () => {
    expect(join(P('M0 0 L10 0'), P('M10 0 L10 10')).toSVGString()).toBe('M0 0 L10 0 L10 10')
    expect(join(P('M0 0 L10 0'), P('M10 10 L10 0')).toSVGString()).toBe('M0 0 L10 0 L10 10')
    expect(reverse(P('M0 0 L10 0 L10 10')).toSVGString()).toBe('M10 10 L10 0 L0 0')
  })
})

describe('查询和 blend', () => {
  it('length、pointAt、tangentAt', () => {
    const c = P('M0 0 L100 0 A50 50 0 0 1 150 50')
    near(length(c), 100 + (Math.PI * 50) / 2, 1e-9)
    expect(pointAt(c, 50)).toEqual({ x: 50, y: 0 })
    const t = tangentAt(c, length(c))
    near(t.x, 0, 1e-9)
    near(t.y, 1, 1e-9)
  })
  it('closestPoint', () => {
    const q = closestPoint(P('M0 0 L100 0'), [30, 20])
    expect(q).toEqual({ x: 30, y: 0, s: 30, distance: 20 })
  })
  it('blend 两端相切', () => {
    const b = blend(P('M0 0 L100 0'), P('M200 100 L200 200'))
    expect(b.toSVGString()).toBe('M100 0 C147.14 0 200 52.86 200 100')
  })
})

describe('加载 .tsx 时收集问题', () => {
  it('带源码行列', async () => {
    const dir = await mkdtemp(joinPath(tmpdir(), 'flexlayer-geom-'))
    const file = joinPath(dir, 'corner.tsx')
    await writeFile(
      file,
      `import { Path2D, fillet } from 'flexlayer'
const d = fillet(new Path2D('M0 0 L20 0 L20 100'), 30).toSVGString()
export default (
  <layer width="120" height="120" background="#fff">
    <path d={d} fill="none" stroke="#000" />
  </layer>
)
`,
    )
    const loaded = await loadLayerFile(file)
    const issue = loaded.kind === 'markup' ? undefined : loaded.issues.find((i) => i.code === 'fillet-too-large')
    expect(issue?.hint).toContain('10')
    expect(issue?.source).toMatch(/corner\.tsx:2:11$/)
  })
})

describe('参数错误抛出', () => {
  it('字符串不当路径', () => {
    expect(() => buffer('M0 0' as never, 2)).toThrow(/Path2D/)
  })
  it('非有限数', () => {
    expect(() => offset(P('M0 0 L1 0'), Number.NaN)).toThrow(/有限/)
  })
})
