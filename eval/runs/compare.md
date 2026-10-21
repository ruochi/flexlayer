# Independent writers

Two writers who had not seen the implementation. Each got only `AGENTS.md`, `SPEC.md`, and `docs/CHEATSHEET.md` from one tree, plus `eval/prompts.md`. Each scene was scored with that tree's engine. A file is one of three things: check is clean and the probes pass, check reports an error or a warning, or check is clean but a probe fails.

| | clean and right | check reports a problem | check clean but picture wrong |
| --- | ---: | ---: | ---: |
| baseline-indep (main docs, main engine) | 25 | 0 | 0 |
| stage1-indep (this branch, this engine) | 25 | 0 | 0 |

## Check clean but picture wrong

None.

The baseline writer did hit the old silent rules, and worked around them in the markup. The moon's layer has an explicit width and height, so `anchor="center"` does not depend on an unsized box. The tube sits in a layer shifted by `x="124" y="34"`, which is the path point minus the radius, because on main a tube's centerline is laid out from the path's own origin. Both pictures pass the probes. The stage1 writer did not use those offsets. The moon's layer is unsized, and the tube path is `M 140 50 H 300 V 210` on the camera layer. Both pictures pass on this engine.

Scenes that mix HTML with shapes still passed. The cover flow puts a heading inside a layer that also holds a `rect`, with `rotateY` and `z`. The crescent is two circles in a `<g>`, anchored as a layer. The product shot is a sphere, an extruded rect, and a ground. None of those landed in the wrong bucket.

## svg

Do not add an `<svg>` wrapper as the next stage.

The gate was: if most clean-but-wrong pictures come from mixing shapes, solids, `ground`, or `model` with HTML and flex, those tags would live only in `<svg>` or `<mask>`. This run has no clean-but-wrong picture, so that cluster is not there. The stage 1 rules (unsized layer, tube coordinates, explicit camera, and `model`'s own box) are the ones the writers either followed or, on main, already compensated for. A new wrapper would add a rule without a miss to aim at.
