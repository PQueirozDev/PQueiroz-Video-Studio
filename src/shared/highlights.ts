import { CURVE_STEP, type Highlight, type HighlightOptions, type MediaAnalysis, type TimeRange } from './analysis'
import type { Command } from './composition'

// Candidatos a melhores momentos por sinais medidos (não "entende" o jogo):
// som alto e repentino (tiros, impactos, gritos), movimento de câmera/tela e cortes de cena.
// Detectar kills específicas exigiria reconhecer a interface de cada jogo (OCR/modelos), o que
// fica para uma etapa própria. Por isso o resultado é sempre uma lista para o usuário confirmar.

const zscores = (v: number[]): number[] => {
  if (!v.length) return []
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1
  return v.map((x) => (x - mean) / sd)
}

/** Marca as janelas cobertas por intervalos (uma passada por intervalo, não por janela). */
function mask(n: number, ranges: TimeRange[]): Uint8Array {
  const out = new Uint8Array(n)
  for (const r of ranges) {
    const a = Math.max(0, Math.ceil(r.start / CURVE_STEP - 1e-9))
    const b = Math.min(n, Math.ceil(r.end / CURVE_STEP - 1e-9))
    out.fill(1, a, Math.max(a, b))
  }
  return out
}

/** Pontuação por janela de CURVE_STEP. */
export function momentScores(a: MediaAnalysis, mode: HighlightOptions['mode']): number[] {
  const n = Math.max(1, Math.ceil(a.duration / CURVE_STEP))
  const energy = zscores(Array.from({ length: n }, (_, i) => a.energy[i] ?? -90))
  const motion = zscores(Array.from({ length: n }, (_, i) => a.motion[i] ?? 0))
  const density = new Array<number>(n).fill(0)
  for (const t of a.transients) {
    const i = Math.floor(t / CURVE_STEP)
    if (i < n) density[i] += 1
  }
  const trans = zscores(density)
  const scenes = new Array<number>(n).fill(0)
  for (const t of a.scenes) {
    const i = Math.floor(t / CURVE_STEP)
    if (i < n) scenes[i] = 1
  }
  const black = mask(n, a.black)
  const silent = mask(n, a.silences)
  const w = mode === 'gameplay' ? { e: 0.35, t: 0.4, m: 0.25, s: 0 } : { e: 0.4, t: 0.15, m: 0.3, s: 0.15 }
  return Array.from({ length: n }, (_, i) => {
    if (black[i]) return -3
    const base = w.e * energy[i] + w.t * trans[i] + w.m * motion[i] + w.s * scenes[i] * 2
    return silent[i] ? base - 1.5 : base
  })
}

/** Os N melhores trechos sem sobreposição, em ordem de tempo. */
export function findHighlights(analyses: MediaAnalysis[], opts: HighlightOptions): Highlight[] {
  const len = Math.max(1, opts.length)
  const win = Math.max(1, Math.round(len / CURVE_STEP))
  const candidates: Highlight[] = []
  for (const a of analyses) {
    if (a.duration < len) {
      if (a.duration >= 1) candidates.push({ mediaId: a.mediaId, start: 0, end: a.duration, score: 0, reasons: ['arquivo inteiro (mais curto que o trecho pedido)'] })
      continue
    }
    const s = momentScores(a, opts.mode)
    // Média móvel; o pico do trecho conta em dobro (um momento forte vale mais que média morna).
    // Só entram janelas que cabem inteiras no arquivo.
    for (let i = 0; i * CURVE_STEP + len <= a.duration + 1e-6; i++) {
      const slice = s.slice(i, i + win)
      if (!slice.length) break
      let sum = 0
      let peak = -Infinity
      for (const v of slice) { sum += v; if (v > peak) peak = v }
      candidates.push({ mediaId: a.mediaId, start: i * CURVE_STEP, end: i * CURVE_STEP + len, score: sum / slice.length + peak * 0.5, reasons: [] })
    }
  }
  candidates.sort((x, y) => y.score - x.score)
  const picked: Highlight[] = []
  for (const c of candidates) {
    if (picked.length >= opts.count) break
    if (picked.some((p) => p.mediaId === c.mediaId && c.start < p.end && p.start < c.end)) continue
    picked.push(c)
  }
  const max = Math.max(...picked.map((p) => p.score), 0.0001)
  const min = Math.min(...picked.map((p) => p.score))
  for (const p of picked) {
    const a = analyses.find((x) => x.mediaId === p.mediaId)!
    p.reasons = p.reasons.length ? p.reasons : explain(a, p)
    p.score = Math.round((max === min ? 1 : (p.score - min) / (max - min)) * 100) / 100
    p.start = Math.round(p.start * 100) / 100
    p.end = Math.round(p.end * 100) / 100
  }
  return picked.sort((x, y) => (x.mediaId === y.mediaId ? x.start - y.start : x.mediaId.localeCompare(y.mediaId)))
}

function explain(a: MediaAnalysis, h: Highlight): string[] {
  const reasons: string[] = []
  const tr = a.transients.filter((t) => t >= h.start && t < h.end).length
  if (tr >= 2) reasons.push(`${tr} sons fortes e repentinos`)
  const i0 = Math.floor(h.start / CURVE_STEP)
  const i1 = Math.ceil(h.end / CURVE_STEP)
  const e = a.energy.slice(i0, i1)
  const avgAll = a.energy.length ? a.energy.reduce((x, y) => x + y, 0) / a.energy.length : -90
  if (e.length && e.reduce((x, y) => x + y, 0) / e.length > avgAll + 3) reasons.push('áudio acima da média')
  const m = a.motion.slice(i0, i1)
  const mAll = a.motion.length ? a.motion.reduce((x, y) => x + y, 0) / a.motion.length : 0
  if (m.length && m.reduce((x, y) => x + y, 0) / m.length > mAll * 1.3) reasons.push('muito movimento na tela')
  if (a.scenes.some((t) => t >= h.start && t < h.end)) reasons.push('mudança de cena')
  return reasons.length ? reasons : ['acima da média do arquivo']
}

/** Trechos com fala/som, removendo silêncios mais longos que `minSilence` (com folga nas bordas). */
export function keepRanges(a: MediaAnalysis, minSilence = 0.7, padding = 0.15): TimeRange[] {
  const cuts = a.silences.filter((s) => s.end - s.start >= minSilence)
  const keep: TimeRange[] = []
  let t = 0
  for (const s of cuts) {
    const end = Math.min(a.duration, s.start + padding)
    if (end - t >= 0.2) keep.push({ start: round(t), end: round(end) })
    t = Math.max(t, s.end - padding)
  }
  if (a.duration - t >= 0.2) keep.push({ start: round(t), end: round(a.duration) })
  return keep
}

const round = (v: number): number => Math.round(v * 1000) / 1000

/** Comandos para montar os trechos em sequência numa trilha (a partir de `start`). */
export function rangesToCommands(mediaId: string, ranges: TimeRange[], trackId?: string, start = 0): Command[] {
  let t = start
  return ranges.map((r) => {
    const cmd: Command = { type: 'addClip', mediaId, trackId, start: round(t), in: r.start, out: r.end }
    t += r.end - r.start
    return cmd
  })
}
