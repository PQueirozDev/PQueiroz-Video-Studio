import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { all, run } from './db'

const AQC_DEFAULT = 'E:\\aqc'

function defaults(): Settings {
  const drive = existsSync('E:\\') ? 'E:\\' : join(homedir(), 'Videos')
  return {
    aqcRoot: AQC_DEFAULT,
    projectsRoot: join(drive, 'PQueiroz Studio', 'Projetos'),
    // Mesmo destino do fluxo atual: os vídeos prontos vão para "Videos feitos".
    exportRoot: join(AQC_DEFAULT, 'Videos feitos'),
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
