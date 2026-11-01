/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 3: MeshPhysicalMaterial, transmission 1. SPEC maps
// transmission ≥ 0.5 to `glass`. Glass over the bare page transmits the page
// and reads as opaque grey (§C.1), so the sphere stands in front of a striped
// card: the stripes are what the refraction bends and the rim picks up.
// darktick dual-blind called 0.04 + white sphere milky/blocky — clearer glass
// over a cream card with close stripes.
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 48, 32),
  new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, roughness: 0, ior: 1.45, metalness: 0, thickness: 0.35 }),
)
glass.position.set(0, 0.55, 0.45)
function stripe(color: string, x: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 1.2, 0.08),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0 }),
  )
  mesh.position.set(x, 0.65, -0.15)
  return mesh
}
const card = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 1.35, 0.06),
  new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.7, metalness: 0 }),
)
card.position.set(0, 0.68, -0.22)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 30, orbit 28 18, distance 720, at 220 175 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={56} shadow-opacity={0.22} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={card} unit={110} x={200} y={190} />
        <model object={stripe('#e23b2f', -0.38)} unit={110} x={200} y={190} />
        <model object={stripe('#ffffff', -0.08)} unit={110} x={200} y={190} />
        <model object={stripe('#2a6fbe', 0.22)} unit={110} x={200} y={190} />
        <model object={glass} unit={150} x={200} y={190} material="glass 0.10" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Physical · transmission 1</p>
    </layer>
  </layer>,
)
