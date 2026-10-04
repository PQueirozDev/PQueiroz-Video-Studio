import { spawn, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export const uid = (): string => randomUUID()
export const now = (): number => Date.now()

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** Executa um programa sem shell (sem risco de injeção) e coleta a saída. */
export function exec(cmd: string, args: string[], opts: SpawnOptions & { timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts, shell: false })
    } catch (err) {
      resolvePromise({ code: -1, stdout: '', stderr: String(err) })
      return
    }
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolvePromise({ code: -1, stdout, stderr: stderr + String(err) })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolvePromise({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** Encerra o processo e todos os filhos (no Windows, ffmpeg/python lançados pelo Claude). */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      /* já terminou */
    }
  }
}
