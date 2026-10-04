import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { Upload } from 'lucide-react'
import { api } from '@/lib/format'
import { useStore } from '@/store'
import { ProjectsSidebar } from './ProjectsSidebar'
import { Player } from './Player'
import { ChatPanel } from './ChatPanel'
import { BottomPanel } from './BottomPanel'

const storage = {
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* sem armazenamento: usa o layout padrão */
    }
  }
}

export function Workspace() {
  const importPaths = useStore((s) => s.importPaths)
  const [dragging, setDragging] = useState(false)
  const [overAssets, setOverAssets] = useState(false)
  const depth = useRef(0)

  // Um drop tratado em outro lugar (ex.: aba Assets) também precisa esconder o overlay.
  useEffect(() => {
    const reset = (): void => {
      depth.current = 0
      setDragging(false)
    }
    window.addEventListener('drop', reset, true)
    window.addEventListener('dragend', reset, true)
    return () => {
      window.removeEventListener('drop', reset, true)
      window.removeEventListener('dragend', reset, true)
    }
  }, [])
  const outer = useDefaultLayout({ id: 'pq-outer', storage })
  const top = useDefaultLayout({ id: 'pq-top', storage })

  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => api.media.pathForFile(f)).filter(Boolean)
    importPaths(paths)
  }

  return (
    <div
      className="relative h-full"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        depth.current++
        setDragging(true)
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOverAssets(Boolean((e.target as HTMLElement).closest?.('[data-drop="assets"]')))
      }}
      onDrop={onDrop}
    >
      <Group orientation="vertical" id="pq-outer" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged} className="h-full">
        <Panel id="top" minSize="35%" defaultSize="70%">
          <Group orientation="horizontal" id="pq-top" defaultLayout={top.defaultLayout} onLayoutChanged={top.onLayoutChanged} className="h-full">
            <Panel id="projects" defaultSize="16%" minSize="160px" maxSize="30%" collapsible collapsedSize="0px">
              <ProjectsSidebar />
            </Panel>
            <Separator className="w-px" />
            <Panel id="preview" minSize="30%" defaultSize="56%">
              <Player />
            </Panel>
            <Separator className="w-px" />
            <Panel id="chat" defaultSize="28%" minSize="280px" maxSize="50%">
              <ChatPanel />
            </Panel>
          </Group>
        </Panel>
        <Separator className="h-px" />
        <Panel id="bottom" minSize="120px" defaultSize="30%" collapsible collapsedSize="34px">
          <BottomPanel />
        </Panel>
      </Group>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[1px] animate-fade-in">
          <div className="flex flex-col items-center gap-2 text-accent">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">{overAssets ? 'Solte para guardar na biblioteca de assets' : 'Solte para importar no projeto'}</p>
            <p className="text-xs text-muted">Vídeos MP4, MOV, MKV, WEBM · Áudio MP3, WAV, AAC · Imagens PNG, JPG, WEBP</p>
          </div>
        </div>
      )}
    </div>
  )
}
