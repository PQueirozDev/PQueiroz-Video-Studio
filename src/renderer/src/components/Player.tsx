import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Film, Maximize, Music, Pause, Play, SkipBack, Volume2, VolumeX } from 'lucide-react'
import { cx, fmtTimePrecise, mediaUrl } from '@/lib/format'
import { useStore, type Source } from '@/store'
import { Empty, IconButton } from './ui'

interface Resolved {
  label: string
  path: string
  kind: 'video' | 'audio' | 'image'
}

function useResolved(source: Source): Resolved | null {
  const { media, versions } = useStore()
  const useProxies = useStore((s) => s.settings?.useProxies ?? false)
  return useMemo(() => {
    if (!source) return null
    if (source.kind === 'media') {
      const m = media.find((x) => x.id === source.id)
      if (!m) return null
      const proxy = useProxies && m.proxy ? m.proxy : null
      return { label: proxy ? `${m.name} · proxy` : m.name, path: proxy ?? m.path, kind: m.kind }
    }
    const v = versions.find((x) => x.id === source.id)
    return v ? { label: v.label, path: v.path, kind: 'video' } : null
  }, [source, media, versions, useProxies])
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

export function Player() {
  const { source, setSource, media, versions, compare, setCompare } = useStore()
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const main = useResolved(source)
  const firstVideo = media.find((m) => m.kind === 'video')
  const current = versions.find((v) => v.id === project?.currentVersionId) ?? versions[versions.length - 1]
  const before: Resolved | null = firstVideo ? { label: `Original · ${firstVideo.name}`, path: firstVideo.path, kind: 'video' } : null
  const after: Resolved | null = current ? { label: current.label, path: current.path, kind: 'video' } : null
  const showCompare = compare && before && after

  const a = useRef<HTMLVideoElement>(null)
  const b = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)

  const videos = (): HTMLVideoElement[] => [a.current, showCompare ? b.current : null].filter(Boolean) as HTMLVideoElement[]

  useEffect(() => {
    setPlaying(false)
    setTime(0)
  }, [main?.path, showCompare])

  useEffect(() => {
    for (const v of videos()) {
      v.volume = volume
      v.muted = muted
      v.playbackRate = speed
    }
  })

  const toggle = (): void => {
    const vs = videos()
    if (!vs.length) return
    if (vs[0].paused) vs.forEach((v) => v.play().catch(() => {}))
    else vs.forEach((v) => v.pause())
  }

  const seek = (t: number): void => {
    for (const v of videos()) v.currentTime = Math.min(t, v.duration || t)
    setTime(t)
    useStore.setState({ playerTime: t })
  }

  // A timeline pode pedir para o player ir a um ponto (ex.: início de um corte).
  const seekReq = useStore((s) => s.seekRequest)
  useEffect(() => {
    if (seekReq) seek(seekReq.t)
  }, [seekReq]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') seek(Math.max(0, time - 1))
      else if (e.key === 'ArrowRight') seek(Math.min(duration, time + 1))
      else if (e.key.toLowerCase() === 'f') box.current?.requestFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mode = source?.kind === 'version' ? 'editado' : 'original'

  return (
    <section className="flex h-full flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Preview</span>
        <span className="min-w-0 truncate text-xs text-muted">{showCompare ? 'Antes / Depois' : main?.label}</span>
        <div className="ml-auto flex items-center gap-1">
          {before && after && (
            <div className="flex rounded-md border border-line bg-panel p-0.5">
              {(['original', 'editado'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setCompare(false)
                    setSource(m === 'original' ? { kind: 'media', id: firstVideo!.id } : { kind: 'version', id: current!.id })
                  }}
                  className={cx('h-6 rounded px-2 text-[11px] font-medium capitalize transition-colors',
                    !compare && mode === m ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}
                >
                  {m === 'original' ? 'Original' : 'Editado'}
                </button>
              ))}
            </div>
          )}
          <IconButton title="Antes / Depois" active={compare} disabled={!before || !after} onClick={() => setCompare(!compare)}>
            <Columns2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center gap-3 bg-black p-3">
        {!main && !showCompare ? (
          <Empty icon={<Film className="h-10 w-10" />} title="Nenhum vídeo selecionado">
            Arraste vídeos para a janela ou use "Importar" na biblioteca.
          </Empty>
        ) : showCompare ? (
          [before!, after!].map((r, i) => (
            <div key={r.path} className="relative flex h-full min-w-0 flex-1 items-center justify-center">
              <video
                ref={i === 0 ? a : b}
                src={mediaUrl(r.path)}
                className="max-h-full max-w-full rounded"
                onLoadedMetadata={(e) => i === 1 && setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => i === 1 && setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={toggle}
              />
              <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] font-medium">{i === 0 ? 'ANTES' : `DEPOIS · ${r.label}`}</span>
            </div>
          ))
        ) : main!.kind === 'image' ? (
          <img src={mediaUrl(main!.path)} className="max-h-full max-w-full rounded object-contain" alt="" />
        ) : (
          <>
            {main!.kind === 'audio' && <Music className="absolute h-14 w-14 text-faint" />}
            <video
              key={main!.path}
              ref={a}
              src={mediaUrl(main!.path)}
              className={cx('max-h-full max-w-full rounded', main!.kind === 'audio' && 'h-0')}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onTimeUpdate={(e) => {
                setTime(e.currentTarget.currentTime)
                useStore.setState({ playerTime: e.currentTarget.currentTime })
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onClick={toggle}
              onDoubleClick={() => box.current?.requestFullscreen()}
            />
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-line bg-panel px-3 py-2">
        <input
          type="range" min={0} max={duration || 0} step={0.01} value={time}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ ['--fill' as string]: `${duration ? (time / duration) * 100 : 0}%` }}
          className="w-full"
          disabled={!duration}
        />
        <div className="flex items-center gap-1">
          <IconButton title="Voltar ao início" onClick={() => seek(0)}><SkipBack className="h-4 w-4" /></IconButton>
          <IconButton title={playing ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'} onClick={toggle} className="text-fg">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconButton>
          <span className="ml-1 font-mono text-[11px] text-muted">{fmtTimePrecise(time)} <span className="text-faint">/ {fmtTimePrecise(duration || 0)}</span></span>
          <div className="ml-auto flex items-center gap-1">
            <IconButton title={muted ? 'Ativar som' : 'Silenciar'} onClick={() => setMuted(!muted)}>
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </IconButton>
            <input
              type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setMuted(false)
              }}
              style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
              className="w-20"
            />
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              title="Velocidade"
              className="ml-1 h-6 rounded border border-line bg-bg px-1 font-mono text-[11px] text-muted outline-none"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
            <IconButton title="Tela cheia (F)" onClick={() => box.current?.requestFullscreen()}><Maximize className="h-4 w-4" /></IconButton>
          </div>
        </div>
      </div>
    </section>
  )
}
