import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  Bookmark, ClipboardPaste, Columns2, Copy, Eye, EyeOff, Film, Layers, Link2, ListRestart, Lock, Magnet, Music, Pause, Play, Redo2, Scissors,
  ShieldCheck, Shuffle, Sparkles, Trash2, Undo2, Unlink, Unlock, Volume2, VolumeX, WandSparkles, ZoomIn
} from 'lucide-react'
import { clipEnd, clipLength, trackClips, type Clip, type Command, type Track } from '@shared/composition'
import { api, cx, fmtTime, fmtTimePrecise, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { Button, IconButton, Progress } from '@/components/ui'
import { Waveform } from '@/components/Waveform'
import { Timeline as SimpleTimeline } from '@/components/Timeline'
import { Browser, DND } from './Browser'
import { Inspector } from './Inspector'
import { errorMessage, useEditor } from './editorStore'
import { AutoStudioDialog } from './AutoStudioDialog'
import { QualityDialog } from './QualityDialog'
import { EditorTour } from './EditorTour'

const HEADER = 150
const ROW: Record<Track['kind'], number> = { video: 54, audio: 40 }
const EDGE = 7 // px que contam como borda de corte
const SNAP_PX = 8
const FRAME = 1 / 30

interface Drag {
  id: string
  /** slip = Alt+arrastar: troca o trecho do arquivo sem mexer na posição. */
  mode: 'move' | 'in' | 'out' | 'slip'
  group?: string
  /** Quanto o grupo pode andar para a esquerda (o membro mais cedo para no zero). */
  groupSlack: number
  x0: number
  start: number
  inP: number
  /** No freeze frame `outP` é virtual: início + duração do congelamento. */
  outP: number
  /** Segundos do arquivo por segundo de timeline (1 no freeze frame). */
  sp: number
  hold: boolean
  trackId: string
  /** Resultado provisório (o que a tela mostra durante o arraste). */
  nStart: number
  nIn: number
  nOut: number
  nTrack: string
  snapAt: number | null
}

interface Menu { x: number; y: number; clipId: string }

/** Trilhas na ordem da tela: vídeos de cima (mais alta) para baixo, depois áudios. */
function displayTracks(tracks: Track[]): Track[] {
  const v = tracks.filter((t) => t.kind === 'video').reverse()
  const a = tracks.filter((t) => t.kind === 'audio')
  return [...v, ...a]
}

export function TimelineEditor() {
  const projectId = useStore((s) => s.projectId)
  const media = useStore((s) => s.media)
  const task = useStore((s) => (s.projectId ? s.task[s.projectId] : undefined))
  const toast = useStore((s) => s.toast)
  const ed = useEditor()
  const { doc, pxPerSec: pps, playhead, selection, snapping, ripple } = ed
  const [simple, setSimple] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [exactBusy, setExactBusy] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)
  const [qcOpen, setQcOpen] = useState(false)
  // A paleta de comandos abre o Auto Studio e o Quality Check daqui.
  useEffect(() => {
    const auto = (): void => setAutoOpen(true)
    const qc = (): void => setQcOpen(true)
    window.addEventListener('pq-open-auto', auto)
    window.addEventListener('pq-open-qc', qc)
    return () => { window.removeEventListener('pq-open-auto', auto); window.removeEventListener('pq-open-qc', qc) }
  }, [])
  const scroller = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)

  useEffect(() => {
    if (projectId && useEditor.getState().projectId !== projectId) void ed.load(projectId)
  }, [projectId])
  // Edições feitas por outro caminho (agente, outra janela) chegam por evento.
  useEffect(() => api.composition.onChanged((pid) => { if (pid === useEditor.getState().projectId) void useEditor.getState().load(pid) }), [])
  // Mudanças na mídia (importar, remover) também afetam a composição derivada.
  useEffect(() => { if (projectId) void useEditor.getState().load(projectId) }, [media.length])

  const duration = ed.duration()
  const tracks = useMemo(() => (doc ? displayTracks(doc.tracks) : []), [doc])
  const mediaOf = useCallback((id: string) => media.find((m) => m.id === id), [media])
  const width = Math.max((duration + 20) * pps, 600)

  // ---------- tempo / snap ----------
  const timeAt = (clientX: number): number => {
    const el = scroller.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, (clientX - r.left - HEADER + el.scrollLeft) / pps)
  }
  const snapPoints = (exclude: string | null): number[] => {
    if (!doc) return [0]
    const pts = [0, playhead, ...doc.markers.map((m) => m.time)]
    for (const c of doc.clips) if (c.id !== exclude) pts.push(c.start, clipEnd(c))
    return pts
  }
  const snap = (t: number, exclude: string | null, extra: number[] = []): { t: number; at: number | null } => {
    if (!snapping) return { t, at: null }
    let best: number | null = null
    let dist = SNAP_PX / pps
    for (const p of [...snapPoints(exclude), ...extra]) {
      const d = Math.abs(p - t)
      if (d < dist) { dist = d; best = p }
    }
    return best === null ? { t, at: null } : { t: best, at: best }
  }

  // ---------- arraste de clipes ----------
  const onClipDown = (e: RPointerEvent, c: Clip, track: Track): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    ed.select(c.id, e.shiftKey || e.ctrlKey || e.metaKey)
    if (track.locked) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mode: Drag['mode'] = e.clientX - rect.left < EDGE ? 'in' : rect.right - e.clientX < EDGE ? 'out' : 'move'
    const hold = c.hold > 0
    const outP = hold ? c.in + c.hold : c.out
    // Freeze frame não tem início para cortar: a borda esquerda só move o clipe.
    const m0 = hold && mode === 'in' ? 'move' : mode === 'move' && e.altKey && !hold ? 'slip' : mode
    const groupSlack = c.group ? c.start - Math.min(...(doc?.clips ?? []).filter((x) => x.group === c.group).map((x) => x.start)) : 0
    const d: Drag = { id: c.id, mode: m0, group: c.group, groupSlack, x0: e.clientX, start: c.start, inP: c.in, outP, sp: hold ? 1 : c.speed || 1, hold, trackId: c.trackId, nStart: c.start, nIn: c.in, nOut: outP, nTrack: c.trackId, snapAt: null }
    dragRef.current = d
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onClipMove = (e: RPointerEvent, c: Clip): void => {
    const d = dragRef.current
    if (!d || d.id !== c.id) return
    const dt = (e.clientX - d.x0) / pps
    if (Math.abs(e.clientX - d.x0) < 3 && !drag) return
    const m = mediaOf(c.mediaId)
    // Tudo em segundos de timeline; `sp` converte para segundos do arquivo.
    const sp = d.sp
    const len = (d.outP - d.inP) / sp
    const next = { ...d }
    if (d.mode === 'move') {
      const floor = d.groupSlack
      let s = Math.max(floor, d.start + dt)
      const a = snap(s, c.id)
      const b = snap(s + len, c.id)
      if (a.at !== null && (b.at === null || Math.abs(a.t - s) <= Math.abs(b.t - s - len))) { s = a.t; next.snapAt = a.at } else if (b.at !== null) { s = b.t - len; next.snapAt = b.at } else next.snapAt = null
      next.nStart = Math.max(floor, s)
      // Trilha sob o ponteiro (só do mesmo tipo).
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track]') as HTMLElement | null
      const target = el?.dataset.track
      const tk = doc?.tracks.find((t) => t.id === target)
      const src = doc?.tracks.find((t) => t.id === d.trackId)
      if (tk && src && tk.kind === src.kind && !tk.locked) next.nTrack = tk.id
    } else if (d.mode === 'slip') {
      // Arrastar para a direita mostra um trecho anterior do arquivo (o conteúdo "anda" junto com o mouse).
      const srcLen = d.outP - d.inP
      const maxIn = m?.kind === 'image' || c.title ? d.inP : Math.max(0, (m?.duration ?? d.outP) - srcLen)
      const ni = Math.min(maxIn, Math.max(0, d.inP - dt * sp))
      next.nIn = ni
      next.nOut = ni + srcLen
    } else if (d.mode === 'in') {
      // Sem ripple o início não passa do zero da timeline.
      const minIn = m?.kind === 'image' || c.title ? d.inP : ripple ? 0 : Math.max(0, d.inP - d.start * sp)
      const maxIn = d.outP - 0.1 * sp
      let ni = Math.min(maxIn, Math.max(minIn, d.inP + dt * sp))
      const sn = snap(d.start + (ni - d.inP) / sp, c.id)
      if (sn.at !== null) ni = Math.min(maxIn, Math.max(minIn, d.inP + (sn.t - d.start) * sp))
      next.snapAt = sn.at
      next.nIn = ni
      next.nStart = d.start + (ni - d.inP) / sp
    } else {
      const maxOut = m?.kind === 'image' || c.title || d.hold ? d.inP + 600 : m?.duration ?? d.outP
      const minOut = d.inP + 0.1 * sp
      let no = Math.max(minOut, Math.min(maxOut, d.outP + dt * sp))
      const sn = snap(d.start + (no - d.inP) / sp, c.id)
      if (sn.at !== null) no = Math.max(minOut, Math.min(maxOut, d.inP + (sn.t - d.start) * sp))
      next.snapAt = sn.at
      next.nOut = no
    }
    dragRef.current = next
    setDrag(next)
  }
  const onClipUp = (c: Clip): void => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d || d.id !== c.id) return
    const cmds: Command[] = []
    if (d.mode === 'move' && (Math.abs(d.nStart - d.start) > 0.001 || d.nTrack !== d.trackId)) cmds.push({ type: 'moveClip', clipId: c.id, start: round(d.nStart), trackId: d.nTrack })
    if (d.mode === 'slip' && Math.abs(d.nIn - d.inP) > 0.001) cmds.push({ type: 'slipClip', clipId: c.id, delta: round(d.nIn - d.inP) })
    if (d.mode === 'in' && Math.abs(d.nIn - d.inP) > 0.001) cmds.push({ type: 'trimClip', clipId: c.id, in: round(d.nIn), ripple })
    if (d.mode === 'out' && Math.abs(d.nOut - d.outP) > 0.001) cmds.push({ type: 'trimClip', clipId: c.id, out: round(d.nOut), ripple })
    if (cmds.length) void ed.edit(cmds)
  }

  // ---------- soltar recursos ----------
  const onTrackDrop = (e: DragEvent, track: Track): void => {
    e.preventDefault()
    const dt = e.dataTransfer
    const clipEl = (e.target as HTMLElement).closest('[data-clip]') as HTMLElement | null
    const clipId = clipEl?.dataset.clip
    const mediaId = dt.getData(DND.media)
    if (mediaId) {
      const m = mediaOf(mediaId)
      if (!m) return
      const kind = m.kind === 'audio' ? 'audio' : 'video'
      const target = track.kind === kind ? track.id : undefined
      void ed.edit([{ type: 'addClip', mediaId, trackId: target, start: round(snap(timeAt(e.clientX), null).t) }])
      return
    }
    if (!clipId) return toast('Solte transições, efeitos e LUTs em cima de um clipe.', 'bad')
    const tr = dt.getData(DND.transition)
    const fx = dt.getData(DND.effect)
    const lut = dt.getData(DND.lut)
    if (tr) void ed.edit([{ type: 'setTransition', clipId, transition: { type: tr } }])
    else if (fx) void ed.edit([{ type: 'addEffect', clipId, effect: fx }])
    else if (lut) void ed.edit([{ type: 'addEffect', clipId, effect: 'lut', asset: lut }])
    ed.select(clipId)
  }
  const acceptsDrop = (e: DragEvent): void => {
    if (Object.values(DND).some((t) => e.dataTransfer.types.includes(t))) e.preventDefault()
  }

  // ---------- ações ----------
  const selectedClips = (): Clip[] => (doc?.clips ?? []).filter((c) => selection.includes(c.id))
  const splitAtPlayhead = (): void => {
    if (!doc) return
    const t = useEditor.getState().playhead
    let targets = selectedClips().filter((c) => t > c.start + 0.1 && t < clipEnd(c) - 0.1)
    if (!targets.length) targets = doc.clips.filter((c) => t > c.start + 0.1 && t < clipEnd(c) - 0.1 && !doc.tracks.find((x) => x.id === c.trackId)?.locked)
    if (!targets.length) return toast('Nenhum clipe sob o playhead para dividir.', 'bad')
    void ed.edit(targets.map((c) => ({ type: 'splitClip', clipId: c.id, at: round(t) })))
  }
  const removeSelected = (withRipple: boolean): void => {
    const ids = selectedClips().map((c) => c.id)
    if (ids.length) void ed.edit(ids.map((clipId) => ({ type: 'removeClip', clipId, ripple: withRipple })))
  }
  const copyAttrs = (id?: string): void => {
    const src = id ?? selection[0]
    if (!src) return
    useEditor.setState({ clipboard: src })
    toast('Efeitos e animações copiados. Selecione clipes e cole (Ctrl+V).', 'ok')
  }
  const pasteAttrs = (ids?: string[]): void => {
    const from = useEditor.getState().clipboard
    const to = (ids ?? selection).filter((x) => x !== from)
    if (!from || !to.length) return
    void ed.edit([{ type: 'pasteAttributes', fromClipId: from, toClipIds: to, effects: true, keyframes: true }])
  }
  const zoomTo = (next: number, anchorClientX?: number): void => {
    const el = scroller.current
    const clamped = Math.min(400, Math.max(4, next))
    if (el && anchorClientX !== undefined) {
      const t = timeAt(anchorClientX)
      const offset = anchorClientX - el.getBoundingClientRect().left - HEADER
      useEditor.setState({ pxPerSec: clamped })
      requestAnimationFrame(() => { el.scrollLeft = Math.max(0, t * clamped - offset) })
    } else useEditor.setState({ pxPerSec: clamped })
  }
  const fit = (): void => {
    const el = scroller.current
    if (el && duration > 0) zoomTo((el.clientWidth - HEADER - 40) / duration)
  }
  /** `compare`: gera também o "antes" (sem efeitos de imagem) para comparar lado a lado. */
  const exactPreview = async (compare = false): Promise<void> => {
    if (!projectId) return
    setExactBusy(true)
    try {
      const start = Math.max(0, Math.min(playhead, duration - 0.5))
      const len = Math.min(10, duration - start)
      const r = await api.composition.renderPreview(projectId, start, len)
      // Um de cada vez: os dois disputariam a GPU.
      const before = compare ? (await api.composition.renderPreview(projectId, start, len, true)).path : undefined
      // O player passa a mostrar a timeline (senão a prévia não teria onde aparecer).
      // Se o player ainda não está montado, ele pega a prévia pendente ao montar.
      const detail = { ...r, before }
      ;(window as unknown as { __pqExact?: unknown }).__pqExact = detail
      useEditor.setState({ previewActive: true })
      window.dispatchEvent(new CustomEvent('pq-exact-preview', { detail }))
    } catch (err) {
      toast(errorMessage(err), 'bad')
    } finally {
      setExactBusy(false)
    }
  }
  const assemble = async (): Promise<void> => {
    if (!projectId) return
    try {
      const vs = await api.media.assemble(projectId)
      useStore.setState({ versions: await api.versions.list(projectId) })
      await useStore.getState().loadProjects()
      if (vs.length) {
        useStore.getState().setCompare(false)
        useStore.getState().setSource({ kind: 'version', id: vs[vs.length - 1].id })
        toast(`Nova versão: ${vs[vs.length - 1].label}`, 'ok')
      }
    } catch (err) {
      toast(errorMessage(err), 'bad')
    }
  }

  // ---------- teclado ----------
  useEffect(() => {
    if (simple) return
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return
      const st = useEditor.getState()
      const k = e.key.toLowerCase()
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); if (st.redo) void st.travel('redo'); return }
      if (ctrl && k === 'z') { e.preventDefault(); if (st.undo) void st.travel('undo'); return }
      if (ctrl && k === 'c') { copyAttrs(); return }
      if (ctrl && k === 'v') { pasteAttrs(); return }
      if (ctrl && k === 'g') {
        e.preventDefault()
        if (e.shiftKey) { if (st.selection.length) void st.edit([{ type: 'ungroupClips', clipIds: st.selection }]) }
        else if (st.selection.length > 1) void st.edit([{ type: 'groupClips', clipIds: st.selection }])
        return
      }
      if (ctrl && k === 'a') { e.preventDefault(); useEditor.setState({ selection: st.doc?.clips.map((c) => c.id) ?? [] }); return }
      if (ctrl) return
      if (k === ' ') { e.preventDefault(); st.setPlaying(!st.playing); return }
      if (k === 's' || (k === 'b' && ctrl)) { e.preventDefault(); splitAtPlayhead(); return }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSelected(e.shiftKey || st.ripple); return }
      if (k === 'm') { void st.edit([{ type: 'addMarker', time: round(st.playhead) }]); return }
      if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); st.setPlayhead(st.playhead + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : FRAME)); return }
      if (k === 'home') { st.setPlayhead(0); return }
      if (k === 'end') { st.setPlayhead(st.duration()); return }
      if (k === '+' || k === '=') { zoomTo(st.pxPerSec * 1.25); return }
      if (k === '-') { zoomTo(st.pxPerSec / 1.25); return }
      if (k === 'escape') { useEditor.setState({ selection: [] }); setMenu(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [simple, selection, doc])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  // Mantém o playhead visível durante a reprodução.
  useEffect(() => {
    const el = scroller.current
    if (!el || !ed.playing) return
    const x = playhead * pps
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEADER - 40) el.scrollLeft = Math.max(0, x - 80)
  }, [playhead, ed.playing, pps])

  if (simple) {
    return (
      <div className="h-full">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-muted">
          <Button size="sm" variant="ghost" onClick={() => setSimple(false)}><Layers className="h-3.5 w-3.5" />Timeline completa</Button>
          {doc?.origin === 'manual'
            ? <span className="text-warn">A timeline completa foi editada; os cortes daqui só valem se você voltar para a timeline simples.</span>
            : <span>Modo simples: ordem e cortes dos arquivos.</span>}
        </div>
        <SimpleTimeline />
      </div>
    )
  }

  const tickStep = pps > 120 ? 0.5 : pps > 60 ? 1 : pps > 25 ? 2 : pps > 10 ? 5 : 10
  const ticks = Math.ceil(width / pps / tickStep)
  const busy = Boolean(task) || ed.busy

  return (
    <Group orientation="horizontal" id="pq-editor" className="h-full">
      <Panel id="browser" defaultSize="18%" minSize="150px" maxSize="35%" collapsible collapsedSize="0px">
        <Browser />
      </Panel>
      <Separator className="w-px" />
      <Panel id="timeline" minSize="40%">
        <div className="flex h-full flex-col" onDragOver={acceptsDrop}>
          {/* Barra de ferramentas */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1">
            <IconButton title={ed.playing ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'} onClick={() => ed.setPlaying(!ed.playing)}>{ed.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</IconButton>
            <span className="mr-1 font-mono text-[11px] tabular-nums text-fg">{fmtTimePrecise(playhead)}<span className="text-faint"> / {fmtTimePrecise(duration)}</span></span>
            <span className="mx-1 h-4 w-px bg-line" />
            <IconButton title="Desfazer (Ctrl+Z)" disabled={!ed.undo || ed.busy} onClick={() => void ed.travel('undo')}><Undo2 className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Refazer (Ctrl+Shift+Z)" disabled={!ed.redo || ed.busy} onClick={() => void ed.travel('redo')}><Redo2 className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Dividir no playhead (S)" onClick={splitAtPlayhead}><Scissors className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Excluir seleção (Delete; Shift+Delete fecha o espaço)" disabled={!selection.length} onClick={() => removeSelected(ripple)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Marcador no playhead (M)" onClick={() => void ed.edit([{ type: 'addMarker', time: round(playhead) }])}><Bookmark className="h-3.5 w-3.5" /></IconButton>
            <span className="mx-1 h-4 w-px bg-line" />
            <IconButton title="Snap magnético" active={snapping} onClick={() => useEditor.setState({ snapping: !snapping })}><Magnet className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Ripple: cortar/excluir empurra os clipes seguintes" active={ripple} onClick={() => useEditor.setState({ ripple: !ripple })}><Shuffle className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Nova trilha de vídeo" onClick={() => void ed.edit([{ type: 'addTrack', kind: 'video' }])}><Film className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Nova trilha de áudio" onClick={() => void ed.edit([{ type: 'addTrack', kind: 'audio' }])}><Music className="h-3.5 w-3.5" /></IconButton>
            <span className="mx-1 h-4 w-px bg-line" />
            <ZoomIn className="h-3.5 w-3.5 text-faint" />
            <input type="range" aria-label="Zoom da timeline" min={4} max={400} value={pps} onChange={(e) => zoomTo(Number(e.target.value))} className="w-20" />
            <Button size="sm" variant="ghost" onClick={fit} title="Caber tudo na tela">Caber</Button>
            <div className="ml-auto flex items-center gap-1">
              {task && (
                <div className="w-36">
                  <p className="mb-0.5 truncate text-[10px] text-muted">{task.text} {task.progress != null && `${Math.round(task.progress * 100)}%`}</p>
                  <Progress value={task.progress ?? undefined} indeterminate={task.progress == null} />
                </div>
              )}
              <Button size="sm" variant="ghost" disabled={!duration || exactBusy} onClick={() => void exactPreview(true)} title="Prévia exata dividida: sem efeitos de imagem à esquerda, com efeitos à direita (arraste a divisória)">
                <Columns2 className="h-3.5 w-3.5" />Antes/depois
              </Button>
              <Button size="sm" variant="ghost" data-tour="exact" disabled={!duration || exactBusy} onClick={() => void exactPreview()} title="Renderiza 10 s a partir do playhead com o mesmo motor do export (efeitos, LUTs e mixagem exatos)">
                <WandSparkles className="h-3.5 w-3.5" />{exactBusy ? 'Gerando...' : 'Prévia exata'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSimple(true)} title="Timeline simples (ordem e cortes)"><ListRestart className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" data-tour="qc" onClick={() => setQcOpen(true)} title="Verifica tela preta, textos fora da área segura, volume e mais"><ShieldCheck className="h-3.5 w-3.5" />Verificar</Button>
              <QualityDialog open={qcOpen} onClose={() => setQcOpen(false)} />
              <Button size="sm" variant="ghost" data-tour="auto" onClick={() => setAutoOpen(true)} title="Monta a edição sozinho a partir dos vídeos e da música"><Sparkles className="h-3.5 w-3.5" />Auto Studio</Button>
              <AutoStudioDialog open={autoOpen} onClose={() => setAutoOpen(false)} />
              <EditorTour />
              <Button size="sm" variant="primary" disabled={!duration || busy} onClick={assemble}><Layers className="h-3.5 w-3.5" />Montar versão</Button>
            </div>
          </div>

          {/* Trilhas */}
          <div
            ref={scroller}
            data-tour="timeline"
            className="relative min-h-0 flex-1 overflow-auto"
            onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); zoomTo(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX) } }}
            onPointerDown={() => useEditor.setState({ selection: [] })}
          >
            <div className="relative" style={{ width: width + HEADER, minHeight: '100%' }}>
              {/* Régua */}
              <div
                className="sticky top-0 z-20 flex h-6 border-b border-line bg-panel"
                onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setScrubbing(true); ed.setPlaying(false); ed.setPlayhead(timeAt(e.clientX)) }}
                onPointerMove={(e) => scrubbing && ed.setPlayhead(snap(timeAt(e.clientX), null).t)}
                onPointerUp={() => setScrubbing(false)}
                onDoubleClick={(e) => void ed.edit([{ type: 'addMarker', time: round(timeAt(e.clientX)) }])}
              >
                <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-panel" style={{ width: HEADER }} />
                <div className="relative flex-1 cursor-col-resize font-mono text-[9px] text-faint">
                  {Array.from({ length: ticks + 1 }, (_, i) => (
                    <span key={i} className="absolute bottom-0 border-l border-line-2 pb-0.5 pl-1" style={{ left: i * tickStep * pps }}>{fmtTime(i * tickStep)}</span>
                  ))}
                  {doc?.markers.map((m) => (
                    <button key={m.id} type="button" title={`${m.label || 'Marcador'} · ${fmtTimePrecise(m.time)} (clique direito remove)`}
                      onPointerDown={(e) => { e.stopPropagation(); ed.setPlayhead(m.time) }}
                      onContextMenu={(e) => { e.preventDefault(); void ed.edit([{ type: 'removeMarker', markerId: m.id }]) }}
                      className="absolute top-0 h-3 w-2 -translate-x-1 bg-warn [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]"
                      style={{ left: m.time * pps }} />
                  ))}
                </div>
              </div>

              {tracks.map((track) => {
                const clips = doc ? trackClips(doc, track.id) : []
                return (
                  <div key={track.id} data-track={track.id} className={cx('relative flex border-b border-line', ed.selectedTrack === track.id && 'bg-accent/[0.03]')} style={{ height: ROW[track.kind] }}
                    onDragOver={acceptsDrop} onDrop={(e) => onTrackDrop(e, track)}>
                    <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line bg-panel px-1.5" style={{ width: HEADER }}
                      onPointerDown={(e) => { e.stopPropagation(); useEditor.setState({ selectedTrack: track.id, selection: [] }) }}>
                      <span className={cx('flex-1 truncate text-[10.5px] font-semibold', track.kind === 'video' ? 'text-info' : 'text-ok')}>{track.name}</span>
                      <IconButton className="h-5 w-5" title={track.muted ? 'Ativar som' : 'Silenciar'} active={track.muted} onClick={() => void ed.edit([{ type: 'updateTrack', trackId: track.id, muted: !track.muted }])}>{track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}</IconButton>
                      {track.kind === 'video' && <IconButton className="h-5 w-5" title={track.hidden ? 'Mostrar' : 'Ocultar'} active={track.hidden} onClick={() => void ed.edit([{ type: 'updateTrack', trackId: track.id, hidden: !track.hidden }])}>{track.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}</IconButton>}
                      <IconButton className="h-5 w-5" title={track.locked ? 'Desbloquear' : 'Bloquear'} active={track.locked} onClick={() => void ed.edit([{ type: 'updateTrack', trackId: track.id, locked: !track.locked }])}>{track.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}</IconButton>
                    </div>
                    <div className={cx('relative flex-1', track.locked && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,#ffffff05_6px_12px)]')}>
                      {clips.map((c) => {
                        const m = mediaOf(c.mediaId)
                        const d = drag?.id === c.id ? drag : null
                        // Os outros clipes do grupo acompanham o arraste.
                        const follow = !d && drag?.mode === 'move' && drag.group && drag.group === c.group ? drag.nStart - drag.start : 0
                        const start = d ? d.nStart : Math.max(0, c.start + follow)
                        const len = d ? (d.nOut - d.nIn) / d.sp : clipLength(c)
                        const onOtherTrack = d && d.nTrack !== track.id
                        const selected = selection.includes(c.id)
                        const kfTimes = [...new Set(Object.values(c.keyframes ?? {}).flatMap((k) => k?.map((x) => x.t) ?? []))]
                        return (
                          <div key={c.id} data-clip={c.id}
                            onPointerDown={(e) => onClipDown(e, c, track)} onPointerMove={(e) => onClipMove(e, c)} onPointerUp={() => onClipUp(c)}
                            onDoubleClick={() => ed.setPlayhead(c.start)}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!selection.includes(c.id)) ed.select(c.id); setMenu({ x: e.clientX, y: e.clientY, clipId: c.id }) }}
                            className={cx('group absolute inset-y-1 overflow-hidden rounded border text-[10.5px]',
                              c.title ? 'border-accent/50 bg-accent/20' : track.kind === 'video' ? 'border-info/40 bg-info/15' : 'border-ok/35 bg-ok/12',
                              selected && 'ring-2 ring-accent', onOtherTrack && 'opacity-30', track.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing')}
                            style={{ left: start * pps, width: Math.max(3, len * pps) }}
                            title={`${c.title ? `Título: ${c.title.text.split('\n')[0]}` : m?.name ?? 'Arquivo ausente'} · ${fmtTimePrecise(len)} · Alt+arrastar = slip${c.effects.length ? ` · ${c.effects.length} efeito(s)` : ''}`}>
                            {m?.thumbnail && track.kind === 'video' && <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `url("${mediaUrl(m.thumbnail)}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />}
                            {m && m.hasAudio && projectId && c.hold <= 0 && <Waveform item={m} projectId={projectId} range={{ in: d ? d.nIn : c.in, out: d ? d.nOut : c.out }} />}
                            {c.transitionIn && <div className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(135deg,#8b5cf655_0_4px,transparent_4px_8px)]" style={{ width: c.transitionIn.duration * pps }} title="Transição" />}
                            <div className="relative flex items-center gap-1 px-1.5 pt-0.5">
                              <span className="truncate font-medium">{c.title ? `T  ${c.title.text.split('\n')[0]}` : m?.name ?? 'Arquivo ausente'}</span>
                              {c.effects.length > 0 && <span className="rounded bg-accent/25 px-1 text-[9px] text-accent">fx {c.effects.length}</span>}
                              {c.hold > 0 ? <span className="rounded bg-warn/25 px-1 text-[9px] text-warn">freeze</span>
                                : c.speed !== 1 && <span className="rounded bg-white/15 px-1 text-[9px]">{Number(c.speed.toFixed(2))}×</span>}
                            </div>
                            {c.group && <span className="absolute inset-x-0 top-0 h-[3px] bg-warn/70" title="Agrupado (Ctrl+Shift+G desagrupa)" />}
                            {kfTimes.map((t) => <span key={t} className="absolute bottom-0.5 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-accent" style={{ left: t * pps }} />)}
                            {!track.locked && <>
                              <span className="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize opacity-0 group-hover:bg-white/20 group-hover:opacity-100" />
                              <span className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize opacity-0 group-hover:bg-white/20 group-hover:opacity-100" />
                            </>}
                          </div>
                        )
                      })}
                      {/* Fantasma do clipe arrastado para outra trilha */}
                      {drag && drag.nTrack === track.id && drag.trackId !== track.id && (
                        <div className="pointer-events-none absolute inset-y-1 rounded border-2 border-dashed border-accent bg-accent/10" style={{ left: drag.nStart * pps, width: ((drag.nOut - drag.nIn) / drag.sp) * pps }} />
                      )}
                    </div>
                  </div>
                )
              })}

              {!doc?.clips.length && (
                <div className="pointer-events-none absolute inset-x-0 top-24 text-center text-[12px] text-faint" style={{ paddingLeft: HEADER }}>
                  Arraste vídeos, áudios e imagens da coluna da esquerda para as trilhas.
                </div>
              )}

              {/* Playhead e linha de snap */}
              <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-accent" style={{ left: HEADER + playhead * pps }}>
                <span className="absolute -left-[5px] top-0 h-2.5 w-[11px] bg-accent [clip-path:polygon(0_0,100%_0,50%_100%)]" />
              </div>
              {drag?.snapAt != null && <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-warn" style={{ left: HEADER + drag.snapAt * pps }} />}
            </div>
          </div>
        </div>

        {menu && (
          <div className="fixed z-50 min-w-48 rounded-lg border border-line-2 bg-panel py-1 text-[12px] shadow-xl shadow-black/50" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            {[
              { label: 'Dividir no playhead', icon: Scissors, run: splitAtPlayhead },
              { label: 'Copiar efeitos e animações', icon: Copy, run: () => copyAttrs(menu.clipId) },
              { label: 'Colar efeitos e animações', icon: ClipboardPaste, run: () => pasteAttrs(selection.length ? selection : [menu.clipId]), disabled: !ed.clipboard },
              { label: 'Agrupar seleção (Ctrl+G)', icon: Link2, run: () => void ed.edit([{ type: 'groupClips', clipIds: selection }]), disabled: selection.length < 2 },
              { label: 'Desagrupar (Ctrl+Shift+G)', icon: Unlink, run: () => void ed.edit([{ type: 'ungroupClips', clipIds: [menu.clipId] }]), disabled: !doc?.clips.find((c) => c.id === menu.clipId)?.group },
              { label: 'Remover transição', icon: Shuffle, run: () => void ed.edit([{ type: 'setTransition', clipId: menu.clipId, transition: null }]), disabled: !doc?.clips.find((c) => c.id === menu.clipId)?.transitionIn },
              { label: 'Remover todos os efeitos', icon: WandSparkles, run: () => { const c = doc?.clips.find((x) => x.id === menu.clipId); if (c?.effects.length) void ed.edit(c.effects.map((e) => ({ type: 'removeEffect', clipId: c.id, effectId: e.id }))) } },
              { label: 'Excluir', icon: Trash2, run: () => void ed.edit([{ type: 'removeClip', clipId: menu.clipId }]) },
              { label: 'Excluir e fechar o espaço', icon: Trash2, run: () => void ed.edit([{ type: 'removeClip', clipId: menu.clipId, ripple: true }]) }
            ].map((it) => (
              <button key={it.label} type="button" disabled={it.disabled} onClick={() => { setMenu(null); it.run() }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-raised disabled:opacity-40">
                <it.icon className="h-3.5 w-3.5 text-muted" />{it.label}
              </button>
            ))}
          </div>
        )}
      </Panel>
      <Separator className="w-px" />
      <Panel id="inspector" defaultSize="24%" minSize="240px" maxSize="40%" collapsible collapsedSize="0px">
        <Inspector />
      </Panel>
    </Group>
  )
}

const round = (v: number): number => Math.round(v * 1000) / 1000
