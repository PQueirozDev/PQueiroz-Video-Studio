import { useRef, useState } from 'react'
import { AudioLines, Film, Image as ImageIcon, Layers, Music, Search, Sparkles, Palette, Shuffle, Type, Wand2 } from 'lucide-react'
import type { Command } from '@shared/composition'
import { api, cx, fmtTime, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { Spinner } from '@/components/ui'
import { useEditor } from './editorStore'
import { HubPanel, type HubTab } from './HubPanels'

// Recursos para a timeline: arrastar para uma trilha/clipe ou clicar para aplicar no clipe selecionado.
// A prévia de cada transição/efeito é um vídeo curto renderizado pelo mesmo motor do export,
// gerado só quando o mouse passa por cima (nunca todas de uma vez).

export const DND = { media: 'application/x-pq-media', transition: 'application/x-pq-transition', effect: 'application/x-pq-effect', lut: 'application/x-pq-lut' }

type Tab = 'media' | 'transitions' | 'effects' | 'luts' | HubTab

function PreviewTile({ kind, id, name, onApply, dragType, hint }: { kind: 'transition' | 'effect' | 'lut'; id: string; name: string; onApply(): void; dragType: string; hint?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const hover = useRef(false)
  const load = async (): Promise<void> => {
    hover.current = true
    if (src || state === 'loading') return
    setState('loading')
    try {
      const path = await api.composition.fxPreview(kind, id)
      setSrc(mediaUrl(path) ?? null)
      setState('idle')
    } catch {
      setState('error')
    }
  }
  return (
    <button
      type="button" draggable
      onDragStart={(e) => { e.dataTransfer.setData(dragType, id); e.dataTransfer.effectAllowed = 'copy' }}
      onMouseEnter={load} onMouseLeave={() => { hover.current = false }} onFocus={load}
      onClick={onApply}
      title={`${name}${hint ? ` — ${hint}` : ''}\nArraste para um clipe ou clique para aplicar no selecionado`}
      className="group flex flex-col overflow-hidden rounded-md border border-line bg-bg text-left hover:border-accent/60"
    >
      <div className="relative aspect-video w-full bg-raised">
        {src ? <video src={src} autoPlay loop muted playsInline className="h-full w-full object-cover" /> : (
          <div className="flex h-full items-center justify-center text-faint">{state === 'loading' ? <Spinner className="h-3.5 w-3.5" /> : state === 'error' ? <span className="text-[10px]">sem prévia</span> : <Sparkles className="h-3.5 w-3.5 opacity-40" />}</div>
        )}
      </div>
      <span className="truncate px-1.5 py-1 text-[10.5px] font-medium">{name}</span>
    </button>
  )
}

export function Browser() {
  const [tab, setTab] = useState<Tab>('media')
  const [q, setQ] = useState('')
  const media = useStore((s) => s.media)
  const { catalog, luts, selection, doc, edit } = useEditor()
  const match = (s: string): boolean => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
  const toSelected = (make: (clipId: string) => Command): void => {
    const ids = selection.filter((id) => doc?.clips.some((c) => c.id === id))
    if (!ids.length) return useStore.getState().toast('Selecione um clipe na timeline (ou arraste até ele).', 'bad')
    void edit(ids.map(make))
  }
  const addMedia = (id: string): void => {
    const m = media.find((x) => x.id === id)
    if (!m) return
    void edit([{ type: 'addClip', mediaId: id }])
  }
  const tabs: { id: Tab; label: string; icon: typeof Film }[] = [
    { id: 'media', label: 'Mídia', icon: Film },
    { id: 'transitions', label: 'Transições', icon: Shuffle },
    { id: 'effects', label: 'Efeitos', icon: Sparkles },
    { id: 'luts', label: 'LUTs', icon: Palette },
    { id: 'titles', label: 'Títulos', icon: Type },
    { id: 'sfx', label: 'Sons', icon: AudioLines },
    { id: 'overlays', label: 'Overlays', icon: Layers },
    { id: 'presets', label: 'Presets', icon: Wand2 }
  ]
  const videoEffects = (catalog?.effects ?? []).filter((e) => e.kind !== 'audio' && e.id !== 'lut' && match(e.name))
  const audioEffects = (catalog?.effects ?? []).filter((e) => e.kind === 'audio' && match(e.name))

  return (
    <aside data-tour="browser" className="flex h-full flex-col border-r border-line bg-panel-2">
      <div className="grid shrink-0 grid-cols-4 gap-0.5 border-b border-line p-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} title={t.label}
            className={cx('flex h-6 flex-1 items-center justify-center gap-1 rounded text-[10.5px] font-medium', tab === t.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg')}>
            <t.icon className="h-3 w-3" /><span className="hidden xl:inline">{t.label}</span>
          </button>
        ))}
      </div>
      <label className="mx-1.5 my-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-2 bg-bg px-2">
        <Search className="h-3 w-3 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar recursos" className="w-full bg-transparent text-[11.5px] outline-none placeholder:text-faint" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {tab === 'media' && (
          <div className="space-y-1">
            {media.filter((m) => match(m.name)).map((m) => (
              <div key={m.id} draggable onDragStart={(e) => { e.dataTransfer.setData(DND.media, m.id); e.dataTransfer.effectAllowed = 'copy' }}
                onDoubleClick={() => addMedia(m.id)} title="Arraste para uma trilha · duplo clique adiciona no fim"
                className="flex cursor-grab items-center gap-2 rounded-md border border-line bg-bg p-1 hover:border-accent/60 active:cursor-grabbing">
                <div className="flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-raised">
                  {m.thumbnail ? <img src={mediaUrl(m.thumbnail)} alt="" className="h-full w-full object-cover" /> : m.kind === 'audio' ? <Music className="h-3.5 w-3.5 text-ok" /> : <ImageIcon className="h-3.5 w-3.5 text-warn" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium">{m.name}</p>
                  <p className="font-mono text-[9.5px] text-faint">{m.kind === 'image' ? 'imagem' : fmtTime(m.duration)}</p>
                </div>
              </div>
            ))}
            {!media.length && <p className="p-2 text-[11px] text-faint">Importe arquivos para montar a timeline.</p>}
          </div>
        )}
        {tab === 'transitions' && (
          <div className="grid grid-cols-2 gap-1.5">
            {(catalog?.transitions ?? []).filter((t) => match(t.name)).map((t) => (
              <PreviewTile key={t.id} kind="transition" id={t.id} name={t.name} dragType={DND.transition} hint={`${t.defaultDuration} s`}
                onApply={() => toSelected((clipId) => ({ type: 'setTransition', clipId, transition: { type: t.id } }))} />
            ))}
          </div>
        )}
        {tab === 'effects' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {videoEffects.map((e) => (
                <PreviewTile key={e.id} kind="effect" id={e.id} name={e.name} dragType={DND.effect}
                  onApply={() => toSelected((clipId) => ({ type: 'addEffect', clipId, effect: e.id }))} />
              ))}
            </div>
            {audioEffects.length > 0 && <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-faint">Áudio</p>}
            <div className="space-y-1">
              {audioEffects.map((e) => (
                <button key={e.id} type="button" draggable onDragStart={(ev) => ev.dataTransfer.setData(DND.effect, e.id)}
                  onClick={() => toSelected((clipId) => ({ type: 'addEffect', clipId, effect: e.id }))}
                  className="flex w-full items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5 text-left text-[11px] hover:border-accent/60">
                  <Music className="h-3 w-3 text-ok" />{e.name}
                </button>
              ))}
            </div>
          </>
        )}
        {(tab === 'titles' || tab === 'sfx' || tab === 'overlays' || tab === 'presets') && <HubPanel tab={tab} match={match} />}
        {tab === 'luts' && (
          <div className="grid grid-cols-2 gap-1.5">
            {luts.filter((l) => match(l.name)).map((l) => (
              <PreviewTile key={l.id} kind="lut" id={l.id} name={l.name} dragType={DND.lut}
                onApply={() => toSelected((clipId) => ({ type: 'addEffect', clipId, effect: 'lut', asset: l.id }))} />
            ))}
            {!luts.length && <p className="col-span-2 p-2 text-[11px] text-faint">Nenhuma LUT encontrada.</p>}
          </div>
        )}
      </div>
    </aside>
  )
}
