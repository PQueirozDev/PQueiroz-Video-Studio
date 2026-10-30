import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Film, Maximize, Music, Pause, Play, SkipBack, Volume2, VolumeX } from 'lucide-react'
import { cx, fmtTimePrecise, mediaUrl } from '@/lib/format'
import { useStore, type Source } from '@/store'
import { Button, Empty, IconButton } from './ui'

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
  const { source, setSource, media, versions, compare, setCompare, compareA, compareB, region, focusChat, subtitlePreview } = useStore()
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const main = useResolved(source)
  const firstVideo = media.find((m) => m.kind === 'video')
  const current = versions.find((v) => v.id === project?.currentVersionId) ?? versions[versions.length - 1]
  const defaultA: Source = firstVideo ? { kind: 'media', id: firstVideo.id } : versions[0] ? { kind: 'version', id: versions[0].id } : null
  const defaultB: Source = current ? { kind: 'version', id: current.id } : null
  const before = useResolved(compareA ?? defaultA)
  const after = useResolved(compareB ?? defaultB)
  const options = [...media.filter((m) => m.kind === 'video').map((m) => ({ value: `media:${m.id}`, label: m.name })), ...versions.map((v) => ({ value: `version:${v.id}`, label: `${v.favorite ? '★ ' : ''}${v.label}` }))]
  const sourceValue = (s: Source): string => s ? `${s.kind}:${s.id}` : ''
  const selectComparison = (side: 'compareA' | 'compareB', value: string): void => {
    const [kind, id] = value.split(':')
    if (kind === 'media' || kind === 'version') useStore.setState({ [side]: { kind, id } })
  }
  const showCompare = Boolean(compare && before && after)

  const a = useRef<HTMLVideoElement>(null)
  const b = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const measureFrame = (): void => {
    if (!box.current || !a.current) return
    const outer = box.current.getBoundingClientRect()
    const video = a.current.getBoundingClientRect()
    setFrame({ left: video.left - outer.left, top: video.top - outer.top, width: video.width, height: video.height })
  }
  useEffect(() => {
    if (!box.current) return
    const observer = new ResizeObserver(measureFrame)
    observer.observe(box.current)
    if (a.current) observer.observe(a.current)
    return () => observer.disconnect()
  }, [main?.path, showCompare])

  const videos = (): HTMLVideoElement[] => [a.current, showCompare ? b.current : null].filter(Boolean) as HTMLVideoElement[]

  useEffect(() => {
    setPlaying(false)
    setTime(0)
    setDuration(0)
    setStart(0); setEnd(0)
    useStore.setState({ playerTime: 0, region: null })
  }, [main?.path, before?.path, after?.path, showCompare])

  useEffect(() => {
    for (const v of videos()) {
      v.volume = volume
      v.muted = muted || (Boolean(showCompare) && v === b.current)
      v.playbackRate = speed
    }
  })

  const toggle = (): void => {
    const vs = videos()
    if (!vs.length) return
    if (vs[0].paused) {
      if (duration && vs[0].currentTime >= duration - 0.05) seek(0)
      vs.forEach((v) => v.play().catch(() => {}))
    }
    else vs.forEach((v) => v.pause())
  }

  const seek = (t: number): void => {
    for (const v of videos()) v.currentTime = Math.min(t, v.duration || t)
    setTime(t)
    useStore.setState({ playerTime: t })
  }
  const updateComparison = (): void => {
    const left = a.current; const right = b.current
    if (!left || !right) return
    const limit = Math.min(left.duration || 0, right.duration || 0)
    if (limit) setDuration(limit)
    if (left.currentTime >= limit && limit > 0) { left.pause(); right.pause() }
    if (Math.abs(right.currentTime - left.currentTime) > 0.12) right.currentTime = Math.min(left.currentTime, right.duration || left.currentTime)
    setTime(left.currentTime)
    useStore.setState({ playerTime: left.currentTime })
  }
  const selectRegion = (): void => {
    if (!source || start < 0 || end <= start || end > duration) return
    useStore.setState({ region: { source, start, end } })
    focusChat()
  }
  const cue = subtitlePreview?.path === main?.path && !showCompare ? subtitlePreview?.document.cues.find((c) => c.start <= time && c.end > time) : undefined

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
        <span className="min-w-0 truncate text-xs text-muted">{showCompare ? 'Comparação sincronizada' : main?.label}</span>
        <div className="ml-auto flex items-center gap-1">
          {firstVideo && current && (
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
          <IconButton title="Comparar versões" active={compare} disabled={!before || !after} onClick={() => setCompare(!compare)}>
            <Columns2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {showCompare && <div className="flex gap-2 border-b border-line bg-panel-2 px-3 py-2">
        {(['compareA', 'compareB'] as const).map((side, i) => <label key={side} className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">{i === 0 ? 'A' : 'B'}<select aria-label={`Vídeo ${i === 0 ? 'A' : 'B'}`} className="h-7 min-w-0 flex-1 rounded border border-line-2 bg-bg px-2" value={sourceValue(i === 0 ? compareA ?? defaultA : compareB ?? defaultB)} onChange={(e) => selectComparison(side, e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>)}
      </div>}

      <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center gap-3 bg-black p-3">
        {!main && !showCompare ? (
          <Empty icon={<Film className="h-10 w-10" />} title="Nenhum vídeo selecionado">
            Arraste vídeos para a janela ou use "Importar" na biblioteca.
          </Empty>
        ) : showCompare ? (
          [before!, after!].map((r, i) => (
            <div key={`${i}:${r.path}`} className="relative flex h-full min-w-0 flex-1 items-center justify-center">
              <video
                ref={i === 0 ? a : b}
                src={mediaUrl(r.path)}
                className="max-h-full max-w-full rounded"
                onLoadedMetadata={updateComparison}
                onTimeUpdate={() => i === 0 && updateComparison()}
                onEnded={() => videos().forEach((v) => v.pause())}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={toggle}
              />
              <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] font-medium">{i === 0 ? 'A' : 'B'} · {r.label}</span>
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
              onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); measureFrame() }}
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
        {cue && subtitlePreview && frame.height > 0 && <div className="pointer-events-none absolute" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}><div className="absolute inset-x-0 px-4 text-center whitespace-pre-wrap font-semibold" style={{ top: subtitlePreview.document.style.position === 'top' ? '6%' : subtitlePreview.document.style.position === 'center' ? '50%' : undefined, transform: subtitlePreview.document.style.position === 'center' ? 'translateY(-50%)' : undefined, bottom: subtitlePreview.document.style.position === 'bottom' ? '6%' : undefined, color: subtitlePreview.document.style.color, fontSize: `${subtitlePreview.document.style.size * frame.height / 1080}px`, textShadow: '0 2px 4px #000, 1px 0 2px #000' }}>{cue.text}</div></div>}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-line bg-panel px-3 py-2">
        {main && main.kind !== 'image' && !showCompare && <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="font-medium">Trecho para o Claude</span>
          <label>De <input aria-label="Início do trecho" type="number" min={0} max={duration} step={0.01} value={start} onChange={(e) => setStart(Number(e.target.value))} className="w-16 rounded border border-line-2 bg-bg px-1 py-1 font-mono" /></label>
          <button title="Marcar início na posição atual" onClick={() => setStart(Number(time.toFixed(2)))} className="rounded bg-raised px-2 py-1">Marcar início</button>
          <label>até <input aria-label="Fim do trecho" type="number" min={0} max={duration} step={0.01} value={end} onChange={(e) => setEnd(Number(e.target.value))} className="w-16 rounded border border-line-2 bg-bg px-1 py-1 font-mono" /></label>
          <button title="Marcar fim na posição atual" onClick={() => setEnd(Number(time.toFixed(2)))} className="rounded bg-raised px-2 py-1">Marcar fim</button>
          <Button size="sm" variant="primary" disabled={end <= start || end > duration} onClick={selectRegion}>Pedir alteração</Button>
          {region && <button onClick={() => useStore.setState({ region: null })} className="text-accent">Limpar seleção</button>}
        </div>}
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
