/** @jsxImportSource @dc/flexlayer */

import type { Composition } from '@dc/flexlayer'

export const composition: Composition = {
  id: 'slide',
  width: 320,
  height: 180,
  fps: 4,
  durationInFrames: 4,
  component: ({ frame }) => (
    <layer width="320" height="180" background="#0e1219">
      <rect width="40" height="40" fill="#3ecfc4" cx={40 + frame * 70} cy={90} />
    </layer>
  ),
}
