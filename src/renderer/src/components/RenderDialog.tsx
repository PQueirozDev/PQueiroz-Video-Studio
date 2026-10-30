import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { RenderSettings } from '@shared/types'
import { EXPORT_PRESETS } from '@shared/exportPresets'
import { cx } from '@/lib/format'
import { api } from '@/lib/format'
import { useProject, useStore } from '@/store'
import { Button, Dialog, Field, Segmented, Select } from './ui'

export function RenderDialog() {
  const { dialog, setDialog, versions, media, settings, saveSettings, toast } = useStore()
  const project = useProject()
  const open = dialog === 'render'
  const sources = [
    ...[...versions].reverse().map((v) => ({ value: v.path, label: v.label })),
    ...media.filter((m) => m.kind === 'video').map((m) => ({ value: m.path, label: `Original · ${m.name}` }))
  ]
  const [src, setSrc] = useState('')
  const [captions, setCaptions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [s, setS] = useState<RenderSettings>({ container: 'mp4', resolution: '1080p', fps: 'original', quality: 'alta' })
  /** Destinos marcados: um render por destino (exportação em lote). Nenhum = configuração manual. */
  const [targets, setTargets] = useState<string[]>([])

  useEffect(() => {
    if (!open || !project) return
    setCaptions(false)
    const current = versions.find((v) => v.id === project.currentVersionId)
    setSrc(current?.path ?? sources[0]?.value ?? '')
    setS((x) => ({ ...x, resolution: project.resolution, fps: project.fps === '24' ? 'original' : project.fps }))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof RenderSettings>(k: K, v: RenderSettings[K]): void => setS((x) => ({ ...x, [k]: v }))

  const changeDest = async (): Promise<void> => {
    const dir = await api.settings.pickFolder('Pasta de exportação', settings?.exportRoot)
    if (dir) await saveSettings({ exportRoot: dir })
  }

  const enqueue = async (): Promise<void> => {
    if (!project || !src || busy) return
    setBusy(true)
    const label = sources.find((x) => x.value === src)?.label.replace(/^Original · /, 'Original ') ?? 'Render'
    try {
      const subtitles = captions ? await api.subtitles.load(project.id, src) : undefined
      if (captions && !subtitles?.cues.length) throw new Error('Salve legendas para este vídeo na aba Legendas antes de exportar.')
      if (targets.length) {
        for (const presetId of targets) await api.render.enqueue(project.id, { path: src, label }, { ...s, resolution: '1080p', presetId, subtitles })
      } else await api.render.enqueue(project.id, { path: src, label }, { ...s, subtitles })
      setDialog('queue')
      toast(targets.length > 1 ? `${targets.length} exportações na fila (uma por destino)` : 'Adicionado à fila de render', 'ok')
    } catch (err) {
      toast(String((err as Error).message), 'bad')
    } finally { setBusy(false) }
  }

  return (
    <Dialog
      open={open}
      onClose={() => setDialog(null)}
      title="Renderizar"
      subtitle={project ? `${project.name} · formato ${project.format === 'original' ? 'original' : project.format}` : undefined}
      footer={<>
        <Button variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button>
        <Button variant="primary" disabled={!src || busy} onClick={enqueue}>{busy ? 'Preparando…' : targets.length > 1 ? `Exportar ${targets.length} destinos` : 'Adicionar à fila'}</Button>
      </>}
    >
      {sources.length === 0 ? (
        <p className="text-[13px] text-muted">Importe um vídeo ou peça uma edição ao Claude antes de renderizar.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Origem">
            <Select value={src} onChange={setSrc} options={sources} />
          </Field>
          {/* Grupo de botões (não <label>: senão o primeiro botão herdaria o texto do campo como nome). */}
          <div role="group" aria-labelledby="render-destinos">
            <span id="render-destinos" className="mb-1.5 block text-xs font-medium text-muted">Destinos</span>
            <div className="grid grid-cols-2 gap-1.5">
              {EXPORT_PRESETS.map((p) => {
                const on = targets.includes(p.id)
                return (
                  <button key={p.id} type="button" aria-pressed={on} title={p.description}
                    onClick={() => setTargets((t) => (on ? t.filter((x) => x !== p.id) : [...t, p.id]))}
                    className={cx('rounded-lg border px-2.5 py-1.5 text-left text-xs', on ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:border-line-2')}>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-[10.5px] text-faint">{p.aspect} · {p.shortSide}p{p.maxBytes ? ` · até ${Math.round(p.maxBytes / 1048576)} MB` : ''}</span>
                  </button>
                )
              })}
            </div>
            <span className="mt-1 block text-[11px] text-faint">Marque um ou vários: cada um sai no tamanho, enquadramento e limite certos, e passa pelo Quality Check ao terminar. Sem destino, use os ajustes abaixo.</span>
          </div>
          {!targets.length && <><div className="grid grid-cols-2 gap-4">
            <Field label="Formato">
              <Segmented value={s.container} onChange={(v) => set('container', v)} options={[{ value: 'mp4', label: 'MP4' }, { value: 'mov', label: 'MOV' }]} />
            </Field>
            <Field label="FPS">
              <Segmented value={s.fps} onChange={(v) => set('fps', v)} options={[{ value: 'original', label: 'Original' }, { value: '30', label: '30' }, { value: '60', label: '60' }]} />
            </Field>
          </div>
          <Field label="Resolução">
            <Segmented value={s.resolution} onChange={(v) => set('resolution', v)} options={[{ value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p' }, { value: '4k', label: '4K' }]} />
          </Field>
          <Field label="Qualidade" hint={settings?.hwAccel ? 'Usa a GPU (NVENC) quando disponível, com fallback automático para CPU.' : 'Codificação por CPU (libx264).'}>
            <Segmented value={s.quality} onChange={(v) => set('quality', v)}
              options={[{ value: 'rapida', label: 'Rápida' }, { value: 'equilibrada', label: 'Equilibrada' }, { value: 'alta', label: 'Alta' }, { value: 'maxima', label: 'Máxima' }]} />
          </Field></>}
          <Field label="Destino" hint="Arquivos existentes nunca são sobrescritos.">
            <div className="flex items-center gap-2">
              <span className="selectable min-w-0 flex-1 truncate rounded-lg border border-line-2 bg-bg px-3 py-2 font-mono text-[11.5px] text-muted">{settings?.exportRoot}</span>
              <Button size="sm" onClick={changeDest}><FolderOpen className="h-3.5 w-3.5" />Alterar</Button>
            </div>
          </Field>
          <label className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 p-3 text-xs"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /><span>Gravar as legendas salvas no vídeo<span className="mt-1 block text-faint">Usa o texto e o estilo revisados na aba Legendas para esta origem.</span></span></label>
        </div>
      )}
    </Dialog>
  )
}
