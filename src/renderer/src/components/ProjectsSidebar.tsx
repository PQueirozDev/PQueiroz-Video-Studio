import { useState } from 'react'
import { Film, FolderOpen, Pencil, Plus } from 'lucide-react'
import { api, cx, fmtAgo, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { IconButton, inputClass, Spinner } from './ui'

export function ProjectsSidebar() {
  const { projects, projectId, openProject, setDialog, live, loadProjects } = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')

  const commit = async (id: string): Promise<void> => {
    if (name.trim()) await api.projects.rename(id, name.trim())
    setEditing(null)
    loadProjects()
  }

  return (
    <aside className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Projetos</span>
        <IconButton title="Abrir pasta do projeto" onClick={() => projectId && api.projects.openFolder(projectId)}>
          <FolderOpen className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {projects.map((p) => (
          <div
            key={p.id}
            onClick={() => p.id !== projectId && openProject(p.id)}
            onDoubleClick={() => {
              setEditing(p.id)
              setName(p.name)
            }}
            className={cx(
              'group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
              p.id === projectId ? 'bg-accent-soft' : 'hover:bg-raised'
            )}
          >
            <div className="h-8 w-11 shrink-0 overflow-hidden rounded bg-bg">
              {p.thumbnail ? <img src={mediaUrl(p.thumbnail)} className="h-full w-full object-cover" alt="" /> : <Film className="m-auto mt-2 h-4 w-4 text-faint" />}
            </div>
            <div className="min-w-0 flex-1">
              {editing === p.id ? (
                <input
                  autoFocus
                  className={cx(inputClass, 'h-6 px-1.5 text-xs')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => commit(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(p.id)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <p className={cx('truncate text-[12.5px]', p.id === projectId ? 'font-medium text-fg' : 'text-muted')}>{p.name}</p>
              )}
              <p className="flex items-center gap-1 truncate text-[10.5px] text-faint">
                {live[p.id]?.running ? <><Spinner className="h-2.5 w-2.5 text-accent" /> Claude trabalhando</> : fmtAgo(p.updatedAt)}
              </p>
            </div>
            {editing !== p.id && (
              <Pencil
                className="h-3 w-3 shrink-0 text-faint opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing(p.id)
                  setName(p.name)
                }}
              />
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => setDialog('newProject')}
        className="m-1.5 flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <Plus className="h-3.5 w-3.5" />Projeto
      </button>
    </aside>
  )
}
