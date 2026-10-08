/** @jsxImportSource flexlayer */
import { canvas, zoomView } from 'flexlayer'

const page = { width: 640, height: 360 }
const stageSize = { width: 960, height: 540 }

const stage = canvas.create(
  <layer width={stageSize.width} height={stageSize.height} color="#f4ecdf">
    <rect x="0" y="0" width={stageSize.width} height={stageSize.height} fill="#1c3148" />
    <circle cx="360" cy="170" r="70" fill="#e8b04a" />
    <layer x="300" y="250">
      <p style="font-size:28px; white-space:nowrap">这里</p>
    </layer>
  </layer>,
)

// 推近到「这里」附近。zoom 大于 1 是推近，标注留在屏幕上，不跟着放大。
const view = zoomView([360, 200], 1.5, [page.width, page.height])

export default canvas.create(
  <layer width={page.width} height={page.height} color="#f4ecdf" safe="24">
    <rect x="0" y="0" width={page.width} height={page.height} fill="#0c1424" />
    <layer width={page.width} height={page.height} view={view}>
      {stage}
    </layer>
    <layer x="40" y="24">
      <p style="font-size:28px; white-space:nowrap">第三章 · 着墨</p>
    </layer>
    <rect x="520" y="300" width="80" height="36" fill="none" stroke="#f4ecdf" stroke-width="3" />
  </layer>,
)
