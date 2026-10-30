import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, SkipBack, WandSparkles, X } from 'lucide-react'
import { clipEnd, type Clip } from '@shared/composition'
import type { MediaItem } from '@shared/types'
import { cx, fmtTimePrecise, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { Badge, IconButton } from '@/components/ui'
import { useEditor } from './editorStore'
import { audioAt, layersAt, outputSize, type LayerState } from './preview'
import { AudioMeter, meterSource, resumeMeter } from './AudioMeter'
import { fontFamily, useHub } from './hub'

// Preview em tempo real da composição (aproximado): cada clipe é um <video>/<img> posicionado por CSS
// com a mesma interpolação de keyframes do render. Efeitos sem equivalente em CSS só aparecem na
// "Prévia exata", que renderiza o trecho com o motor do export e toca por cima.

/** Estilo da máscara: retângulo normal = interseção das faixas; invertido = união (fica o lado de fora). */
function maskStyle(layer: LayerState | null): React.CSSProperties {
  if (!layer?.mask) return {}
  const p = layer.clip.effects.find((e) => e.enabled && e.type === 'mask')?.params
  const composite = p && Math.round(p.shape) === 1 ? (Math.round(p.invert) === 1 ? 'add' : 'intersect') : 'add'
  return { maskImage: layer.mask, WebkitMaskImage: layer.mask, maskComposite: composite, WebkitMaskComposite: composite === 'intersect' ? 'source-in' : 'source-over' } as React.CSSProperties
}

/** Estilo comum das camadas: enquadramento, opacidade, filtro, máscara e mesclagem da trilha. */
function layerStyle(layer: LayerState | null): React.CSSProperties {
  return { opacity: layer?.opacity ?? 0, transform: layer?.transform, transformOrigin: layer?.transformOrigin, filter: layer?.filter || undefined, clipPath: layer?.clipPath,
    zIndex: (layer?.trackIndex ?? 0) + 1, mixBlendMode: (layer?.blend ?? undefined) as React.CSSProperties['mixBlendMode'], ...maskStyle(layer) }
}

/** Título em CSS com a mesma geometria do drawtext (tamanho = fração da altura, âncora x/y, contorno, caixa). */
function TitleLayer({ layer, stageH }: { layer: LayerState | null; stageH: number }) {
  const t = layer?.clip.title
  if (!layer || !t) return null
  const size = t.size * stageH
  const lines = (t.uppercase ? t.text.toLocaleUpperCase('pt-BR') : t.text).split('\n')
  const tx = t.align === 'left' ? '0' : t.align === 'right' ? '-100%' : '-50%'
  return (
    <div className="pointer-events-none absolute inset-0" style={layerStyle(layer)}>
      <div className="absolute whitespace-pre" style={{
        left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: `translate(${tx}, -50%)`, textAlign: t.align,
        fontFamily: `"${fontFamily(t.font)}", "${fontFamily('poppins-bold')}", sans-serif`, fontSize: size, lineHeight: t.lineSpacing, color: t.color,
        WebkitTextStroke: t.outline > 0 ? `${(2 * t.outline * size).toFixed(2)}px ${t.outlineColor}` : undefined, paintOrder: 'stroke fill',
        textShadow: t.shadow > 0 ? `${(t.shadow * size).toFixed(1)}px ${(t.shadow * size).toFixed(1)}px 0 rgba(0,0,0,.55)` : undefined
      }}>
        {lines.map((line, i) => (
          <div key={i}>
            <span style={t.box > 0 ? { background: `${t.boxColor}${Math.round(t.box * 255).toString(16).padStart(2, '0')}`, padding: `0 ${(size * 0.22).toFixed(1)}px`, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } : undefined}>{line || '\u00a0'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const PRELOAD = 2 // s: monta o elemento antes do clipe começar, para não engasgar no corte
const DRIFT = 0.25

/** `rate` = velocidade do clipe; 0 = freeze frame (fica parado no quadro, mudo). */
function useSync(ref: React.RefObject<HTMLMediaElement | null>, active: boolean, target: number, playing: boolean, volume: number, rate = 1): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.volume = rate > 0 ? Math.max(0, Math.min(1, volume)) : 0
    if (rate > 0 && Math.abs(el.playbackRate - rate) > 0.001) el.playbackRate = rate
    if (!active || rate === 0) {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target
      return
    }
    if (playing) {
      if (Math.abs(el.currentTime - target) > DRIFT * Math.max(1, rate)) el.currentTime = target
      if (el.paused) void el.play().catch(() => {})
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target
    }
  })
}

function VideoLayer({ clip, item, layer, playing, useProxy }: { clip: Clip; item: MediaItem; layer: LayerState | null; playing: boolean; useProxy: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => meterSource(ref.current), [])
  const active = Boolean(layer)
  useSync(ref, active, layer?.sourceTime ?? clip.in, playing, layer?.volume ?? 0, clip.hold > 0 ? 0 : clip.speed)
  const src = mediaUrl(useProxy && item.proxy ? item.proxy : item.path)
  return (
    <div className="absolute inset-0" style={layerStyle(layer)}>
      <video ref={ref} src={src} crossOrigin="anonymous" preload="auto" playsInline className="h-full w-full object-contain" />
      {layer && layer.vignette > 0 && <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at center, transparent ${Math.round(70 - layer.vignette * 40)}%, rgba(0,0,0,${0.35 + layer.vignette * 0.5}) 100%)` }} />}
    </div>
  )
}

function ImageLayer({ item, layer }: { item: MediaItem; layer: LayerState | null }) {
  if (!layer) return null
  return (
    <div className="absolute inset-0" style={layerStyle(layer)}>
      <img src={mediaUrl(item.path)} alt="" className="h-full w-full object-contain" draggable={false} />
    </div>
  )
}

function AudioLayer({ item, active, target, playing, volume, rate }: { item: MediaItem; active: boolean; target: number; playing: boolean; volume: number; rate: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => meterSource(ref.current), [])
  useSync(ref, active, target, playing, volume, rate)
  return <audio ref={ref} src={mediaUrl(item.path)} crossOrigin="anonymous" preload="auto" />
}

/** Comparação: o "depois" fica por cima e é recortado na divisória arrastável; o "antes" segue o tempo dele. */
function BeforeAfter({ before, after }: { before: string; after: string }) {
  const top = useRef<HTMLVideoElement>(null)
  const under = useRef<HTMLVideoElement>(null)
  const [split, setSplit] = useState(0.5)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const a = top.current
    const b = under.current
    if (!a || !b) return
    let raf = 0
    const sync = (): void => {
      if (b.playbackRate !== a.playbackRate) b.playbackRate = a.playbackRate
      if (Math.abs(b.currentTime - a.currentTime) > 0.08) b.currentTime = a.currentTime
      if (a.paused !== b.paused) void (a.paused ? b.pause() : b.play().catch(() => {}))
      raf = requestAnimationFrame(sync)
    }
    raf = requestAnimationFrame(sync)
    return () => cancelAnimationFrame(raf)
  }, [])
  const drag = (e: React.PointerEvent): void => {
    if (!(e.buttons & 1) || !box.current) return
    const r = box.current.getBoundingClientRect()
    setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
  }
  return (
    <div ref={box} className="absolute inset-0 z-50 bg-black">
      <video ref={under} src={mediaUrl(before)} muted className="absolute inset-0 h-full w-full object-contain" />
      <video ref={(el) => { top.current = el; meterSource(el) }} src={mediaUrl(after)} crossOrigin="anonymous" autoPlay controls onPlay={resumeMeter}
        className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }} />
      <div className="absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-ew-resize touch-none" style={{ left: `${split * 100}%` }}
        onPointerDown={(e) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)} onPointerMove={drag} role="slider" aria-label="Divisória antes/depois" aria-valuenow={Math.round(split * 100)}>
        <div className="mx-auto h-full w-0.5 bg-white/80" />
      </div>
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px]">Antes</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px]">Depois</span>
    </div>
  )
}

export function CompositionPreview() {
  const { doc, playhead, playing, setPlaying, setPlayhead } = useEditor()
  const media = useStore((s) => s.media)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const useProxy = useStore((s) => s.settings?.useProxies ?? false)
  const box = useRef<HTMLDivElement>(null)
  const [boxSize, setBoxSize] = useState({ w: 640, h: 360 })
  const [exact, setExact] = useState<{ path: string; start: number; duration: number; before?: string } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBoxSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    // A prévia pode ter sido gerada antes de este player montar (ele aparece só quando a timeline é ativada).
    const w = window as unknown as { __pqExact?: typeof exact }
    const take = (d: typeof exact): void => { w.__pqExact = undefined; setExact(d) }
    if (w.__pqExact) take(w.__pqExact)
    const on = (e: Event): void => take((e as CustomEvent).detail)
    window.addEventListener('pq-exact-preview', on)
    return () => window.removeEventListener('pq-exact-preview', on)
  }, [])

  // Relógio da reprodução.
  useEffect(() => {
    if (!playing) return
    resumeMeter()
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const st = useEditor.getState()
      const t = st.playhead + (now - last) / 1000
      last = now
      const end = st.duration()
      if (t >= end) useEditor.setState({ playhead: end, playing: false })
      else {
        useEditor.setState({ playhead: t })
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Fontes dos títulos vêm dos pacotes do Asset Hub (registradas ao carregar).
  const loadHub = useHub((s) => s.load)
  useEffect(() => void loadHub(), [loadHub])
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media])
  const firstVideo = media.find((m) => m.kind === 'video')
  const out = outputSize(project?.format ?? '16:9', project?.resolution ?? '1080p', firstVideo?.width ?? 1920, firstVideo?.height ?? 1080)
  const scale = Math.min(boxSize.w / out.w, boxSize.h / out.h)
  const stage = { w: Math.floor(out.w * scale), h: Math.floor(out.h * scale) }
  const layers = doc ? layersAt(doc, playhead, stage.w / out.w, (id) => mediaById.get(id)?.kind) : []
  const audio = doc ? audioAt(doc, playhead) : []
  // Monta os elementos dos clipes ativos e dos que vão começar logo (pré-carga).
  const mounted = doc ? doc.clips.filter((c) => playhead >= c.start - PRELOAD && playhead < clipEnd(c) + 0.2) : []

  return (
    <section className="flex h-full flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-xs font-medium">Timeline</span>
        <Badge tone={exact ? 'accent' : 'info'}>{exact ? (exact.before ? 'antes / depois · 540p' : 'prévia exata · 540p') : 'prévia rápida (aproximada)'}</Badge>
        {exact && <IconButton title="Voltar para a prévia rápida" className="ml-auto" onClick={() => setExact(null)}><X className="h-3.5 w-3.5" /></IconButton>}
      </div>
      <div className="flex min-h-0 flex-1">
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-black" style={{ width: stage.w, height: stage.h }}>
          {doc && mounted.map((c) => {
            if (c.title) return <TitleLayer key={c.id} layer={layers.find((l) => l.clip.id === c.id) ?? null} stageH={stage.h} />
            const item = mediaById.get(c.mediaId)
            if (!item) return null
            if (item.kind === 'audio') {
              const a = audio.find((x) => x.clip.id === c.id)
              return <AudioLayer key={c.id} item={item} active={Boolean(a)} target={a?.sourceTime ?? c.in} playing={playing && !exact} volume={a?.volume ?? 0} rate={c.speed} />
            }
            const layer = layers.find((l) => l.clip.id === c.id) ?? null
            return item.kind === 'image'
              ? <ImageLayer key={c.id} item={item} layer={layer} />
              : <VideoLayer key={c.id} clip={c} item={item} layer={layer} playing={playing && !exact} useProxy={useProxy} />
          })}
          {exact?.before && <BeforeAfter key={exact.path + exact.before} after={exact.path} before={exact.before} />}
          {exact && !exact.before && <video key={exact.path} ref={meterSource} src={mediaUrl(exact.path)} crossOrigin="anonymous" autoPlay controls onPlay={resumeMeter} className="absolute inset-0 z-50 h-full w-full bg-black object-contain" />}
        </div>
        {!doc?.clips.length && <p className="absolute inset-0 flex items-center justify-center text-sm text-faint">A timeline está vazia.</p>}
      </div>
      <AudioMeter active={playing || Boolean(exact)} />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3">
        <IconButton title="Início" onClick={() => setPlayhead(0)}><SkipBack className="h-3.5 w-3.5" /></IconButton>
        <IconButton title={playing ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</IconButton>
        <span className="font-mono text-[11px] tabular-nums">{fmtTimePrecise(playhead)}</span>
        <input type="range" aria-label="Posição na timeline" min={0} max={Math.max(0.01, useEditor.getState().duration())} step={0.01} value={playhead}
          onChange={(e) => setPlayhead(Number(e.target.value))} className="flex-1" />
        <span className="font-mono text-[11px] tabular-nums text-faint">{fmtTimePrecise(useEditor.getState().duration())}</span>
        <span className={cx('hidden text-[10.5px] text-faint lg:inline')}><WandSparkles className="mr-1 inline h-3 w-3" />Efeitos exatos: botão “Prévia exata” na timeline</span>
      </div>
    </section>
  )
}
