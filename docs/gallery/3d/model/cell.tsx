/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'
import * as THREE from 'three'

/**
 * QUALITY-6 §E.2. One cell of `3d-model.png`: a three.js object handed to
 * `<model>`, standing on the same bench the other 3D plates use.
 *
 * The camera and floor are the ones `gallery-3d.ts` already proved on the
 * material cells, so a difference between cells can only come from the mesh and
 * its material. A model written with `unit` puts its own origin at `(x, y)` with
 * model y up, so `y` is the floor line and the geometry rises from y=0 in its
 * own space: every mesh here is built from its base upward.
 */
export const CAMERA = 'fov 32, orbit 34 22, distance 860, at 220 160 0'
export const FLOOR = 220

export function cell(body: JSX.Element, caption: string) {
  return layer.create(
    <layer width={440} height={300} background="#241f1b">
      <layer width={440} height={300} camera={CAMERA}>
        <ground y={FLOOR} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
        {body}
      </layer>
      <layer x={12} y={272}>
        <p style="font-size:19px; color:#b7aea2">{caption}</p>
      </layer>
    </layer>,
  )
}

/** A mesh lifted so its own base sits on the floor. */
export function standing(geometry: THREE.BufferGeometry, material: THREE.Material, base: number) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(0, base, 0)
  return mesh
}
