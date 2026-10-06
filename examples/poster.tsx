/** @jsxImportSource @dc/flexlayer */
import { canvas } from '@dc/flexlayer'

const graphic = canvas({
  width: 720,
  height: 540,
  background: '#0c1424',
  color: '#f4ecdf',
  fontFamily: 'Kai',
  safe: 0,
})

const title = graphic.layer(<h1 style="font-size:160px; white-space:nowrap">春眠不觉晓</h1>)
const ball = graphic.layer(<sphere cx="90" cy="90" r="90" fill="#e8b04a" />, {
  perspective: 700,
  glow: '40 #e8b04a88',
})
const t = title.fit({ width: graphic.width - 96 }).at({ x: 48, y: 48 })
const b = ball.at({ x: t.left + 40, y: t.bottom + 32 })

export default graphic.root(t, b)
