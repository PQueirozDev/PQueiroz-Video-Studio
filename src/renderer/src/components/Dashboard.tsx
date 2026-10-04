import { useEffect, useState } from 'react'
import { Clock, Film, FolderOpen, Import, Plus, Sparkles } from 'lucide-react'
import type { AqcInfo, Project } from '@shared/types'
import { api, fmtAgo, fmtTime, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { Badge, Button } from './ui'

const STATUS: Record<Project['status'], { label: string; tone: 'neutral' | 'accent' | 'ok' | 'info' }> = {
  novo: { label: 'Novo', tone: 'neutral' },
  editando: { label: 'Editando', tone: 'info' },
  pronto: { label: 'Pronto', tone: 'accent' },
  renderizado: { label: 'Renderizado', tone: 'ok' }
}

export function ProjectCard({ p, onOpen }: { p: Project; onOpen(): void }) {
  const s = STATUS[p.status]
  return (
    <button onClick={onOpen} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel text-left transition-all hover:-translate-y-0.5 hover:border-line-2 hover:bg-panel-2">
      <div className="relative aspect-video w-full overflow-hidden bg-bg">
        {p.thumbnail ? (
          <img src={mediaUrl(p.thumbnail)} className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" alt="" />
        ) : (
          <div className="flex h-full items-center justify-center text-faint"><Film className="h-7 w-7" /></div>
        )}
        {p.duration != null && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-px font-mono text-[10.5px]">{fmtTime(p.duration)}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{p.name}</span>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <Clock className="h-3 w-3" />{fmtAgo(p.updatedAt)}
          <span>·</span>{p.format === 'original' ? 'Original' : p.format}
        </div>
      </div>
    </button>
  )
}

export function Dashboard() {
  const { projects, openProject, setDialog, loadProjects } = useStore()
  const [aqc, setAqc] = useState<AqcInfo | null>(null)

  useEffect(() => {
    loadProjects()
    api.env.aqcInfo().then(setAqc)
  }, [loadProjects])

  const openExisting = async (): Promise<void> => {
    const p = await api.projects.openExisting()
    if (p) await openProject(p.id)
  }

  /** "Importar Vídeo" no dashboard: cria um projeto com o nome do primeiro arquivo e importa. */
  const quickImport = async (): Promise<void> => {
    const paths = await api.media.pickFiles()
    if (!paths.length) return
    const name = paths[0].split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
    const p = await api.projects.create({ name, format: '9:16', resolution: '1080p', fps: 'original', preset: 'aquecedores-fortes' })
    await openProject(p.id)
    await useStore.getState().importPaths(paths)
    await loadProjects()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
            <p className="mt-1 text-[13px] text-muted">Importe os vídeos, converse com o Claude e acompanhe cada versão.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={openExisting}><FolderOpen className="h-4 w-4" />Abrir Projeto</Button>
            <Button onClick={quickImport}><Import className="h-4 w-4" />Importar Vídeo</Button>
            <Button variant="primary" onClick={() => setDialog('newProject')}><Plus className="h-4 w-4" />Novo Projeto</Button>
          </div>
        </div>

        {aqc?.exists && (
          <div className="mb-8 flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Sparkles className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Sistema de edição conectado: <span className="font-mono text-xs text-muted">{aqc.root}</span></p>
              <p className="truncate text-xs text-faint">
                {aqc.workflow.filter((w) => w.found).map((w) => w.name).join(' · ')} · {aqc.musicCount} músicas · {aqc.doneVideos.length} vídeo(s) feito(s)
              </p>
            </div>
            {aqc.workflow.some((w) => !w.found) && <Badge tone="warn">skill ausente: {aqc.workflow.filter((w) => !w.found).map((w) => w.name).join(', ')}</Badge>}
          </div>
        )}

        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-faint">Recentes</h2>
        {projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-2 py-16 text-center">
            <Film className="h-8 w-8 text-faint" />
            <p className="text-[13px] text-muted">Nenhum projeto ainda.</p>
            <Button variant="primary" onClick={() => setDialog('newProject')}><Plus className="h-4 w-4" />Criar o primeiro projeto</Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {projects.map((p) => <ProjectCard key={p.id} p={p} onOpen={() => openProject(p.id)} />)}
          </div>
        )}
      </div>
    </div>
  )
}
