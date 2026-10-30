import { useEffect, useState } from 'react'
import type { MediaItem } from '@shared/types'
import { api } from '@/lib/format'

/** `range` (s dentro do arquivo) mostra só esse trecho; sem ele, usa o corte da timeline simples. */
export function Waveform({ item, projectId, range }: { item: MediaItem; projectId: string; range?: { in: number; out: number } }) {
  const [peaks, setPeaks] = useState<number[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setPeaks([]); setFailed(false)
    api.media.waveform(projectId, item.id).then((p) => { if (alive) setPeaks(p) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [projectId, item.id])
  if (failed) return <span className="absolute bottom-0 right-1 text-[8px] opacity-60" title="Não foi possível analisar o áudio">áudio indisponível</span>
  if (!peaks.length) return null
  const duration = item.duration || 1
  const from = Math.floor((range?.in ?? item.trimIn ?? 0) / duration * peaks.length)
  const to = Math.ceil((range?.out ?? item.trimOut ?? duration) / duration * peaks.length)
  const visible = peaks.slice(from, to)
  return <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-5 w-full opacity-45" viewBox={`0 0 ${visible.length} 40`} preserveAspectRatio="none" aria-label="Forma de onda do áudio">
    {visible.map((p, i) => <rect key={i} x={i} y={20 - p * 19} width={0.7} height={Math.max(1, p * 38)} fill="currentColor" />)}
  </svg>
}
