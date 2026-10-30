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
    history: invoke('media:history'),
    undo: invoke('media:undo'),
    redo: invoke('media:redo'),
    waveform: invoke('media:waveform'),
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
  composition: {
    get: invoke('composition:get'),
    edit: invoke('composition:edit'),
    undo: invoke('composition:undo'),
    redo: invoke('composition:redo'),
    reset: invoke('composition:reset'),
    catalog: invoke('composition:catalog'),
    luts: invoke('composition:luts'),
    renderPreview: invoke('composition:renderPreview'),
    colorMatch: invoke('composition:colorMatch'),
    fxPreview: invoke('composition:fxPreview'),
    onChanged: (cb) => subscribe('composition:changed', cb)
  } as StudioApi['composition'],
  analysis: {
    cached: invoke('analysis:cached'),
    run: invoke('analysis:run'),
    cancel: invoke('analysis:cancel'),
    highlights: invoke('analysis:highlights'),
    silencePlan: invoke('analysis:silencePlan'),
    beatMontage: invoke('analysis:beatMontage')
  } as StudioApi['analysis'],
  transcription: {
    models: invoke('transcription:models'),
    download: invoke('transcription:download'),
    run: invoke('transcription:run')
  } as StudioApi['transcription'],
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
    favorite: invoke('versions:favorite'),
    list: invoke('versions:list'),
    restore: invoke('versions:restore'),
    duplicate: invoke('versions:duplicate'),
    reveal: invoke('versions:reveal')
  } as StudioApi['versions'],
  render: {
    retry: invoke('render:retry'),
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
  auto: {
    run: invoke('auto:run')
  } as StudioApi['auto'],
  qc: {
    project: invoke('qc:project'), render: invoke('qc:render')
  } as StudioApi['qc'],
  styles: {
    list: invoke('styles:list'), learn: invoke('styles:learn'), update: invoke('styles:update'), remove: invoke('styles:remove'),
    project: invoke('styles:project'), setProject: invoke('styles:setProject'), apply: invoke('styles:apply')
  } as StudioApi['styles'],
  hub: {
    packs: invoke('hub:packs'),
    items: invoke('hub:items'),
    use: invoke('hub:use'),
    install: invoke('hub:install'),
    remove: invoke('hub:remove'),
    exportFolder: invoke('hub:exportFolder')
  } as StudioApi['hub'],
  assets: {
    list: invoke('assets:list'),
    pickAndAdd: invoke('assets:pickAndAdd'),
    add: invoke('assets:add'),
    use: invoke('assets:use'),
    openFolder: invoke('assets:openFolder')
  } as StudioApi['assets'],
  subtitles: {
    load: invoke('subtitles:load'), save: invoke('subtitles:save'), generated: invoke('subtitles:generated'),
    target: invoke('subtitles:target'), import: invoke('subtitles:import'), export: invoke('subtitles:export')
  } as StudioApi['subtitles'],
  image: {
    create: invoke('image:create'), open: invoke('image:open'), updateInfo: invoke('image:updateInfo'), saveDesign: invoke('image:saveDesign'),
    createVersion: invoke('image:createVersion'), attachRender: invoke('image:attachRender'), pendingRenders: invoke('image:pendingRenders'),
    versionDoc: invoke('image:versionDoc'), restoreVersion: invoke('image:restoreVersion'), export: invoke('image:export'), exportAs: invoke('image:exportAs'),
    savePreview: invoke('image:savePreview'), saveAsset: invoke('image:saveAsset'), importImages: invoke('image:importImages'),
    pickImages: invoke('image:pickImages'), generate: invoke('image:generate'), generation: invoke('image:generation'),
    toVideo: invoke('image:toVideo'), fonts: invoke('image:fonts'), styleGuide: invoke('image:styleGuide'), reveal: invoke('image:reveal')
  } as StudioApi['image'],
  brands: {
    list: invoke('brands:list'), get: invoke('brands:get'), create: invoke('brands:create'), update: invoke('brands:update'),
    remove: invoke('brands:remove'), importLogo: invoke('brands:importLogo'), importLogoFile: invoke('brands:importLogoFile'),
    updateLogo: invoke('brands:updateLogo'), removeLogo: invoke('brands:removeLogo'), addAssets: invoke('brands:addAssets'), openFolder: invoke('brands:openFolder')
  } as StudioApi['brands'],
  providers: {
    list: invoke('providers:list'), configure: invoke('providers:configure'), setKey: invoke('providers:setKey')
  } as StudioApi['providers'],
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
