import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Sparkles, Wand2 } from 'lucide-react'
import { readTitle } from '@shared/composition'
import type { HubItem } from '@shared/packs'
import { cx, mediaUrl } from '@/lib/format'
import { addMediaItem, addTitleFromTemplate, applyPreset, fontFamily, useHub } from './hub'

// Abas do Asset Hub no navegador do editor. Clique aplica no playhead (ou no clipe selecionado, nos presets).

export type HubTab = 'titles' | 'sfx' | 'overlays' | 'presets'

/** Amostra do título em CSS, com a fonte real do pacote. */
function TitleSample({ it }: { it: HubItem }) {
  const t = readTitle(it.title?.style)
  const text = (t.uppercase ? t.text.toLocaleUpperCase('pt-BR') : t.text).split('\n')[0]
  const stroke = t.outline > 0 ? `${Math.max(1, t.outline * 14).toFixed(1)}px ${t.outlineColor}` : undefined
  return (
    <div className="flex h-12 items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(#1c1c24_0_25%,#15151b_0_50%)] [background-size:12px_12px] px-1">
      <span className="max-w-full truncate leading-none" style={{
        fontFamily: `"${fontFamily(t.font)}", sans-serif`, fontSize: Math.min(22, 8 + t.size * 80), color: t.color,
        WebkitTextStroke: stroke, paintOrder: 'stroke fill', textShadow: t.shadow > 0 ? '1px 2px 3px rgba(0,0,0,.6)' : undefined,
        background: t.box > 0 ? `${t.boxColor}${Math.round(t.box * 255).toString(16).padStart(2, '0')}` : undefined, padding: t.box > 0 ? '2px 5px' : undefined
      }}>{text}</span>
    </div>
  )
}

function SoundRow({ it }: { it: HubItem }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const toggle = (): void => {
    const a = ref.current
    if (!a) return
    if (a.paused) { a.currentTime = 0; void a.play() } else a.pause()
  }
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-line bg-bg px-1.5 py-1 hover:border-accent/60">
      <button type="button" onClick={toggle} aria-label={`Ouvir ${it.name}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-raised text-ok hover:bg-ok/20">
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      <button type="button" onClick={() => void addMediaItem(it)} title="Adicionar no playhead" className="min-w-0 flex-1 text-left">
        <p className="truncate text-[11px] font-medium">{it.name}</p>
        {it.tags?.length ? <p className="truncate text-[9.5px] text-faint">{it.tags.join(' · ')}</p> : null}
      </button>
      {it.path && <audio ref={ref} src={mediaUrl(it.path)} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
    </div>
  )
}

function OverlayTile({ it }: { it: HubItem }) {
  const ref = useRef<HTMLVideoElement>(null)
  return (
    <button type="button" onClick={() => void addMediaItem(it)} title={`${it.name} — clique para pôr no playhead (mescla "tela")`}
      onMouseEnter={() => void ref.current?.play().catch(() => {})} onMouseLeave={() => ref.current?.pause()}
      className="group overflow-hidden rounded-md border border-line bg-bg text-left hover:border-accent/60">
      <div className="relative aspect-video bg-black">
        {it.path && /\.(png|jpe?g)$/i.test(it.path)
          ? <img src={mediaUrl(it.path)} alt="" className="h-full w-full object-cover" />
          : it.path && <video ref={ref} src={`${mediaUrl(it.path)}#t=0.5`} muted loop playsInline preload="metadata" className="h-full w-full object-cover" />}
      </div>
      <p className="truncate px-1.5 py-1 text-[10.5px]">{it.name}</p>
    </button>
  )
}

export function HubPanel({ tab, match }: { tab: HubTab; match(s: string): boolean }) {
  const { items, loaded, load } = useHub()
  useEffect(() => void load(), [load])
  const visible = (type: HubItem['type']): HubItem[] => items.filter((i) => i.type === type && (match(i.name) || (i.tags ?? []).some(match)))
  if (!loaded) return <p className="p-2 text-[11px] text-faint">Carregando o Asset Hub...</p>

  if (tab === 'titles') {
    const list = visible('title')
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {list.map((it) => (
          <button key={it.key} type="button" onClick={() => void addTitleFromTemplate(it)} title={`${it.name} — clique para pôr no playhead`}
            className="overflow-hidden rounded-md border border-line bg-bg text-left hover:border-accent/60">
            <TitleSample it={it} />
            <p className="truncate px-1.5 py-1 text-[10.5px]">{it.name}</p>
          </button>
        ))}
        {!list.length && <p className="col-span-2 p-2 text-[11px] text-faint">Nenhum título.</p>}
      </div>
    )
  }
  if (tab === 'sfx') {
    const list = visible('sfx')
    return <div className="space-y-1">{list.map((it) => <SoundRow key={it.key} it={it} />)}{!list.length && <p className="p-2 text-[11px] text-faint">Nenhum som.</p>}</div>
  }
  if (tab === 'overlays') {
    const list = visible('overlay')
    return <div className="grid grid-cols-2 gap-1.5">{list.map((it) => <OverlayTile key={it.key} it={it} />)}{!list.length && <p className="col-span-2 p-2 text-[11px] text-faint">Nenhum overlay.</p>}</div>
  }
  const list = visible('preset')
  const group = (kind: 'motion' | 'look'): HubItem[] => list.filter((i) => i.preset?.kind === kind)
  return (
    <div>
      {(['motion', 'look'] as const).map((kind) => group(kind).length > 0 && (
        <div key={kind} className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{kind === 'motion' ? 'Movimento (no playhead)' : 'Cor e estilo'}</p>
          <div className="space-y-1">
            {group(kind).map((it) => (
              <button key={it.key} type="button" onClick={() => void applyPreset(it)} title="Aplica no clipe selecionado"
                className={cx('flex w-full items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5 text-left text-[11px] hover:border-accent/60')}>
                {kind === 'motion' ? <Wand2 className="h-3 w-3 shrink-0 text-accent" /> : <Sparkles className="h-3 w-3 shrink-0 text-warn" />}
                <span className="truncate">{it.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!list.length && <p className="p-2 text-[11px] text-faint">Nenhum preset.</p>}
    </div>
  )
}
