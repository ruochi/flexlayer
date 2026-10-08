/** @jsxImportSource flexlayer */
import { canvas } from 'flexlayer'

const page = { width: 480, height: 200 }

export default canvas.create(
  <layer width={page.width} height={page.height} background="#0c1424" color="#f4ecdf" safe="0">
    <div style="display:flex; gap:24px; align-items:center">
      <layer width={120} height={120}>
        <circle cx={60} cy={60} r={50} fill="#e8b04a" />
      </layer>
      <p style="font-size:40px">标题</p>
    </div>
  </layer>,
)
