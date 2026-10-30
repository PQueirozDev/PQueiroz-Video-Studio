import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clapperboard, Download, FolderOpen } from 'lucide-react'
import type { AssetItem } from '@shared/types'
import type { ExportFormat } from '@shared/image'
import { analyzeDoc } from '@shared/imageDoc'
import { api } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { renderBytes, videoPasses } from '@/image/render'
import { Button, Dialog, Field, inputClass, Progress, Segmented, Select } from '../ui'

const errMsg = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Cria uma versão só se a arte mudou desde a versão atual (exportar não deve encher a lista). */
async function versionIfChanged(request: string): Promise<void> {
  const { projectId, doc, saveVersion } = useImage.getState()
  if (!projectId || !doc) return
  const project = useStore.getState().projects.find((p) => p.id === projectId)
  if (project?.currentVersionId) {
    try {
      const v = await api.image.versionDoc(projectId, project.currentVersionId)
      if (JSON.stringify(v) === JSON.stringify(doc)) return
    } catch {
      /* versão ilegível: cria outra */
    }
  }
  await saveVersion(request, 'Versão criada na exportação')
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { doc, projectId, brands, info } = useImage()
  const toast = useStore((s) => s.toast)
  const [fmt, setFmt] = useState<ExportFormat>('png')
  const [scale, setScale] = useState<'1' | '2'>('1')
  const [quality, setQuality] = useState(0.92)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<string | null>(null)
  const brand = brands.find((b) => b.id === info?.brandId)
  const warnings = useMemo(() => (doc ? analyzeDoc(doc, brand).filter((i) => i.level === 'aviso') : []), [doc, brand])
  if (!doc || !projectId) return null

  const run = async (saveAs: boolean): Promise<void> => {
    setBusy(true)
    try {
      await useImage.getState().flush()
      const bytes = await renderBytes(doc, { scale: Number(scale), type: fmt, quality })
      const path = saveAs ? await api.image.exportAs(projectId, bytes, fmt) : await api.image.export(projectId, bytes, fmt)
      setLast(path)
      await versionIfChanged('Exportação')
      useStore.getState().loadProjects()
      toast(`Exportado: ${path.split(/[\\/]/).pop()}`, 'ok')
    } catch (err) {
      toast(`Falha ao exportar: ${errMsg(err)}`, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const W = Math.round(doc.width * Number(scale)), H = Math.round(doc.height * Number(scale))
  return (
    <Dialog open={open} onClose={onClose} title="Exportar arte" subtitle={`${W} × ${H} px · textos e logo renderizados com as fontes e o arquivo originais`} width={480}
      footer={<>
        {last && <Button variant="ghost" onClick={() => api.image.reveal(projectId, last)}><FolderOpen className="h-4 w-4" />Mostrar arquivo</Button>}
        <Button disabled={busy} onClick={() => run(true)}>Exportar como…</Button>
        <Button variant="primary" disabled={busy} onClick={() => run(false)}><Download className="h-4 w-4" />{busy ? 'Exportando…' : 'Exportar'}</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Formato do arquivo">
          <Segmented<ExportFormat> value={fmt} onChange={setFmt} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }]} />
        </Field>
        <Field label="Resolução" hint="2× é ideal para impressão ou para reenquadrar depois. As redes sociais usam 1×.">
          <Segmented<'1' | '2'> value={scale} onChange={setScale} options={[{ value: '1', label: `1× (${doc.width}×${doc.height})` }, { value: '2', label: `2× (${doc.width * 2}×${doc.height * 2})` }]} />
        </Field>
        {fmt !== 'png' && (
          <Field label={`Qualidade: ${Math.round(quality * 100)}%`}>
            <input type="range" min={0.6} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full" style={{ ['--fill' as string]: `${((quality - 0.6) / 0.4) * 100}%` }} />
          </Field>
        )}
        {warnings.length > 0 && (
          <div className="space-y-1 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2">
            {warnings.map((w, i) => <p key={i} className="flex items-start gap-1.5 text-xs text-warn"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w.text}</p>)}
          </div>
        )}
        <p className="text-[11px] text-faint">O arquivo vai para a pasta <span className="font-mono">output/</span> do projeto e nunca substitui um existente.</p>
      </div>
    </Dialog>
  )
}

export function ToVideoDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { doc, projectId } = useImage()
  const { projects, toast, openProject, task } = useStore()
  const [duration, setDuration] = useState(6)
  const [motion, setMotion] = useState<'zoom-in' | 'zoom-out' | 'none'>('zoom-in')
  const [subjectMotion, setSubjectMotion] = useState<'float' | 'none'>('float')
  const [textIn, setTextIn] = useState<'fade' | 'slide' | 'none'>('slide')
  const [music, setMusic] = useState('')
  const [target, setTarget] = useState('')
  const [tracks, setTracks] = useState<AssetItem[]>([])
  const [busy, setBusy] = useState(false)
  const videoProjects = projects.filter((p) => p.kind === 'video')
  useEffect(() => {
    if (open) api.assets.list().then((a) => setTracks(a.filter((x) => x.category === 'musicas')))
  }, [open])
  if (!doc || !projectId) return null
  const passes = videoPasses(doc)
  const progress = task[projectId]

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      await useImage.getState().flush()
      const [background, subject, foreground] = await Promise.all([
        renderBytes(doc, { filter: passes.background }),
        passes.subject ? renderBytes(doc, { filter: passes.subject, background: false }) : Promise.resolve(null),
        passes.foreground ? renderBytes(doc, { filter: passes.foreground, background: false }) : Promise.resolve(null)
      ])
      const r = await api.image.toVideo(projectId, { background, subject, foreground, duration, motion, subjectMotion, textIn, music: music || null, targetProjectId: target || null })
      await versionIfChanged('Enviada para o Video Studio')
      toast('Vídeo animado criado no Video Studio', 'ok')
      onClose()
      await openProject(r.projectId)
      useStore.setState({ source: { kind: 'media', id: r.mediaId } })
    } catch (err) {
      toast(`Falha ao animar: ${errMsg(err)}`, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title="Enviar para o Video Studio" subtitle="A arte vira um clipe animado (MP4) e entra num projeto de vídeo, pronto para trilha, transições e mais edição com o Claude." width={520}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={busy} onClick={run}><Clapperboard className="h-4 w-4" />{busy ? 'Animando…' : 'Criar vídeo animado'}</Button>
      </>}>
      <div className="space-y-4">
        <Field label={`Duração: ${duration} s`}>
          <input type="range" min={3} max={15} step={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full" style={{ ['--fill' as string]: `${((duration - 3) / 12) * 100}%` }} />
        </Field>
        <Field label="Movimento do fundo">
          <Segmented<'zoom-in' | 'zoom-out' | 'none'> value={motion} onChange={setMotion} options={[{ value: 'zoom-in', label: 'Aproximar' }, { value: 'zoom-out', label: 'Afastar' }, { value: 'none', label: 'Parado' }]} />
        </Field>
        <Field label="Mascote / elemento principal" hint={passes.subject ? 'Camadas com papel "Herói" animam separadas do fundo.' : 'Nenhuma camada com papel "Herói" — marque o mascote como Herói no inspetor para animá-lo.'}>
          <Segmented<'float' | 'none'> value={subjectMotion} onChange={setSubjectMotion} options={[{ value: 'float', label: 'Flutuar' }, { value: 'none', label: 'Parado' }]} />
        </Field>
        <Field label="Entrada dos textos e da logo">
          <Segmented<'fade' | 'slide' | 'none'> value={textIn} onChange={setTextIn} options={[{ value: 'slide', label: 'Subir' }, { value: 'fade', label: 'Surgir' }, { value: 'none', label: 'Sem efeito' }]} />
        </Field>
        <Field label="Trilha sonora" hint="Músicas da sua biblioteca de assets (inclusive E:\aqc\Recursos).">
          <Select value={music} onChange={setMusic} options={[{ value: '', label: 'Sem música' }, ...tracks.map((t) => ({ value: t.path, label: t.name }))]} />
        </Field>
        <Field label="Projeto de vídeo">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
            <option value="">Criar um projeto novo</option>
            {videoProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {busy && progress && (
          <div>
            <p className="mb-1 text-xs text-muted">{progress.text}</p>
            <Progress value={progress.progress ?? 0} indeterminate={progress.progress == null} />
          </div>
        )}
      </div>
    </Dialog>
  )
}
