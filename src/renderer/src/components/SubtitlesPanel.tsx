import { useEffect, useRef, useState } from 'react'
import { Captions, Download, Import, Plus, Save, Trash2, Wand2 } from 'lucide-react'
import type { SubtitleDocument } from '@shared/types'
import { emptySubtitles, validateSubtitles } from '@shared/subtitles'
import { api } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Empty } from './ui'

export function SubtitlesPanel() {
  const { projectId, media, versions, source, playerTime, toast, live } = useStore()
  const sources = [...versions.map((v) => ({ path: v.path, label: v.label, kind: 'version' as const, id: v.id })), ...media.filter((m) => m.kind === 'video').map((m) => ({ path: m.path, label: m.name, kind: 'media' as const, id: m.id }))]
  const [path, setPath] = useState(() => sources.find((s) => s.id === source?.id)?.path ?? sources[0]?.path ?? '')
  const [doc, setDoc] = useState<SubtitleDocument>(emptySubtitles)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const wasRunning = useRef(false)
  const running = Boolean(projectId && live[projectId]?.running)
  const report = (err: unknown): void => toast((err as Error).message, 'bad')
  useEffect(() => {
    if (!path && sources.length) setPath(sources.find((s) => s.id === source?.id)?.path ?? sources[0].path)
  }, [path, sources.length, source?.id])
  useEffect(() => {
    let alive = true
    setLoaded(false)
    if (projectId && path) api.subtitles.load(projectId, path).then((d) => { if (alive) { setDoc(d); setDirty(false); setLoaded(true) } }).catch(report)
    return () => { alive = false }
  }, [projectId, path])
  useEffect(() => {
    if (loaded && path) useStore.setState({ subtitlePreview: { path, document: doc } })
  }, [path, doc, loaded])
  const reload = async (): Promise<void> => {
    if (!projectId || !path) return
    setBusy(true)
    try { setDoc(await api.subtitles.generated(projectId, path)); setDirty(false); toast('Legendas geradas carregadas', 'ok') }
    catch (err) { report(err) }
    finally { setBusy(false); setWaiting(false) }
  }
  useEffect(() => {
    if (waiting && wasRunning.current && !running) void reload()
    wasRunning.current = running
  }, [running, waiting])
  const update = (next: SubtitleDocument): void => { setDoc(next); setDirty(true) }
  const save = async (): Promise<void> => {
    if (!projectId) return
    setBusy(true)
    try { setDoc(await api.subtitles.save(projectId, path, validateSubtitles(doc))); setDirty(false); toast('Legendas salvas', 'ok') }
    catch (err) { report(err) }
    finally { setBusy(false) }
  }
  const generate = async (): Promise<void> => {
    if (!projectId || !path || running) return
    setBusy(true)
    try {
      const target = await api.subtitles.target(projectId, path)
      useStore.setState({ region: null })
      setWaiting(true)
      await useStore.getState().sendChat(`Gere legendas em português para o áudio real do arquivo ${JSON.stringify(path)}. Use uma ferramenta de transcrição disponível neste ambiente; não invente falas. Se não houver ferramenta, informe a limitação sem instalar nada automaticamente. Salve apenas o SRT UTF-8 em ${JSON.stringify(target)}, com tempos relativos a este arquivo, blocos curtos e sem sobreposição. Não renderize nem altere o vídeo. A geração de legendas está autorizada.`)
      if (!useStore.getState().live[projectId]?.running) setWaiting(false)
      useStore.getState().focusChat()
    } catch (err) { setWaiting(false); report(err) }
    finally { setBusy(false) }
  }
  if (!sources.length) return <Empty icon={<Captions className="h-7 w-7" />} title="Legendas">Importe um vídeo para gerar ou revisar legendas.</Empty>
  return <div className="space-y-3 p-3">
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2 p-2">
      <select aria-label="Vídeo das legendas" disabled={busy || waiting} className="h-8 min-w-32 rounded border border-line-2 bg-bg px-2 text-xs" value={path} onChange={(e) => {
        if (dirty && !window.confirm('Descartar alterações de legendas não salvas?')) return
        setPath(e.target.value)
        const selected = sources.find((s) => s.path === e.target.value)
        if (selected) useStore.getState().setSource({ kind: selected.kind, id: selected.id })
      }}>{sources.map((s) => <option key={s.path} value={s.path}>{s.label}</option>)}</select>
      <Button size="sm" disabled={busy || running || dirty || !loaded} onClick={generate}><Wand2 className="h-3.5 w-3.5" />{waiting ? 'Gerando…' : 'Gerar com Claude'}</Button>
      <Button size="sm" disabled={busy || waiting || !loaded} onClick={async () => {
        if (!projectId || (dirty && !window.confirm('Substituir as legendas não salvas pelo SRT?'))) return
        setBusy(true)
        try { const d = await api.subtitles.import(projectId, path); if (d) { setDoc(d); setDirty(false) } } catch (err) { report(err) } finally { setBusy(false) }
      }}><Import className="h-3.5 w-3.5" />Importar SRT</Button>
      <Button size="sm" disabled={busy || waiting || dirty} onClick={reload}>Carregar geradas</Button>
      <Button size="sm" disabled={busy || !doc.cues.length} onClick={async () => { try { if (await api.subtitles.export(doc)) toast('SRT exportado', 'ok') } catch (err) { report(err) } }}><Download className="h-3.5 w-3.5" />SRT</Button>
      <Button size="sm" variant="primary" disabled={busy || waiting || !dirty || !loaded} onClick={save}><Save className="h-3.5 w-3.5" />Salvar{dirty ? ' alterações' : ''}</Button>
    </div>
    <fieldset disabled={!loaded || waiting || busy} className="space-y-3">
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
      <label className="flex items-center gap-2">Tamanho<input aria-label="Tamanho da legenda" type="number" min={16} max={96} value={doc.style.size} className="w-16 rounded border border-line-2 bg-bg p-1" onChange={(e) => update({ ...doc, style: { ...doc.style, size: Number(e.target.value) } })} /></label>
      <label className="flex items-center gap-2">Cor<input aria-label="Cor da legenda" type="color" value={doc.style.color} onChange={(e) => update({ ...doc, style: { ...doc.style, color: e.target.value } })} /></label>
      <label className="flex items-center gap-2">Posição<select className="rounded border border-line-2 bg-bg p-1" value={doc.style.position} onChange={(e) => update({ ...doc, style: { ...doc.style, position: e.target.value as SubtitleDocument['style']['position'] } })}><option value="bottom">Embaixo</option><option value="center">Centro</option><option value="top">Em cima</option></select></label>
      <span className="ml-auto text-faint">{doc.cues.length} legendas · tempos em segundos</span>
    </div>
    <p className="text-[11px] text-faint">Revise no player. Salve para usar na exportação. A geração usa as ferramentas de transcrição disponíveis para o Claude.</p>
    <div className="space-y-1.5">
      {doc.cues.map((c, i) => <div key={c.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 p-2">
        <button className="w-6 font-mono text-xs text-accent" title="Ver esta legenda" onClick={() => {
          const selected = sources.find((s) => s.path === path)
          if (selected) useStore.getState().setSource({ kind: selected.kind, id: selected.id })
          useStore.setState((s) => ({ seekRequest: { t: c.start, n: (s.seekRequest?.n ?? 0) + 1 } }))
        }}>{i + 1}</button>
        {(['start', 'end'] as const).map((key) => <input key={key} aria-label={`${key === 'start' ? 'Início' : 'Fim'} da legenda ${i + 1}`} type="number" min={0} step={0.01} value={c[key]} className="w-20 rounded border border-line-2 bg-bg p-1 font-mono text-xs" disabled={waiting} onChange={(e) => update({ ...doc, cues: doc.cues.map((x) => x.id === c.id ? { ...x, [key]: Number(e.target.value) } : x) })} />)}
        <textarea aria-label={`Texto da legenda ${i + 1}`} rows={1} className="min-w-0 flex-1 resize-y rounded border border-line-2 bg-bg p-1.5 text-xs" value={c.text} disabled={waiting} onChange={(e) => update({ ...doc, cues: doc.cues.map((x) => x.id === c.id ? { ...x, text: e.target.value } : x) })} />
        <button aria-label={`Excluir legenda ${i + 1}`} disabled={waiting} className="p-1 text-faint hover:text-bad" onClick={() => update({ ...doc, cues: doc.cues.filter((x) => x.id !== c.id) })}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>)}
    </div>
    <Button size="sm" disabled={!loaded || waiting} onClick={() => update({ ...doc, cues: [...doc.cues, { id: crypto.randomUUID(), start: playerTime, end: playerTime + 2, text: 'Nova legenda' }] })}><Plus className="h-3.5 w-3.5" />Adicionar na posição do player</Button>
    </fieldset>
  </div>
}
