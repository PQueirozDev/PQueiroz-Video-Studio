import type { ReactNode } from 'react'
import type { Fill, Shadow, Stroke } from '@shared/image'
import { cx } from '@/lib/format'
import { useImage } from '@/image/imageStore'

// Controles compactos do inspetor. Padrão de histórico: o foco/clique registra um ponto de
// desfazer (checkpoint) e as mudanças contínuas (digitar, arrastar slider) não criam outros.

export const smallInput = 'h-7 w-full rounded-md border border-line-2 bg-bg px-2 text-xs text-fg outline-none focus:border-accent'

export function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex items-center gap-2', className)}>
      <span className="w-20 shrink-0 text-[11px] text-faint">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </label>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="space-y-2 border-b border-line px-3 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{title}</p>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Num({ value, onChange, step = 1, min, max, suffix }: { value: number; onChange(v: number): void; step?: number; min?: number; max?: number; suffix?: string }) {
  const checkpoint = useImage((s) => s.checkpoint)
  return (
    <div className="relative w-full">
      <input
        type="number" className={cx(smallInput, suffix && 'pr-6')} value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0} step={step} min={min} max={max}
        onFocus={checkpoint}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(min != null || max != null ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) : v)
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-faint">{suffix}</span>}
    </div>
  )
}

export function Slider({ value, onChange, min, max, step = 0.01 }: { value: number; onChange(v: number): void; min: number; max: number; step?: number }) {
  const checkpoint = useImage((s) => s.checkpoint)
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <input type="range" className="w-full" min={min} max={max} step={step} value={value} style={{ ['--fill' as string]: fill }}
      onPointerDown={checkpoint} onChange={(e) => onChange(Number(e.target.value))} />
  )
}

const toHex = (c: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c.slice(1).split('').map((x) => x + x).join('')}`
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7)
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c)
  return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : '#000000'
}

export function ColorInput({ value, onChange, palette }: { value: string; onChange(v: string): void; palette?: string[] }) {
  const checkpoint = useImage((s) => s.checkpoint)
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input type="color" value={toHex(value)} onFocus={checkpoint} onChange={(e) => onChange(e.target.value)}
          className="h-7 w-8 shrink-0 cursor-pointer rounded border border-line-2 bg-bg p-0.5" />
        <input className={smallInput} value={value} onFocus={checkpoint} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </div>
      {palette && palette.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {palette.map((c) => (
            <button key={c} type="button" title={c} onClick={() => {
              checkpoint()
              onChange(c)
            }} className={cx('h-4 w-4 rounded border', toHex(value).toLowerCase() === toHex(c).toLowerCase() ? 'border-white' : 'border-line-2')} style={{ background: c }} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FillEditor({ fill, onChange, palette }: { fill: Fill; onChange(f: Fill): void; palette?: string[] }) {
  const checkpoint = useImage((s) => s.checkpoint)
  const stops = fill.type === 'solid' ? [{ offset: 0, color: fill.color }, { offset: 1, color: fill.color }] : fill.stops
  const setType = (t: Fill['type']): void => {
    checkpoint()
    if (t === 'solid') onChange({ type: 'solid', color: stops[0].color })
    else if (t === 'linear') onChange({ type: 'linear', angle: fill.type === 'linear' ? fill.angle : 180, stops: stops.length >= 2 ? stops : [stops[0], { offset: 1, color: '#000000' }] })
    else onChange({ type: 'radial', cx: 0.5, cy: 0.5, r: 0.7, stops })
  }
  const setStop = (i: number, color: string): void => {
    if (fill.type === 'solid') return
    onChange({ ...fill, stops: fill.stops.map((s, k) => (k === i ? { ...s, color } : s)) })
  }
  return (
    <div className="space-y-2">
      <div className="flex rounded-md border border-line-2 bg-bg p-0.5">
        {(['solid', 'linear', 'radial'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)}
            className={cx('h-6 flex-1 rounded text-[11px]', fill.type === t ? 'bg-raised text-fg' : 'text-muted hover:text-fg')}>
            {t === 'solid' ? 'Sólida' : t === 'linear' ? 'Gradiente' : 'Radial'}
          </button>
        ))}
      </div>
      {fill.type === 'solid' ? (
        <ColorInput value={fill.color} onChange={(color) => onChange({ type: 'solid', color })} palette={palette} />
      ) : (
        <>
          {fill.stops.slice(0, 3).map((s, i) => (
            <Row key={i} label={i === 0 ? 'Início' : i === fill.stops.length - 1 ? 'Fim' : 'Meio'}>
              <ColorInput value={s.color} onChange={(c) => setStop(i, c)} palette={palette} />
            </Row>
          ))}
          {fill.type === 'linear' && <Row label="Ângulo"><Slider min={0} max={360} step={1} value={fill.angle} onChange={(angle) => onChange({ ...fill, angle })} /><span className="w-8 text-right text-[10.5px] text-faint">{Math.round(fill.angle)}°</span></Row>}
          {fill.type === 'radial' && <Row label="Alcance"><Slider min={0.1} max={1.5} value={fill.r} onChange={(r) => onChange({ ...fill, r })} /></Row>}
        </>
      )}
    </div>
  )
}

export function ShadowEditor({ shadow, onChange }: { shadow: Shadow | null; onChange(s: Shadow | null): void }) {
  const checkpoint = useImage((s) => s.checkpoint)
  return (
    <Section title="Sombra" right={
      <input type="checkbox" checked={Boolean(shadow)} onChange={(e) => {
        checkpoint()
        onChange(e.target.checked ? { color: 'rgba(0,0,0,0.45)', blur: 24, x: 0, y: 8 } : null)
      }} />
    }>
      {shadow && (
        <>
          <Row label="Cor"><ColorInput value={shadow.color} onChange={(color) => onChange({ ...shadow, color })} /></Row>
          <Row label="Desfoque"><Slider min={0} max={120} step={1} value={shadow.blur} onChange={(blur) => onChange({ ...shadow, blur })} /></Row>
          <Row label="Distância"><Slider min={-60} max={60} step={1} value={shadow.y} onChange={(y) => onChange({ ...shadow, y })} /></Row>
        </>
      )}
    </Section>
  )
}

export function StrokeEditor({ stroke, onChange, title = 'Borda / contorno' }: { stroke: Stroke | null; onChange(s: Stroke | null): void; title?: string }) {
  const checkpoint = useImage((s) => s.checkpoint)
  return (
    <Section title={title} right={
      <input type="checkbox" checked={Boolean(stroke)} onChange={(e) => {
        checkpoint()
        onChange(e.target.checked ? { color: '#000000', width: 4 } : null)
      }} />
    }>
      {stroke && (
        <>
          <Row label="Cor"><ColorInput value={stroke.color} onChange={(color) => onChange({ ...stroke, color })} /></Row>
          <Row label="Espessura"><Slider min={1} max={40} step={1} value={stroke.width} onChange={(width) => onChange({ ...stroke, width })} /></Row>
        </>
      )}
    </Section>
  )
}
