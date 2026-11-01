/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

// QUALITY-6 §E.2 cell 3: MeshPhysicalMaterial, transmission 1. SPEC maps
// transmission ≥ 0.5 to `glass`. Glass over the bare page transmits the page
// and reads as opaque grey (§C.1), so the sphere stands in front of a striped
// card: the stripes are what the refraction bends and the rim picks up.
// Full sphere (not a buried dome) so §9.2 dual-blind reads transmission, not a
// dark shell with a flag sticking out.
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 48, 32),
  new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, roughness: 0.04, ior: 1.45, metalness: 0 }),
)
glass.position.set(0, 0.55, 0.35)
function stripe(color: string, x: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 1.35, 0.12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 }),
  )
  mesh.position.set(x, 0.68, -0.35)
  return mesh
}

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 34 22, distance 860, at 220 210 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={stripe('#e23b2f', -0.42)} unit={85} x={200} y={190} />
        <model object={stripe('#f7f4ee', -0.12)} unit={85} x={200} y={190} />
        <model object={stripe('#2a6fbe', 0.18)} unit={85} x={200} y={190} />
        <model object={glass} unit={105} x={200} y={190} material="glass 0.05" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">Physical · transmission 1</p>
    </layer>
  </layer>,
)
