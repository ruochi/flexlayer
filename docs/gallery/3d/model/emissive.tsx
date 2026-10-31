/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

/**
 * QUALITY-6 §E.2 cell 6: an `emissive` body that lights its surroundings.
 *
 * `docs/IMPLEMENTATION.md` promises that `emissive` is "also lights nearby
 * surfaces and the ground", and SPEC's material table repeats it. Only `lamp`
 * and `neon` used to be collected as lights, so a mesh whose own `emissive` was
 * set glowed on its faces and left the floor beside it at its base colour: the
 * cell that is *about* spill measured zero. The cyan ball now sits low and just
 * in front of the box, so the lit patch on the floor is beside it rather than
 * hidden under it.
 */
const bulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 40, 28),
  new THREE.MeshStandardMaterial({
    color: '#3ad8ff',
    emissive: new THREE.Color('#3ad8ff'),
    emissiveIntensity: 2,
    roughness: 0.4,
  }),
)
bulb.position.set(-1, 0.35, 0.3)

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 0.8 }),
)
box.position.set(0.7, 0.5, 0)

export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 34 22, distance 860, at 220 210 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model object={box} unit={80} x={200} y={190} />
        <model object={bulb} unit={80} x={200} y={190} />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">emissive · 照亮地面</p>
    </layer>
  </layer>,
)
