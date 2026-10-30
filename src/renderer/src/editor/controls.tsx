import { useEffect, useState, type ReactNode } from 'react'
import { Diamond } from 'lucide-react'
import { cx } from '@/lib/format'

/**
 * Slider que só grava ao soltar (ou com Enter no número): arrastar não cria dezenas de passos de desfazer.
 * `onPreview` recebe o valor durante o arraste, para a tela acompanhar sem gravar.
 */
export function Slider({ label, value, min, max, step, unit, onCommit, onPreview, disabled, keyframe }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onCommit(v: number): void
  onPreview?(v: number | null): void
  disabled?: boolean
  keyframe?: { animated: boolean; atKey: boolean; onToggle(): void }
}) {
  const [v, setV] = useState(value)
  const [text, setText] = useState(fmt(value, step))
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) {
      setV(value)
      setText(fmt(value, step))
    }
  }, [value, step, dragging])
  const commit = (n: number): void => {
    const c = Math.min(max, Math.max(min, n))
    setDragging(false)
    onPreview?.(null)
    if (Math.abs(c - value) > step / 4) onCommit(c)
    else setV(value)
  }
  return (
    <div className={cx('grid grid-cols-[92px_1fr_58px_18px] items-center gap-2 py-0.5', disabled && 'opacity-40')}>
      <span className="truncate text-[11px] text-muted" title={label}>{label}</span>
      <input
        type="range" aria-label={label} min={min} max={max} step={step} value={v} disabled={disabled}
        onPointerDown={() => setDragging(true)}
        onChange={(e) => {
          const n = Number(e.target.value)
          setV(n)
          setText(fmt(n, step))
          onPreview?.(n)
        }}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        className="h-1 w-full accent-[var(--color-accent)]"
      />
      <input
        value={text} disabled={disabled} aria-label={`${label} (valor)`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { const n = Number(text.replace(',', '.')); Number.isFinite(n) ? commit(n) : setText(fmt(value, step)) }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-6 w-full rounded border border-line-2 bg-bg px-1 text-right font-mono text-[10.5px] outline-none focus:border-accent"
        title={unit}
      />
      {keyframe ? (
        <button
          type="button" onClick={keyframe.onToggle} disabled={disabled}
          title={keyframe.atKey ? 'Remover keyframe neste ponto' : keyframe.animated ? 'Adicionar keyframe no playhead' : 'Animar: cria o primeiro keyframe no playhead'}
          aria-label={`Keyframe de ${label}`}
          className={cx('flex h-5 w-5 items-center justify-center rounded', keyframe.atKey ? 'text-accent' : keyframe.animated ? 'text-accent/70 hover:text-accent' : 'text-faint hover:text-fg')}
        >
          <Diamond className={cx('h-3 w-3', keyframe.atKey && 'fill-current')} />
        </button>
      ) : <span />}
    </div>
  )
}

const fmt = (v: number, step: number): string => (step >= 1 ? String(Math.round(v)) : v.toFixed(step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3))

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-line">
      <div className="flex h-8 items-center gap-2 px-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 text-left text-[11px] font-semibold uppercase tracking-wider text-faint hover:text-muted">
          {open ? '▾' : '▸'} {title}
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}
