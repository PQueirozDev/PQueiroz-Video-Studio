import { create } from 'zustand'
import type { Command, Composition } from '@shared/composition'
import { compositionDuration } from '@shared/composition'
import type { FxCatalog } from '@shared/api'
import { api } from '@/lib/format'
import { useStore } from '@/store'

// Estado do editor de timeline (renderer). O documento vem sempre do processo principal:
// toda mudança é um comando validado lá (com desfazer/refazer), e a tela só reflete o resultado.

export interface LutInfo { id: string; name: string; builtIn: boolean }

interface EditorState {
  projectId: string | null
  doc: Composition | null
  undo: boolean
  redo: boolean
  catalog: FxCatalog | null
  luts: LutInfo[]
  /** Clipes selecionados (o primeiro é o "principal", mostrado no inspetor). */
  selection: string[]
  selectedTrack: string | null
  playhead: number
  playing: boolean
  /** true: o player mostra a timeline (preview da composição) em vez de um arquivo. */
  previewActive: boolean
  pxPerSec: number
  snapping: boolean
  ripple: boolean
  /** Clipe cujos efeitos/animações foram copiados (Ctrl+C). */
  clipboard: string | null
  busy: boolean
  load(projectId: string): Promise<void>
  edit(commands: Command[]): Promise<(string | undefined)[] | null>
  travel(direction: 'undo' | 'redo'): Promise<void>
  select(id: string | null, additive?: boolean): void
  setPlayhead(t: number): void
  setPlaying(on: boolean): void
  duration(): number
}

const message = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  doc: null,
  undo: false,
  redo: false,
  catalog: null,
  luts: [],
  selection: [],
  selectedTrack: null,
  playhead: 0,
  playing: false,
  previewActive: false,
  pxPerSec: 40,
  snapping: true,
  ripple: false,
  clipboard: null,
  busy: false,

  async load(projectId) {
    try {
      const [state, catalog, luts] = await Promise.all([api.composition.get(projectId), get().catalog ?? api.composition.catalog(), api.composition.luts()])
      if (get().projectId !== projectId) set({ selection: [], selectedTrack: null, playhead: 0, playing: false, clipboard: null })
      set({ projectId, doc: state.doc, undo: state.undo, redo: state.redo, catalog, luts })
    } catch (err) {
      set({ projectId, doc: null })
      useStore.getState().toast(message(err), 'bad')
    }
  },

  async edit(commands) {
    const { projectId } = get()
    if (!projectId || !commands.length) return null
    set({ busy: true })
    try {
      const r = await api.composition.edit(projectId, commands)
      const alive = new Set(r.doc.clips.map((c) => c.id))
      set((s) => ({ doc: r.doc, undo: r.undo, redo: r.redo, selection: s.selection.filter((id) => alive.has(id)) }))
      return r.createdIds
    } catch (err) {
      useStore.getState().toast(message(err), 'bad')
      return null
    } finally {
      set({ busy: false })
    }
  },

  async travel(direction) {
    const { projectId, busy } = get()
    if (!projectId || busy) return
    set({ busy: true })
    try {
      const r = await api.composition[direction](projectId)
      const alive = new Set(r.doc.clips.map((c) => c.id))
      set((s) => ({ doc: r.doc, undo: r.undo, redo: r.redo, selection: s.selection.filter((id) => alive.has(id)) }))
    } catch (err) {
      useStore.getState().toast(message(err), 'bad')
    } finally {
      set({ busy: false })
    }
  },

  select(id, additive = false) {
    if (!id) return set({ selection: [] })
    set((s) => {
      // Clipe agrupado: a seleção pega o grupo inteiro.
      const c = s.doc?.clips.find((x) => x.id === id)
      // O clicado vem primeiro: é ele que o inspetor mostra.
      const ids = c?.group ? [id, ...s.doc!.clips.filter((x) => x.group === c.group && x.id !== id).map((x) => x.id)] : [id]
      const on = s.selection.includes(id)
      return {
        selection: additive ? (on ? s.selection.filter((x) => !ids.includes(x)) : [...s.selection, ...ids.filter((x) => !s.selection.includes(x))]) : ids,
        selectedTrack: c?.trackId ?? s.selectedTrack
      }
    })
  },

  setPlayhead(t) {
    set({ playhead: Math.max(0, Math.min(t, get().duration() || 0)), previewActive: true })
  },

  setPlaying(on) {
    const end = get().duration()
    // Apertar play no fim volta para o começo.
    if (on && get().playhead >= end - 0.05) set({ playhead: 0 })
    set({ playing: on && end > 0, previewActive: true })
  },

  duration() {
    const d = get().doc
    return d ? compositionDuration(d) : 0
  }
}))

// Escolher um arquivo/versão para ver no player sai do modo timeline.
useStore.subscribe((s, prev) => {
  if (s.source !== prev.source) useEditor.setState({ previewActive: false, playing: false })
  if (s.projectId !== prev.projectId) useEditor.setState({ projectId: null, doc: null, previewActive: false, playing: false })
})

export { message as errorMessage }
