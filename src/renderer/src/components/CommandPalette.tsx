import { Command } from 'cmdk'
import { Bot, Clapperboard, Compass, Film, FolderOpen, Home, ImageIcon, Import, Keyboard, Library, ListVideo, Plus, RotateCcw, Settings, ShieldCheck, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '@/lib/format'
import { useStore } from '@/store'

function Item({ icon, children, onSelect, hint }: { icon: ReactNode; children: ReactNode; onSelect(): void; hint?: string }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted data-[selected=true]:bg-raised data-[selected=true]:text-fg"
    >
      <span className="text-faint">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </Command.Item>
  )
}

const groupClass = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint'

export function CommandPalette() {
  const { paletteOpen, setPalette, setDialog, projectId, projects, versions, openProject, closeProject, focusChat, importPaths, loadProjects, setSource, toast } = useStore()
  if (!paletteOpen) return null

  const run = (fn: () => void | Promise<void>) => () => {
    setPalette(false)
    void fn()
  }

  return (
    <div className="fixed inset-0 z-[55] flex justify-center bg-black/50 pt-[14vh] animate-fade-in" onMouseDown={() => setPalette(false)}>
      <Command
        label="Command Center"
        className="h-fit w-[560px] overflow-hidden rounded-xl border border-line-2 bg-panel shadow-2xl shadow-black/60 animate-pop"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && setPalette(false)}
      >
        <Command.Input autoFocus placeholder="Digite um comando ou busque um projeto..." className="h-12 w-full border-b border-line bg-transparent px-4 text-sm outline-none placeholder:text-faint" />
        <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
          <Command.Empty className="py-8 text-center text-xs text-faint">Nenhum comando encontrado.</Command.Empty>
          <Command.Group heading="Comandos" className={groupClass}>
            <Item icon={<Plus className="h-4 w-4" />} onSelect={run(() => setDialog('newProject'))}>Novo projeto de vídeo</Item>
            <Item icon={<ImageIcon className="h-4 w-4" />} onSelect={run(() => {
              useStore.setState({ projectId: null })
              useStore.getState().setView('image')
            })}>Nova arte (Image Studio)</Item>
            <Item icon={<Library className="h-4 w-4" />} onSelect={run(() => useStore.getState().setView('assets'))}>Biblioteca de assets e marcas</Item>
            {projectId && <Item icon={<Import className="h-4 w-4" />} onSelect={run(async () => importPaths(await api.media.pickFiles()))}>Importar vídeo</Item>}
            {projectId && <Item icon={<Clapperboard className="h-4 w-4" />} onSelect={run(() => setDialog('render'))}>Renderizar</Item>}
            {projectId && <Item icon={<Bot className="h-4 w-4" />} onSelect={run(focusChat)}>Falar com Claude</Item>}
            {projectId && <Item icon={<FolderOpen className="h-4 w-4" />} onSelect={run(() => api.projects.openFolder(projectId))}>Abrir pasta do projeto</Item>}
            {projectId && <Item icon={<Sparkles className="h-4 w-4" />} onSelect={run(() => void window.dispatchEvent(new Event('pq-open-auto')))}>Auto Studio (montar edição automática)</Item>}
            {projectId && <Item icon={<ShieldCheck className="h-4 w-4" />} onSelect={run(() => void window.dispatchEvent(new Event('pq-open-qc')))}>Quality Check</Item>}
            {projectId && <Item icon={<Compass className="h-4 w-4" />} onSelect={run(() => void window.dispatchEvent(new Event('pq-editor-tour')))}>Tour do editor</Item>}
            {projectId && <Item icon={<Keyboard className="h-4 w-4" />} onSelect={run(() => void window.dispatchEvent(new Event('pq-shortcuts')))}>Atalhos do teclado</Item>}
            <Item icon={<ListVideo className="h-4 w-4" />} onSelect={run(() => setDialog('queue'))}>Fila de render</Item>
            <Item icon={<Settings className="h-4 w-4" />} onSelect={run(() => setDialog('settings'))}>Abrir configurações</Item>
            {projectId && <Item icon={<Home className="h-4 w-4" />} onSelect={run(closeProject)}>Ir para o Dashboard</Item>}
          </Command.Group>
          {projectId && versions.length > 0 && (
            <Command.Group heading="Restaurar versão" className={groupClass}>
              {[...versions].reverse().map((v) => (
                <Item key={v.id} icon={<RotateCcw className="h-4 w-4" />} hint={v.request.slice(0, 40)}
                  onSelect={run(async () => {
                    await api.versions.restore(projectId, v.id)
                    await loadProjects()
                    setSource({ kind: 'version', id: v.id })
                    toast(`${v.label} restaurada`, 'ok')
                  })}>
                  Restaurar {v.label}
                </Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Projetos" className={groupClass}>
            {projects.map((p) => (
              <Item key={p.id} icon={p.kind === 'image' ? <ImageIcon className="h-4 w-4" /> : <Film className="h-4 w-4" />} onSelect={run(() => openProject(p.id))}>{p.name}</Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  )
}
