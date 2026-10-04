import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X, Loader2 } from 'lucide-react'
import { cx } from '@/lib/format'
import { useStore } from '@/store'
import appIcon from '@/assets/icon.svg'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent hover:bg-accent-strong text-white shadow-[0_1px_0_#ffffff22_inset]',
  secondary: 'bg-raised hover:bg-line-2 text-fg border border-line-2',
  ghost: 'hover:bg-raised text-muted hover:text-fg',
  danger: 'bg-bad/15 hover:bg-bad/25 text-bad border border-bad/30'
}

export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : size === 'lg' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[13px]',
        VARIANTS[variant], className
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({ className, children, title, active, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg', className
      )}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className ?? 'h-4 w-4')} />
}

export function Progress({ value, indeterminate, className }: { value?: number; indeterminate?: boolean; className?: string }) {
  return (
    <div className={cx('relative h-1 overflow-hidden rounded-full bg-line-2', className)}>
      {indeterminate ? (
        <div className="indeterminate absolute inset-y-0 w-1/3 rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      )}
    </div>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-raised text-muted border-line-2',
    accent: 'bg-accent-soft text-accent border-accent/30',
    ok: 'bg-ok/10 text-ok border-ok/25',
    warn: 'bg-warn/10 text-warn border-warn/25',
    bad: 'bg-bad/10 text-bad border-bad/25',
    info: 'bg-info/10 text-info border-info/25'
  }
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium', tones[tone])}>{children}</span>
}

export function Dialog({ open, onClose, title, subtitle, children, footer, width = 520 }: {
  open: boolean; onClose(): void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] animate-fade-in" onMouseDown={onClose}>
      <div
        className="flex max-h-[86vh] flex-col rounded-xl border border-line-2 bg-panel shadow-2xl shadow-black/60 animate-pop"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <IconButton title="Fechar" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line-2 bg-bg px-3 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20'

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange(v: T): void
}) {
  return (
    <div className="flex rounded-lg border border-line-2 bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 flex-1 rounded-md px-2 text-xs font-medium transition-colors',
            value === o.value ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange(v: T): void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputClass, 'appearance-none pr-8')}>
      {options.map((o) => <option key={o.value} value={o.value} className="bg-panel">{o.label}</option>)}
    </select>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-2 text-left">
      <span>
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-[11px] text-faint">{hint}</span>}
      </span>
      <span className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-2')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return <img src={appIcon} width={size} height={size} alt="" draggable={false} className="shrink-0 select-none" />
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx(
          'rounded-lg border bg-panel-2 px-3 py-2 text-xs shadow-xl shadow-black/40 animate-pop',
          t.tone === 'ok' ? 'border-ok/30' : t.tone === 'bad' ? 'border-bad/40 text-bad' : 'border-line-2'
        )}>{t.text}</div>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="text-faint">{icon}</div>
      <p className="text-[13px] font-medium text-muted">{title}</p>
      {children && <div className="text-xs text-faint">{children}</div>}
    </div>
  )
}
