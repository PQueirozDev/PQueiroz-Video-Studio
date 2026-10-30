import { effectById, normalizeParams, transitionById } from './fx'
import { animProp, normalizeKeys, valueAt, type AnimProp, type Keyframe } from './keyframes'

// Documento de composição: a edição de verdade (trilhas, clipes, transições, efeitos, marcadores).
// Os arquivos originais nunca são tocados; tudo aqui é não destrutivo e vira filtros do FFmpeg no render.
// Toda mudança passa por applyCommand(), que valida e devolve um documento novo (base do undo/redo
// e das ferramentas do agente).

export const COMPOSITION_VERSION = 1
export const MIN_CLIP = 0.1
const EPS = 0.002

export type TrackKind = 'video' | 'audio'

/** Modo de mesclagem da trilha sobre as de baixo (overlays de luz usam "screen"). */
export type BlendMode = 'normal' | 'screen' | 'add' | 'lighten' | 'multiply' | 'overlay' | 'softlight'
export const BLEND_MODES: { id: BlendMode; name: string }[] = [
  { id: 'normal', name: 'Normal' }, { id: 'screen', name: 'Tela (screen)' }, { id: 'add', name: 'Adição' }, { id: 'lighten', name: 'Clarear' },
  { id: 'multiply', name: 'Multiplicar' }, { id: 'overlay', name: 'Sobrepor (overlay)' }, { id: 'softlight', name: 'Luz suave' }
]

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  hidden: boolean
  locked: boolean
  blend?: BlendMode
}

/** Clipe de texto (título): gerado pelo motor, sem arquivo. Usa `mediaId = TITLE_MEDIA`. */
export interface TitleSpec {
  text: string
  /** Id da fonte instalada (Asset Hub), ex.: "anton". */
  font: string
  /** Altura da letra em fração da altura do quadro. */
  size: number
  color: string
  /** Âncora do bloco de texto (0–1). Com align "left" é a borda esquerda; "right", a direita. */
  x: number
  y: number
  align: 'left' | 'center' | 'right'
  /** Contorno, em fração do tamanho da letra. */
  outline: number
  outlineColor: string
  /** Sombra, em fração do tamanho da letra. */
  shadow: number
  /** Opacidade da caixa de fundo (0 = sem caixa). */
  box: number
  boxColor: string
  lineSpacing: number
  uppercase: boolean
}

export const TITLE_MEDIA = '__title__'
export const TITLE_REF: MediaRef = { id: TITLE_MEDIA, kind: 'image', duration: null, hasAudio: false }
export const DEFAULT_TITLE: TitleSpec = {
  text: 'Seu título', font: 'poppins-bold', size: 0.09, color: '#ffffff', x: 0.5, y: 0.5, align: 'center',
  outline: 0, outlineColor: '#000000', shadow: 0.04, box: 0, boxColor: '#000000', lineSpacing: 1.15, uppercase: false
}
const HEX = /^#[0-9a-f]{6}$/i
/** Id de fonte/LUT: "item" (pacote essencial) ou "pacote.item" (64 + 1 + 64). */
export const ASSET_ID = /^[\w-]{1,64}(\.[\w-]{1,64})?$/

/** Completa e limita um título (aceita parcial, vindo da interface, de um template ou do agente). */
export function readTitle(raw: unknown, base: TitleSpec = DEFAULT_TITLE): TitleSpec {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const color = (v: unknown, fb: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fb)
  const text = typeof t.text === 'string' ? t.text.replace(/\r\n?/g, '\n').slice(0, 500) : base.text
  return {
    text: text.trim() ? text : base.text,
    font: typeof t.font === 'string' && ASSET_ID.test(t.font) ? t.font : base.font,
    size: clamp(num(t.size, base.size), 0.02, 0.4),
    color: color(t.color, base.color),
    x: clamp(num(t.x, base.x), 0, 1), y: clamp(num(t.y, base.y), 0, 1),
    align: t.align === 'left' || t.align === 'right' || t.align === 'center' ? t.align : base.align,
    outline: clamp(num(t.outline, base.outline), 0, 0.2), outlineColor: color(t.outlineColor, base.outlineColor),
    shadow: clamp(num(t.shadow, base.shadow), 0, 0.15),
    box: clamp(num(t.box, base.box), 0, 1), boxColor: color(t.boxColor, base.boxColor),
    lineSpacing: clamp(num(t.lineSpacing, base.lineSpacing), 0.8, 2.5),
    uppercase: typeof t.uppercase === 'boolean' ? t.uppercase : base.uppercase
  }
}

/** Mídia do clipe: títulos não têm arquivo. */
export const mediaRefOf = (media: Map<string, MediaRef>, c: { mediaId: string }): MediaRef | undefined => (c.mediaId === TITLE_MEDIA ? TITLE_REF : media.get(c.mediaId))

export interface EffectInstance {
  id: string
  type: string
  enabled: boolean
  params: Record<string, number>
  /** Arquivo da biblioteca usado pelo efeito (ex.: id da LUT). */
  asset?: string
}

/** Enquadramento estático do clipe (cada campo também pode ser animado por keyframes). */
export interface Transform {
  /** Deslocamento em fração do quadro (-1 a 1). */
  x: number
  y: number
  /** Tamanho em relação ao quadro (1 = ocupa o quadro; menor = picture-in-picture). */
  scale: number
  rotation: number
  /** Zoom de câmera (≥ 1), centrado em anchorX/anchorY (0–1). */
  zoom: number
  anchorX: number
  anchorY: number
}

export const NEUTRAL_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, zoom: 1, anchorX: 0.5, anchorY: 0.5 }

/** Mixagem final do projeto. */
export interface Mix {
  /** Normaliza o volume final para o alvo (LUFS), como pedem YouTube/Instagram/TikTok. */
  normalize: boolean
  targetLufs: number
  /** Abaixa a música (trilhas de áudio) quando há som nos vídeos (fala, jogo). */
  duck: boolean
  /** 0–1: quanto a música abaixa. */
  duckAmount: number
}

export const DEFAULT_MIX: Mix = { normalize: false, targetLufs: -14, duck: false, duckAmount: 0.6 }

export interface TransitionRef {
  type: string
  duration: number
}

export interface Clip {
  id: string
  trackId: string
  mediaId: string
  /** Posição na timeline (s). */
  start: number
  /** Trecho usado do arquivo (s). Para imagens, `in` é 0 e `out` é a duração exibida. */
  in: number
  out: number
  volume: number
  opacity: number
  fadeIn: number
  fadeOut: number
  /** Transição a partir do clipe anterior da mesma trilha; os dois se sobrepõem por `duration`. */
  transitionIn: TransitionRef | null
  effects: EffectInstance[]
  transform: Transform
  /** Velocidade (0,1 a 8; 0,5 = câmera lenta). O trecho do arquivo dura (out - in) / speed na timeline. */
  speed: number
  /** > 0: congela o quadro em `in` por esse tempo (freeze frame). */
  hold: number
  /** Animações (tempo relativo ao início do clipe). Sobrepõem o valor estático da mesma propriedade. */
  keyframes: Partial<Record<AnimProp, Keyframe[]>>
  /** Clipes do mesmo grupo se movem juntos (ex.: os degraus de uma rampa de velocidade). */
  group?: string
  /** Só em títulos (mediaId = TITLE_MEDIA). */
  title?: TitleSpec
}

export interface Marker {
  id: string
  time: number
  label: string
}

export interface Composition {
  version: number
  /** 'legacy' = derivada da timeline simples (ordem/cortes dos arquivos); 'manual' = editada por comandos. */
  origin: 'legacy' | 'manual'
  tracks: Track[]
  clips: Clip[]
  markers: Marker[]
  mix: Mix
}

/** O que a validação precisa saber de cada mídia do projeto. */
export interface MediaRef {
  id: string
  kind: 'video' | 'audio' | 'image'
  duration: number | null
  hasAudio: boolean
}

export type Command =
  | { type: 'addTrack'; kind: TrackKind; name?: string }
  | { type: 'updateTrack'; trackId: string; name?: string; muted?: boolean; hidden?: boolean; locked?: boolean; blend?: BlendMode }
  | { type: 'removeTrack'; trackId: string }
  | { type: 'addClip'; mediaId: string; trackId?: string; start?: number; in?: number; out?: number }
  | { type: 'moveClip'; clipId: string; start: number; trackId?: string }
  | { type: 'trimClip'; clipId: string; in?: number; out?: number; ripple?: boolean }
  | { type: 'splitClip'; clipId: string; at: number }
  | { type: 'removeClip'; clipId: string; ripple?: boolean }
  | { type: 'setClipProps'; clipId: string; volume?: number; opacity?: number; fadeIn?: number; fadeOut?: number }
  | { type: 'setTransition'; clipId: string; transition: { type: string; duration?: number } | null }
  | { type: 'addEffect'; clipId: string; effect: string; params?: Record<string, number>; asset?: string }
  | { type: 'updateEffect'; clipId: string; effectId: string; params?: Record<string, number>; enabled?: boolean }
  | { type: 'removeEffect'; clipId: string; effectId: string }
  | { type: 'addMarker'; time: number; label?: string }
  | { type: 'removeMarker'; markerId: string }
  /** Tira todos os clipes e marcadores das trilhas desbloqueadas (para remontar do zero). */
  | { type: 'clearTimeline' }
  | { type: 'setTransform'; clipId: string; transform: Partial<Transform> }
  /** Substitui a animação de uma propriedade (lista vazia ou null remove). */
  | { type: 'setKeyframes'; clipId: string; prop: AnimProp; keyframes: Keyframe[] | null }
  /** Cria ou troca um keyframe no tempo `t` (s dentro do clipe). */
  | { type: 'addKeyframe'; clipId: string; prop: AnimProp; t: number; v: number; ease?: Keyframe['ease'] }
  /** Copia efeitos/animações/enquadramento de um clipe para outros. */
  | { type: 'pasteAttributes'; fromClipId: string; toClipIds: string[]; effects?: boolean; keyframes?: boolean; transform?: boolean }
  | { type: 'setMix'; mix: Partial<Mix> }
  /** Muda a velocidade do clipe inteiro; com ripple (padrão) os seguintes andam junto. */
  | { type: 'setSpeed'; clipId: string; speed: number; ripple?: boolean }
  /** Câmera lenta (ou acelerada) só no trecho [from, to] da timeline, com rampa suave nas bordas. */
  | { type: 'speedRamp'; clipId: string; from: number; to: number; speed: number; smooth?: boolean }
  /** Congela o quadro no ponto `at` por `duration` s (os seguintes andam para dar espaço). */
  | { type: 'freezeFrame'; clipId: string; at: number; duration: number }
  /** Slip: troca o trecho do arquivo mostrado sem mudar posição nem duração na timeline (delta em s do arquivo). */
  | { type: 'slipClip'; clipId: string; delta: number }
  | { type: 'groupClips'; clipIds: string[] }
  | { type: 'ungroupClips'; clipIds: string[] }
  /** Título (texto gerado). Sem trilha: usa a trilha de vídeo mais alta livre no intervalo, ou cria uma. */
  | { type: 'addTitle'; trackId?: string; start?: number; duration?: number; title?: Partial<TitleSpec>; keyframes?: Clip['keyframes']; fadeIn?: number; fadeOut?: number }
  | { type: 'updateTitle'; clipId: string; title: Partial<TitleSpec> }
  /** Desloca no tempo tudo o que começa em `from` ou depois (todas as trilhas desbloqueadas e marcadores), mantendo transições. */
  | { type: 'shiftTime'; from: number; delta: number }

export const COMMAND_TYPES: Command['type'][] = ['addTrack', 'updateTrack', 'removeTrack', 'addClip', 'moveClip', 'trimClip', 'splitClip', 'removeClip', 'setClipProps', 'setTransition', 'addEffect', 'updateEffect', 'removeEffect', 'addMarker', 'removeMarker', 'clearTimeline', 'setTransform', 'setKeyframes', 'addKeyframe', 'pasteAttributes', 'setMix', 'setSpeed', 'speedRamp', 'freezeFrame', 'slipClip', 'groupClips', 'ungroupClips', 'addTitle', 'updateTitle', 'shiftTime']

export const MIN_SPEED = 0.1
export const MAX_SPEED = 8
/** Duração na timeline (considera velocidade e freeze frame). */
export const clipLength = (c: Clip): number => (c.hold > 0 ? c.hold : (c.out - c.in) / (c.speed || 1))
/** Converte um intervalo da timeline (s) em intervalo do arquivo. */
export const toSource = (c: Clip, timelineSeconds: number): number => (c.hold > 0 ? 0 : timelineSeconds * (c.speed || 1))
export const clipEnd = (c: Clip): number => c.start + clipLength(c)
export const compositionDuration = (doc: Composition): number => doc.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
const r3 = (v: number): number => Math.round(v * 1000) / 1000

export function emptyComposition(): Composition {
  return {
    version: COMPOSITION_VERSION,
    origin: 'manual',
    tracks: [
      { id: 'V1', kind: 'video', name: 'Vídeo 1', muted: false, hidden: false, locked: false },
      { id: 'A1', kind: 'audio', name: 'Áudio 1', muted: false, hidden: false, locked: false }
    ],
    clips: [],
    markers: [],
    mix: { ...DEFAULT_MIX }
  }
}

export function trackClips(doc: Composition, trackId: string): Clip[] {
  return doc.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start)
}

// ---------- leitura segura (arquivos antigos, corrompidos ou vindos do agente) ----------

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const bool = (v: unknown): boolean => v === true
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.slice(0, 200) : fallback)
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

/** Documento salvo por uma versão mais nova do app: não é corrupção, e nunca deve ser sobrescrito. */
export class UnsupportedVersionError extends Error {}

/**
 * Converte qualquer JSON para uma composição atual. Lança erro se o documento for de uma versão
 * mais nova (não sabemos ler) ou se não tiver a estrutura mínima.
 */
export function migrateComposition(raw: unknown): Composition {
  if (!raw || typeof raw !== 'object') throw new Error('Composição inválida.')
  const o = raw as Record<string, unknown>
  const version = num(o.version, 1)
  if (version > COMPOSITION_VERSION) throw new UnsupportedVersionError(`Esta composição foi criada por uma versão mais nova do app (formato ${version}).`)
  if (!Array.isArray(o.tracks) || !Array.isArray(o.clips)) throw new Error('Composição sem trilhas ou clipes.')
  const tracks: Track[] = o.tracks.map((t: Record<string, unknown>) => ({
    id: str(t.id), kind: t.kind === 'audio' ? 'audio' : 'video', name: str(t.name, 'Trilha'),
    muted: bool(t.muted), hidden: bool(t.hidden), locked: bool(t.locked),
    ...(BLEND_MODES.some((b) => b.id === t.blend) && t.blend !== 'normal' ? { blend: t.blend as BlendMode } : {})
  }))
  const clips: Clip[] = o.clips.map((c: Record<string, unknown>) => ({
    id: str(c.id), trackId: str(c.trackId), mediaId: str(c.mediaId),
    start: num(c.start, 0), in: num(c.in, 0), out: num(c.out, 0),
    volume: clamp(num(c.volume, 1), 0, 2), opacity: clamp(num(c.opacity, 1), 0, 1),
    fadeIn: Math.max(0, num(c.fadeIn, 0)), fadeOut: Math.max(0, num(c.fadeOut, 0)),
    transitionIn: c.transitionIn && typeof c.transitionIn === 'object'
      ? { type: str((c.transitionIn as Record<string, unknown>).type), duration: num((c.transitionIn as Record<string, unknown>).duration, 0.5) }
      : null,
    effects: Array.isArray(c.effects)
      ? c.effects.map((e: Record<string, unknown>) => ({ id: str(e.id), type: str(e.type), enabled: e.enabled !== false, params: (e.params && typeof e.params === 'object' ? e.params : {}) as Record<string, number>, ...(typeof e.asset === 'string' ? { asset: str(e.asset) } : {}) }))
      : [],
    transform: readTransform(c.transform),
    speed: clamp(num(c.speed, 1), MIN_SPEED, MAX_SPEED),
    hold: Math.max(0, num(c.hold, 0)),
    keyframes: (c.keyframes && typeof c.keyframes === 'object' ? c.keyframes : {}) as Clip['keyframes'],
    ...(typeof c.group === 'string' && c.group ? { group: str(c.group, '').slice(0, 40) } : {}),
    ...(c.mediaId === TITLE_MEDIA ? { title: readTitle(c.title) } : {})
  }))
  const markers: Marker[] = Array.isArray(o.markers)
    ? o.markers.map((m: Record<string, unknown>) => ({ id: str(m.id), time: Math.max(0, num(m.time, 0)), label: str(m.label) }))
    : []
  const mx = (o.mix && typeof o.mix === 'object' ? o.mix : {}) as Record<string, unknown>
  const mix: Mix = {
    normalize: bool(mx.normalize), targetLufs: clamp(num(mx.targetLufs, DEFAULT_MIX.targetLufs), -24, -9),
    duck: bool(mx.duck), duckAmount: clamp(num(mx.duckAmount, DEFAULT_MIX.duckAmount), 0, 1)
  }
  return { version: COMPOSITION_VERSION, origin: o.origin === 'legacy' ? 'legacy' : 'manual', tracks, clips, markers, mix }
}

function readTransform(raw: unknown): Transform {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    x: clamp(num(t.x, 0), -1, 1), y: clamp(num(t.y, 0), -1, 1), scale: clamp(num(t.scale, 1), 0.05, 1),
    rotation: clamp(num(t.rotation, 0), -360, 360), zoom: clamp(num(t.zoom, 1), 1, 4),
    anchorX: clamp(num(t.anchorX, 0.5), 0, 1), anchorY: clamp(num(t.anchorY, 0.5), 0, 1)
  }
}

/** Divide os keyframes no ponto `at` (s dentro do clipe), mantendo o valor exato no corte dos dois lados. */
export function splitKeyframes(keys: Clip['keyframes'], at: number): { left: Clip['keyframes']; right: Clip['keyframes'] } {
  const left: Clip['keyframes'] = {}
  const right: Clip['keyframes'] = {}
  for (const [prop, list] of Object.entries(keys) as [AnimProp, Keyframe[]][]) {
    if (!list?.length) continue
    const v = valueAt(list, at, list[0].v)
    const before = list.filter((k) => k.t < at - 0.0005)
    const after = list.filter((k) => k.t > at + 0.0005)
    const easeAt = (before[before.length - 1] ?? list[0]).ease
    left[prop] = [...before, { t: r3(at), v, ease: easeAt }]
    right[prop] = [{ t: 0, v, ease: easeAt }, ...after.map((k) => ({ ...k, t: r3(k.t - at) }))]
  }
  return { left, right }
}

/**
 * Trecho [from, from+len] de uma lista de keyframes, com tempos relativos a `from`.
 * Onde a animação continuava além das bordas, grava o valor interpolado na borda (a curva visível não muda).
 */
function windowKeys(list: Keyframe[], from: number, len: number): Keyframe[] {
  let out = list.map((k) => ({ ...k, t: k.t - from }))
  if (out.some((k) => k.t < -0.0005)) {
    const spanning = list.filter((k) => k.t < from - 0.0005).at(-1)!
    out = [{ t: 0, v: valueAt(list, from, list[0].v), ease: spanning.ease }, ...out.filter((k) => k.t > 0.0005)]
  }
  if (out.some((k) => k.t > len + 0.0005)) {
    const v = valueAt(out, len, out[0].v)
    out = [...out.filter((k) => k.t < len - 0.0005), { t: len, v, ease: 'linear' }]
  }
  return out.map((k) => ({ ...k, t: r3(k.t) }))
}

/** Desloca os keyframes (ex.: depois de cortar o início, para continuarem presos ao mesmo conteúdo). */
function shiftKeyframes(c: Clip, delta: number): void {
  for (const prop of Object.keys(c.keyframes) as AnimProp[]) {
    const def = animProp(prop)
    if (!def) continue
    const list = c.keyframes[prop] ?? []
    const keys = list.length ? normalizeKeys(def, windowKeys(list, -delta, clipLength(c)), clipLength(c)) : []
    if (keys.length) c.keyframes[prop] = keys
    else delete c.keyframes[prop]
  }
}

/** Lança um erro legível se o documento não for executável pelo motor. */
export function validateComposition(doc: Composition, media: Map<string, MediaRef>): void {
  const ids = new Set<string>()
  const unique = (id: string, what: string): void => {
    if (!id) throw new Error(`${what} sem identificador.`)
    if (ids.has(id)) throw new Error(`Identificador repetido: ${id}.`)
    ids.add(id)
  }
  for (const t of doc.tracks) unique(t.id, 'Trilha')
  for (const c of doc.clips) {
    unique(c.id, 'Clipe')
    const track = doc.tracks.find((t) => t.id === c.trackId)
    if (!track) throw new Error(`O clipe ${c.id} está numa trilha que não existe.`)
    const m = mediaRefOf(media, c)
    if (!m) throw new Error(`O clipe ${c.id} usa um arquivo que não está no projeto.`)
    if (c.mediaId === TITLE_MEDIA) c.title = readTitle(c.title)
    if ((m.kind === 'audio') !== (track.kind === 'audio')) throw new Error(`"${track.name}" não aceita esse tipo de arquivo.`)
    if (c.start < -EPS || c.in < -EPS) throw new Error(`O clipe ${c.id} começa antes do zero.`)
    if (clipLength(c) < MIN_CLIP - EPS) throw new Error(`O clipe ${c.id} ficou curto demais (mínimo ${MIN_CLIP} s).`)
    if (m.kind !== 'image' && m.duration != null && c.out > m.duration + 0.05) throw new Error(`O clipe ${c.id} passa do fim do arquivo.`)
    if (c.fadeIn + c.fadeOut > clipLength(c) + EPS) throw new Error(`Os fades do clipe ${c.id} são maiores que o próprio clipe.`)
    for (const e of c.effects) {
      unique(e.id, 'Efeito')
      const def = effectById(e.type)
      if (!def) throw new Error(`Efeito desconhecido: ${e.type}.`)
      if ((def.kind ?? 'video') === 'video' && track.kind !== 'video') throw new Error(`"${def.name}" é um efeito de imagem e só vale em trilhas de vídeo.`)
      if (def.kind === 'audio' && (m.kind === 'image' || !m.hasAudio)) throw new Error(`"${def.name}" precisa de um clipe com som.`)
      if (def.asset && (!e.asset || !ASSET_ID.test(e.asset))) throw new Error(`"${def.name}" precisa de um arquivo da biblioteca.`)
      e.params = normalizeParams(def, e.params)
    }
    c.transform = readTransform(c.transform)
    for (const prop of Object.keys(c.keyframes ?? {})) {
      const def = animProp(prop)
      if (!def) throw new Error(`Propriedade animável desconhecida: ${prop}.`)
      if (track.kind === 'audio' && prop !== 'volume') throw new Error('Em trilhas de áudio só o volume pode ser animado.')
      const keys = normalizeKeys(def, c.keyframes[prop as AnimProp], clipLength(c))
      if (keys.length) c.keyframes[prop as AnimProp] = keys
      else delete c.keyframes[prop as AnimProp]
    }
  }
  for (const t of doc.tracks) {
    const list = trackClips(doc, t.id)
    list.forEach((c, i) => {
      const prev = list[i - 1]
      if (c.transitionIn) {
        if (t.kind !== 'video') throw new Error('Transições só valem em trilhas de vídeo.')
        if (!transitionById(c.transitionIn.type)) throw new Error(`Transição desconhecida: ${c.transitionIn.type}.`)
        if (!prev) throw new Error(`O clipe ${c.id} tem transição, mas não há clipe antes dele.`)
        const d = c.transitionIn.duration
        if (d < 0.05 || d > Math.min(clipLength(prev), clipLength(c)) - 0.05) throw new Error(`A transição do clipe ${c.id} é longa demais para os clipes.`)
        if (Math.abs(clipEnd(prev) - d - c.start) > 0.01) throw new Error(`O clipe ${c.id} precisa sobrepor o anterior exatamente pela duração da transição.`)
        // Duas transições seguidas não podem se cruzar dentro do clipe do meio.
        if ((prev.transitionIn?.duration ?? 0) + d > clipLength(prev) - 0.05) throw new Error(`As transições em volta do clipe ${prev.id} se sobrepõem; encurte uma delas.`)
      } else if (prev && c.start < clipEnd(prev) - EPS) {
        throw new Error(`Os clipes ${prev.id} e ${c.id} se sobrepõem na trilha "${t.name}".`)
      }
    })
  }
  for (const m of doc.markers) unique(m.id, 'Marcador')
}

/** Remove transições que perderam o clipe anterior ou a sobreposição exata. */
export function dropBrokenTransitions(doc: Composition): void {
  for (const t of doc.tracks) {
    const list = trackClips(doc, t.id)
    list.forEach((c, i) => {
      if (!c.transitionIn) return
      const prev = list[i - 1]
      if (!prev || Math.abs(clipEnd(prev) - c.transitionIn.duration - c.start) > 0.01) c.transitionIn = null
    })
  }
}

/**
 * Tira os clipes cujo arquivo foi removido do projeto (e as transições que dependiam deles).
 * Devolve quantos clipes saíram; o documento original não é alterado.
 */
export function pruneMissingMedia(doc: Composition, media: Map<string, MediaRef>): { doc: Composition; removed: number } {
  const missing = doc.clips.filter((c) => !mediaRefOf(media, c))
  if (!missing.length) return { doc, removed: 0 }
  const out = structuredClone(doc)
  out.clips = out.clips.filter((c) => mediaRefOf(media, c))
  dropBrokenTransitions(out)
  return { doc: out, removed: missing.length }
}

/** Valida só a estrutura (ids, trilhas, sobreposições), aceitando arquivos que não estão mais no projeto. */
export function validateStructure(doc: Composition, media: Map<string, MediaRef>): void {
  const all = new Map(media)
  for (const c of doc.clips) {
    if (all.has(c.mediaId) || c.mediaId === TITLE_MEDIA) continue
    const kind = doc.tracks.find((t) => t.id === c.trackId)?.kind === 'audio' ? 'audio' : 'video'
    all.set(c.mediaId, { id: c.mediaId, kind, duration: null, hasAudio: true })
  }
  validateComposition(doc, all)
}

// ---------- comandos ----------

const REF_FIELDS = ['clipId', 'fromClipId', 'trackId', 'effectId', 'markerId'] as const
const REF_LISTS = ['clipIds', 'toClipIds'] as const

/**
 * Num lote de comandos, um id "$N" vira o id criado pelo comando N do mesmo lote (0 = primeiro).
 * Assim o agente e o Auto Studio montam "cria o clipe e aplica o efeito nele" numa edição só.
 */
export function resolveRefs(cmd: Command, created: (string | undefined)[]): Command {
  if (!cmd || typeof cmd !== 'object') return cmd
  const fix = (v: unknown): unknown => {
    if (typeof v !== 'string') return v
    const m = /^\$(\d+)$/.exec(v)
    if (!m) return v
    const id = created[Number(m[1])]
    if (Number(m[1]) >= created.length) throw new Error(`"${v}" aponta para um comando que ainda não rodou.`)
    if (!id) throw new Error(`O comando ${Number(m[1]) + 1} não criou nada para "${v}" usar.`)
    return id
  }
  const out = { ...cmd } as Record<string, unknown>
  for (const f of REF_FIELDS) if (f in out) out[f] = fix(out[f])
  for (const f of REF_LISTS) if (Array.isArray(out[f])) out[f] = (out[f] as unknown[]).map(fix)
  return out as unknown as Command
}

export interface CommandContext {
  media: Map<string, MediaRef>
  newId(prefix: string): string
}

export interface CommandResult {
  doc: Composition
  /** Id criado pelo comando (clipe, trilha, efeito, marcador), útil para o agente encadear ações. */
  createdId?: string
}

function finite(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} precisa ser um número.`)
  return v
}

/** Desloca os clipes da trilha que começam em `from` ou depois. */
function shiftAfter(doc: Composition, trackId: string, from: number, delta: number, except?: string): void {
  if (Math.abs(delta) < EPS) return
  for (const c of doc.clips) {
    if (c.trackId === trackId && c.id !== except && c.start >= from - EPS) c.start = r3(Math.max(0, c.start + delta))
  }
}

export function applyCommand(input: Composition, cmd: Command, ctx: CommandContext): CommandResult {
  if (!cmd || typeof cmd !== 'object' || !COMMAND_TYPES.includes(cmd.type)) throw new Error('Comando de edição desconhecido.')
  const doc: Composition = structuredClone(input)
  doc.origin = 'manual'
  let createdId: string | undefined

  const track = (id: string | undefined): Track => {
    const t = doc.tracks.find((x) => x.id === id)
    if (!t) throw new Error(`Trilha não encontrada: ${id}.`)
    return t
  }
  const editable = (t: Track): Track => {
    if (t.locked) throw new Error(`A trilha "${t.name}" está bloqueada.`)
    return t
  }
  const clip = (id: string): Clip => {
    const c = doc.clips.find((x) => x.id === id)
    if (!c) throw new Error(`Clipe não encontrado: ${id}.`)
    editable(track(c.trackId))
    return c
  }
  const mediaOf = (c: Clip): MediaRef => {
    const m = mediaRefOf(ctx.media, c)
    if (!m) throw new Error('Arquivo do clipe não está no projeto.')
    return m
  }

  switch (cmd.type) {
    case 'addTrack': {
      const kind: TrackKind = cmd.kind === 'audio' ? 'audio' : 'video'
      const count = doc.tracks.filter((t) => t.kind === kind).length + 1
      const prefix = kind === 'video' ? 'V' : 'A'
      let id = `${prefix}${count}`
      while (doc.tracks.some((t) => t.id === id)) id = ctx.newId(prefix)
      doc.tracks.push({ id, kind, name: str(cmd.name) || `${kind === 'video' ? 'Vídeo' : 'Áudio'} ${count}`, muted: false, hidden: false, locked: false })
      createdId = id
      break
    }
    case 'updateTrack': {
      const t = track(cmd.trackId)
      if (cmd.name !== undefined) t.name = str(cmd.name) || t.name
      if (cmd.muted !== undefined) t.muted = Boolean(cmd.muted)
      if (cmd.hidden !== undefined) t.hidden = Boolean(cmd.hidden)
      if (cmd.locked !== undefined) t.locked = Boolean(cmd.locked)
      if (cmd.blend !== undefined) {
        if (!BLEND_MODES.some((b) => b.id === cmd.blend)) throw new Error('Modo de mesclagem desconhecido.')
        if (t.kind !== 'video') throw new Error('Mesclagem só vale em trilhas de vídeo.')
        if (cmd.blend === 'normal') delete t.blend
        else t.blend = cmd.blend
      }
      break
    }
    case 'removeTrack': {
      const t = editable(track(cmd.trackId))
      if (doc.tracks.filter((x) => x.kind === t.kind).length === 1) throw new Error('O projeto precisa de pelo menos uma trilha desse tipo.')
      doc.tracks = doc.tracks.filter((x) => x.id !== t.id)
      doc.clips = doc.clips.filter((c) => c.trackId !== t.id)
      break
    }
    case 'addClip': {
      const m = ctx.media.get(cmd.mediaId)
      if (!m) throw new Error('Arquivo não encontrado no projeto.')
      const kind: TrackKind = m.kind === 'audio' ? 'audio' : 'video'
      const t = editable(cmd.trackId ? track(cmd.trackId) : doc.tracks.find((x) => x.kind === kind) ?? track(undefined))
      const a = cmd.in === undefined ? 0 : finite(cmd.in, 'Início do trecho')
      const fallbackLen = m.kind === 'image' ? 3 : (m.duration ?? 0) - a
      const b = cmd.out === undefined ? a + fallbackLen : finite(cmd.out, 'Fim do trecho')
      const start = cmd.start === undefined ? trackClips(doc, t.id).reduce((e, c) => Math.max(e, clipEnd(c)), 0) : finite(cmd.start, 'Posição')
      createdId = ctx.newId('c')
      doc.clips.push({ id: createdId, trackId: t.id, mediaId: m.id, start: r3(start), in: r3(m.kind === 'image' ? 0 : a), out: r3(m.kind === 'image' ? b - a : b), volume: 1, opacity: 1, fadeIn: 0, fadeOut: 0, transitionIn: null, effects: [], transform: { ...NEUTRAL_TRANSFORM }, speed: 1, hold: 0, keyframes: {} })
      break
    }
    case 'moveClip': {
      const c = clip(cmd.clipId)
      const members = c.group ? doc.clips.filter((x) => x.group === c.group) : [c]
      for (const x of members) editable(track(x.trackId))
      // O grupo anda junto e nunca passa do zero.
      const delta = Math.max(finite(cmd.start, 'Posição') - c.start, -Math.min(...members.map((x) => x.start)))
      if (cmd.trackId && cmd.trackId !== c.trackId) {
        const to = editable(track(cmd.trackId))
        if (members.some((x) => x.trackId !== c.trackId)) throw new Error('Este grupo tem clipes em trilhas diferentes; mova-os sem trocar de trilha.')
        if (to.kind !== track(c.trackId).kind) throw new Error('Clipes de vídeo e de áudio ficam em trilhas do próprio tipo.')
        for (const x of members) x.trackId = to.id
      }
      const first = members.reduce((a, b) => (b.start < a.start ? b : a))
      for (const x of members) x.start = r3(Math.max(0, x.start + delta))
      first.transitionIn = null // mover desfaz a sobreposição com o clipe de fora; as do grupo continuam
      dropBrokenTransitions(doc) // na trilha de origem e na de destino
      break
    }
    case 'addTitle': {
      const len = clamp(cmd.duration === undefined ? 3 : finite(cmd.duration, 'Duração'), MIN_CLIP, 600)
      const start = Math.max(0, cmd.start === undefined ? 0 : finite(cmd.start, 'Posição'))
      // Automático: só trilha visível e em mesclagem normal (em "multiply" um texto branco sumiria).
      const free = (t: Track): boolean => !t.locked && !t.hidden && (t.blend ?? 'normal') === 'normal' && trackClips(doc, t.id).every((x) => clipEnd(x) <= start + EPS || x.start >= start + len - EPS)
      let t: Track
      if (cmd.trackId) {
        t = editable(track(cmd.trackId))
        if (t.kind !== 'video') throw new Error('Títulos vão em trilhas de vídeo.')
      } else {
        // A trilha de vídeo mais de cima (que não seja a principal) livre no intervalo; senão, uma nova por cima.
        const main = doc.tracks.find((x) => x.kind === 'video')?.id
        const found = [...doc.tracks].reverse().find((x) => x.kind === 'video' && x.id !== main && free(x))
        if (found) t = found
        else {
          let id = `V${doc.tracks.filter((x) => x.kind === 'video').length + 1}`
          while (doc.tracks.some((x) => x.id === id)) id = ctx.newId('V')
          t = { id, kind: 'video', name: 'Títulos', muted: false, hidden: false, locked: false }
          const lastVideo = doc.tracks.map((x) => x.kind).lastIndexOf('video')
          doc.tracks.splice(lastVideo + 1, 0, t)
        }
      }
      createdId = ctx.newId('c')
      const c: Clip = { id: createdId, trackId: t.id, mediaId: TITLE_MEDIA, start: r3(start), in: 0, out: r3(len), volume: 1, opacity: 1,
        fadeIn: clamp(num(cmd.fadeIn, 0), 0, len / 2), fadeOut: clamp(num(cmd.fadeOut, 0), 0, len / 2), transitionIn: null, effects: [],
        transform: { ...NEUTRAL_TRANSFORM }, speed: 1, hold: 0, keyframes: {}, title: readTitle(cmd.title) }
      for (const [prop, list] of Object.entries(cmd.keyframes ?? {}) as [AnimProp, Keyframe[]][]) {
        const def = animProp(prop)
        if (!def) throw new Error(`Propriedade animável desconhecida: ${prop}.`)
        const keys = normalizeKeys(def, list, len)
        if (keys.length) c.keyframes[prop] = keys
      }
      doc.clips.push(c)
      break
    }
    case 'shiftTime': {
      const from = finite(cmd.from, 'Início')
      const delta = finite(cmd.delta, 'Deslocamento')
      const locked = new Set(doc.tracks.filter((t) => t.locked).map((t) => t.id))
      const moving = doc.clips.filter((c) => c.start >= from - EPS)
      if (moving.some((c) => locked.has(c.trackId))) throw new Error('Há clipes em trilhas bloqueadas depois desse ponto; desbloqueie para deslocar.')
      if (moving.some((c) => c.start + delta < -EPS)) throw new Error('O deslocamento passaria do início da timeline.')
      for (const c of moving) c.start = r3(Math.max(0, c.start + delta))
      for (const m of doc.markers) if (m.time >= from - EPS) m.time = r3(Math.max(0, m.time + delta))
      dropBrokenTransitions(doc)
      break
    }
    case 'updateTitle': {
      const c = clip(cmd.clipId)
      if (c.mediaId !== TITLE_MEDIA || !c.title) throw new Error('Este clipe não é um título.')
      c.title = readTitle({ ...c.title, ...(cmd.title ?? {}) }, c.title)
      break
    }
    case 'slipClip': {
      const c = clip(cmd.clipId)
      const m = mediaOf(c)
      if (m.kind === 'image' || c.hold > 0) throw new Error('Slip só vale para vídeo e áudio em movimento.')
      const len = c.out - c.in
      const max = (m.duration ?? c.out) - len
      const a = clamp(c.in + finite(cmd.delta, 'Deslocamento'), 0, Math.max(0, max))
      c.in = r3(a)
      c.out = r3(a + len)
      break
    }
    case 'groupClips': {
      const ids = [...new Set(Array.isArray(cmd.clipIds) ? cmd.clipIds : [])]
      if (ids.length < 2) throw new Error('Selecione pelo menos dois clipes para agrupar.')
      createdId = ctx.newId('g')
      for (const id of ids) clip(id).group = createdId
      break
    }
    case 'ungroupClips': {
      const groups = new Set((Array.isArray(cmd.clipIds) ? cmd.clipIds : []).map((id) => clip(id).group).filter(Boolean))
      const members = doc.clips.filter((x) => x.group && groups.has(x.group))
      for (const x of members) editable(track(x.trackId)) // nada muda se algum membro estiver em trilha bloqueada
      for (const x of members) delete x.group
      break
    }
    case 'trimClip': {
      const c = clip(cmd.clipId)
      const m = mediaOf(c)
      const oldStart = c.start
      const oldLen = clipLength(c)
      // Os seguintes na ordem da trilha (inclui um que sobrepõe este por causa de transição).
      const after = trackClips(doc, c.trackId).filter((x) => x.id !== c.id && x.start > oldStart + EPS)
      if (cmd.in !== undefined) {
        let a = finite(cmd.in, 'Início do corte')
        if (m.kind === 'image') throw new Error('Imagens não têm início para cortar; ajuste o fim.')
        // Sem ripple o conteúdo fica parado na timeline (o início anda); com ripple o clipe fica no lugar e os seguintes andam.
        if (c.hold > 0) throw new Error('No freeze frame, ajuste só a duração.')
        // Sem ripple o início não pode ir antes do zero da timeline (o fim ficaria fora do lugar).
        if (!cmd.ripple) a = Math.max(a, c.in - c.start * c.speed)
        if (!cmd.ripple) c.start = r3(Math.max(0, c.start + (a - c.in) / c.speed))
        const delta = (c.in - a) / c.speed
        c.in = r3(a)
        shiftKeyframes(c, delta) // a animação continua presa ao mesmo trecho do vídeo
      }
      if (cmd.out !== undefined) {
        // No freeze frame o "fim" é a duração do congelamento.
        if (c.hold > 0) c.hold = r3(Math.max(MIN_CLIP, finite(cmd.out, 'Duração') - c.in))
        else c.out = r3(finite(cmd.out, 'Fim do corte'))
      }
      shiftKeyframes(c, 0) // descarta keyframes que ficaram depois do novo fim
      if (cmd.ripple) {
        const delta = clipLength(c) - oldLen
        for (const x of after) x.start = r3(Math.max(0, x.start + delta))
      }
      break
    }
    case 'splitClip': {
      const c = clip(cmd.clipId)
      const at = finite(cmd.at, 'Ponto de corte')
      if (at <= c.start + MIN_CLIP || at >= clipEnd(c) - MIN_CLIP) throw new Error('O ponto de corte precisa estar dentro do clipe.')
      const offset = at - c.start
      createdId = ctx.newId('c')
      const parts = splitKeyframes(c.keyframes, offset)
      const srcOffset = toSource(c, offset)
      const right: Clip = { ...structuredClone(c), id: createdId, start: r3(at), in: r3(c.in + srcOffset), transitionIn: null, fadeIn: 0,
        ...(c.hold > 0 ? { in: c.in, hold: r3(clipLength(c) - offset) } : {}),
        effects: c.effects.map((e) => ({ ...e, params: { ...e.params }, id: ctx.newId('fx') })), keyframes: parts.right }
      c.keyframes = parts.left
      if (c.hold > 0) c.hold = r3(offset)
      else c.out = r3(c.in + srcOffset)
      c.fadeOut = 0
      doc.clips.push(right)
      break
    }
    case 'removeClip': {
      const c = clip(cmd.clipId)
      doc.clips = doc.clips.filter((x) => x.id !== c.id)
      const next = trackClips(doc, c.trackId).find((x) => x.start >= c.start - EPS)
      const nextOverlap = next?.transitionIn?.duration ?? 0
      if (next) next.transitionIn = null
      // O seguinte encosta no anterior: some o comprimento do clipe e as sobreposições das transições.
      if (cmd.ripple) shiftAfter(doc, c.trackId, clipEnd(c) - nextOverlap - EPS, -clipLength(c) + (c.transitionIn?.duration ?? 0) + nextOverlap)
      break
    }
    case 'setClipProps': {
      const c = clip(cmd.clipId)
      if (cmd.volume !== undefined) c.volume = clamp(finite(cmd.volume, 'Volume'), 0, 2)
      if (cmd.opacity !== undefined) c.opacity = clamp(finite(cmd.opacity, 'Opacidade'), 0, 1)
      if (cmd.fadeIn !== undefined) c.fadeIn = Math.max(0, finite(cmd.fadeIn, 'Fade de entrada'))
      if (cmd.fadeOut !== undefined) c.fadeOut = Math.max(0, finite(cmd.fadeOut, 'Fade de saída'))
      break
    }
    case 'setTransition': {
      const c = clip(cmd.clipId)
      const prev = trackClips(doc, c.trackId).filter((x) => x.id !== c.id && x.start < c.start + EPS).pop()
      const oldOverlap = c.transitionIn?.duration ?? 0
      if (!cmd.transition) {
        c.transitionIn = null
        shiftAfter(doc, c.trackId, c.start, oldOverlap) // desfaz a sobreposição
        break
      }
      const def = transitionById(cmd.transition.type)
      if (!def) throw new Error(`Transição desconhecida: ${cmd.transition.type}.`)
      if (!prev) throw new Error('A transição precisa de um clipe antes deste na mesma trilha.')
      const d = r3(cmd.transition.duration === undefined ? def.defaultDuration : finite(cmd.transition.duration, 'Duração da transição'))
      // Estilo CapCut: o clipe (e os seguintes) recuam para sobrepor o anterior pela duração da transição;
      // um espaço vazio entre os dois é fechado junto.
      shiftAfter(doc, c.trackId, c.start, clipEnd(prev) - d - c.start)
      c.transitionIn = { type: def.id, duration: d }
      break
    }
    case 'addEffect': {
      const c = clip(cmd.clipId)
      const def = effectById(cmd.effect)
      if (!def) throw new Error(`Efeito desconhecido: ${cmd.effect}.`)
      createdId = ctx.newId('fx')
      c.effects.push({ id: createdId, type: def.id, enabled: true, params: normalizeParams(def, cmd.params ?? {}), ...(cmd.asset ? { asset: str(cmd.asset) } : {}) })
      break
    }
    case 'updateEffect': {
      const c = clip(cmd.clipId)
      const e = c.effects.find((x) => x.id === cmd.effectId)
      if (!e) throw new Error('Efeito não encontrado no clipe.')
      const def = effectById(e.type)
      if (!def) throw new Error(`Efeito desconhecido: ${e.type}.`)
      if (cmd.params) e.params = normalizeParams(def, cmd.params, e.params)
      if (cmd.enabled !== undefined) e.enabled = Boolean(cmd.enabled)
      break
    }
    case 'removeEffect': {
      const c = clip(cmd.clipId)
      if (!c.effects.some((x) => x.id === cmd.effectId)) throw new Error('Efeito não encontrado no clipe.')
      c.effects = c.effects.filter((x) => x.id !== cmd.effectId)
      break
    }
    case 'addMarker': {
      createdId = ctx.newId('m')
      doc.markers.push({ id: createdId, time: r3(Math.max(0, finite(cmd.time, 'Tempo do marcador'))), label: str(cmd.label) })
      break
    }
    case 'setTransform': {
      const c = clip(cmd.clipId)
      const t = cmd.transform ?? {}
      const next = { ...c.transform }
      for (const k of Object.keys(NEUTRAL_TRANSFORM) as (keyof Transform)[]) if (t[k] !== undefined) next[k] = finite(t[k], 'Enquadramento')
      c.transform = readTransform(next)
      break
    }
    case 'setKeyframes': {
      const c = clip(cmd.clipId)
      const def = animProp(cmd.prop)
      if (!def) throw new Error(`Propriedade animável desconhecida: ${cmd.prop}.`)
      const keys = normalizeKeys(def, cmd.keyframes ?? [], clipLength(c))
      if (keys.length) c.keyframes[def.id] = keys
      else delete c.keyframes[def.id]
      break
    }
    case 'addKeyframe': {
      const c = clip(cmd.clipId)
      const def = animProp(cmd.prop)
      if (!def) throw new Error(`Propriedade animável desconhecida: ${cmd.prop}.`)
      const t = finite(cmd.t, 'Tempo do keyframe')
      if (t < -EPS || t > clipLength(c) + EPS) throw new Error('O keyframe precisa estar dentro do clipe.')
      const list = (c.keyframes[def.id] ?? []).filter((k) => Math.abs(k.t - t) >= 0.001)
      c.keyframes[def.id] = normalizeKeys(def, [...list, { t, v: finite(cmd.v, 'Valor do keyframe'), ease: cmd.ease ?? 'linear' }], clipLength(c))
      break
    }
    case 'pasteAttributes': {
      const from = doc.clips.find((x) => x.id === cmd.fromClipId)
      if (!from) throw new Error('Clipe de origem não encontrado.')
      if (!Array.isArray(cmd.toClipIds) || !cmd.toClipIds.length) throw new Error('Escolha pelo menos um clipe de destino.')
      for (const id of cmd.toClipIds) {
        const c = clip(id)
        if (c.id === from.id) continue
        if (cmd.effects !== false) c.effects = [...c.effects, ...from.effects.map((e) => ({ ...e, params: { ...e.params }, id: ctx.newId('fx') }))]
        if (cmd.transform) c.transform = { ...from.transform }
        if (cmd.keyframes) {
          c.keyframes = structuredClone(from.keyframes)
          shiftKeyframes(c, 0)
        }
      }
      break
    }
    case 'setMix': {
      const mx = cmd.mix ?? {}
      if (mx.normalize !== undefined) doc.mix.normalize = Boolean(mx.normalize)
      if (mx.targetLufs !== undefined) doc.mix.targetLufs = clamp(finite(mx.targetLufs, 'Alvo de volume'), -24, -9)
      if (mx.duck !== undefined) doc.mix.duck = Boolean(mx.duck)
      if (mx.duckAmount !== undefined) doc.mix.duckAmount = clamp(finite(mx.duckAmount, 'Intensidade do ducking'), 0, 1)
      break
    }
    case 'setSpeed': {
      const c = clip(cmd.clipId)
      if (c.hold > 0) throw new Error('Freeze frame não tem velocidade.')
      const speed = clamp(finite(cmd.speed, 'Velocidade'), MIN_SPEED, MAX_SPEED)
      const oldLen = clipLength(c)
      const after = trackClips(doc, c.trackId).filter((x) => x.id !== c.id && x.start > c.start + EPS)
      const stretch = c.speed / r3(speed)
      c.speed = r3(speed)
      const delta = clipLength(c) - oldLen
      if (cmd.ripple !== false) for (const x of after) x.start = r3(Math.max(0, x.start + delta))
      // A animação acompanha o conteúdo: estica ou encolhe junto com o clipe.
      for (const [prop, list] of Object.entries(c.keyframes) as [AnimProp, Keyframe[]][]) {
        if (list) c.keyframes[prop] = list.map((k) => ({ ...k, t: r3(k.t * stretch) }))
      }
      c.fadeIn = r3(Math.min(c.fadeIn, clipLength(c)))
      c.fadeOut = r3(Math.min(c.fadeOut, clipLength(c) - c.fadeIn))
      shiftKeyframes(c, 0)
      break
    }
    case 'speedRamp': {
      const c = clip(cmd.clipId)
      if (c.hold > 0) throw new Error('Freeze frame não tem velocidade.')
      const speed = clamp(finite(cmd.speed, 'Velocidade'), MIN_SPEED, MAX_SPEED)
      const from = Math.max(c.start, finite(cmd.from, 'Início do trecho'))
      const to = Math.min(clipEnd(c), finite(cmd.to, 'Fim do trecho'))
      if (to - from < 0.2) throw new Error('O trecho da rampa precisa ter pelo menos 0,2 s dentro do clipe.')
      const s0 = c.speed
      let a = c.in + (from - c.start) * s0
      let b = c.in + (to - c.start) * s0
      // Sobras menores que um clipe mínimo nas pontas entram no trecho da rampa.
      if ((a - c.in) / s0 < MIN_CLIP) a = c.in
      if ((c.out - b) / s0 < MIN_CLIP) b = c.out
      type Piece = { in: number; out: number; speed: number }
      // Rampa: degraus de velocidade em cada borda (geométricos entre a velocidade atual e a nova).
      const build = (steps: number): Piece[] => {
        const ramp = steps ? Math.min((b - a) / 4, 0.35 * s0) : 0
        const out: Piece[] = []
        const push = (i: number, o: number, sp: number): void => { if (o - i > 0.001) out.push({ in: i, out: o, speed: sp }) }
        push(c.in, a, s0)
        for (let k = 1; k <= steps; k++) push(a + (ramp * (k - 1)) / steps, a + (ramp * k) / steps, s0 * (speed / s0) ** (k / (steps + 1)))
        push(a + ramp, b - ramp, speed)
        for (let k = steps; k >= 1; k--) push(b - (ramp * k) / steps, b - (ramp * (k - 1)) / steps, s0 * (speed / s0) ** (k / (steps + 1)))
        push(b, c.out, s0)
        return out
      }
      const fits = (ps: Piece[]): boolean => ps.every((p) => (p.out - p.in) / p.speed >= MIN_CLIP - 0.0005)
      // Trechos curtos em velocidade alta não comportam 3 degraus: usa menos (ou nenhum).
      let pieces = build(0)
      for (let steps = cmd.smooth === false ? 0 : 3; steps >= 0; steps--) {
        const ps = build(steps)
        if (fits(ps)) { pieces = ps; break }
      }
      if (!fits(pieces)) throw new Error('O trecho é curto demais para essa velocidade. Aumente o trecho ou use uma velocidade menor.')
      // A animação continua presa ao mesmo conteúdo: cada pedaço leva seu trecho, esticado para a nova duração.
      const keysFor = (p: Piece): Clip['keyframes'] => {
        const off = (p.in - c.in) / s0
        const was = (p.out - p.in) / s0
        const k = s0 / p.speed
        const out: Clip['keyframes'] = {}
        for (const [prop, list] of Object.entries(c.keyframes) as [AnimProp, Keyframe[]][]) {
          if (list?.length) out[prop] = windowKeys(list, off, was).map((x) => ({ ...x, t: r3(x.t * k) }))
        }
        return out
      }
      const oldLen = clipLength(c)
      const after = trackClips(doc, c.trackId).filter((x) => x.id !== c.id && x.start > c.start + EPS)
      doc.clips = doc.clips.filter((x) => x.id !== c.id)
      // Os degraus formam um grupo: a rampa se move como um clipe só.
      const group = pieces.length > 1 ? c.group ?? ctx.newId('g') : c.group
      let t = c.start
      pieces.forEach((p, i) => {
        // Pedaços menores que um quadro de saída não valem a pena (o arredondamento os absorve).
        const piece: Clip = { ...structuredClone(c), id: i === 0 ? c.id : ctx.newId('c'), start: r3(t), in: r3(p.in), out: r3(p.out), speed: r3(p.speed), keyframes: keysFor(p), ...(group ? { group } : {}),
          transitionIn: i === 0 ? c.transitionIn : null, fadeIn: i === 0 ? c.fadeIn : 0, fadeOut: i === pieces.length - 1 ? c.fadeOut : 0,
          effects: c.effects.map((e) => ({ ...e, params: { ...e.params }, id: i === 0 ? e.id : ctx.newId('fx') })) }
        t += clipLength(piece)
        doc.clips.push(piece)
      })
      const delta = t - c.start - oldLen
      for (const x of after) x.start = r3(Math.max(0, x.start + delta))
      createdId = c.id
      break
    }
    case 'freezeFrame': {
      const c = clip(cmd.clipId)
      const m = mediaOf(c)
      if (m.kind !== 'video') throw new Error('Freeze frame só vale para vídeo.')
      const at = finite(cmd.at, 'Ponto do freeze')
      const dur = clamp(finite(cmd.duration, 'Duração do freeze'), MIN_CLIP, 30)
      if (at < c.start - EPS || at > clipEnd(c) + EPS) throw new Error('O freeze precisa estar dentro do clipe.')
      const after = trackClips(doc, c.trackId).filter((x) => x.id !== c.id && x.start > c.start + EPS)
      const inside = at > c.start + MIN_CLIP && at < clipEnd(c) - MIN_CLIP
      const offset = inside ? at - c.start : at <= c.start + MIN_CLIP ? 0 : clipLength(c)
      // O corte usa o ponto exato; o quadro congelado recua o necessário para caber um quadro antes do fim do trecho.
      const srcSplit = r3(c.in + toSource(c, offset))
      const frame = r3(Math.max(c.in, Math.min(srcSplit, c.out - 0.04)))
      // Valores animados no ponto do freeze viram constantes no quadro congelado (sem salto de zoom/posição).
      const stillKeys: Clip['keyframes'] = {}
      for (const [prop, list] of Object.entries(c.keyframes) as [AnimProp, Keyframe[]][]) {
        if (list?.length) stillKeys[prop] = [{ t: 0, v: valueAt(list, offset, list[0].v), ease: 'linear' }]
      }
      let right: Clip | null = null
      if (inside) {
        right = { ...structuredClone(c), id: ctx.newId('c'), start: r3(at + dur), in: srcSplit, transitionIn: null, fadeIn: 0, keyframes: splitKeyframes(c.keyframes, offset).right,
          effects: c.effects.map((e) => ({ ...e, params: { ...e.params }, id: ctx.newId('fx') })) }
        c.keyframes = splitKeyframes(c.keyframes, offset).left
        c.out = srcSplit
        c.fadeOut = 0
      }
      const holdStart = right ? at : offset === 0 ? c.start : clipEnd(c)
      if (!right && holdStart === c.start) c.start = r3(c.start + dur)
      createdId = ctx.newId('c')
      const frozen: Clip = { ...structuredClone(c), id: createdId, start: r3(holdStart), in: frame, out: r3(frame + 0.04), speed: 1, hold: r3(dur), transitionIn: null, fadeIn: 0, fadeOut: 0, keyframes: stillKeys,
        effects: c.effects.map((e) => ({ ...e, params: { ...e.params }, id: ctx.newId('fx') })) }
      doc.clips.push(frozen)
      if (right) doc.clips.push(right)
      for (const x of after) x.start = r3(x.start + dur)
      break
    }
    case 'clearTimeline': {
      const locked = new Set(doc.tracks.filter((t) => t.locked).map((t) => t.id))
      doc.clips = doc.clips.filter((c) => locked.has(c.trackId))
      doc.markers = []
      break
    }
    case 'removeMarker': {
      doc.markers = doc.markers.filter((m) => m.id !== cmd.markerId)
      break
    }
  }
  validateComposition(doc, ctx.media)
  return { doc, createdId }
}
