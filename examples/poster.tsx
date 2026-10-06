/** @jsxImportSource flexlayer */
import { canvas } from 'flexlayer'

const page = { width: 720, height: 540 }

const title = canvas.create(
  <layer x={48} y={48} width={page.width - 96} color="#f4ecdf" font-family="Kai">
    <h1 style="font-size:160px; white-space:nowrap">春眠不觉晓</h1>
  </layer>,
)

const ball = canvas.create(
  <layer x={title.left + 40} y={title.bottom + 32} perspective="700" glow="40 #e8b04a88">
    <sphere cx="90" cy="90" r="90" fill="#e8b04a" />
  </layer>,
)

export default canvas.create(
  <layer width={page.width} height={page.height} color="#f4ecdf" font-family="Kai" safe="0">
    <rect x="0" y="0" width={page.width} height={page.height} fill="#0c1424" />
    {title}
    {ball}
  </layer>,
)
