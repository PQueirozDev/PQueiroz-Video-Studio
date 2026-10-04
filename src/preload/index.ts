import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { StudioApi } from '@shared/api'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StudioApi = {
  env: {
    check: invoke('env:check'),
    aqcInfo: invoke('env:aqcInfo'),
    setupPython: invoke('env:setupPython')
  } as StudioApi['env'],
  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    pickFolder: invoke('settings:pickFolder'),
    pickFile: invoke('settings:pickFile')
  } as StudioApi['settings'],
  projects: {
    list: invoke('projects:list'),
    get: invoke('projects:get'),
    create: invoke('projects:create'),
    rename: invoke('projects:rename'),
    update: invoke('projects:update'),
    openFolder: invoke('projects:openFolder'),
    openExisting: invoke('projects:openExisting'),
    archive: invoke('projects:archive')
  } as StudioApi['projects'],
  media: {
    list: invoke('media:list'),
    import: invoke('media:import'),
    pickAndImport: invoke('media:pickAndImport'),
    pickFiles: invoke('media:pickFiles'),
    reorder: invoke('media:reorder'),
    remove: invoke('media:remove'),
    timeline: invoke('media:timeline'),
    setTrim: invoke('media:setTrim'),
    setInTimeline: invoke('media:setInTimeline'),
    assemble: invoke('media:assemble'),
    onChanged: (cb) => subscribe('media:changed', cb),
    onTask: (cb) => subscribe('task:progress', cb),
    pathForFile: (file: File) => webUtils.getPathForFile(file)
  } as StudioApi['media'],
  chat: {
    history: invoke('chat:history'),
    send: invoke('chat:send'),
    cancel: invoke('chat:cancel'),
    running: invoke('chat:running'),
    resetSession: invoke('chat:resetSession'),
    onEvent: (cb) => subscribe('claude:event', cb),
    usage: invoke('claude:usage'),
    onUsage: (cb) => subscribe('claude:usage', cb)
  } as StudioApi['chat'],
  versions: {
    list: invoke('versions:list'),
    restore: invoke('versions:restore'),
    duplicate: invoke('versions:duplicate'),
    reveal: invoke('versions:reveal')
  } as StudioApi['versions'],
  render: {
    enqueue: invoke('render:enqueue'),
    list: invoke('render:list'),
    cancel: invoke('render:cancel'),
    reveal: invoke('render:reveal'),
    clearFinished: invoke('render:clearFinished'),
    onUpdate: (cb) => subscribe('render:update', cb)
  } as StudioApi['render'],
  presets: {
    list: invoke('presets:list'),
    save: invoke('presets:save'),
    remove: invoke('presets:remove')
  } as StudioApi['presets'],
  assets: {
    list: invoke('assets:list'),
    pickAndAdd: invoke('assets:pickAndAdd'),
    add: invoke('assets:add'),
    use: invoke('assets:use'),
    openFolder: invoke('assets:openFolder')
  } as StudioApi['assets'],
  app: {
    toMediaUrl: (path: string) => `studio-media://file/${encodeURIComponent(path)}`,
    memory: invoke('app:memory') as StudioApi['app']['memory'],
    version: invoke('app:version') as StudioApi['app']['version'],
    updateState: invoke('app:updateState') as StudioApi['app']['updateState'],
    checkUpdate: invoke('app:checkUpdate') as StudioApi['app']['checkUpdate'],
    installUpdate: invoke('app:installUpdate') as StudioApi['app']['installUpdate'],
    onUpdate: (cb) => subscribe('app:update', cb),
    onCommand: (cb) => subscribe('app:command', cb)
  }
}

contextBridge.exposeInMainWorld('studio', api)
