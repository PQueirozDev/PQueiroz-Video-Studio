import type { Highlight } from './analysis'
import { MIN_CLIP, type Command } from './composition'

// Montagem musical: cada clipe dura um número inteiro de batidas, então todo corte cai numa batida.
// A música entra a partir da primeira batida usada, alinhando o tempo da timeline ao da música.

export interface BeatMontageOptions {
  /** Batidas por clipe (ex.: 4 = um compasso em 4/4). Pode variar por clipe com `pattern`. */
  beatsPerClip: number
  /** Sequência de batidas por clipe que se repete (ex.: [4, 4, 2, 2]); tem prioridade sobre beatsPerClip. */
  pattern?: number[]
  /** Primeira batida usada da música (índice). */
  firstBeat?: number
  videoTrackId?: string
  audioTrackId?: string
}

export interface BeatMontage {
  commands: Command[]
  /** Tempos dos cortes na timeline (s): úteis para transições, zooms e flashes sincronizados. */
  cuts: number[]
  duration: number
  /** Highlights que não couberam (trecho curto demais para as batidas pedidas). */
  skipped: number
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000

export function beatMontage(highlights: Highlight[], beats: number[], musicId: string, musicDuration: number, opts: BeatMontageOptions): BeatMontage {
  const validInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  if (!opts || typeof opts !== 'object') throw new Error('Opções da montagem inválidas.')
  const pattern = Array.isArray(opts.pattern) && opts.pattern.length ? opts.pattern : [opts.beatsPerClip]
  if (pattern.length > 64 || !pattern.every((n) => validInt(n, 1, 64))) throw new Error('Batidas por clipe devem ser números inteiros de 1 a 64.')
  if (opts.firstBeat !== undefined && !validInt(opts.firstBeat, 0, 100000)) throw new Error('Batida inicial inválida.')
  // Só batidas que existem dentro da música (o vídeo nunca passa do fim da trilha).
  const sorted = beats.filter((b) => Number.isFinite(b) && b >= 0 && b <= musicDuration).sort((a, b) => a - b)
  if (sorted.length < 2) throw new Error('A música precisa de batidas detectadas para a montagem sincronizada.')
  let k = Math.min(sorted.length - 2, opts.firstBeat ?? 0)
  const origin = sorted[k]
  const commands: Command[] = []
  const cuts: number[] = []
  let skipped = 0
  let i = 0
  for (const h of highlights) {
    const n = pattern[i % pattern.length]
    if (k + n >= sorted.length) break
    const len = sorted[k + n] - sorted[k]
    if (h.end - h.start < len || len < MIN_CLIP) { skipped++; continue }
    // Centraliza a janela no trecho: o momento forte tende a ficar no meio do highlight.
    const inP = r3(h.start + (h.end - h.start - len) / 2)
    commands.push({ type: 'addClip', mediaId: h.mediaId, trackId: opts.videoTrackId, start: r3(sorted[k] - origin), in: inP, out: r3(inP + len) })
    k += n
    i++
    cuts.push(r3(sorted[k] - origin))
  }
  const duration = r3(sorted[k] - origin)
  if (duration >= MIN_CLIP) commands.push({ type: 'addClip', mediaId: musicId, trackId: opts.audioTrackId, start: 0, in: r3(origin), out: r3(origin + duration) })
  return { commands, cuts: cuts.slice(0, -1), duration, skipped }
}

/** Aproxima tempos (ex.: marcadores) da batida mais próxima dentro da tolerância. */
export function snapToBeats(times: number[], beats: number[], tolerance = 0.15): number[] {
  return times.map((t) => {
    let best = t
    let dist = tolerance
    for (const b of beats) {
      const d = Math.abs(b - t)
      if (d <= dist) { dist = d; best = b }
    }
    return best
  })
}
