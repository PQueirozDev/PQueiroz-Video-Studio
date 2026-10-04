import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { recoverInterruptedRuns } from './claude/claude'
import { one, run } from './db'
import { registerIpc } from './ipc'
import { handleMediaProtocol, registerSchemePrivileges } from './protocol'
import { recoverRenders } from './render/queue'
import { initUpdater } from './updater'

// Permite rodar uma instância isolada (testes) sem tocar no banco do dia a dia.
if (process.env.PQ_USER_DATA) app.setPath('userData', process.env.PQ_USER_DATA)

registerSchemePrivileges()

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null

interface Bounds { x?: number; y?: number; width: number; height: number; maximized?: boolean }

function loadBounds(): Bounds {
  try {
    return JSON.parse(one<{ value: string }>("SELECT value FROM settings WHERE key = 'windowBounds'")?.value ?? '')
  } catch {
    return { width: 1480, height: 920 }
  }
}

function saveBounds(): void {
  if (!win) return
  const b: Bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }
  run("INSERT INTO settings(key, value) VALUES('windowBounds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(b))
}

function createWindow(): void {
  const b = loadBounds()
  win = new BrowserWindow({
    ...b,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'PQueiroz Video Studio',
    backgroundColor: '#0b0b0f',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0b0f', symbolColor: '#a1a1aa', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (b.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())
  win.on('close', saveBounds)
  // Links externos abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  app.setAppUserModelId('com.pqueiroz.videostudio')
  Menu.setApplicationMenu(null)
  handleMediaProtocol()
  registerIpc()
  recoverInterruptedRuns()
  recoverRenders()
  createWindow()
  initUpdater()
})

app.on('window-all-closed', () => app.quit())
