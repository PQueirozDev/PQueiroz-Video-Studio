import { create } from 'zustand'
import type { Brand, ImageDoc, ImageFormatId, ImageProjectInfo, Layer, ProviderInfo } from '@shared/image'
import { adaptDoc, newId } from '@shared/imageDoc'
import { api } from '@/lib/format'
import { doneHooks, sendHooks, useStore } from '@/store'
import { renderBytes } from './render'
import { buildTemplate, templateById } from '@shared/templates'

// Estado do editor do Image Studio. O design de trabalho é salvo automaticamente (design.json);
// versões (V1, V2…) são criadas em momentos explícitos: pedido ao Claude, geração, "Salvar versão"
// e exportação.

const HISTORY_LIMIT = 80
const errMsg = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface ImageState {
  projectId: string | null
  info: ImageProjectInfo | null
  doc: ImageDoc | null
  selectedId: string | null
  past: ImageDoc[]
  future: ImageDoc[]
  zoom: number | 'fit'
  showSafe: boolean
  showGrid: boolean
  brands: Brand[]
  providers: ProviderInfo[]
  /** Versão mostrada no lugar da arte de trabalho (somente leitura). */
  viewVersionId: string | null
  compare: { a: string; b: string } | null
  saving: boolean
  pendingSave: boolean
  /** Miniaturas recém-renderizadas por versão (antes do arquivo existir no disco). */
  versionThumbs: Record<string, string>
  busy: string | null

  open(projectId: string): Promise<void>
  close(): void
  loadBrands(): Promise<void>
  loadProviders(): Promise<void>
  /** Registra o estado atual no histórico antes de uma mudança (arrastar, digitar…). */
  checkpoint(): void
  /** Altera o documento sem novo ponto de histórico (use depois de checkpoint). */
  mutate(fn: (doc: ImageDoc) => ImageDoc): void
  /** checkpoint + mutate. */
  change(fn: (doc: ImageDoc) => ImageDoc): void
  updateLayer(id: string, patch: Partial<Layer>, withHistory?: boolean): void
  addLayer(layer: Layer, index?: number): void
  removeLayer(id: string): void
  duplicateLayer(id: string): void
  moveLayer(id: string, to: 'up' | 'down' | 'top' | 'bottom'): void
  select(id: string | null): void
  undo(): void
  redo(): void
  setZoom(z: number | 'fit'): void
  flush(): Promise<void>
  setInfo(patch: Partial<Pick<ImageProjectInfo, 'brandId' | 'formatId' | 'style' | 'provider' | 'originalPrompt'>>): Promise<void>
  changeFormat(formatId: ImageFormatId, width?: number, height?: number): void
  applyTemplate(templateId: string, texts?: Record<string, string>): void
  saveVersion(request: string, changes: string): Promise<void>
  renderPending(): Promise<void>
  reloadFromDisk(): Promise<void>
  setViewVersion(id: string | null): void
  setCompare(c: { a: string; b: string } | null): void
}

/** Encaixa uma imagem (proporção preservada) dentro da caixa de um espaço reservado. */
export function fitInto(img: Layer, box: { x: number; y: number; w: number; h: number }): Layer {
  const k = Math.min(box.w / img.w, box.h / img.h)
  const w = Math.round(img.w * k), h = Math.round(img.h * k)
  return { ...img, x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + box.h - h), w, h }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()

export const useImage = create<ImageState>((set, get) => {
  const scheduleSave = (): void => {
    set({ pendingSave: true })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void get().flush(), 600)
  }

  const isLocked = (): boolean => {
    const id = get().projectId
    return Boolean(id && useStore.getState().live[id]?.running)
  }

  return {
    projectId: null, info: null, doc: null, selectedId: null, past: [], future: [], zoom: 'fit', showSafe: true, showGrid: false,
    brands: [], providers: [], viewVersionId: null, compare: null, saving: false, pendingSave: false, versionThumbs: {}, busy: null,

    open: async (projectId) => {
      if (get().projectId && get().projectId !== projectId) await get().flush()
      const { info, doc } = await api.image.open(projectId)
      set({ projectId, info, doc, selectedId: null, past: [], future: [], viewVersionId: null, compare: null, zoom: 'fit', versionThumbs: {} })
      void get().loadBrands()
      void get().loadProviders()
      void get().renderPending()
    },
    close: () => {
      void get().flush()
      set({ projectId: null, info: null, doc: null, selectedId: null, past: [], future: [], viewVersionId: null, compare: null })
    },
    loadBrands: async () => set({ brands: await api.brands.list() }),
    loadProviders: async () => set({ providers: await api.providers.list() }),

    checkpoint: () => {
      const doc = get().doc
      if (!doc) return
      set((s) => ({ past: [...s.past.slice(-HISTORY_LIMIT + 1), doc], future: [] }))
    },
    mutate: (fn) => {
      const doc = get().doc
      if (!doc) return
      if (isLocked()) {
        useStore.getState().toast('O Claude está editando esta arte. Aguarde ele terminar.', 'info')
        return
      }
      set({ doc: fn(doc), viewVersionId: null })
      scheduleSave()
    },
    change: (fn) => {
      if (isLocked()) {
        useStore.getState().toast('O Claude está editando esta arte. Aguarde ele terminar.', 'info')
        return
      }
      get().checkpoint()
      get().mutate(fn)
    },
    updateLayer: (id, patch, withHistory = true) => {
      const apply = (d: ImageDoc): ImageDoc => ({ ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) })
      if (withHistory) get().change(apply)
      else get().mutate(apply)
    },
    addLayer: (layer, index) => {
      get().change((d) => {
        const layers = [...d.layers]
        layers.splice(index ?? layers.length, 0, layer)
        return { ...d, layers }
      })
      set({ selectedId: layer.id })
    },
    removeLayer: (id) => {
      get().change((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }))
      if (get().selectedId === id) set({ selectedId: null })
    },
    duplicateLayer: (id) => {
      const d = get().doc
      const i = d?.layers.findIndex((l) => l.id === id) ?? -1
      if (!d || i < 0) return
      const src = d.layers[i]
      const copy = { ...structuredClone(src), id: newId(), name: `${src.name} (cópia)`, x: src.x + 24, y: src.y + 24 } as Layer
      get().addLayer(copy, i + 1)
    },
    moveLayer: (id, to) => {
      get().change((d) => {
        const layers = [...d.layers]
        const i = layers.findIndex((l) => l.id === id)
        if (i < 0) return d
        const [l] = layers.splice(i, 1)
        const j = to === 'top' ? layers.length : to === 'bottom' ? 0 : to === 'up' ? Math.min(layers.length, i + 1) : Math.max(0, i - 1)
        layers.splice(j, 0, l)
        return { ...d, layers }
      })
    },
    select: (selectedId) => set({ selectedId }),
    undo: () => {
      const { past, doc } = get()
      if (!past.length || !doc || isLocked()) return
      set((s) => ({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...s.future], viewVersionId: null }))
      scheduleSave()
    },
    redo: () => {
      const { future, doc } = get()
      if (!future.length || !doc || isLocked()) return
      set((s) => ({ doc: future[0], future: future.slice(1), past: [...s.past, doc], viewVersionId: null }))
      scheduleSave()
    },
    setZoom: (zoom) => set({ zoom }),

    flush: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const { projectId, doc, pendingSave } = get()
      if (!projectId || !doc || !pendingSave) return saveChain
      set({ pendingSave: false, saving: true })
      // Gravações em série: nunca duas ao mesmo tempo no mesmo arquivo.
      saveChain = saveChain.then(async () => {
        try {
          await api.image.saveDesign(projectId, doc)
        } catch (err) {
          useStore.getState().toast(`Não foi possível salvar: ${errMsg(err)}`, 'bad')
        } finally {
          set({ saving: false })
        }
      })
      return saveChain
    },

    setInfo: async (patch) => {
      const id = get().projectId
      if (!id) return
      const info = await api.image.updateInfo(id, patch)
      if (get().projectId === id) set({ info })
      if (patch.brandId !== undefined) get().mutate((d) => ({ ...d, meta: { ...d.meta, brandId: info.brandId } }))
    },
    changeFormat: (formatId, width, height) => {
      get().change((d) => adaptDoc(d, formatId, width, height))
      void get().setInfo({ formatId })
    },
    applyTemplate: (templateId, texts) => {
      const t = templateById(templateId)
      const { doc, info, brands } = get()
      if (!t || !doc) return
      const brand = brands.find((b) => b.id === info?.brandId) ?? null
      const logo = brand?.logos.find((l) => l.id === brand.defaultLogoId) ?? brand?.logos[0] ?? null
      const next = buildTemplate(t, doc.formatId, { brand, logo, texts }, { width: doc.width, height: doc.height })
      // Imagens já geradas/importadas (cenário e herói) ocupam os espaços reservados do template.
      const images = doc.layers.filter((l) => l.type === 'image' && (l.role === 'background' || l.role === 'subject'))
      let layers = [...next.layers]
      for (const img of images) {
        const slot = layers.findIndex((l) => l.type === 'shape' && l.role === img.role && /^Espaço/i.test(l.name))
        if (slot >= 0) {
          const s = layers[slot]
          layers[slot] = img.role === 'background' ? { ...img, x: 0, y: 0, w: next.width, h: next.height } : fitInto(img, s)
        } else layers = img.role === 'background' ? [img, ...layers] : [...layers.slice(0, 1), img, ...layers.slice(1)]
      }
      get().change(() => ({ ...next, layers, meta: { ...next.meta, title: doc.meta.title } }))
      set({ selectedId: null })
    },

    saveVersion: async (request, changes) => {
      const { projectId, doc } = get()
      if (!projectId || !doc) return
      await get().flush()
      try {
        const v = await api.image.createVersion(projectId, doc, request, changes)
        const png = await renderBytes(doc)
        await api.image.attachRender(projectId, v.id, png)
        await useStore.getState().refreshVersions()
        useStore.getState().loadProjects()
        useStore.getState().toast(`${v.label} salva`, 'ok')
      } catch (err) {
        useStore.getState().toast(`Falha ao salvar versão: ${errMsg(err)}`, 'bad')
      }
    },
    renderPending: async () => {
      const projectId = get().projectId
      if (!projectId) return
      const pending = await api.image.pendingRenders(projectId)
      for (const p of pending) {
        try {
          const png = await renderBytes(p.doc)
          if (get().projectId !== projectId) return
          await api.image.attachRender(projectId, p.versionId, png)
        } catch {
          /* tenta de novo na próxima abertura */
        }
      }
      if (pending.length && get().projectId === projectId) {
        await useStore.getState().refreshVersions()
        useStore.getState().loadProjects()
      }
    },
    reloadFromDisk: async () => {
      const projectId = get().projectId
      if (!projectId) return
      const { info, doc } = await api.image.open(projectId)
      if (get().projectId !== projectId) return
      const cur = get().doc
      set((s) => ({ info, doc, past: cur ? [...s.past.slice(-HISTORY_LIMIT + 1), cur] : s.past, future: [], viewVersionId: null, pendingSave: false }))
      const sel = get().selectedId
      if (sel && !doc.layers.some((l) => l.id === sel)) set({ selectedId: null })
    },
    setViewVersion: (viewVersionId) => set({ viewVersionId, compare: null }),
    setCompare: (compare) => set({ compare, viewVersionId: null })
  }
})

// Antes de cada pedido ao Claude: grava o design e uma prévia que ele pode abrir para "ver" a arte.
sendHooks.push(async (projectId) => {
  const s = useImage.getState()
  if (useStore.getState().projects.find((p) => p.id === projectId)?.kind !== 'image') return
  let doc = s.projectId === projectId ? s.doc : null
  if (doc) await s.flush()
  try {
    // Editor ainda abrindo (ex.: "Criar com o Claude"): usa o design gravado.
    doc ??= (await api.image.open(projectId)).doc
    const scale = Math.min(1, 1080 / Math.max(doc.width, doc.height))
    await api.image.savePreview(projectId, await renderBytes(doc, { scale }))
  } catch {
    /* sem prévia o Claude ainda lê o design.json */
  }
})

// Quando o Claude termina: recarrega o design que ele editou e renderiza as versões novas.
doneHooks.push((e) => {
  const s = useImage.getState()
  if (s.projectId !== e.projectId) return
  void (async () => {
    if (e.designChanged) await s.reloadFromDisk()
    await useImage.getState().renderPending()
  })()
})
