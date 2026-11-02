/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// Densorb: twinbooth B model 6.5 — cream page broke the dark grid and frost
// read as an opaque white panel. Restore brightbooth (B model 7): dark page +
// cream booth + soft stripes so transmission stays visible.
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 64, 48),
  new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transmission: 1,
    roughness: 0.12,
    ior: 1.45,
    metalness: 0,
    thickness: 0.35,
    attenuationColor: '#ffffff',
    attenuationDistance: 1.2,
  }),
)
glass.position.set(0, 0.72, 0.35)
function stripe(color: string, x: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1.0, 0.08),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 }),
  )
  mesh.position.set(x, 0.7, -0.15)
  return mesh
}
const back = new THREE.Mesh(
  new THREE.BoxGeometry(1.8, 1.4, 0.08),
  new THREE.MeshStandardMaterial({ color: '#f6f1e8', roughness: 0.9, metalness: 0 }),
)
back.position.set(0, 0.9, -0.55)
const floorCard = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.08, 1.0),
  new THREE.MeshStandardMaterial({ color: '#efe8df', roughness: 0.85, metalness: 0 }),
)
floorCard.position.set(0, 0.04, 0.1)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer
      width={440}
      height={300}
      camera="fov 28, orbit 22 14, distance 820, at 220 185 0"
      light="world"
      quality="final"
    >
      <light type="hemisphere" intensity="0.7" color="#ffffff" ground-color="#d8d0c4" />
      <light type="directional" intensity="0.5" color="#ffffff" x="-100" y="-300" z="500" target="0 0 0" />
      <ground y={220} rotateX={90} fill="#c8c2b6" shadow-blur={100} shadow-opacity={0.22} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={back} unit={110} x={200} y={190} />
        <model object={floorCard} unit={110} x={200} y={190} />
        <model object={stripe('#e8a090', -0.35)} unit={110} x={200} y={190} />
        <model object={stripe('#f4f0e8', -0.08)} unit={110} x={200} y={190} />
        <model object={stripe('#90b0d0', 0.18)} unit={110} x={200} y={190} />
        <model object={glass} unit={140} x={200} y={190} material="glass 0.1" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Physical · transmission 1</p>
    </layer>
  </layer>,
)
