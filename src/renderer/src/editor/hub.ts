import { create } from 'zustand'
import { clipEnd, trackClips, type Clip, type Command, type Composition } from '@shared/composition'
import type { HubItem, PackInfo } from '@shared/packs'
import { presetToCommands } from '@shared/autoStudio'
import { api, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { errorMessage, useEditor } from './editorStore'

// Asset Hub no editor: itens dos pacotes instalados (títulos, sons, overlays, presets, fontes)
// e as ações que levam cada um para a timeline. Tudo vira comandos validados da composição.

export const ESSENTIALS = 'pq-essentials'
/** Mesmo id do processo principal (fontes/LUTs do pacote essencial ficam curtos). */
export const assetId = (it: Pick<HubItem, 'packId' | 'id'>): string => (it.packId === ESSENTIALS ? it.id : `${it.packId}.${it.id}`)
/** Família CSS de uma fonte instalada (registrada com FontFace). */
export const fontFamily = (fontId: string): string => `pq-font-${fontId}`

interface HubState {
  items: HubItem[]
  packs: PackInfo[]
  loaded: boolean
  load(force?: boolean): Promise<void>
}

/** Fontes registradas no navegador: troca quando o pacote muda de versão e some quando ele é removido. */
const registered = new Map<string, { stamp: string; face: FontFace }>()
function registerFonts(items: HubItem[]): void {
  const alive = new Set<string>()
  for (const it of items) {
    if (it.type !== 'font' || !it.path) continue
    const id = assetId(it)
    const stamp = `${it.path}|${it.packVersion}`
    alive.add(id)
    const old = registered.get(id)
    if (old?.stamp === stamp) continue
    if (old) document.fonts.delete(old.face)
    const face = new FontFace(fontFamily(id), `url("${mediaUrl(it.path)}?v=${encodeURIComponent(it.packVersion)}")`)
    registered.set(id, { stamp, face })
    face.load().then((f) => document.fonts.add(f)).catch(() => registered.delete(id))
  }
  for (const [id, r] of registered) {
    if (alive.has(id)) continue
    document.fonts.delete(r.face)
    registered.delete(id)
  }
}

export const useHub = create<HubState>((set, get) => ({
  items: [],
  packs: [],
  loaded: false,
  async load(force = false) {
    if (get().loaded && !force) return
    try {
      const [items, packs] = await Promise.all([api.hub.items(), api.hub.packs()])
      registerFonts(items)
      set({ items, packs, loaded: true })
    } catch (err) {
      useStore.getState().toast(errorMessage(err), 'bad')
    }
  }
}))

/** Trilha de vídeo (acima da principal) livre no intervalo, para títulos/overlays. */
function freeTrack(doc: Composition, kind: 'video' | 'audio', start: number, end: number, skipMain: boolean, blend?: string): string | null {
  const main = doc.tracks.find((t) => t.kind === kind)?.id
  const free = (id: string): boolean => trackClips(doc, id).every((c) => clipEnd(c) <= start + 0.002 || c.start >= end - 0.002)
  const list = [...doc.tracks].reverse().filter((t) => t.kind === kind && !t.locked && !(skipMain && t.id === main))
  return list.find((t) => free(t.id) && (blend === undefined || (t.blend ?? 'normal') === blend))?.id ?? null
}

export async function addTitleFromTemplate(it: HubItem): Promise<void> {
  if (!it.title) return
  const { playhead, edit } = useEditor.getState()
  const ids = await edit([{ type: 'addTitle', start: Math.round(playhead * 1000) / 1000, duration: it.title.duration, title: it.title.style,
    keyframes: it.title.keyframes, fadeIn: it.title.fadeIn, fadeOut: it.title.fadeOut }])
  if (ids?.[0]) useEditor.getState().select(ids[0])
}

/** SFX vai para uma trilha de áudio livre no playhead; overlay para uma trilha de vídeo em "screen" por cima. */
export async function addMediaItem(it: HubItem): Promise<void> {
  const projectId = useStore.getState().projectId
  const ed = useEditor.getState()
  if (!projectId || !ed.doc) return
  try {
    const m = await api.hub.use(projectId, it.key)
    await useStore.getState().refreshMedia()
    const start = Math.round(ed.playhead * 1000) / 1000
    const len = m.kind === 'image' ? 3 : m.duration ?? 3
    const kind = it.type === 'sfx' ? 'audio' : 'video'
    const blend = it.type === 'overlay' ? it.blend ?? 'screen' : undefined
    let doc = useEditor.getState().doc!
    let trackId = freeTrack(doc, kind, start, start + len, kind === 'video', kind === 'video' ? blend : undefined)
    if (!trackId) {
      const created = await useEditor.getState().edit([{ type: 'addTrack', kind, name: it.type === 'sfx' ? 'Efeitos sonoros' : 'Overlays' }])
      if (!created?.[0]) return
      trackId = created[0]
      doc = useEditor.getState().doc!
    }
    const cmds: Command[] = [{ type: 'addClip', mediaId: m.id, trackId, start }]
    const track = doc.tracks.find((t) => t.id === trackId)
    if (kind === 'video' && blend && blend !== 'normal' && (track?.blend ?? 'normal') !== blend) cmds.push({ type: 'updateTrack', trackId, blend: blend as 'screen' })
    const ids = await useEditor.getState().edit(cmds)
    if (ids?.[0]) useEditor.getState().select(ids[0])
  } catch (err) {
    useStore.getState().toast(errorMessage(err), 'bad')
  }
}

/** Comandos de um preset para um clipe: efeitos novos + keyframes mesclados no ponto de aplicação. */
export function presetCommands(it: HubItem, clip: Clip, playhead: number): Command[] {
  const p = it.preset
  if (!p) return []
  const len = clipEnd(clip) - clip.start
  const at = p.anchor === 'playhead' ? Math.min(Math.max(0, playhead - clip.start), len) : p.anchor === 'end' ? len : 0
  return presetToCommands(p, clip.id, len, at, clip.keyframes)
}

export async function applyPreset(it: HubItem): Promise<void> {
  const ed = useEditor.getState()
  const clips = (ed.doc?.clips ?? []).filter((c) => ed.selection.includes(c.id))
  const video = clips.filter((c) => ed.doc?.tracks.find((t) => t.id === c.trackId)?.kind === 'video')
  if (!video.length) return useStore.getState().toast('Selecione um clipe de vídeo na timeline para aplicar o preset.', 'bad')
  // Em vários clipes (ex.: grupo), o preset de movimento vai só no que está sob o playhead.
  const targets = it.preset?.anchor === 'playhead' ? video.filter((c) => ed.playhead >= c.start && ed.playhead <= clipEnd(c)).slice(0, 1) : video
  if (!targets.length) return useStore.getState().toast('Leve o playhead para dentro do clipe selecionado.', 'bad')
  await ed.edit(targets.flatMap((c) => presetCommands(it, c, ed.playhead)))
}
