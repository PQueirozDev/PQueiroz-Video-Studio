import type { MediaAnalysis } from './analysis'
import type { Clip, Command } from './composition'
import { findHighlights, keepRanges } from './highlights'
import { valueAt, type AnimProp, type Keyframe } from './keyframes'
import { beatMontage } from './music'
import type { PresetDef, TitleTemplate } from './packs'

// Auto Studio: transforma vídeos (+ música opcional) numa edição pronta, em UM lote de comandos
// (uma etapa de desfazer). Função pura: recebe análises e recursos do Asset Hub, devolve comandos
// que se referem aos clipes criados no próprio lote ("$N" = id criado pelo comando N).

export type AutoStyle = 'gaming' | 'shorts' | 'vlog' | 'cinema'

export const AUTO_STYLES: { id: AutoStyle; name: string; description: string }[] = [
  { id: 'gaming', name: 'Montagem gaming', description: 'Melhores jogadas cortadas na batida, zoom punch e flash nos cortes, whoosh e look forte.' },
  { id: 'shorts', name: 'Shorts dinâmico', description: 'Trechos curtos com movimento de câmera alternado, gancho de texto no começo e cor vibrante.' },
  { id: 'vlog', name: 'Vlog limpo', description: 'Tira silêncios e pausas, mantém a ordem, fades suaves e volume normalizado.' },
  { id: 'cinema', name: 'Cinemático', description: 'Trechos longos com dissolve, barras de cinema, look de filme e título de abertura.' }
]

export interface AutoAssets {
  intro?: TitleTemplate
  /** Movimento nos cortes (ex.: zoom punch). */
  cutMotion?: PresetDef
  /** Acento a cada 4 cortes (ex.: flash). */
  accent?: PresetDef
  /** Movimentos alternados no Shorts (zoom in/out suave). */
  drift?: PresetDef[]
  look?: PresetDef
  /** Id de mídia (já importada no projeto) do whoosh tocado nos cortes. */
  whooshId?: string
  whooshLength?: number
}

export interface AutoInput {
  style: AutoStyle
  /** Análises dos vídeos, na ordem escolhida. */
  videos: MediaAnalysis[]
  music?: { mediaId: string; duration: number; beats: number[]; bpm: number } | null
  /** Duração máxima da edição (s). */
  targetDuration: number
  title?: string
  assets: AutoAssets
  /** Estilo aprendido (Style Memory): ritmo, mixagem e volume da música. */
  pace?: number
  mix?: { normalize: boolean; targetLufs: number; duck?: boolean }
  musicVolume?: number | null
}

export interface AutoPlan {
  commands: Command[]
  duration: number
  clips: number
  notes: string[]
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000

/** Comandos de um preset num clipe (efeitos + keyframes a partir de `at`, cortados no fim do clipe). */
export function presetToCommands(p: PresetDef, clipId: string, clipLength: number, at: number, existing: Clip['keyframes'] = {}): Command[] {
  const cmds: Command[] = []
  for (const e of p.effects ?? []) cmds.push({ type: 'addEffect', clipId, effect: e.type, params: e.params, asset: e.asset })
  if (p.transform) cmds.push({ type: 'setTransform', clipId, transform: p.transform })
  for (const [prop, keys] of Object.entries(p.keyframes ?? {}) as [AnimProp, Keyframe[]][]) {
    if (!keys?.length) continue
    const span = keys[keys.length - 1].t
    const shifted = keys.map((k) => ({ ...k, t: r3(at + k.t) }))
    const placed = shifted.filter((k) => k.t <= clipLength + 0.0005)
    if (!placed.length) continue
    // Preset cortado pelo fim do clipe: grava o valor interpolado no fim (a animação não "some").
    if (placed.length < shifted.length && placed[placed.length - 1].t < clipLength - 0.001) placed.push({ t: r3(clipLength), v: valueAt(shifted, clipLength, shifted[0].v), ease: 'linear' })
    // Animação antiga fora do trecho do preset continua.
    const old = (existing[prop] ?? []).filter((k) => k.t < at - 0.001 || k.t > at + span + 0.001)
    cmds.push({ type: 'setKeyframes', clipId, prop, keyframes: [...old, ...placed].sort((a, b) => a.t - b.t) })
  }
  return cmds
}

interface Placed { ref: string; start: number; len: number; mediaId: string; hasAudio: boolean }

export function planAutoEdit(input: AutoInput): AutoPlan {
  const { style, videos, music, assets } = input
  if (!videos.length) throw new Error('Escolha pelo menos um vídeo para o Auto Studio.')
  const target = Math.min(600, Math.max(5, input.targetDuration || 30))
  const cmds: Command[] = [{ type: 'clearTimeline' }]
  const notes: string[] = []
  const placed: Placed[] = []
  const push = (c: Command): string => {
    cmds.push(c)
    return `$${cmds.length - 1}`
  }
  const hasAudio = (mediaId: string): boolean => videos.find((v) => v.mediaId === mediaId)?.loudness.integrated != null

  // ---------- escolha e posição dos trechos ----------
  if (style === 'vlog') {
    let t = 0
    for (const a of videos) {
      for (const r of keepRanges(a, 0.7, 0.15)) {
        if (t >= target) break
        const len = Math.min(r.end - r.start, target - t)
        if (len < 0.3) continue
        const ref = push({ type: 'addClip', mediaId: a.mediaId, trackId: 'V1', start: r3(t), in: r3(r.start), out: r3(r.start + len) })
        placed.push({ ref, start: t, len, mediaId: a.mediaId, hasAudio: hasAudio(a.mediaId) })
        t = r3(t + len)
      }
    }
    if (music) {
      // Música de fundo baixa, do tamanho da edição, saindo em fade.
      const len = r3(Math.min(music.duration, t))
      if (len >= 0.2) {
        const ref = push({ type: 'addClip', mediaId: music.mediaId, start: 0, in: 0, out: len })
        cmds.push({ type: 'setClipProps', clipId: ref, volume: input.musicVolume ?? 0.3, fadeOut: Math.min(2, len / 3) })
      }
    }
    const kept = placed.reduce((s, p) => s + p.len, 0)
    const total = videos.reduce((s, a) => s + a.duration, 0)
    notes.push(`Silêncios e pausas removidos: ${Math.round(total - kept)} s a menos.`)
  } else {
    const clipLen = input.pace && input.pace >= 0.8 && input.pace <= 15 ? input.pace : style === 'shorts' ? 2.5 : style === 'cinema' ? 5 : 3
    const mode = style === 'gaming' ? 'gameplay' : 'geral'
    const beat = music && music.beats.length > 8 ? 60 / Math.max(60, Math.min(200, music.bpm || 120)) : 0
    // Batidas por clipe: ~1,5 s nos estilos rápidos, ~4 s no cinemático.
    const per = beat ? Math.max(1, Math.round((input.pace && input.pace >= 0.8 && input.pace <= 15 ? input.pace * 0.6 : style === 'cinema' ? 4 : style === 'shorts' ? 1.6 : 1.5) / beat)) : 0
    const pattern = per ? (style === 'gaming' ? [per * 2, per * 2, per, per] : [per]) : []
    const window = beat ? Math.max(...pattern) * beat + 0.4 : clipLen
    const count = Math.min(100, Math.ceil(target / (beat ? (pattern.reduce((a, b) => a + b, 0) / pattern.length) * beat : clipLen)) + 3)
    const highlights = findHighlights(videos, { length: Math.min(120, window), count, mode })
    if (!highlights.length) throw new Error('Não encontrei trechos aproveitáveis nesses vídeos.')
    if (music && beat) {
      const beats = music.beats.filter((b) => b <= music.beats[0] + target + 0.01)
      const m = beatMontage(highlights, beats, music.mediaId, music.duration, { beatsPerClip: per, pattern, videoTrackId: 'V1' })
      for (const c of m.commands) {
        if (c.type !== 'addClip') continue
        const ref = push(c)
        const len = (c.out ?? 0) - (c.in ?? 0)
        if (c.mediaId === music.mediaId) {
          if (input.musicVolume != null) cmds.push({ type: 'setClipProps', clipId: ref, volume: input.musicVolume })
          continue
        }
        placed.push({ ref, start: c.start ?? 0, len, mediaId: c.mediaId, hasAudio: hasAudio(c.mediaId) })
      }
      notes.push(`Cortes sincronizados com a música (${Math.round(music.bpm)} BPM).`)
      if (m.skipped) notes.push(`${m.skipped} trecho(s) curto(s) demais para as batidas ficaram de fora.`)
    } else {
      let t = 0
      for (const h of highlights) {
        if (t >= target - 0.3) break
        const len = Math.min(h.end - h.start, target - t)
        const ref = push({ type: 'addClip', mediaId: h.mediaId, trackId: 'V1', start: r3(t), in: r3(h.start), out: r3(h.start + len) })
        placed.push({ ref, start: t, len, mediaId: h.mediaId, hasAudio: hasAudio(h.mediaId) })
        t = r3(t + len)
      }
      if (music) {
        const ref = push({ type: 'addClip', mediaId: music.mediaId, start: 0, in: 0, out: r3(Math.min(music.duration, t)) })
        if (input.musicVolume != null) cmds.push({ type: 'setClipProps', clipId: ref, volume: input.musicVolume })
        notes.push('A música não teve batidas claras: os cortes seguem os melhores momentos.')
      }
    }
  }
  if (!placed.length) throw new Error('Nada sobrou para montar (vídeos curtos ou silenciosos demais).')
  const duration = r3(Math.max(...placed.map((p) => p.start + p.len)))

  // ---------- cor, movimento e som ----------
  for (const [i, p] of placed.entries()) {
    if (assets.look) cmds.push(...presetToCommands(assets.look, p.ref, p.len, 0))
    if (style === 'cinema') cmds.push({ type: 'addEffect', clipId: p.ref, effect: 'letterbox' })
    if (i > 0 && (style === 'gaming') && assets.cutMotion && i % 2 === 1) cmds.push(...presetToCommands(assets.cutMotion, p.ref, p.len, 0))
    if (i > 0 && style === 'gaming' && assets.accent && i % 4 === 0) cmds.push(...presetToCommands(assets.accent, p.ref, p.len, 0))
    if (style === 'shorts' && assets.drift?.length) cmds.push(...presetToCommands(assets.drift[i % assets.drift.length], p.ref, p.len, 0))
    // Com música, o som do jogo fica por baixo; no vlog a fala é o principal.
    if (music && p.hasAudio && style !== 'vlog') cmds.push({ type: 'setClipProps', clipId: p.ref, volume: style === 'gaming' ? 0.6 : 0.35 })
  }
  // Dissolve entre os trechos do cinemático (sem música: com música os cortes ficam na batida).
  if (style === 'cinema' && !music) {
    // Cada dissolve cabe nos dois clipes vizinhos (e não cruza o dissolve anterior); curto demais = corte seco.
    let prevIn = 0
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1]
      const d = r3(Math.min(0.8, Math.min(prev.len, placed[i].len) - 0.1, prev.len - prevIn - 0.1))
      if (d < 0.2) { prevIn = 0; continue }
      cmds.push({ type: 'setTransition', clipId: placed[i].ref, transition: { type: 'cross-dissolve', duration: d } })
      prevIn = d
    }
  }
  if (style === 'vlog' || style === 'cinema') {
    cmds.push({ type: 'setClipProps', clipId: placed[0].ref, fadeIn: Math.min(0.6, placed[0].len / 3) })
    const last = placed[placed.length - 1]
    cmds.push({ type: 'setClipProps', clipId: last.ref, fadeOut: Math.min(0.8, last.len / 3) })
  }
  // Whoosh um pouco antes dos cortes do gaming (a cada 2 cortes), numa trilha própria.
  if (style === 'gaming' && assets.whooshId) {
    const len = assets.whooshLength ?? 0.5
    const sfxTrack = push({ type: 'addTrack', kind: 'audio', name: 'Efeitos sonoros' })
    let lastEnd = -1
    for (const [i, p] of placed.entries()) {
      if (i % 2 === 0) continue
      const s = r3(Math.max(0, p.start - len * 0.6))
      if (s < lastEnd) continue
      const out = Math.min(len, duration - s)
      if (out < 0.1) continue
      cmds.push({ type: 'addClip', mediaId: assets.whooshId, trackId: sfxTrack, start: s, in: 0, out: r3(out) })
      lastEnd = s + len
    }
  }
  if (input.title?.trim() && assets.intro) {
    const t = assets.intro
    cmds.push({ type: 'addTitle', start: 0, duration: Math.min(t.duration, duration), title: { ...t.style, text: input.title.trim().slice(0, 200) }, keyframes: t.keyframes, fadeIn: t.fadeIn, fadeOut: t.fadeOut })
  }
  cmds.push({ type: 'setMix', mix: { normalize: input.mix?.normalize ?? true, targetLufs: input.mix?.targetLufs ?? -14, duck: input.mix?.duck ?? (Boolean(music) && (style === 'vlog' || style === 'shorts')), duckAmount: 0.6 } })
  notes.push(`${placed.length} trechos, ${Math.round(duration)} s no total.`)
  return { commands: cmds, duration, clips: placed.length, notes }
}
