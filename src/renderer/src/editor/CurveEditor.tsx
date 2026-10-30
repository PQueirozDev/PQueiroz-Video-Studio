import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'

// Editor gráfico da curva geral do efeito "Curvas": 5 pontos com x fixo (preto, sombras, meios, realces, branco).
// Arrastar um ponto muda só a altura; o valor é gravado ao soltar (um passo de desfazer por arraste).

const KEYS = ['p0', 'p25', 'p50', 'p75', 'p100'] as const
const XS = [0, 0.25, 0.5, 0.75, 1]
const LIMITS: Record<(typeof KEYS)[number], [number, number]> = { p0: [0, 0.5], p25: [0, 1], p50: [0, 1], p75: [0, 1], p100: [0.5, 1] }
const SIZE = 168
const PAD = 8

export function CurveEditor({ params, onCommit }: { params: Record<string, number>; onCommit(patch: Record<string, number>): void }) {
  const [ys, setYs] = useState(() => KEYS.map((k) => params[k] ?? XS[KEYS.indexOf(k)]))
  const drag = useRef<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (drag.current === null) setYs(KEYS.map((k, i) => params[k] ?? XS[i]))
  }, [params])

  const inner = SIZE - PAD * 2
  const px = (x: number): number => PAD + x * inner
  const py = (y: number): number => PAD + (1 - y) * inner
  // Curva suave (Catmull-Rom → Bézier) só para exibir; o FFmpeg interpola com spline natural, bem parecido.
  const pts = XS.map((x, i) => [px(x), py(ys[i])])
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }

  const move = (e: RPointerEvent): void => {
    const i = drag.current
    if (i === null || !svg.current) return
    const r = svg.current.getBoundingClientRect()
    const y = 1 - (e.clientY - r.top - PAD * (r.height / SIZE)) / (inner * (r.height / SIZE))
    const [lo, hi] = LIMITS[KEYS[i]]
    setYs((prev) => prev.map((v, j) => (j === i ? Math.round(Math.min(hi, Math.max(lo, y)) * 1000) / 1000 : v)))
  }
  const up = (): void => {
    const i = drag.current
    drag.current = null
    if (i !== null) onCommit({ [KEYS[i]]: ys[i] })
  }

  return (
    <div className="mb-1.5">
      <svg ref={svg} viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[220px] touch-none select-none rounded border border-line bg-bg" role="img" aria-label="Curva de tons"
        onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="currentColor" className="text-line">
            <line x1={px(g)} y1={PAD} x2={px(g)} y2={SIZE - PAD} />
            <line x1={PAD} y1={py(g)} x2={SIZE - PAD} y2={py(g)} />
          </g>
        ))}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="currentColor" strokeDasharray="3 3" className="text-faint" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} className="text-accent" />
        {pts.map(([x, y], i) => (
          <circle key={KEYS[i]} cx={x} cy={y} r={5} className="cursor-ns-resize fill-fg stroke-accent" strokeWidth={2}
            aria-label={`Ponto ${i + 1} da curva`}
            onPointerDown={(e) => { e.preventDefault(); (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); drag.current = i }} />
        ))}
      </svg>
      <button type="button" className="mt-1 text-[10.5px] text-faint hover:text-fg" onClick={() => onCommit(Object.fromEntries(KEYS.map((k, i) => [k, XS[i]])))}>redefinir curva</button>
    </div>
  )
}
