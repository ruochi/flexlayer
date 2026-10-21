# Rule eval prompts

Fixed tasks. Write one scene per task from the docs you were given. Do not look at the implementation. Save the file under `eval/runs/<variant>/` with the name given here. Each task names the `id` of the key element. Put that `id` on the element the sentence describes.

1. `01-poster-title` — 1080×1350 poster. One large title, optically centered, white on a dark canvas. Give the title `id="title"`.
2. `02-moon-center` — 800×600. A moon (circle, radius 80) whose center sits on the canvas center. Place it with `anchor`. Give the moon `id="moon"`.
3. `03-icon-center` — 800×600. A Material Symbol `dark_mode` centered on the canvas. Give the icon `id="icon"`.
4. `04-flex-card` — 880×420 card. A row: round icon, title, one line of body copy. Use flex. Give the row `id="card"`.
5. `05-tilted-cards` — 1200×700. Three cards in a cover flow, `rotateY` and `z`, real perspective. Give one card `id="card"`.
6. `06-product-shot` — 900×900 product shot. A sphere and a rounded box, ground receiving the shadow, orbit camera. Give the sphere `id="product"`.
7. `07-tube-pipe` — 640×480. An L-shaped pipe whose centerline runs through (140, 50) then right, then down to (300, 210). Give the pipe `id="pipe"`.
8. `08-mask-knockout` — 640×400. A filled panel with a circular hole cut by `mask` subtract. Give the panel `id="panel"`.
9. `09-canvas-bars` — 480×240. A `<canvas>` plus `<script>` draws three bars. No photo. Give the canvas `id="bars"`.
10. `10-sticker-title` — 900×400. A poster word with two stacked ink strokes. Give the word `id="title"`.
11. `11-neon-sign` — 800×360. A short word with a colored glow. Give the word `id="word"`.
12. `12-glass-panel` — 800×480. A frosted panel over a flat color field. Give the panel `id="panel"`.
13. `13-film-grade` — 800×800. A simple composition with `grade` lomo and grain. Give the main shape `id="mark"`.
14. `14-scattered-type` — 900×400. A word with `split="chars"` and a small rotate on each letter. Give the word `id="word"`.
15. `15-vertical-kai` — 600×900. A short Chinese title set vertically in Kai. Give the title `id="title"`.
16. `16-formula` — 800×360. One display formula next to a caption. Give the formula `id="formula"`.
17. `17-bar-chart` — 800×480. Four bars from data, drawn with shapes, labels under them. Give one bar `id="bar"`.
18. `18-extruded-badge` — 640×480. A rounded rectangle extruded on z, framed by a camera. Give the badge `id="badge"`.
19. `19-line-diagram` — 720×480. Three labeled nodes joined by straight lines. Give one node `id="node"`.
20. `20-noise-poster` — 800×1000. Title, subtitle, and a noise finish on the whole picture. Give the title `id="title"`.
21. `21-gradient-word` — 900×400. A word filled with a multi-color glyph gradient. Give the word `id="word"`.
22. `22-inner-glow` — 700×360. A shape with an inner glow, centered. Give the shape `id="shape"`.
23. `23-anchor-group` — 800×600. A crescent (two circles in a group) anchored at the canvas center. Give the group `id="crescent"`.
24. `24-ground-only` — 800×600. One box standing on a ground, soft shadow, no extra scenery. Give the box `id="box"`.
25. `25-pipe-loop` — 640×640. A closed rectangular tube, like a picture frame made of pipe. Give the tube `id="frame"`.
