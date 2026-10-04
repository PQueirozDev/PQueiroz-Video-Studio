import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { RenderSettings } from '@shared/types'
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
  const [s, setS] = useState<RenderSettings>({ container: 'mp4', resolution: '1080p', fps: 'original', quality: 'alta' })

  useEffect(() => {
    if (!open || !project) return
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
    if (!project || !src) return
    const label = sources.find((x) => x.value === src)?.label.replace(/^Original · /, 'Original ') ?? 'Render'
    try {
      await api.render.enqueue(project.id, { path: src, label }, s)
      setDialog('queue')
      toast('Adicionado à fila de render', 'ok')
    } catch (err) {
      toast(String((err as Error).message), 'bad')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => setDialog(null)}
      title="Renderizar"
      subtitle={project ? `${project.name} · formato ${project.format === 'original' ? 'original' : project.format}` : undefined}
      footer={<>
        <Button variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button>
        <Button variant="primary" disabled={!src} onClick={enqueue}>Adicionar à fila</Button>
      </>}
    >
      {sources.length === 0 ? (
        <p className="text-[13px] text-muted">Importe um vídeo ou peça uma edição ao Claude antes de renderizar.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Origem">
            <Select value={src} onChange={setSrc} options={sources} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
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
          </Field>
          <Field label="Destino" hint="Arquivos existentes nunca são sobrescritos.">
            <div className="flex items-center gap-2">
              <span className="selectable min-w-0 flex-1 truncate rounded-lg border border-line-2 bg-bg px-3 py-2 font-mono text-[11.5px] text-muted">{settings?.exportRoot}</span>
              <Button size="sm" onClick={changeDest}><FolderOpen className="h-3.5 w-3.5" />Alterar</Button>
            </div>
          </Field>
        </div>
      )}
    </Dialog>
  )
}
