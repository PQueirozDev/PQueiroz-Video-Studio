import type { AutoStyle } from './autoStudio'
import { clipEnd, clipLength, trackClips, TITLE_MEDIA, type Command, type Composition, type MediaRef, type TitleSpec } from './composition'

// Style Memory: aprende o "jeito de editar" de uma edição pronta (cor, títulos, legendas, ritmo, transições,
// movimento, volumes) e reaplica em outros projetos ou passa para o Auto Studio e o Claude.

export interface StyleEffect { type: string; params: Record<string, number>; asset?: string }

export interface StyleProfile {
  id: string
  name: string
  /** Cliente (Marca) dono do estilo; null = estilo geral. */
  brandId: string | null
  /** Projeto de onde foi aprendido. */
  source: string
  look: StyleEffect[]
  title: Partial<TitleSpec> | null
  captions: Partial<TitleSpec> | null
  pacing: { medianClip: number; cutsPerMinute: number }
  transition: { type: string; duration: number; share: number } | null
  /** Fração dos clipes com zoom/movimento animado. */
  motion: number
  audio: { musicVolume: number | null; normalize: boolean; targetLufs: number; duck: boolean }
  sfxPerMinute: number
  autoStyle: AutoStyle
  /** Instruções livres para o Claude (ex.: "sempre legenda amarela", "nada de transições chamativas"). */
  notes: string
  createdAt: number
  updatedAt: number
}

export type LearnedStyle = Omit<StyleProfile, 'id' | 'name' | 'brandId' | 'source' | 'notes' | 'createdAt' | 'updatedAt'>

const r2 = (v: number): number => Math.round(v * 100) / 100
/** Trilha sonora = clipe de áudio longo (mesma regra para aprender e para aplicar). */
const isMusicBed = (len: number, total: number): boolean => len >= Math.min(10, total * 0.5)
const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
/** Estilo de título sem o texto e sem a posição de cada caso (só a "cara"). */
const titleLook = (t: TitleSpec): Partial<TitleSpec> => {
  const { text: _text, ...rest } = t
  return rest
}

export function learnStyle(doc: Composition, media: Map<string, MediaRef>): LearnedStyle {
  const videoTracks = new Set(doc.tracks.filter((t) => t.kind === 'video').map((t) => t.id))
  const audioTracks = new Set(doc.tracks.filter((t) => t.kind === 'audio').map((t) => t.id))
  const footage = doc.clips.filter((c) => videoTracks.has(c.trackId) && c.mediaId !== TITLE_MEDIA && media.get(c.mediaId)?.kind !== 'image')
  if (!footage.length) throw new Error('A timeline não tem clipes de vídeo para aprender o estilo.')
  const total = Math.max(1, Math.max(...doc.clips.map(clipEnd)))

  // Look: a combinação de efeitos de imagem mais repetida entre os clipes (com os parâmetros do mais comum).
  const counts = new Map<string, { n: number; effects: StyleEffect[] }>()
  for (const c of footage) {
    const effects = c.effects.filter((e) => e.enabled && e.type !== 'mask' && e.type !== 'color-match').map((e) => ({ type: e.type, params: { ...e.params }, ...(e.asset ? { asset: e.asset } : {}) }))
    const key = effects.map((e) => e.type + (e.asset ?? '')).join('|')
    const cur = counts.get(key) ?? { n: 0, effects }
    cur.n++
    counts.set(key, cur)
  }
  const look = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.effects ?? []

  // Títulos e legendas: os da trilha "Legendas" (ou muitos títulos curtos) contam como legenda.
  const titles = doc.clips.filter((c) => c.title)
  const captionTrack = doc.tracks.find((t) => /legenda/i.test(t.name))?.id
  const captions = titles.filter((c) => c.trackId === captionTrack)
  const others = titles.filter((c) => c.trackId !== captionTrack)
  const pick = (list: typeof titles): Partial<TitleSpec> | null => (list.length ? titleLook(list.sort((a, b) => clipLength(b) - clipLength(a))[0].title!) : null)

  // Ritmo: duração mediana dos trechos na trilha principal.
  const main = trackClips(doc, doc.tracks.find((t) => t.kind === 'video')?.id ?? '').filter((c) => !c.title)
  const lens = main.map(clipLength)
  const cuts = Math.max(0, main.length - 1)
  const withTransition = main.filter((c) => c.transitionIn)
  const tCount = new Map<string, number>()
  for (const c of withTransition) tCount.set(c.transitionIn!.type, (tCount.get(c.transitionIn!.type) ?? 0) + 1)
  const topT = [...tCount].sort((a, b) => b[1] - a[1])[0]
  const transition = topT && cuts ? { type: topT[0], duration: r2(median(withTransition.filter((c) => c.transitionIn!.type === topT[0]).map((c) => c.transitionIn!.duration))), share: r2(withTransition.length / cuts) } : null
  const motion = r2(footage.filter((c) => (c.keyframes.zoom?.length ?? 0) > 1 || (c.keyframes.x?.length ?? 0) > 1 || c.transform.zoom > 1.01).length / footage.length)

  // Áudio: volume da música (trilhas de áudio com arquivos longos) e efeitos sonoros curtos.
  const audioClips = doc.clips.filter((c) => audioTracks.has(c.trackId))
  const music = audioClips.filter((c) => isMusicBed(clipLength(c), total))
  const sfx = audioClips.filter((c) => clipLength(c) < 3)
  const medianClip = r2(median(lens))
  const cutsPerMinute = r2((cuts / total) * 60)
  const hasLetterbox = look.some((e) => e.type === 'letterbox')
  const autoStyle: AutoStyle = hasLetterbox || (transition && transition.share > 0.5 && medianClip >= 3.5) ? 'cinema'
    : medianClip <= 2.2 && motion >= 0.3 ? (sfx.length ? 'gaming' : 'shorts')
    : sfx.length && medianClip <= 3.5 ? 'gaming'
    : cutsPerMinute < 8 ? 'vlog' : 'shorts'
  return {
    look, title: pick(others), captions: pick(captions), pacing: { medianClip, cutsPerMinute }, transition, motion,
    audio: { musicVolume: music.length ? r2(median(music.map((c) => c.volume))) : null, normalize: doc.mix.normalize, targetLufs: doc.mix.targetLufs, duck: doc.mix.duck },
    sfxPerMinute: r2((sfx.length / total) * 60), autoStyle
  }
}

/**
 * Comandos para vestir uma edição com o estilo: look nos clipes de vídeo (sem duplicar efeitos já iguais),
 * cara dos títulos e legendas (mantém texto e posição de cada um), volume da música e mixagem.
 */
export function applyStyleCommands(doc: Composition, media: Map<string, MediaRef>, s: Pick<StyleProfile, 'look' | 'title' | 'captions' | 'audio'>): Command[] {
  const cmds: Command[] = []
  const videoTracks = new Set(doc.tracks.filter((t) => t.kind === 'video' && !t.locked).map((t) => t.id))
  const audioTracks = new Set(doc.tracks.filter((t) => t.kind === 'audio' && !t.locked).map((t) => t.id))
  const lookTypes = new Set(s.look.map((e) => e.type))
  for (const c of doc.clips) {
    if (!videoTracks.has(c.trackId) || c.title || media.get(c.mediaId)?.kind === 'audio') continue
    // Troca o look antigo pelo do estilo (efeitos do mesmo tipo saem; máscara e correspondência de cor ficam).
    for (const e of c.effects) if (lookTypes.has(e.type)) cmds.push({ type: 'removeEffect', clipId: c.id, effectId: e.id })
    for (const e of s.look) cmds.push({ type: 'addEffect', clipId: c.id, effect: e.type, params: e.params, ...(e.asset ? { asset: e.asset } : {}) })
  }
  const captionTrack = doc.tracks.find((t) => /legenda/i.test(t.name))?.id
  const keepPlace = ({ x: _x, y: _y, align: _a, ...rest }: Partial<TitleSpec>): Partial<TitleSpec> => rest
  for (const c of doc.clips) {
    if (!c.title || !videoTracks.has(c.trackId)) continue
    const look = c.trackId === captionTrack ? s.captions : s.title
    // Muda só a "cara": posição e alinhamento de cada título/legenda continuam onde estavam.
    if (look) cmds.push({ type: 'updateTitle', clipId: c.id, title: keepPlace(look) })
  }
  if (s.audio.musicVolume != null) {
    const total = Math.max(1, ...doc.clips.map(clipEnd))
    for (const c of doc.clips) if (audioTracks.has(c.trackId) && isMusicBed(clipLength(c), total)) cmds.push({ type: 'setClipProps', clipId: c.id, volume: s.audio.musicVolume })
  }
  cmds.push({ type: 'setMix', mix: { normalize: s.audio.normalize, targetLufs: s.audio.targetLufs, duck: s.audio.duck } })
  return cmds
}

/** Resumo curto do estilo (painel e contexto do Claude). */
export function describeStyle(s: StyleProfile): string {
  const parts = [
    `ritmo: cortes a cada ~${s.pacing.medianClip}s (${s.pacing.cutsPerMinute}/min)`,
    s.look.length ? `look: ${s.look.map((e) => (e.asset ? `${e.type}:${e.asset}` : e.type)).join(' + ')}` : 'sem look de cor',
    s.transition ? `transição: ${s.transition.type} ${s.transition.duration}s em ${Math.round(s.transition.share * 100)}% dos cortes` : 'cortes secos',
    s.motion > 0 ? `movimento em ${Math.round(s.motion * 100)}% dos clipes` : '',
    s.title ? `títulos: fonte ${s.title.font}, cor ${s.title.color}${s.title.uppercase ? ', maiúsculas' : ''}` : '',
    s.captions ? `legendas: fonte ${s.captions.font}, cor ${s.captions.color}, tamanho ${s.captions.size}` : '',
    s.audio.musicVolume != null ? `música a ${Math.round(s.audio.musicVolume * 100)}%` : '',
    s.sfxPerMinute > 0 ? `${s.sfxPerMinute} efeitos sonoros/min` : '',
    s.audio.normalize ? `volume final ${s.audio.targetLufs} LUFS` : ''
  ]
  return parts.filter(Boolean).join('; ')
}
