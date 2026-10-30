import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// Log estruturado (uma linha JSON por evento) em <userData>/logs/studio-AAAA-MM-DD.log.
// Guarda 14 dias. Nunca registra conteúdo de mensagens, chaves ou caminhos de fora do estúdio por conta própria:
// quem chama decide os campos, e valores longos são cortados.

type Level = 'info' | 'warn' | 'error'
const KEEP_DAYS = 14
let dir: string | null = null
let cleaned = false

function logDir(): string | null {
  if (dir) return dir
  try {
    dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return null
  }
}

function clean(d: string): void {
  if (cleaned) return
  cleaned = true
  const limit = Date.now() - KEEP_DAYS * 86400_000
  for (const f of readdirSync(d)) {
    const m = /^studio-(\d{4}-\d{2}-\d{2})\.log$/.exec(f)
    if (m && Date.parse(m[1]) < limit) {
      try { unlinkSync(join(d, f)) } catch { /* em uso: tenta no próximo início */ }
    }
  }
}

function write(level: Level, event: string, data?: Record<string, unknown>): void {
  const d = logDir()
  const entry: Record<string, unknown> = { t: new Date().toISOString(), level, event }
  for (const [k, v] of Object.entries(data ?? {})) entry[k] = typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…` : v
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  if (!d) return
  try {
    clean(d)
    appendFileSync(join(d, `studio-${entry.t!.toString().slice(0, 10)}.log`), `${line}\n`, 'utf8')
  } catch { /* disco cheio ou sem permissão: o app continua */ }
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => write('error', event, data),
  dir: logDir
}
