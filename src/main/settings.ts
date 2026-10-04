import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { all, run } from './db'

const IS_WIN = process.platform === 'win32'

/**
 * O sistema de edição (aqc) é opcional: só vira padrão se a pasta existir neste computador
 * (E:\aqc ou C:\aqc no PC do Pedro, ~/aqc no Linux). Num computador novo fica vazio até o
 * usuário escolher uma pasta ou importar um preset que traga o fluxo.
 */
function detectAqc(): string {
  const candidates = IS_WIN ? ['E:\\aqc', 'C:\\aqc', join(homedir(), 'aqc')] : [join(homedir(), 'aqc')]
  return candidates.find((p) => existsSync(join(p, 'CLAUDE.md')) || existsSync(join(p, 'Modelo edicao'))) ?? ''
}

function defaults(): Settings {
  const drive = IS_WIN && existsSync('E:\\') ? 'E:\\' : join(homedir(), 'Videos')
  const aqc = detectAqc()
  return {
    aqcRoot: aqc,
    projectsRoot: join(drive, 'PQueiroz Studio', 'Projetos'),
    // Com o fluxo do Pedro, os vídeos prontos vão para "Videos feitos", como antes.
    exportRoot: aqc ? join(aqc, 'Videos feitos') : join(drive, 'PQueiroz Studio', 'Exportados'),
    ffmpegPath: '',
    ffprobePath: '',
    claudePath: '',
    claudeModel: '',
    pythonPath: '',
    notifications: true,
    animations: true,
    uiScale: 1,
    hwAccel: true,
    useProxies: true,
    assetsRoot: join(drive, 'PQueiroz Studio', 'Biblioteca'),
    maxConcurrentRenders: 1,
    onboarded: false,
    lastProjectId: null
  }
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const s = defaults() as unknown as Record<string, unknown>
  for (const row of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    if (row.key in s) {
      try {
        s[row.key] = JSON.parse(row.value)
      } catch {
        /* valor corrompido: mantém o padrão */
      }
    }
  }
  cache = s as unknown as Settings
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in current)) continue
    run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key, JSON.stringify(value))
  }
  cache = { ...current, ...patch }
  return cache
}
