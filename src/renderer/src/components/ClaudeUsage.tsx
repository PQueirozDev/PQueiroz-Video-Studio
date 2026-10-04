import { useCallback, useEffect, useState } from 'react'
import { Asterisk, Clock, MemoryStick, RefreshCw } from 'lucide-react'
import type { ClaudeUsage, UsageWindow } from '@shared/types'
import { api, cx } from '@/lib/format'
import { Dialog } from './ui'

// Uso da assinatura do Claude na barra de título + painel de detalhes (mesmo padrão do Qyrex).
// Os números vêm do `claude -p /usage` (não gasta uso) e dos rate_limit_event do chat.

const POLL_MS = 3 * 60_000
const MEMORY_MS = 5_000
const DANGER = 80
const CLAUDE = '#D97757'

const level = (pct: number): string => (pct >= DANGER ? 'text-bad' : pct >= 50 ? 'text-warn' : 'text-ok')

/** "4d 18h", "4h 28m", "18m" até o reset. */
function timeLeft(iso: string | null, now: number): string {
  if (!iso) return '—'
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000))
  if (mins <= 0) return 'agora'
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const resetClock = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const label = (w: UsageWindow): string => (w.kind === 'session' ? '5 horas' : w.kind === 'week' ? 'Semana' : (w.label ?? 'Modelo'))
const session = (u: ClaudeUsage): UsageWindow | undefined => u.windows.find((w) => w.kind === 'session') ?? u.windows[0]
const week = (u: ClaudeUsage): UsageWindow | undefined => u.windows.find((w) => w.kind === 'week')
const peak = (u: ClaudeUsage): number => Math.max(0, ...u.windows.map((w) => w.usedPercent))

export function ClaudeIcon({ size = 18 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md"
      style={{ width: size, height: size, background: `${CLAUDE}26`, color: CLAUDE, boxShadow: `inset 0 0 0 1px ${CLAUDE}40` }}>
      <Asterisk size={Math.round(size * 0.62)} strokeWidth={2.6} />
    </span>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-raised">
      <div className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, background: pct >= DANGER ? 'var(--color-bad)' : CLAUDE }} />
    </div>
  )
}

function Stat({ label: l, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-[11px] text-faint">{l}</div>
      <div className={cx('font-mono text-[13px] font-semibold tabular-nums text-fg', className)}>{value}</div>
    </div>
  )
}

export function UsageCard({ usage, now, refreshing, onRefresh }: { usage: ClaudeUsage; now: number; refreshing: boolean; onRefresh(): void }) {
  const s = session(usage)
  const w = week(usage)
  const top = peak(usage)
  const live = !usage.error && now - new Date(usage.fetchedAt).getTime() < 5 * 60_000

  return (
    <div className="flex flex-col rounded-xl border border-line bg-bg p-4">
      <div className="flex items-center gap-2.5">
        <ClaudeIcon size={26} />
        <span className="min-w-0 truncate text-[15px] font-semibold">Claude Code</span>
        {usage.plan && <span className="rounded border border-line-2 px-1.5 py-0.5 font-mono text-[10px] lowercase text-muted">{usage.plan}</span>}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-faint">
          <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'animate-pulse' : 'bg-faint')} style={live ? { background: CLAUDE } : undefined} />
          {live ? 'ao vivo' : 'desatualizado'}
        </span>
        <button onClick={onRefresh} disabled={refreshing} title="Atualizar"
          className="rounded-md border border-line p-1.5 text-faint transition-colors hover:bg-raised hover:text-fg disabled:opacity-60">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
        </button>
      </div>
      {usage.account && <p className="selectable mt-1 pl-9 text-[11px] text-faint">{usage.account}</p>}

      {usage.error && usage.windows.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Não foi possível ler o uso agora. <span className="text-faint">{usage.error}</span></p>
      ) : (
        <>
          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[32px] font-bold leading-none tabular-nums">
                {s ? Math.round(s.usedPercent) : 0}<span className="ml-0.5 text-base font-medium text-faint">%</span>
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-muted">
                uso 5h{w && <> · <span className="font-semibold text-fg">semana {Math.round(w.usedPercent)}%</span></>}
              </div>
            </div>
            <span className="flex items-center gap-1.5 rounded-md border border-line-2 px-2 py-1 font-mono text-[12px] font-semibold tabular-nums">
              <Clock size={12} className="text-faint" />{timeLeft(s?.resetsAt ?? null, now)}
            </span>
          </div>

          <div className="mt-4 space-y-3.5">
            {usage.windows.map((x) => (
              <div key={`${x.kind}-${x.label ?? ''}`}>
                <div className="mb-1.5 flex items-center justify-between text-[13px]">
                  <span>{label(x)}</span>
                  <span className="font-mono text-[12px] tabular-nums text-muted">{Math.round(x.usedPercent)}%</span>
                </div>
                <Bar pct={x.usedPercent} />
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3.5">
            {s && <Stat label="reset 5h" value={`${timeLeft(s.resetsAt, now)} · ${resetClock(s.resetsAt)}`} />}
            {w && <Stat label="reset semana" value={`${timeLeft(w.resetsAt, now)} · ${resetClock(w.resetsAt)}`} />}
            <Stat label="pico" value={`${Math.round(top)}%`} className={top >= DANGER ? 'text-bad' : undefined} />
            <Stat label="fonte" value={usage.source === 'live' ? 'chat (ao vivo)' : '/usage'} />
          </div>
          <p className="mt-3 border-t border-line pt-3 text-[11px] text-faint">
            Ler o uso não gasta a assinatura. Os pedidos do chat atualizam estes números em tempo real.
          </p>
        </>
      )}
    </div>
  )
}

/** Indicador da barra de título + memória do app + painel "Uso do Claude". */
export function ClaudeUsageIndicator() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [memory, setMemory] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (force = false) => {
    try {
      setUsage(await api.chat.usage(force))
    } catch {
      /* silencioso: mantém o último valor */
    }
  }, [])

  useEffect(() => {
    void load()
    const off = api.chat.onUsage(setUsage)
    const poll = setInterval(() => void load(), POLL_MS)
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  useEffect(() => {
    const read = (): void => {
      api.app.memory().then(setMemory).catch(() => {})
    }
    read()
    const t = setInterval(read, MEMORY_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [open])

  const s = usage?.available ? session(usage) : undefined
  const pct = s ? Math.round(s.usedPercent) : null

  return (
    <>
      {usage?.available && (
        <button onClick={() => setOpen(true)} title="Uso da assinatura do Claude — clique para ver os detalhes"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-raised">
          <ClaudeIcon />
          <span className={cx('font-mono text-[12px] font-semibold tabular-nums', pct === null ? 'text-faint' : level(pct))}>{pct === null ? '—' : `${pct}%`}</span>
        </button>
      )}
      {memory !== null && (
        <span className="flex items-center gap-1.5 px-1 font-mono text-[12px] tabular-nums text-muted" title="Memória usada pelo PQueiroz Video Studio">
          <MemoryStick size={13} className="text-faint" />{memory} MB
        </span>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} width={460} title="Uso do Claude"
        subtitle="Limites atuais, janelas de reset e conta do Claude Code conectado.">
        {usage && (
          <UsageCard usage={usage} now={now} refreshing={refreshing} onRefresh={async () => {
            setRefreshing(true)
            await load(true)
            setRefreshing(false)
          }} />
        )}
      </Dialog>
    </>
  )
}

/** Configurações › Claude: o mesmo cartão do painel, carregado sob demanda. */
export function SettingsUsage() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    api.chat.usage().then(setUsage).catch(() => {})
    return api.chat.onUsage(setUsage)
  }, [])
  if (!usage) return <p className="text-xs text-faint">Lendo o uso da assinatura...</p>
  return (
    <UsageCard usage={usage} now={Date.now()} refreshing={refreshing} onRefresh={async () => {
      setRefreshing(true)
      setUsage(await api.chat.usage(true))
      setRefreshing(false)
    }} />
  )
}
