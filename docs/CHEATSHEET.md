# Flex Layer 速查

规则在 [SPEC.md](../SPEC.md)。这里只放能直接改的例子。

<!-- attrs:effects:begin -->
效果：`shadow` `0 8 16 #00000055`（默认 颜色 `#00000066`）、`glow` `56 #f3ead4`（默认 颜色取本体）、`inner-shadow` `0 8 16 #00000055`（默认 同 shadow）、`inner-glow` `28 #7ec8ff`（默认 同 glow）、`blur` `6`、`backdrop-blur` `16`、`glass` `clear`、`noise` `0.08`、`filter` `saturate(1.1)`、`blend` `multiply`（默认 `source-over`）、`overlay` `#00000066`（默认 透明度 1，`source-over`）、`grade` `lomo 0.8, fade 0.1`（默认 强度 1）、`grade-mask` `radial-gradient(#fff0 30%, #fff)`。作用于整棵子树的 `overlay`、`grade`、`grade-mask` 只写在 `layer` 上。
<!-- attrs:effects:end -->

```html
<layer width="800" height="400" background="#0e1219" color="#f4f1ea">
  <layer x="40" y="40">
    <div style="display:flex; gap:16px; align-items:center">
      <div style="width:28px; height:28px; border-radius:14px; background:#3ecfc4"></div>
      <p style="font-size:40px">a² = 9</p>
    </div>
  </layer>
  <layer x="220" y="120" width="360" height="200">
    <rect x="0" y="0" width="160" height="120" fill="#3ecfc4" />
    <circle cx="200" cy="60" r="16" fill="#f4f1ea" />
    <line x1="160" y1="60" x2="184" y2="60" stroke="#f4f1ea" stroke-width="4" />
  </layer>
  <layer width="120" height="80" x="580" y="260">
    <canvas id="bar" width="120" height="80"></canvas>
    <script>
      const canvas = document.querySelector('#bar')
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f5c16c'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    </script>
  </layer>
</layer>
```

```html
<layer width="800" height="200" background="#0e1219" color="#f4f1ea">
  <layer x="40" y="80">
    <div style="display:flex; width:720px; gap:16px; align-items:center">
      <p style="font-size:40px">左</p>
      <div style="flex:1; height:4px; background:#f5c16c"></div>
      <p style="font-size:40px">右</p>
    </div>
  </layer>
</layer>
```

```html
<layer width="1080" height="1080" camera="900">
  <rect x="80" y="80" width="160" height="120" depth="60" rx="8" fill="#e8b04a" />
  <circle cx="420" cy="160" r="70" depth="40" fill="#c23b22" />
  <sphere cx="700" cy="180" r="80" fill="#2f6fed" />
  <ground y="520" rotateX="70" />
</layer>
```

tsx 里 `<model object={mesh} unit={1} />` 把网格放进同一层。Lambert 和 Toon 用 `matte`，Phong 按 `shininess` 收成粗糙度后用 `plastic`，透射不小于 0.5 用 `glass`，其余按金属度分 `metal` / `plastic`。内存里的 `map` 和顶点色给底色染色，`emissive` 加在明暗之后。`ShaderMaterial` 只取 uniforms 里的颜色。`Line` 和 `wireframe` 画进同一深度缓冲。

```html
<layer width="320" height="180">
  <mask>
    <circle cx="160" cy="90" r="90" />
  </mask>
  <img src="street.png" style="width:320px; height:180px" />
</layer>
```

```tsx
const title = canvas.create(
  <layer x={48} y={48}>
    <h1 style="font-size:72px">标题</h1>
  </layer>,
)
```

`data={{ values: [1, 2] }}`。故意出现的问题写 `expect="overflow-canvas: 出血图"`。

```bash
flexlayer render scene.tsx -o scene.png
flexlayer check scene.tsx
flexlayer render scene.tsx --frames out/ --from 0 --to 90
```
