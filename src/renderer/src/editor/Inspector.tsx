import { useState } from 'react'
import { Eye, EyeOff, Lock, Plus, Trash2, Unlock, Volume2, VolumeX } from 'lucide-react'
import { BLEND_MODES, clipLength, MAX_SPEED, MIN_SPEED, type BlendMode, type Clip, type Command, type Transform } from '@shared/composition'
import { ANIM_PROPS, EASES, valueAt, type AnimProp, type Ease } from '@shared/keyframes'
import { api, cx, fmtTimePrecise } from '@/lib/format'
import { useStore } from '@/store'
import { Button, IconButton, Toggle } from '@/components/ui'
import { approximateEffects } from './preview'
import { Section, Slider } from './controls'
import { CurveEditor } from './CurveEditor'
import { TitleInspector } from './TitleInspector'
import { StylePanel } from './StylePanel'
import { errorMessage, useEditor } from './editorStore'

const TRANSFORM_PROPS: (keyof Transform & AnimProp)[] = ['scale', 'x', 'y', 'rotation', 'zoom']
const COLOR_PROPS: AnimProp[] = ['brightness', 'contrast', 'saturation', 'blur']

/** Propriedade animável: slider + botão de keyframe. Com animação, mexer no slider grava um keyframe no playhead. */
function AnimSlider({ clip, prop, staticValue, onStatic }: { clip: Clip; prop: AnimProp; staticValue: number; onStatic(v: number): Command }) {
  const { edit, playhead } = useEditor()
  const def = ANIM_PROPS.find((p) => p.id === prop)!
  const keys = clip.keyframes?.[prop]
  const local = Math.min(clipLength(clip), Math.max(0, playhead - clip.start))
  const inside = playhead >= clip.start && playhead <= clip.start + clipLength(clip)
  const atKey = !!keys?.some((k) => Math.abs(k.t - local) < 0.02)
  const value = valueAt(keys, local, staticValue)
  const setKey = (v: number): void => void edit([{ type: 'addKeyframe', clipId: clip.id, prop, t: local, v }])
  return (
    <Slider
      label={def.label} value={value} min={def.min} max={def.max} step={def.step} unit={def.unit}
      onCommit={(v) => (keys?.length ? (inside ? setKey(v) : useStore.getState().toast('Leve o playhead para dentro do clipe para gravar o keyframe.', 'bad')) : void edit([onStatic(v)]))}
      keyframe={{
        animated: !!keys?.length,
        atKey,
        onToggle: () => {
          if (!inside) return useStore.getState().toast('Leve o playhead para dentro do clipe para criar keyframes.', 'bad')
          if (atKey) void edit([{ type: 'setKeyframes', clipId: clip.id, prop, keyframes: (keys ?? []).filter((k) => Math.abs(k.t - local) >= 0.02) }])
          else if (!keys?.length && (prop === 'opacity' || prop === 'volume')) {
            // Opacidade/volume animados multiplicam o valor fixo: ao começar a animar, o fixo vira 1 e o keyframe guarda o valor atual.
            void edit([onStatic(1), { type: 'addKeyframe', clipId: clip.id, prop, t: local, v: value }])
          } else setKey(value)
        }
      }}
    />
  )
}

function KeyframeList({ clip }: { clip: Clip }) {
  const { edit, setPlayhead } = useEditor()
  const entries = Object.entries(clip.keyframes ?? {}).filter(([, k]) => k?.length) as [AnimProp, NonNullable<Clip['keyframes'][AnimProp]>][]
  if (!entries.length) return <p className="text-[11px] text-faint">Clique no losango ao lado de uma propriedade para animá-la a partir do playhead.</p>
  return (
    <div className="space-y-2">
      {entries.map(([prop, keys]) => (
        <div key={prop} className="rounded-md border border-line bg-bg/50 p-1.5">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-medium">{ANIM_PROPS.find((p) => p.id === prop)?.label}</span>
            <button type="button" className="text-faint hover:text-bad" onClick={() => void edit([{ type: 'setKeyframes', clipId: clip.id, prop, keyframes: null }])}>remover animação</button>
          </div>
          {keys.map((k, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5 font-mono text-[10.5px]">
              <button type="button" className="w-14 text-left text-accent hover:underline" onClick={() => setPlayhead(clip.start + k.t)} title="Ir para este keyframe">{k.t.toFixed(2)} s</button>
              <span className="w-12 text-right text-muted">{Number(k.v.toFixed(3))}</span>
              <select
                aria-label="Curva" value={k.ease} disabled={i === keys.length - 1}
                onChange={(e) => void edit([{ type: 'setKeyframes', clipId: clip.id, prop, keyframes: keys.map((x, j) => (j === i ? { ...x, ease: e.target.value as Ease } : x)) }])}
                className="h-5 flex-1 rounded border border-line-2 bg-bg text-[10.5px]"
              >
                {EASES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
              <IconButton title="Apagar keyframe" className="h-5 w-5" onClick={() => void edit([{ type: 'setKeyframes', clipId: clip.id, prop, keyframes: keys.filter((_, j) => j !== i) }])}>
                <Trash2 className="h-3 w-3" />
              </IconButton>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ClipInspector({ clip }: { clip: Clip }) {
  const { edit, catalog, luts, doc } = useEditor()
  const media = useStore((s) => s.media)
  const m = media.find((x) => x.id === clip.mediaId)
  const track = doc?.tracks.find((t) => t.id === clip.trackId)
  const isVideo = track?.kind === 'video'
  const hasSound = m?.kind !== 'image' && !!m?.hasAudio
  const [adding, setAdding] = useState('')
  const set = (patch: Partial<Record<'volume' | 'opacity' | 'fadeIn' | 'fadeOut', number>>): Command => ({ type: 'setClipProps', clipId: clip.id, ...patch })
  const effects = (catalog?.effects ?? []).filter((e) => (e.kind === 'audio' ? hasSound : isVideo))
  const approx = approximateEffects(clip)

  return (
    <div>
      <div className="border-b border-line px-3 py-2">
        <p className="truncate text-[13px] font-medium" title={m?.name}>{clip.title ? `Título: ${clip.title.text.split('\n')[0]}` : m?.name ?? 'Arquivo removido'}</p>
        <p className="font-mono text-[10.5px] text-faint">{fmtTimePrecise(clip.start)} → {fmtTimePrecise(clip.start + clipLength(clip))} · trecho {clip.in.toFixed(2)}–{clip.out.toFixed(2)} s</p>
      </div>
      {clip.title && <TitleInspector clip={clip} />}
      <Section title="Clipe">
        {clip.title ? (
          <Slider label="Duração" value={clip.out} min={0.1} max={600} step={0.05} unit="s" onCommit={(v) => void edit([{ type: 'trimClip', clipId: clip.id, out: v, ripple: useEditor.getState().ripple }])} />
        ) : clip.hold > 0 ? (
          <Slider label="Duração do freeze" value={clip.hold} min={0.1} max={30} step={0.05} unit="s" onCommit={(v) => void edit([{ type: 'trimClip', clipId: clip.id, out: clip.in + v, ripple: useEditor.getState().ripple }])} />
        ) : <>
          {m?.kind !== 'image' && <Slider label="Início no arquivo" value={clip.in} min={0} max={Math.max(clip.out - 0.1, 0.1)} step={0.01} unit="s" onCommit={(v) => void edit([{ type: 'trimClip', clipId: clip.id, in: v, ripple: useEditor.getState().ripple }])} />}
          <Slider label={m?.kind === 'image' ? 'Duração' : 'Fim no arquivo'} value={clip.out} min={clip.in + 0.1} max={m?.kind === 'image' ? 60 : m?.duration ?? clip.out} step={0.01} unit="s" onCommit={(v) => void edit([{ type: 'trimClip', clipId: clip.id, out: v, ripple: useEditor.getState().ripple }])} />
        </>}
        {hasSound && <AnimSlider clip={clip} prop="volume" staticValue={clip.volume} onStatic={(v) => set({ volume: v })} />}
        {isVideo && <AnimSlider clip={clip} prop="opacity" staticValue={clip.opacity} onStatic={(v) => set({ opacity: v })} />}
        <Slider label="Fade de entrada" value={clip.fadeIn} min={0} max={Math.max(0, clipLength(clip) - clip.fadeOut)} step={0.05} unit="s" onCommit={(v) => void edit([set({ fadeIn: v })])} />
        <Slider label="Fade de saída" value={clip.fadeOut} min={0} max={Math.max(0, clipLength(clip) - clip.fadeIn)} step={0.05} unit="s" onCommit={(v) => void edit([set({ fadeOut: v })])} />
      </Section>
      {!clip.title && m && m.kind !== 'image' && clip.hold <= 0 && <SpeedSection clip={clip} isVideo={isVideo} />}
      {isVideo && (
        <Section title="Enquadramento" right={<button type="button" className="text-[10.5px] text-faint hover:text-fg" onClick={() => void edit([{ type: 'setTransform', clipId: clip.id, transform: { x: 0, y: 0, scale: 1, rotation: 0, zoom: 1, anchorX: 0.5, anchorY: 0.5 } }, ...TRANSFORM_PROPS.map((prop): Command => ({ type: 'setKeyframes', clipId: clip.id, prop, keyframes: null }))])}>redefinir</button>}>
          {TRANSFORM_PROPS.map((prop) => <AnimSlider key={prop} clip={clip} prop={prop} staticValue={clip.transform[prop]} onStatic={(v) => ({ type: 'setTransform', clipId: clip.id, transform: { [prop]: v } })} />)}
          <Slider label="Centro do zoom X" value={clip.transform.anchorX} min={0} max={1} step={0.01} onCommit={(v) => void edit([{ type: 'setTransform', clipId: clip.id, transform: { anchorX: v } }])} />
          <Slider label="Centro do zoom Y" value={clip.transform.anchorY} min={0} max={1} step={0.01} onCommit={(v) => void edit([{ type: 'setTransform', clipId: clip.id, transform: { anchorY: v } }])} />
        </Section>
      )}
      {isVideo && (
        <Section title="Cor animada" defaultOpen={false}>
          {COLOR_PROPS.map((prop) => (
            <AnimSlider key={prop} clip={clip} prop={prop} staticValue={ANIM_PROPS.find((p) => p.id === prop)!.neutral}
              onStatic={(v) => ({ type: 'addKeyframe', clipId: clip.id, prop, t: Math.max(0, useEditor.getState().playhead - clip.start), v })} />
          ))}
        </Section>
      )}
      <Section title="Animações">
        <KeyframeList clip={clip} />
      </Section>
      {isVideo && (
        <Section title="Transição de entrada">
          <select
            aria-label="Transição de entrada" value={clip.transitionIn?.type ?? ''}
            onChange={(e) => void edit([{ type: 'setTransition', clipId: clip.id, transition: e.target.value ? { type: e.target.value, duration: clip.transitionIn?.duration } : null }])}
            className="mb-1 h-7 w-full rounded-md border border-line-2 bg-bg px-2 text-xs"
          >
            <option value="">Corte seco (sem transição)</option>
            {(catalog?.transitions ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {clip.transitionIn && (
            <Slider label="Duração" value={clip.transitionIn.duration} min={0.1} max={2} step={0.05} unit="s"
              onCommit={(v) => void edit([{ type: 'setTransition', clipId: clip.id, transition: { type: clip.transitionIn!.type, duration: v } }])} />
          )}
        </Section>
      )}
      <Section title={`Efeitos (${clip.effects.length})`}>
        {clip.effects.map((e) => {
          const def = catalog?.effects.find((d) => d.id === e.type)
          return (
            <div key={e.id} className={cx('mb-2 rounded-md border border-line bg-bg/50 p-1.5', !e.enabled && 'opacity-50')}>
              <div className="mb-1 flex items-center gap-1.5">
                <input type="checkbox" checked={e.enabled} aria-label={`Ativar ${def?.name}`} onChange={(ev) => void edit([{ type: 'updateEffect', clipId: clip.id, effectId: e.id, enabled: ev.target.checked }])} />
                <span className="flex-1 truncate text-[12px] font-medium">{def?.name ?? e.type}{e.asset ? ` · ${luts.find((l) => l.id === e.asset)?.name ?? e.asset}` : ''}</span>
                <IconButton title="Remover efeito" className="h-5 w-5" onClick={() => void edit([{ type: 'removeEffect', clipId: clip.id, effectId: e.id }])}><Trash2 className="h-3 w-3" /></IconButton>
              </div>
              {e.type === 'color-match' && <ColorMatchControl clip={clip} effectId={e.id} />}
              {e.type === 'curves' && <CurveEditor params={e.params} onCommit={(patch) => void edit([{ type: 'updateEffect', clipId: clip.id, effectId: e.id, params: patch }])} />}
              {e.type === 'mask' && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {[['Elipse', 'shape', 0], ['Retângulo', 'shape', 1], ['Inverter', 'invert', e.params.invert ? 0 : 1]].map(([label, key, v]) => (
                    <button key={label} type="button" onClick={() => void edit([{ type: 'updateEffect', clipId: clip.id, effectId: e.id, params: { [key]: v as number } }])}
                      className={cx('rounded border px-1.5 py-0.5 text-[10.5px]', (key === 'shape' ? Math.round(e.params.shape) === v : e.params.invert === 1) ? 'border-accent bg-accent/20 text-fg' : 'border-line text-faint hover:text-fg')}>{label}</button>
                  ))}
                </div>
              )}
              {def?.params.filter((p) => !(e.type === 'curves' && p.key.startsWith('p')) && !(e.type === 'mask' && (p.key === 'shape' || p.key === 'invert'))).map((p) => (
                <Slider key={p.key} label={p.label} value={e.params[p.key] ?? p.default} min={p.min} max={p.max} step={p.step}
                  onCommit={(v) => void edit([{ type: 'updateEffect', clipId: clip.id, effectId: e.id, params: { [p.key]: v } }])} />
              ))}
            </div>
          )
        })}
        <div className="flex gap-1">
          <select aria-label="Adicionar efeito" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-7 flex-1 rounded-md border border-line-2 bg-bg px-2 text-xs">
            <option value="">Adicionar efeito...</option>
            {effects.filter((e) => e.id !== 'lut').map((e) => <option key={e.id} value={`fx:${e.id}`}>{e.kind === 'audio' ? '♪ ' : ''}{e.name}</option>)}
            {isVideo && luts.map((l) => <option key={l.id} value={`lut:${l.id}`}>LUT · {l.name}</option>)}
          </select>
          <Button size="sm" disabled={!adding} onClick={async () => {
            const [kind, id] = adding.split(':')
            await useEditor.getState().edit([kind === 'lut' ? { type: 'addEffect', clipId: clip.id, effect: 'lut', asset: id } : { type: 'addEffect', clipId: clip.id, effect: id }])
            setAdding('')
          }}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
        {approx.length > 0 && <p className="mt-2 text-[10.5px] text-warn">Granulação, RGB split, nitidez, temperatura, LUT, curvas e correspondência de cor só aparecem na prévia exata e no render.</p>}
      </Section>
    </div>
  )
}

function TrackInspector({ trackId }: { trackId: string }) {
  const { doc, edit } = useEditor()
  const t = doc?.tracks.find((x) => x.id === trackId)
  if (!t) return null
  return (
    <Section title={`Trilha ${t.name}`}>
      <div className="flex gap-1">
        <IconButton title={t.muted ? 'Ativar som' : 'Silenciar'} active={t.muted} onClick={() => void edit([{ type: 'updateTrack', trackId: t.id, muted: !t.muted }])}>{t.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}</IconButton>
        {t.kind === 'video' && <IconButton title={t.hidden ? 'Mostrar' : 'Ocultar'} active={t.hidden} onClick={() => void edit([{ type: 'updateTrack', trackId: t.id, hidden: !t.hidden }])}>{t.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</IconButton>}
        <IconButton title={t.locked ? 'Desbloquear' : 'Bloquear'} active={t.locked} onClick={() => void edit([{ type: 'updateTrack', trackId: t.id, locked: !t.locked }])}>{t.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</IconButton>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void edit([{ type: 'removeTrack', trackId: t.id }])}><Trash2 className="h-3.5 w-3.5" />Excluir trilha</Button>
      </div>
      {t.kind === 'video' && (
        <label className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
          Mesclagem
          <select aria-label="Modo de mesclagem" value={t.blend ?? 'normal'} onChange={(e) => void edit([{ type: 'updateTrack', trackId: t.id, blend: e.target.value as BlendMode }])}
            className="h-7 rounded-md border border-line-2 bg-bg px-2 text-xs">
            {BLEND_MODES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
    </Section>
  )
}

function MixInspector() {
  const { doc, edit } = useEditor()
  if (!doc) return null
  return (
    <Section title="Mixagem do projeto">
      <Toggle checked={doc.mix.duck} onChange={(v) => void edit([{ type: 'setMix', mix: { duck: v } }])} label="Abaixar a música sob fala/jogo" hint="Ducking automático: a trilha de áudio abaixa quando o vídeo tem som." />
      {doc.mix.duck && <Slider label="Intensidade" value={doc.mix.duckAmount} min={0} max={1} step={0.05} onCommit={(v) => void edit([{ type: 'setMix', mix: { duckAmount: v } }])} />}
      <Toggle checked={doc.mix.normalize} onChange={(v) => void edit([{ type: 'setMix', mix: { normalize: v } }])} label="Normalizar volume final" hint="Padrão das redes: -14 LUFS (YouTube, Instagram, TikTok)." />
      {doc.mix.normalize && <Slider label="Alvo (LUFS)" value={doc.mix.targetLufs} min={-24} max={-9} step={0.5} onCommit={(v) => void edit([{ type: 'setMix', mix: { targetLufs: v } }])} />}
      <p className="mt-2 text-[10.5px] text-faint">Ducking e normalização valem no render e na prévia exata.</p>
    </Section>
  )
}

/** Escolhe um clipe de referência e calcula a correspondência de cor (no arquivo original, antes de efeitos). */
function ColorMatchControl({ clip, effectId }: { clip: Clip; effectId: string }) {
  const { doc, edit } = useEditor()
  const media = useStore((s) => s.media)
  const projectId = useStore((s) => s.projectId)
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const others = (doc?.clips ?? []).filter((c) => c.id !== clip.id && media.find((m) => m.id === c.mediaId && m.kind !== 'audio')).sort((a, b) => a.start - b.start)
  const name = (c: Clip): string => `${media.find((m) => m.id === c.mediaId)?.name ?? '?'} · ${fmtTimePrecise(c.start)}`
  const run = async (): Promise<void> => {
    if (!projectId || !ref) return
    setBusy(true)
    try {
      const params = await api.composition.colorMatch(projectId, clip.id, ref)
      await edit([{ type: 'updateEffect', clipId: clip.id, effectId, params }])
    } catch (err) {
      useStore.getState().toast(errorMessage(err), 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mb-1.5 flex gap-1">
      <select aria-label="Clipe de referência" value={ref} onChange={(e) => setRef(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-bg px-2 text-xs">
        <option value="">Igualar a...</option>
        {others.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}
      </select>
      <Button size="sm" disabled={!ref || busy} onClick={() => void run()}>{busy ? '...' : 'Igualar'}</Button>
    </div>
  )
}

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4]

/** Velocidade do clipe inteiro, rampa (câmera lenta num trecho) e freeze frame, ambos a partir do playhead. */
function SpeedSection({ clip, isVideo }: { clip: Clip; isVideo: boolean }) {
  const { edit, playhead } = useEditor()
  const [rampSpeed, setRampSpeed] = useState(0.4)
  const [rampLen, setRampLen] = useState(1)
  const [smooth, setSmooth] = useState(true)
  const [freezeLen, setFreezeLen] = useState(1)
  const end = clip.start + clipLength(clip)
  const inside = playhead > clip.start && playhead < end
  const ripple = (): boolean => useEditor.getState().ripple
  const needPlayhead = (): void => useStore.getState().toast('Leve o playhead para dentro do clipe.', 'bad')
  return (
    <Section title="Velocidade" defaultOpen={clip.speed !== 1}>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {SPEED_PRESETS.map((s) => (
          <button key={s} type="button" onClick={() => void edit([{ type: 'setSpeed', clipId: clip.id, speed: s, ripple: ripple() }])}
            className={cx('rounded border px-1.5 py-0.5 font-mono text-[10.5px]', Math.abs(clip.speed - s) < 0.001 ? 'border-accent bg-accent/20 text-fg' : 'border-line text-faint hover:text-fg')}>{s}×</button>
        ))}
      </div>
      <Slider label="Velocidade" value={clip.speed} min={MIN_SPEED} max={MAX_SPEED} step={0.05} unit="×" onCommit={(v) => void edit([{ type: 'setSpeed', clipId: clip.id, speed: v, ripple: ripple() }])} />
      <p className="mb-1 mt-2.5 text-[11px] font-medium text-muted">Rampa a partir do playhead</p>
      <Slider label="Velocidade no trecho" value={rampSpeed} min={MIN_SPEED} max={MAX_SPEED} step={0.05} unit="×" onCommit={setRampSpeed} />
      <Slider label="Duração do trecho" value={rampLen} min={0.2} max={10} step={0.1} unit="s" onCommit={setRampLen} />
      <Toggle checked={smooth} onChange={setSmooth} label="Transição suave" hint="Muda a velocidade em degraus nas bordas do trecho" />
      <Button size="sm" className="w-full" disabled={!inside} title={inside ? undefined : 'Leve o playhead para dentro do clipe'}
        onClick={() => (inside ? void edit([{ type: 'speedRamp', clipId: clip.id, from: playhead, to: Math.min(end, playhead + rampLen), speed: rampSpeed, smooth }]) : needPlayhead())}>
        Aplicar rampa
      </Button>
      {isVideo && <>
        <p className="mb-1 mt-2.5 text-[11px] font-medium text-muted">Freeze frame</p>
        <Slider label="Duração" value={freezeLen} min={0.1} max={30} step={0.1} unit="s" onCommit={setFreezeLen} />
        <Button size="sm" className="w-full" disabled={!inside} title={inside ? undefined : 'Leve o playhead para dentro do clipe'}
          onClick={() => (inside ? void edit([{ type: 'freezeFrame', clipId: clip.id, at: playhead, duration: freezeLen }]) : needPlayhead())}>
          Congelar quadro no playhead
        </Button>
      </>}
    </Section>
  )
}

export function Inspector() {
  const { doc, selection, selectedTrack } = useEditor()
  const clip = doc?.clips.find((c) => c.id === selection[0])
  return (
    <aside data-tour="inspector" className="h-full overflow-y-auto border-l border-line bg-panel-2">
      {clip ? <ClipInspector key={clip.id} clip={clip} /> : (
        <>
          {selectedTrack && <TrackInspector trackId={selectedTrack} />}
          <StylePanel />
          <MixInspector />
          <p className="px-3 py-3 text-[11px] text-faint">Selecione um clipe para ver tempo, enquadramento, animações, transição e efeitos.</p>
        </>
      )}
    </aside>
  )
}
