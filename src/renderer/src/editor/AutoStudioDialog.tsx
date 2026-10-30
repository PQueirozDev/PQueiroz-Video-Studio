import { useEffect, useState } from 'react'
import { Clapperboard, Film, Gamepad2, Smartphone, Video, Wand2 } from 'lucide-react'
import { AUTO_STYLES, type AutoStyle } from '@shared/autoStudio'
import { api, cx, fmtTime } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Dialog, Field, inputClass, Select } from '@/components/ui'
import { errorMessage, useEditor } from './editorStore'

// Auto Studio: escolhe vídeos, música e estilo; o app analisa tudo e monta a edição numa etapa só (Ctrl+Z desfaz).

const ICON: Record<AutoStyle, typeof Film> = { gaming: Gamepad2, shorts: Smartphone, vlog: Video, cinema: Clapperboard }

export function AutoStudioDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const projectId = useStore((s) => s.projectId)
  const media = useStore((s) => s.media)
  const toast = useStore((s) => s.toast)
  const videos = media.filter((m) => m.kind === 'video')
  const sounds = media.filter((m) => m.kind === 'audio')
  const [style, setStyle] = useState<AutoStyle>('gaming')
  const [picked, setPicked] = useState<string[]>([])
  const [music, setMusic] = useState('')
  const [target, setTarget] = useState(30)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  // Estilo da Style Memory: '' = o do projeto/cliente; 'none' = sem estilo.
  const [styleId, setStyleId] = useState('')
  const [styles, setStyles] = useState<{ id: string; name: string }[]>([])
  const [notes, setNotes] = useState<string[] | null>(null)
  useEffect(() => {
    if (!open) return
    setNotes(null)
    setPicked((p) => (p.length ? p.filter((id) => videos.some((v) => v.id === id)) : videos.map((v) => v.id)))
    void api.styles.list().then((s) => setStyles(s.map(({ id, name }) => ({ id, name })))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const run = async (): Promise<void> => {
    if (!projectId || !picked.length) return
    setBusy(true)
    setNotes(null)
    try {
      const r = await api.auto.run(projectId, { style, mediaIds: picked, musicId: music || null, targetDuration: target, title: title.trim() || undefined, styleId: styleId === 'none' ? null : styleId || undefined })
      setNotes(r.notes)
      useEditor.setState({ previewActive: true, playhead: 0 })
      toast('Edição pronta na timeline. Ctrl+Z desfaz tudo de uma vez.', 'ok')
    } catch (err) {
      toast(errorMessage(err), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Auto Studio" subtitle="Analisa seus vídeos e monta uma edição completa. A timeline atual é substituída (dá para desfazer)." width={620}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        <Button variant="primary" disabled={busy || !picked.length} onClick={() => void run()}><Wand2 className="h-3.5 w-3.5" />{busy ? 'Montando...' : 'Montar edição'}</Button>
      </>}>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {AUTO_STYLES.map((s) => {
          const Icon = ICON[s.id]
          return (
            <button key={s.id} type="button" onClick={() => setStyle(s.id)} aria-pressed={style === s.id}
              className={cx('rounded-lg border p-3 text-left', style === s.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-2')}>
              <p className="flex items-center gap-1.5 text-[13px] font-medium"><Icon className="h-4 w-4 text-accent" />{s.name}</p>
              <p className="mt-1 text-[11.5px] leading-snug text-muted">{s.description}</p>
            </button>
          )
        })}
      </div>
      <Field label={`Vídeos (${picked.length} de ${videos.length})`}>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-bg p-1.5">
          {videos.map((v) => (
            <label key={v.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-raised">
              <input type="checkbox" checked={picked.includes(v.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, v.id] : p.filter((x) => x !== v.id)))} />
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              <span className="font-mono text-[10.5px] text-faint">{fmtTime(v.duration)}</span>
            </label>
          ))}
          {!videos.length && <p className="p-2 text-[12px] text-faint">Importe vídeos no projeto primeiro.</p>}
        </div>
      </Field>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Música" hint={style === 'vlog' ? 'No vlog a música fica baixa, por baixo da fala.' : 'Os cortes caem nas batidas.'}>
          <Select value={music} onChange={setMusic} options={[{ value: '', label: 'Sem música' }, ...sounds.map((m) => ({ value: m.id, label: m.name }))]} />
        </Field>
        <Field label={`Duração máxima: ${target} s`}>
          <input type="range" min={10} max={180} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="mt-2 w-full" aria-label="Duração máxima" />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Estilo (Style Memory)" hint="Look, títulos, ritmo e volumes aprendidos de outra edição.">
          <Select value={styleId} onChange={setStyleId} options={[{ value: '', label: 'O do projeto/cliente' }, { value: 'none', label: 'Nenhum (padrão do estilo)' }, ...styles.map((s) => ({ value: s.id, label: s.name }))]} />
        </Field>
        <Field label="Título de abertura (opcional)">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Ex.: ACE NO CLUTCH" className={inputClass} />
        </Field>
      </div>
      {notes && (
        <ul className="mt-4 space-y-1 rounded-lg border border-ok/30 bg-ok/10 p-3 text-[12px]">
          {notes.map((n) => <li key={n}>✓ {n}</li>)}
        </ul>
      )}
    </Dialog>
  )
}
