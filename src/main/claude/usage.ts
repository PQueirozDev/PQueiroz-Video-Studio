import { join } from 'node:path'
import { app } from 'electron'
import type { ClaudeUsage, UsageWindow } from '@shared/types'
import { ensureDir } from '../files'
import { claudePath } from '../tools'
import { exec } from '../util'

// Uso da assinatura do Claude (janelas de 5h e da semana), como no Qyrex:
//   - `claude -p /usage` em modo não interativo — não envia nada ao modelo e não gasta uso;
//   - `claude auth status` — conta e plano;
//   - eventos `rate_limit_event` que chegam no streaming do chat atualizam ao vivo.

const TTL_MS = 60_000
const MIN_FORCE_MS = 5_000
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "Oct 4, 4:59am", "4:59am", "Oct 10" → Date no fuso local (o CLI escreve no fuso do PC). */
export function parseResetText(text: string, now = new Date()): Date | null {
  const m = /^\s*(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*|\s+at\s+|\s+)?)?(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i.exec(text)
  if (!m || (!m[1] && !m[3])) return null
  const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  if (m[1] && month < 0) return null
  let hours = m[3] ? Number(m[3]) % 12 : 0
  if (m[5]?.toLowerCase() === 'pm') hours += 12
  const date = new Date(now)
  date.setSeconds(0, 0)
  if (month >= 0) date.setMonth(month, Number(m[2]))
  date.setHours(hours, m[4] ? Number(m[4]) : 0)
  if (month < 0 && date.getTime() < now.getTime() - 60_000) date.setDate(date.getDate() + 1)
  if (month >= 0 && date.getTime() < now.getTime() - 86_400_000) date.setFullYear(date.getFullYear() + 1)
  return date
}

/** Linhas "Current session: 59% used · resets Oct 4, 4:59am (America/Sao_Paulo)". */
export function parseUsageText(text: string, now = new Date()): UsageWindow[] {
  const out: UsageWindow[] = []
  const re = /^\s*Current (session|week)(?:\s*\(([^)]+)\))?:\s*(\d+(?:\.\d+)?)%\s*used(?:\s*[·•-]\s*resets\s+(.+?))?\s*$/gim
  for (const m of text.matchAll(re)) {
    const scope = m[2]?.trim() ?? ''
    const allModels = !scope || /all models/i.test(scope)
    const resetsAt = m[4] ? parseResetText(m[4].replace(/\([^)]*\)\s*$/, ''), now) : null
    out.push({
      kind: m[1].toLowerCase() === 'session' ? 'session' : allModels ? 'week' : 'model',
      label: m[1].toLowerCase() === 'week' && !allModels ? scope.replace(/\s*only$/i, '') : null,
      usedPercent: Math.max(0, Math.min(100, Number(m[3]))),
      resetsAt: resetsAt ? resetsAt.toISOString() : null
    })
  }
  return out
}

let current: ClaudeUsage | null = null
let fetching: { at: number; value: Promise<ClaudeUsage> } | null = null
type Listener = (u: ClaudeUsage) => void
let listener: Listener = () => {}
export const onUsageUpdate = (fn: Listener): void => {
  listener = fn
}

function publish(u: ClaudeUsage): ClaudeUsage {
  current = u
  listener(u)
  return u
}

async function read(): Promise<ClaudeUsage> {
  const base: ClaudeUsage = { available: false, account: null, plan: null, windows: [], error: null, fetchedAt: new Date().toISOString(), source: 'usage' }
  const bin = await claudePath()
  if (!bin) return { ...base, error: 'Claude Code não encontrado' }
  const cwd = ensureDir(join(app.getPath('userData'), 'usage-scratch'))
  const auth = await exec(bin, ['auth', 'status'], { timeoutMs: 20_000, cwd })
  let account: string | null = null
  let plan: string | null = null
  try {
    const j = JSON.parse(auth.stdout.trim() || '{}') as { loggedIn?: boolean; email?: string; subscriptionType?: string }
    if (!j.loggedIn) return { ...base, error: 'Faça login com "claude" no terminal.' }
    account = j.email ?? null
    plan = j.subscriptionType ?? null
  } catch {
    /* versões antigas não têm JSON: segue sem conta */
  }
  const r = await exec(bin, ['-p', '/usage', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'],
    { timeoutMs: 45_000, cwd })
  let text = r.stdout
  try {
    text = (JSON.parse(r.stdout.trim()) as { result?: string }).result ?? r.stdout
  } catch {
    /* texto puro */
  }
  const windows = parseUsageText(text)
  return { ...base, available: true, account, plan, windows, error: windows.length ? null : 'O Claude Code não informou o uso.' }
}

export function getClaudeUsage(force = false): Promise<ClaudeUsage> {
  const age = fetching ? Date.now() - fetching.at : Infinity
  if (fetching && age < (force ? MIN_FORCE_MS : TTL_MS)) return fetching.value
  const value = read().then(publish)
  fetching = { at: Date.now(), value }
  value.catch(() => {
    fetching = null
  })
  return value
}

/**
 * `rate_limit_event` do stream-json: { rate_limit_info: { unifiedWindows: { five_hour: { utilization, resetsAt }, seven_day: {...} } } }.
 * utilization vem de 0 a 1 e resetsAt em segundos (epoch).
 */
export function applyRateLimitEvent(info: Record<string, any> | undefined): void {
  const w = info?.unifiedWindows
  if (!w) return
  const win = (kind: UsageWindow['kind'], x: any): UsageWindow | null =>
    x && typeof x.utilization === 'number'
      ? { kind, label: null, usedPercent: Math.round(Math.min(1, Math.max(0, x.utilization)) * 1000) / 10, resetsAt: x.resetsAt ? new Date(x.resetsAt * 1000).toISOString() : null }
      : null
  const live = [win('session', w.five_hour), win('week', w.seven_day)].filter(Boolean) as UsageWindow[]
  if (!live.length) return
  // Mantém janelas extras (por modelo) que só o /usage informa.
  const extra = (current?.windows ?? []).filter((x) => x.kind === 'model')
  publish({
    available: true, account: current?.account ?? null, plan: current?.plan ?? null,
    windows: [...live, ...extra], error: null, fetchedAt: new Date().toISOString(), source: 'live'
  })
}
