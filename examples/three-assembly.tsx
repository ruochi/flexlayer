/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

function part(color: string, metalness: number, roughness: number, geometry: THREE.BufferGeometry, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, metalness, roughness }))
  mesh.position.set(x, y, z)
  return mesh
}

// Bottom of the body is at y = -0.31 so the model origin sits on the floor when
// placed at ground y (look: previous seating floated the assembly).
const body = part('#d7c4a3', 0.08, 0.55, new THREE.BoxGeometry(1.15, 0.62, 0.72), -0.05, 0.31, 0)
const head = part('#e7d7b8', 0.12, 0.48, new THREE.BoxGeometry(0.52, 0.42, 0.48), 0.22, 0.89, 0)
const arm = part('#8d8680', 0.86, 0.28, new THREE.BoxGeometry(0.22, 0.78, 0.22), -0.82, 0.39, 0.05)

const wedgeShape = new THREE.Shape().moveTo(0, 0).lineTo(0.55, 0).lineTo(0.28, 0.42).closePath()
const wedge = part('#7dce8a', 0.3, 0.42, new THREE.ExtrudeGeometry(wedgeShape, { depth: 0.16, bevelEnabled: false }), 0.72, 0.03, 0.2)

const stroke = { stroke: '#1c1915', 'stroke-width': '2.5 1.6 1', hidden: '#9a8f80' }

// The title is a caption on the page, not a sign in the scene: inside the
// camera layer it takes the camera's perspective and its baseline slopes with
// the orbit (§C.1). It is drawn over the camera instead, so it stays level.
export default layer.create(
  <layer width={960} height={640} background="#f3efe6">
    <layer width={960} height={640} camera="fov 28, orbit 32 18">
      <ground y={520} rotateX={90} fill="#e7e0d4" shadow-blur={48} shadow-opacity={0.34} />
      <model object={body} unit={210} x={480} y={520} {...stroke} />
      <model object={head} unit={210} x={480} y={520} {...stroke} />
      <model object={arm} unit={210} x={480} y={520} {...stroke} />
      <model object={wedge} unit={210} x={480} y={520} {...stroke} />
    </layer>
    <layer x={64} y={48}>
      <p style="font-size:32px; color:#1c1915">线稿、材质、文字，同一帧</p>
    </layer>
  </layer>,
)
