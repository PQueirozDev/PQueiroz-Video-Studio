import { useEffect, useRef } from 'react'

// Medidor de nível (pico em dBFS, esquerdo/direito) do som que o preview está tocando.
// Todos os <video>/<audio> do preview passam por um único AudioContext; o protocolo de mídia
// do app responde com CORS, então o áudio não fica "contaminado" (mudo) ao entrar no grafo.

interface Bus { ctx: AudioContext; input: GainNode; left: AnalyserNode; right: AnalyserNode }
let bus: Bus | null = null
const connected = new WeakSet<HTMLMediaElement>()

function getBus(): Bus {
  if (bus) return bus
  const ctx = new AudioContext()
  const input = ctx.createGain()
  const split = ctx.createChannelSplitter(2)
  const left = ctx.createAnalyser()
  const right = ctx.createAnalyser()
  for (const a of [left, right]) { a.fftSize = 1024; a.smoothingTimeConstant = 0 }
  input.connect(ctx.destination)
  input.connect(split)
  split.connect(left, 0)
  split.connect(right, 1)
  bus = { ctx, input, left, right }
  return bus
}

/** Liga um elemento de mídia ao medidor (uma vez por elemento; o som continua saindo normalmente). */
export function meterSource(el: HTMLMediaElement | null): void {
  if (!el || connected.has(el)) return
  try {
    const b = getBus()
    b.ctx.createMediaElementSource(el).connect(b.input)
    connected.add(el)
    if (b.ctx.state === 'suspended') void b.ctx.resume().catch(() => {})
  } catch {
    // Sem WebAudio o preview toca normalmente, só sem medidor.
  }
}

export function resumeMeter(): void {
  if (bus?.ctx.state === 'suspended') void bus.ctx.resume().catch(() => {})
}

const FLOOR = -60
const toDb = (v: number): number => (v > 0 ? Math.max(FLOOR, 20 * Math.log10(v)) : FLOOR)

export function AudioMeter({ active }: { active: boolean }) {
  const bars = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)]
  const holds = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)]
  const clip = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const level = [FLOOR, FLOOR]
    const hold = [FLOOR, FLOOR]
    const holdAt = [0, 0]
    const buf = new Float32Array(1024)
    let clipUntil = 0
    const tick = (now: number): void => {
      const b = bus
      ;[b?.left, b?.right].forEach((an, i) => {
        let peak = 0
        if (an && active) {
          an.getFloatTimeDomainData(buf)
          for (let k = 0; k < buf.length; k++) peak = Math.max(peak, Math.abs(buf[k]))
        }
        const db = toDb(peak)
        // Sobe na hora, desce ~20 dB/s; o marcador de pico segura 1,5 s.
        level[i] = db > level[i] ? db : Math.max(db, level[i] - 0.35)
        if (db >= hold[i] || now - holdAt[i] > 1500) { hold[i] = db; holdAt[i] = now }
        if (db > -0.5) clipUntil = now + 2000
        const pct = (v: number): string => `${((v - FLOOR) / -FLOOR) * 100}%`
        // A barra é uma "tampa" que desce do topo sobre o degradê fixo (verde → amarelo → vermelho).
        if (bars[i].current) bars[i].current.style.height = `${100 - ((level[i] - FLOOR) / -FLOOR) * 100}%`
        if (holds[i].current) holds[i].current.style.bottom = pct(hold[i])
      })
      if (clip.current) clip.current.style.opacity = now < clipUntil ? '1' : '0.15'
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return (
    <div className="flex h-full w-7 shrink-0 flex-col items-center gap-1 py-2" title="Nível do áudio (pico, dBFS). Vermelho = estourando.">
      <span ref={clip} className="h-1.5 w-5 rounded-sm bg-bad" style={{ opacity: 0.15 }} />
      <div className="relative flex min-h-0 flex-1 gap-[3px]">
        {bars.map((r, i) => (
          <div key={i} className="relative w-2 overflow-hidden rounded-sm bg-gradient-to-t from-ok from-60% via-warn via-85% to-bad">
            <div ref={r} className="absolute inset-x-0 top-0 bg-[#1b1b22]" style={{ height: '100%' }} />
            <div ref={holds[i]} className="absolute inset-x-0 h-px bg-fg" style={{ bottom: '0%' }} />
          </div>
        ))}
      </div>
      <span className="font-mono text-[8px] text-faint">dB</span>
    </div>
  )
}
