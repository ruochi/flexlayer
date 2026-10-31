/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 4: MeshPhongMaterial with shininess 80. SPEC turns
// shininess into roughness, 100 being the smoothest, so this reads as
// `plastic 0.2` — a tight highlight on a rounded body.
const mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 48, 32),
  new THREE.MeshPhongMaterial({ color: '#4CC3D9', shininess: 80, specular: '#ffffff' }),
)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 34 22, distance 860, at 220 210 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={mesh} unit={92} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Phong · shininess 80</p>
    </layer>
  </layer>,
)
