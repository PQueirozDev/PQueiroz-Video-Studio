import { ChevronRight, Clapperboard, ListVideo, Search, Settings } from 'lucide-react'
import { useProject, useStore } from '@/store'
import { Button, IconButton, Logo } from './ui'
import { ClaudeUsageIndicator } from './ClaudeUsage'
import { UpdateBadge } from './UpdateBadge'

export function TitleBar() {
  const { view, closeProject, setDialog, setPalette, renders } = useStore()
  const project = useProject()
  const active = renders.filter((r) => r.status === 'renderizando' || r.status === 'aguardando')
  const current = renders.find((r) => r.status === 'renderizando')

  return (
    <header className="drag flex h-10 shrink-0 items-center gap-3 border-b border-line bg-bg pl-3 pr-[150px]">
      <button className="no-drag flex items-center gap-2" onClick={() => view === 'project' && closeProject()} title="Dashboard">
        <Logo size={22} />
        <span className="text-[13px] font-semibold tracking-tight">PQueiroz Video Studio</span>
      </button>
      {project && view === 'project' && (
        <div className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="truncate text-fg">{project.name}</span>
        </div>
      )}

      <button
        onClick={() => setPalette(true)}
        className="no-drag mx-auto flex h-7 w-72 items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-xs text-faint transition-colors hover:border-line-2 hover:text-muted"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Buscar comandos...</span>
        <kbd className="ml-auto rounded bg-raised px-1.5 py-px font-mono text-[10px]">Ctrl K</kbd>
      </button>

      <div className="no-drag flex items-center gap-1.5">
        <UpdateBadge />
        <ClaudeUsageIndicator />
        {active.length > 0 && (
          <button onClick={() => setDialog('queue')} className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted hover:bg-raised">
            <ListVideo className="h-3.5 w-3.5 text-accent" />
            {current ? `Renderizando ${Math.round(current.progress * 100)}%` : `${active.length} na fila`}
          </button>
        )}
        {active.length === 0 && (
          <IconButton title="Fila de render" onClick={() => setDialog('queue')}><ListVideo className="h-4 w-4" /></IconButton>
        )}
        {view === 'project' && (
          <Button variant="primary" size="sm" onClick={() => setDialog('render')}>
            <Clapperboard className="h-3.5 w-3.5" />Renderizar
          </Button>
        )}
        <IconButton title="Configurações" onClick={() => setDialog('settings')}><Settings className="h-4 w-4" /></IconButton>
      </div>
    </header>
  )
}
