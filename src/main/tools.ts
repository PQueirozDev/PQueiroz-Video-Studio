import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { getSettings } from './settings'
import { exec } from './util'

// Localiza os executáveis externos usados pelo fluxo (FFmpeg, Claude Code, Python).

const IS_WIN = process.platform === 'win32'
/** Nome do executável na plataforma atual (ffmpeg → ffmpeg.exe no Windows). */
const exe = (name: string): string => (IS_WIN ? `${name}.exe` : name)
/** Python de um venv: Scriptspython.exe no Windows, bin/python no Linux/macOS. */
const venvPython = (venv: string): string => (IS_WIN ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python'))

async function where(name: string): Promise<string[]> {
  const r = await exec(IS_WIN ? 'where.exe' : 'which', [name], { timeoutMs: 5000 })
  if (r.code !== 0) return []
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

const cache = new Map<string, string | null>()

export function clearToolCache(): void {
  cache.clear()
}

async function locate(key: string, configured: string, finder: () => Promise<string | null>): Promise<string | null> {
  if (configured && existsSync(configured)) return configured
  if (cache.has(key)) return cache.get(key) ?? null
  const found = await finder()
  cache.set(key, found)
  return found
}

export function ffmpegPath(): Promise<string | null> {
  return locate('ffmpeg', getSettings().ffmpegPath, async () => (await where(exe('ffmpeg')))[0] ?? null)
}

export function ffprobePath(): Promise<string | null> {
  return locate('ffprobe', getSettings().ffprobePath, async () => (await where(exe('ffprobe')))[0] ?? null)
}

/** O shim `claude.cmd` do npm não pode ser executado sem shell; preferimos o claude.exe real. */
export function claudePath(): Promise<string | null> {
  return locate('claude', getSettings().claudePath, async () => {
    const candidates = IS_WIN
      ? [
          ...(await where('claude.exe')),
          join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
          join(homedir(), '.local', 'bin', 'claude.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'Programs', 'claude', 'claude.exe')
        ]
      : [
          // Apps abertos pelo menu do Linux nem sempre herdam o PATH do terminal (~/.local/bin, npm global).
          ...(await where('claude')),
          join(homedir(), '.local', 'bin', 'claude'),
          join(homedir(), '.claude', 'local', 'claude'),
          join(homedir(), '.npm-global', 'bin', 'claude'),
          '/usr/local/bin/claude',
          '/usr/bin/claude'
        ]
    return candidates.find((c) => c && existsSync(c)) ?? null
  })
}

/** Ambiente Python dedicado ao estúdio (criado por "Preparar ambiente Python"). */
export function studioVenvPython(): string {
  return venvPython(join(app.getPath('userData'), 'pyenv'))
}

/** Python do sistema (ignora o atalho falso da Microsoft Store em WindowsApps). */
export async function systemPython(): Promise<string | null> {
  if (!IS_WIN) return (await where('python3'))[0] ?? (await where('python'))[0] ?? null
  const list = [...(await where('python.exe')), ...(await where('python3.exe'))]
  const real = list.find((p) => !/WindowsApps/i.test(p))
  if (real) return real
  const py = (await where('py.exe'))[0]
  if (py) {
    const r = await exec(py, ['-3', '-c', 'import sys; print(sys.executable)'], { timeoutMs: 10000 })
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim()
  }
  const local = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python')
  for (const v of ['Python313', 'Python312', 'Python311', 'Python314']) {
    const p = join(local, v, 'python.exe')
    if (existsSync(p)) return p
  }
  return null
}

/** O ambiente que o CLAUDE.md de E:\aqc manda usar (criado pelo `uv sync` do video-use). */
export function videoUseVenvPython(): string {
  return venvPython(join(homedir(), 'Developer', 'video-use', '.venv'))
}

/** Python que o Claude deve usar para rodar o montar.py. */
export async function pythonPath(): Promise<string | null> {
  const configured = getSettings().pythonPath
  if (configured && existsSync(configured)) return configured
  if (existsSync(videoUseVenvPython())) return videoUseVenvPython()
  if (existsSync(studioVenvPython())) return studioVenvPython()
  return systemPython()
}
