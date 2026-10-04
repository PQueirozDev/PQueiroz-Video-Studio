import { Copy, Eye, FolderOpen, GitBranch, RotateCcw } from 'lucide-react'
import { api, cx, fmtAgo, fmtTime, mediaUrl } from '@/lib/format'
import { useProject, useStore } from '@/store'
import { Badge, Button, Empty } from './ui'

export function VersionsList() {
  const { versions, media, setSource, setCompare, source, projectId, loadProjects, refreshVersions, toast } = useStore()
  const project = useProject()
  const original = media.find((m) => m.kind === 'video')

  if (!versions.length) {
    return (
      <Empty icon={<GitBranch className="h-7 w-7" />} title="Nenhuma versão ainda">
        Cada vídeo que o Claude gerar vira uma versão (V1, V2…). O original nunca é alterado.
      </Empty>
    )
  }

  const restore = async (id: string, label: string): Promise<void> => {
    if (!projectId) return
    await api.versions.restore(projectId, id)
    await loadProjects()
    setSource({ kind: 'version', id })
    toast(`${label} é a versão atual`, 'ok')
  }

  const duplicate = async (id: string): Promise<void> => {
    if (!projectId) return
    const v = await api.versions.duplicate(projectId, id)
    await refreshVersions()
    await loadProjects()
    setSource({ kind: 'version', id: v.id })
    toast(`Criada ${v.label}`, 'ok')
  }

  return (
    <div className="divide-y divide-line">
      {original && (
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-bg">
            {original.thumbnail && <img src={mediaUrl(original.thumbnail)} className="h-full w-full object-cover" alt="" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="text-[13px] font-medium">Original</span><Badge>intocado</Badge></div>
            <p className="truncate text-[11px] text-faint">{media.filter((m) => m.kind === 'video').map((m) => m.name).join(', ')}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { setCompare(false); setSource({ kind: 'media', id: original.id }) }}><Eye className="h-3.5 w-3.5" />Visualizar</Button>
        </div>
      )}
      {[...versions].reverse().map((v) => {
        const isCurrent = project?.currentVersionId === v.id
        const viewing = source?.kind === 'version' && source.id === v.id
        return (
          <div key={v.id} className={cx('flex items-start gap-3 px-3 py-2', viewing && 'bg-accent/[0.05]')}>
            <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-bg">
              {v.thumbnail && <img src={mediaUrl(v.thumbnail)} className="h-full w-full object-cover" alt="" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">{v.label}</span>
                {isCurrent && <Badge tone="accent">atual</Badge>}
                <span className="text-[11px] text-faint">{fmtAgo(v.createdAt)}{v.duration ? ` · ${fmtTime(v.duration)}` : ''}</span>
              </div>
              {v.request && <p className="selectable truncate text-[11.5px] text-muted" title={v.request}>“{v.request}”</p>}
              {v.changes && <p className="selectable line-clamp-2 text-[11px] text-faint" title={v.changes}>{v.changes.replace(/```[\s\S]*?```/g, '').slice(0, 240)}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="sm" variant="ghost" onClick={() => { setCompare(false); setSource({ kind: 'version', id: v.id }) }}><Eye className="h-3.5 w-3.5" />Visualizar</Button>
              <Button size="sm" variant="ghost" disabled={isCurrent} onClick={() => restore(v.id, v.label)}><RotateCcw className="h-3.5 w-3.5" />Restaurar</Button>
              <Button size="sm" variant="ghost" onClick={() => duplicate(v.id)}><Copy className="h-3.5 w-3.5" />Duplicar</Button>
              <Button size="sm" variant="ghost" onClick={() => api.versions.reveal(v.id)} title="Mostrar na pasta"><FolderOpen className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
