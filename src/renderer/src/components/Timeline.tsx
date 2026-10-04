import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Film, GripVertical, Image as ImageIcon, Layers, Music, Scissors, Undo2 } from 'lucide-react'
import type { EditTimeline, MediaItem } from '@shared/types'
import { api, cx, fmtTime, fmtTimePrecise, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Progress } from './ui'

// Timeline simplificada: reordenar (arrastar), aparar início/fim sem tocar no arquivo (I / O),
// tirar da timeline e "Montar timeline" (gera uma nova versão). Os cortes também entram no contexto
// do Claude. A trilha "Edição" mostra os trechos da última montagem do montar.py (edit/timeline.json).

const MIN_PX_PER_SEC = 14
const MAX_PX_PER_SEC = 90
const MIN_W = 90

const span = (m: MediaItem): number => Math.max(0.2, (m.trimOut ?? m.duration ?? 4) - (m.trimIn ?? 0))
const isTrimmed = (m: MediaItem): boolean => m.trimIn != null || m.trimOut != null

function Track({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch gap-2">
      <div className="flex w-20 shrink-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{icon}{label}</div>
      <div className="flex min-h-[44px] flex-1 items-stretch gap-1 rounded-md bg-bg/60 p-1">{children}</div>
    </div>
  )
}

function TimeInput({ value, max, onCommit }: { value: number; max: number; onCommit(v: number): void }) {
  const [text, setText] = useState(value.toFixed(2))
  useEffect(() => setText(value.toFixed(2)), [value])
  const commit = (): void => {
    const n = Number(text.replace(',', '.'))
    if (Number.isFinite(n)) onCommit(Math.max(0, Math.min(max, n)))
    else setText(value.toFixed(2))
  }
  return (
    <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="h-7 w-20 rounded-md border border-line-2 bg-bg px-2 text-right font-mono text-[11.5px] outline-none focus:border-accent" />
  )
}

function TrimEditor({ m }: { m: MediaItem }) {
  const { projectId, refreshMedia, playerTime, source } = useStore()
  const dur = m.duration ?? 0
  const a = m.trimIn ?? 0
  const b = m.trimOut ?? dur
  const playing = source?.kind === 'media' && source.id === m.id

  const save = async (inV: number | null, outV: number | null): Promise<void> => {
    if (!projectId) return
    await api.media.setTrim(projectId, m.id, inV, outV)
    await refreshMedia()
  }
  const toggle = async (): Promise<void> => {
    if (!projectId) return
    await api.media.setInTimeline(projectId, m.id, !m.inTimeline)
    await refreshMedia()
  }
  const seek = (t: number): void => useStore.setState((s) => ({ seekRequest: { t, n: (s.seekRequest?.n ?? 0) + 1 } }))

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs">
      <span className="max-w-48 truncate font-medium" title={m.name}>{m.name}</span>
      {m.kind !== 'image' && (
        <>
          <label className="flex items-center gap-1.5 text-muted">Início
            <TimeInput value={a} max={dur} onCommit={(v) => save(v, m.trimOut)} />
            <Button size="sm" variant="ghost" disabled={!playing} title="Marcar posição do player (I)" onClick={() => save(playerTime, m.trimOut)}>I</Button>
          </label>
          <label className="flex items-center gap-1.5 text-muted">Fim
            <TimeInput value={b} max={dur} onCommit={(v) => save(m.trimIn, v)} />
            <Button size="sm" variant="ghost" disabled={!playing} title="Marcar posição do player (O)" onClick={() => save(m.trimIn, playerTime)}>O</Button>
          </label>
          <span className="font-mono text-faint">{fmtTimePrecise(b - a)} de {fmtTimePrecise(dur)}</span>
          <Button size="sm" variant="ghost" onClick={() => seek(a)}>Ir ao início</Button>
          {isTrimmed(m) && <Button size="sm" variant="ghost" onClick={() => save(null, null)}><Undo2 className="h-3.5 w-3.5" />Limpar corte</Button>}
        </>
      )}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={toggle}>
        {m.inTimeline ? <><EyeOff className="h-3.5 w-3.5" />Tirar da timeline</> : <><Eye className="h-3.5 w-3.5" />Voltar para a timeline</>}
      </Button>
    </div>
  )
}

export function Timeline() {
  const { media, projectId, refreshMedia, setSource, setCompare, versions, task, toast } = useStore()
  const [edit, setEdit] = useState<EditTimeline | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const current = projectId ? task[projectId] : undefined
  const sel = media.find((m) => m.id === selected)
  // Escala que faz a trilha mais longa caber na largura do painel (com limites).
  const tracksRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const el = tracksRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (projectId) api.media.timeline(projectId).then(setEdit)
  }, [projectId, versions.length])

  // Atalhos I / O marcam início e fim do clipe selecionado na posição do player.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (!sel || !projectId || tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k !== 'i' && k !== 'o') return
      const src = useStore.getState().source
      if (src?.kind !== 'media' || src.id !== sel.id) return
      const t = useStore.getState().playerTime
      api.media.setTrim(projectId, sel.id, k === 'i' ? t : sel.trimIn, k === 'o' ? t : sel.trimOut).then(refreshMedia)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, projectId, refreshMedia])

  const reorder = async (targetId: string): Promise<void> => {
    if (!projectId || !dragId || dragId === targetId) return
    const ids = media.map((m) => m.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    useStore.setState({ media: ids.map((id) => media.find((m) => m.id === id)!) })
    await api.media.reorder(projectId, ids)
    await refreshMedia()
  }

  const assemble = async (): Promise<void> => {
    if (!projectId) return
    try {
      const vs = await api.media.assemble(projectId)
      const versionsNow = await api.versions.list(projectId)
      useStore.setState({ versions: versionsNow })
      await useStore.getState().loadProjects()
      if (vs.length) {
        setCompare(false)
        setSource({ kind: 'version', id: vs[vs.length - 1].id })
        toast(`Nova versão: ${vs[vs.length - 1].label}`, 'ok')
      }
    } catch (err) {
      toast(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad')
    }
  }

  const clip = (m: MediaItem, tone: string, pps: number): React.ReactNode => (
    <div
      key={m.id}
      draggable
      onDragStart={() => setDragId(m.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        reorder(m.id)
      }}
      onDragEnd={() => setDragId(null)}
      onClick={() => {
        setSelected(m.id)
        setCompare(false)
        setSource({ kind: 'media', id: m.id })
      }}
      style={{ width: Math.max(MIN_W, span(m) * pps) }}
      className={cx(
        'group relative flex shrink-0 cursor-grab items-center gap-1.5 overflow-hidden rounded border px-1.5 text-[11px] active:cursor-grabbing',
        tone, dragId === m.id && 'opacity-40', !m.inTimeline && 'opacity-35 grayscale', selected === m.id && 'ring-2 ring-accent'
      )}
      title={`${m.name} — clique para editar, arraste para reordenar`}
    >
      {m.thumbnail && <img src={mediaUrl(m.thumbnail)} className="absolute inset-0 h-full w-full object-cover opacity-25" alt="" />}
      <GripVertical className="relative h-3 w-3 shrink-0 opacity-50" />
      <span className="relative truncate font-medium">{m.name}</span>
      {isTrimmed(m) && <Scissors className="relative h-3 w-3 shrink-0 text-accent" />}
      {m.duration != null && <span className="relative ml-auto shrink-0 font-mono text-[10px] opacity-70">{fmtTime(span(m))}</span>}
    </div>
  )

  const videos = media.filter((m) => m.kind === 'video')
  const audios = media.filter((m) => m.kind === 'audio')
  const images = media.filter((m) => m.kind === 'image')
  const total = videos.filter((m) => m.inTimeline).reduce((s, m) => s + span(m), 0)
  const longest = Math.max(1, videos.reduce((s, m) => s + span(m), 0), ...audios.map(span), edit?.duration ?? 0)
  const PX_PER_SEC = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, (width - 100) / longest))

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted">Duração montada: <span className="font-mono text-fg">{fmtTimePrecise(total)}</span></span>
        <span className="text-[11px] text-faint">Clique num clipe para aparar (I/O marcam no player) · arraste para reordenar</span>
        <div className="ml-auto flex items-center gap-2">
          {current && (
            <div className="w-40">
              <p className="mb-1 text-[10.5px] text-muted">{current.text} {current.progress != null && `${Math.round(current.progress * 100)}%`}</p>
              <Progress value={current.progress ?? undefined} indeterminate={current.progress == null} />
            </div>
          )}
          <Button size="sm" variant="primary" disabled={!videos.some((m) => m.inTimeline) || Boolean(current)} onClick={assemble}>
            <Layers className="h-3.5 w-3.5" />Montar timeline
          </Button>
        </div>
      </div>

      {sel && <TrimEditor m={sel} />}

      <div ref={tracksRef} className="space-y-2 overflow-x-auto pb-1">
        {edit && edit.segments.length > 0 && (
          <Track label="Edição" icon={<Scissors className="h-3 w-3" />}>
            {edit.segments.map((s, i) => {
              const d = (edit.cuts[i + 1] ?? edit.duration) - (edit.cuts[i] ?? 0)
              return (
                <div key={i} style={{ width: Math.max(56, d * PX_PER_SEC) }}
                  className="flex shrink-0 flex-col justify-center overflow-hidden rounded border border-accent/40 bg-accent/15 px-1.5 text-[10.5px]"
                  title={`${s}: ${fmtTime(edit.cuts[i])} – ${fmtTime(edit.cuts[i + 1])}`}>
                  <span className="truncate font-medium text-fg">{s}</span>
                  <span className="font-mono text-[9.5px] text-muted">{d.toFixed(1)} s</span>
                </div>
              )
            })}
          </Track>
        )}
        <Track label="Vídeo" icon={<Film className="h-3 w-3" />}>
          {videos.length ? videos.map((m) => clip(m, 'border-info/40 bg-info/15 text-fg', PX_PER_SEC)) : <span className="self-center px-2 text-[11px] text-faint">sem vídeos</span>}
        </Track>
        <Track label="Áudio" icon={<Music className="h-3 w-3" />}>
          {audios.length ? audios.map((m) => clip(m, 'border-ok/35 bg-ok/10 text-fg', PX_PER_SEC)) : <span className="self-center px-2 text-[11px] text-faint">sem áudio importado — o Claude sorteia uma música de E:\aqc\Recursos</span>}
        </Track>
        {images.length > 0 && (
          <Track label="Imagens" icon={<ImageIcon className="h-3 w-3" />}>
            {images.map((m) => clip(m, 'border-warn/35 bg-warn/10 text-fg', PX_PER_SEC))}
          </Track>
        )}
      </div>
    </div>
  )
}
