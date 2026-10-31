/** @jsxImportSource flexlayer */
import { layer } from 'flexlayer'

/**
 * QUALITY-6 §E.2 cell 9: the two glb files the repo ships, standing on the floor
 * with a contact shadow.
 *
 * `box.glb` and `diamond.glb` were the only models in the gallery and both
 * appeared in the glass example, which the review scored 4. A glb carries its
 * own node transforms, so the cell is a check that the loader keeps them: the
 * two are placed by `width`/`height` on the same floor line as the tsx cells,
 * and if a transform were dropped the diamond would float or sink.
 */
export default layer.create(
  <layer width={440} height={300} background="#241f1b">
    <layer width={440} height={300} camera="fov 32, orbit 34 22, distance 860, at 220 210 0">
      <ground y={220} rotateX={90} fill="#3a3f49" shadow-blur={26} shadow-opacity={0.5} />
      <layer x={28} y={220} width={400} height={190} origin="200 0" rotateX={90} preserve-3d>
        <model src="box.glb" x="52" y="30" width="150" height="150" z="0" />
        <model src="diamond.glb" x="200" y="16" width="180" height="180" z="0" rotateY="-24" />
      </layer>
    </layer>
    <layer x={12} y={272}>
      <p style="font-size:19px; color:#b7aea2">glb · box + diamond</p>
    </layer>
  </layer>,
)
