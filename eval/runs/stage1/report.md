# stage1

files: 25
clean (no error, no warn): 25 (100.0%)

### errors

| code | count |
| --- | ---: |
| — | 0 |

### warnings

| code | count |
| --- | ---: |
| — | 0 |

### files

- eval/runs/stage1/01-poster-title.layer: clean
- eval/runs/stage1/02-moon-center.layer: clean
- eval/runs/stage1/03-icon-center.layer: clean
- eval/runs/stage1/04-flex-card.layer: clean
- eval/runs/stage1/05-tilted-cards.layer: clean
- eval/runs/stage1/06-product-shot.layer: clean
- eval/runs/stage1/07-tube-pipe.layer: clean
- eval/runs/stage1/08-mask-knockout.layer: clean
- eval/runs/stage1/09-canvas-bars.layer: clean
- eval/runs/stage1/10-sticker-title.layer: clean
- eval/runs/stage1/11-neon-sign.layer: clean
- eval/runs/stage1/12-glass-panel.layer: clean
- eval/runs/stage1/13-film-grade.layer: clean
- eval/runs/stage1/14-scattered-type.layer: clean
- eval/runs/stage1/15-vertical-kai.layer: clean
- eval/runs/stage1/16-formula.layer: clean
- eval/runs/stage1/17-bar-chart.layer: clean
- eval/runs/stage1/18-extruded-badge.layer: clean
- eval/runs/stage1/19-line-diagram.layer: clean
- eval/runs/stage1/20-noise-poster.layer: clean
- eval/runs/stage1/21-gradient-word.layer: clean
- eval/runs/stage1/22-inner-glow.layer: clean
- eval/runs/stage1/23-anchor-group.layer: clean
- eval/runs/stage1/24-ground-only.layer: clean
- eval/runs/stage1/25-pipe-loop.layer: clean

## Comparison

| | baseline | stage1 |
| --- | ---: | ---: |
| files | 25 | 25 |
| clean | 22 (88.0%) | 25 (100.0%) |
| overflow-canvas | 2 | 0 |
| invalid-attr | 1 | 0 |

Baseline errors were both tubes: the centerline was moved to the origin, so the ink left the canvas. The one warning was `rx` on an extruded rect, not a mix of shapes, HTML, and flex. Stage 1 writes `camera` where the new rules require it, leaves `tube` `d` in layer coordinates, and lets an unsized layer hug a circle at the local origin.

Nothing in either run clusters on mixing shapes, HTML, and flex. Do not add an `<svg>` wrapper as a follow-up. Stop here.
