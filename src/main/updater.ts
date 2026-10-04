import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'

// Atualização automática pelo GitHub Releases (PQueirozDev/PQueiroz-Video-Studio).
// O electron-updater confere o SHA-512 do instalador antes de aplicar; só roda no app instalado.

const { autoUpdater } = electronUpdater


let current: UpdateState = { state: 'idle' }

function publish(s: UpdateState): void {
  current = s
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:update', s)
}

export const updateState = (): UpdateState => current

export function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  let version = ''
  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => {
    version = i.version
    publish({ state: 'available', version })
  })
  autoUpdater.on('update-not-available', () => publish({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => publish({ state: 'downloading', version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => publish({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (err) => publish({ state: 'error', message: String(err?.message ?? err).slice(0, 200) }))
  setTimeout(() => void checkForUpdates(), 8_000)
  setInterval(() => void checkForUpdates(), 6 * 60 * 60_000)
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return publishDev()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    publish({ state: 'error', message: String((err as Error).message).slice(0, 200) })
  }
  return current
}

function publishDev(): UpdateState {
  publish({ state: 'none' })
  return current
}

export function installUpdate(): void {
  if (current.state === 'ready') autoUpdater.quitAndInstall(false, true)
}
