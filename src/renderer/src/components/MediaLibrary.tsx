import { FileAudio, Film, Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { api, cx, fmtSize, fmtTime, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { Empty } from './ui'

const ICON = { video: Film, audio: FileAudio, image: ImageIcon }

export function mediaInfo(m: MediaItem): string[] {
  return [
    m.duration != null ? fmtTime(m.duration) : null,
    m.width ? `${m.width}×${m.height}` : null,
    m.fps ? `${m.fps} fps` : null,
    fmtSize(m.size),
    m.codec?.toUpperCase() ?? null,
    m.kind === 'video' && !m.hasAudio ? 'mudo' : null
  ].filter(Boolean) as string[]
}

export function MediaLibrary() {
  const { media, source, setSource, setCompare, projectId, refreshMedia, toast } = useStore()

  if (!media.length) {
    return (
      <Empty icon={<Upload className="h-7 w-7" />} title="Arraste vídeos, áudios e imagens para cá">
        MP4 · MOV · MKV · WEBM · MP3 · WAV · AAC · PNG · JPG · WEBP — os originais nunca são alterados.
      </Empty>
    )
  }

  const remove = async (m: MediaItem): Promise<void> => {
    if (!projectId) return
    await api.media.remove(projectId, m.id)
    await refreshMedia()
    toast(`${m.name} removido da biblioteca`, 'info')
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5 p-2.5">
      {media.map((m) => {
        const Icon = ICON[m.kind]
        const selected = source?.kind === 'media' && source.id === m.id
        return (
          <div
            key={m.id}
            onClick={() => {
              setCompare(false)
              setSource({ kind: 'media', id: m.id })
            }}
            className={cx(
              'group relative cursor-pointer overflow-hidden rounded-lg border bg-panel-2 transition-colors',
              selected ? 'border-accent' : 'border-line hover:border-line-2'
            )}
          >
            <div className="relative aspect-video bg-bg">
              {m.thumbnail ? (
                <img src={mediaUrl(m.thumbnail)} className="h-full w-full object-cover" alt="" />
              ) : (
                <div className="flex h-full items-center justify-center text-faint"><Icon className="h-6 w-6" /></div>
              )}
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 p-0.5"><Icon className="h-3 w-3 text-muted" /></span>
              <button
                title="Remover da biblioteca"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(m)
                }}
                className="absolute right-1.5 top-1.5 rounded bg-black/70 p-1 text-muted opacity-0 transition-opacity hover:text-bad group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-xs font-medium" title={m.name}>{m.name}</p>
              <p className="truncate text-[10.5px] text-faint">{mediaInfo(m).join(' · ')}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
