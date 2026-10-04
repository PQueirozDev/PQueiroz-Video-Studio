import { create } from 'zustand'
import type { ChatMessage, ClaudeEvent, MediaItem, Preset, Project, RenderJob, Settings, Version } from '@shared/types'
import { api } from './lib/format'

export type View = 'splash' | 'onboarding' | 'dashboard' | 'project'
export type Dialog = null | 'newProject' | 'render' | 'settings' | 'queue'

/** O que está no player: um arquivo de mídia, uma versão ou nada. */
export type Source = { kind: 'media'; id: string } | { kind: 'version'; id: string } | null

interface LiveChat {
  running: boolean
  status: string
  messageId: string | null
  text: string
  activity: string[]
  startedAt: number
}

interface Toast { id: number; text: string; tone: 'ok' | 'bad' | 'info' }

interface State {
  view: View
  dialog: Dialog
  paletteOpen: boolean
  settings: Settings | null
  presets: Preset[]
  projects: Project[]
  projectId: string | null
  media: MediaItem[]
  versions: Version[]
  messages: ChatMessage[]
  live: Record<string, LiveChat>
  renders: RenderJob[]
  source: Source
  compare: boolean
  toasts: Toast[]
  chatFocusTick: number
  /** Posição atual do player (usada para marcar início/fim dos clipes). */
  playerTime: number
  seekRequest: { t: number; n: number } | null
  task: Record<string, { text: string; progress: number | null } | undefined>

  setView(v: View): void
  setDialog(d: Dialog): void
  setPalette(open: boolean): void
  setSource(s: Source): void
  setCompare(on: boolean): void
  toast(text: string, tone?: Toast['tone']): void
  focusChat(): void

  loadSettings(): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<void>
  loadProjects(): Promise<void>
  openProject(id: string): Promise<void>
  closeProject(): void
  refreshProject(): Promise<void>
  refreshMedia(): Promise<void>
  refreshVersions(): Promise<void>
  importPaths(paths: string[]): Promise<void>
  sendChat(text: string): Promise<void>
  onClaudeEvent(e: ClaudeEvent): void
  onRender(job: RenderJob): void
}

const emptyLive = (): LiveChat => ({ running: false, status: '', messageId: null, text: '', activity: [], startedAt: 0 })
let toastSeq = 0

export const useStore = create<State>((set, get) => ({
  view: 'splash',
  dialog: null,
  paletteOpen: false,
  settings: null,
  presets: [],
  projects: [],
  projectId: null,
  media: [],
  versions: [],
  messages: [],
  live: {},
  renders: [],
  source: null,
  compare: false,
  toasts: [],
  chatFocusTick: 0,
  playerTime: 0,
  seekRequest: null,
  task: {},

  setView: (view) => set({ view }),
  setDialog: (dialog) => set({ dialog }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSource: (source) => set({ source }),
  setCompare: (compare) => set({ compare }),
  toast: (text, tone = 'info') => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200)
  },
  focusChat: () => set((s) => ({ chatFocusTick: s.chatFocusTick + 1 })),

  loadSettings: async () => {
    const [settings, presets] = await Promise.all([api.settings.get(), api.presets.list()])
    set({ settings, presets })
  },
  saveSettings: async (patch) => {
    set({ settings: await api.settings.update(patch) })
  },
  loadProjects: async () => set({ projects: await api.projects.list() }),

  openProject: async (id) => {
    const [media, versions, messages, running] = await Promise.all([
      api.media.list(id), api.versions.list(id), api.chat.history(id), api.chat.running(id)
    ])
    const project = await api.projects.get(id)
    if (!project) return
    const current = versions.find((v) => v.id === project.currentVersionId)
    const firstVideo = media.find((m) => m.kind === 'video')
    set((s) => ({
      projectId: id, media, versions, messages, view: 'project', compare: false,
      source: current ? { kind: 'version', id: current.id } : firstVideo ? { kind: 'media', id: firstVideo.id } : null,
      live: s.live[id] ? s.live : { ...s.live, [id]: { ...emptyLive(), running, status: running ? 'Claude está trabalhando...' : '' } }
    }))
    get().saveSettings({ lastProjectId: id })
    get().loadProjects()
  },
  closeProject: () => {
    set({ projectId: null, view: 'dashboard', media: [], versions: [], messages: [], source: null })
    get().saveSettings({ lastProjectId: null })
    get().loadProjects()
  },
  refreshProject: async () => {
    await get().loadProjects()
  },
  refreshMedia: async () => {
    const id = get().projectId
    if (id) set({ media: await api.media.list(id) })
  },
  refreshVersions: async () => {
    const id = get().projectId
    if (id) set({ versions: await api.versions.list(id) })
  },

  importPaths: async (paths) => {
    const id = get().projectId
    if (!id || !paths.length) return
    get().toast(`Importando ${paths.length} arquivo(s)...`)
    const r = await api.media.import(id, paths)
    await get().refreshMedia()
    get().loadProjects()
    if (r.imported.length) {
      get().toast(`${r.imported.length} arquivo(s) importado(s)`, 'ok')
      if (!get().source) {
        const v = r.imported.find((m) => m.kind === 'video')
        if (v) set({ source: { kind: 'media', id: v.id } })
      }
    }
    for (const s of r.skipped) get().toast(`${s.path.split(/[\\/]/).pop()}: ${s.reason}`, 'bad')
  },

  sendChat: async (text) => {
    const id = get().projectId
    if (!id || !text.trim()) return
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, projectId: id, role: 'user', content: text, activity: [], createdAt: Date.now() }
    set((s) => ({
      messages: [...s.messages, optimistic],
      live: { ...s.live, [id]: { ...emptyLive(), running: true, status: 'Claude está analisando o projeto...', startedAt: Date.now() } }
    }))
    try {
      await api.chat.send(id, text)
    } catch (err) {
      set((s) => ({ live: { ...s.live, [id]: emptyLive() } }))
      get().toast(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad')
    }
  },

  onClaudeEvent: (e) => {
    const cur = get().live[e.projectId] ?? emptyLive()
    switch (e.type) {
      case 'status':
        set((s) => ({ live: { ...s.live, [e.projectId]: { ...cur, running: true, status: e.text } } }))
        break
      case 'text':
        set((s) => ({ live: { ...s.live, [e.projectId]: { ...cur, running: true, messageId: e.messageId, text: e.text } } }))
        break
      case 'activity':
        set((s) => ({ live: { ...s.live, [e.projectId]: { ...cur, running: true, activity: [...cur.activity, e.text] } } }))
        break
      case 'done': {
        set((s) => ({ live: { ...s.live, [e.projectId]: emptyLive() } }))
        if (get().projectId === e.projectId) {
          api.chat.history(e.projectId).then((messages) => set({ messages }))
          api.versions.list(e.projectId).then((versions) => {
            set({ versions })
            if (e.versions.length) {
              const last = e.versions[e.versions.length - 1]
              set({ source: { kind: 'version', id: last.id } })
              get().toast(`Nova versão: ${last.label}`, 'ok')
            } else {
              // O Claude pode ter restaurado uma versão (bloco ```acao```).
              api.projects.get(e.projectId).then((p) => {
                if (p?.currentVersionId) set({ source: { kind: 'version', id: p.currentVersionId } })
              })
            }
          })
        }
        get().loadProjects()
        break
      }
      case 'error':
        set((s) => ({ live: { ...s.live, [e.projectId]: emptyLive() } }))
        get().toast(e.error, 'bad')
        break
    }
  },

  onRender: (job) => {
    set((s) => {
      const exists = s.renders.some((r) => r.id === job.id)
      return { renders: exists ? s.renders.map((r) => (r.id === job.id ? job : r)) : [job, ...s.renders] }
    })
    if (job.status === 'concluido') get().toast(`Render concluído: ${job.label}`, 'ok')
    if (job.status === 'erro') get().toast(`Falha no render: ${job.label}`, 'bad')
  }
}))

export const useProject = (): Project | undefined => {
  const { projects, projectId } = useStore()
  return projects.find((p) => p.id === projectId)
}
