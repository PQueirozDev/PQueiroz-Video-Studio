import { clipEnd, type Command, type Composition, type TitleSpec } from './composition'
import type { TitleTemplate } from './packs'

// Legendas transcritas (tempos do ARQUIVO) viram títulos na timeline: cada fala aparece onde aquele trecho
// do arquivo está na edição (respeitando cortes, ordem e velocidade). Trechos cortados não geram legenda.

export interface Cue { start: number; end: number; text: string }

const r3 = (v: number): number => Math.round(v * 1000) / 1000
export const MAX_CAPTIONS = 400

export function captionCommands(doc: Composition, mediaId: string, cues: Cue[], template?: TitleTemplate): Command[] {
  const clips = doc.clips
    .filter((c) => c.mediaId === mediaId && !c.title && c.hold <= 0 && doc.tracks.find((t) => t.id === c.trackId)?.kind === 'video')
    .sort((a, b) => a.start - b.start)
  const spans: { start: number; end: number; text: string }[] = []
  for (const c of clips) {
    for (const q of cues) {
      const a = Math.max(q.start, c.in)
      const b = Math.min(q.end, c.out)
      if (b - a < 0.05 || !q.text.trim()) continue
      const start = c.start + (a - c.in) / c.speed
      const end = Math.min(clipEnd(c), c.start + (b - c.in) / c.speed)
      spans.push({ start, end, text: q.text.trim() })
    }
  }
  spans.sort((x, y) => x.start - y.start)
  if (!spans.length) return []
  const style: Partial<TitleSpec> = { ...(template?.style ?? { font: 'poppins-bold', size: 0.06, y: 0.8, outline: 0.1, shadow: 0 }) }
  const cmds: Command[] = [{ type: 'addTrack', kind: 'video', name: 'Legendas' }]
  let last = 0
  for (const s of spans.slice(0, MAX_CAPTIONS)) {
    // Falas encostadas não podem se sobrepor na mesma trilha.
    const start = r3(Math.max(s.start, last))
    const end = r3(s.end)
    if (end - start < 0.1) continue
    cmds.push({ type: 'addTitle', trackId: '$0', start, duration: r3(end - start), title: { ...style, text: s.text.slice(0, 500) }, fadeIn: 0, fadeOut: 0 })
    last = end
  }
  return cmds.length > 1 ? cmds : []
}
