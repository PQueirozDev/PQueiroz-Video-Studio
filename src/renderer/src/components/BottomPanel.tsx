import { useState } from 'react'
import { Clapperboard, FolderOpen, GitBranch, Import, Layers, Library, Captions } from 'lucide-react'
import { SubtitlesPanel } from './SubtitlesPanel'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { Button, IconButton } from './ui'
import { MediaLibrary } from './MediaLibrary'
import { TimelineEditor } from '@/editor/TimelineEditor'
import { VersionsList } from './VersionsList'
import { AssetsPanel } from './AssetsPanel'

type Tab = 'media' | 'timeline' | 'versions' | 'assets' | 'subtitles'

export function BottomPanel() {
  const [tab, setTab] = useState<Tab>('media')
  const { projectId, media, versions, importPaths } = useStore()

  const tabs: { id: Tab; label: string; icon: typeof Layers; count?: number }[] = [
    { id: 'media', label: 'Mídia', icon: Layers, count: media.length },
    { id: 'timeline', label: 'Timeline', icon: Clapperboard },
    { id: 'versions', label: 'Versões', icon: GitBranch, count: versions.length },
    { id: 'subtitles', label: 'Legendas', icon: Captions },
    { id: 'assets', label: 'Assets', icon: Library }
  ]

  const pick = async (): Promise<void> => {
    const paths = await api.media.pickFiles()
    await importPaths(paths)
  }

  return (
    <section className="flex h-full flex-col bg-panel">
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
              tab === t.id ? 'bg-accent-soft text-accent ring-1 ring-accent/25' : 'text-muted hover:bg-raised hover:text-fg'
            )}
          >
            <t.icon className="h-3.5 w-3.5" />{t.label}
            {t.count ? <span className="rounded bg-bg px-1 font-mono text-[10px] text-faint">{t.count}</span> : null}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <IconButton title="Abrir pasta input" onClick={() => projectId && api.projects.openFolder(projectId, 'input')}>
            <FolderOpen className="h-3.5 w-3.5" />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={pick}><Import className="h-3.5 w-3.5" />Importar</Button>
        </div>
      </div>
      <div className={cx('min-h-0 flex-1', tab === 'timeline' ? 'overflow-hidden' : 'overflow-auto')}>
        <div className={tab === 'subtitles' ? '' : 'hidden'}><SubtitlesPanel key={projectId} /></div>
        {tab === 'media' ? <MediaLibrary /> : tab === 'timeline' ? <TimelineEditor /> : tab === 'assets' ? <AssetsPanel /> : tab === 'versions' ? <VersionsList /> : null}
      </div>
    </section>
  )
}
