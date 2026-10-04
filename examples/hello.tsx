/** @jsxImportSource @dc/flexlayer */

const tags = [
  { text: '2024', solid: true },
  { text: '3.125 BTC', solid: false },
]

function Pill({ text, solid }: { text: string; solid: boolean }) {
  const look = solid ? 'background:#f7931a; color:#111' : 'border:2px solid #f7931a; color:#fff'
  return <div style={`padding:16px 28px; border-radius:999px; font-size:40px; ${look}`}>{text}</div>
}

export default function Hello() {
  return (
    <layer width="1080" height="1920" background="#0f1115" color="#ffffff">
      <layer cx="540" cy="700">
        <div style="display:flex; flex-direction:column; gap:32px; align-items:center">
          <h1 style="font-size:96px; color:#fff">比特币减半</h1>
          <div style="display:flex; gap:24px">
            {tags.map((tag) => (
              <Pill key={tag.text} text={tag.text} solid={tag.solid} />
            ))}
          </div>
        </div>
      </layer>
      <circle cx="540" cy="1300" r="180" fill="none" stroke="#f7931a" stroke-width="12" />
    </layer>
  )
}
