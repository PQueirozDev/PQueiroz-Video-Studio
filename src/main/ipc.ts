import { existsSync, readFileSync } from 'node:fs'
import { emptySubtitles, parseSrt, toSrt } from '@shared/subtitles'
import { editWithHistory, historyState, travelHistory } from './media/history'
import { waveform } from './media/waveform'
import { loadSubtitles, saveSubtitles, subtitleFile, reloadGeneratedSubtitles, writeSubtitleExport } from './media/subtitles'
import { app, BrowserWindow, dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getClaudeUsage, onUsageUpdate } from './claude/usage'
import { checkForUpdates, installUpdate, updateState } from './updater'
import type { AssetCategory, ClaudeEvent, CommunityPreset, PresetExportOptions, Settings } from '@shared/types'
import { cancelChat, chatHistory, isRunning, resetSession, sendChat } from './claude/claude'
import { checkEnv, setupPython } from './env'
import { EXTENSIONS, slugify, validatePath } from './files'
import { editTimeline, importMedia, listMedia, removeMedia, reorderMedia } from './media/media'
import {
  communityPresets, deletePreset, importPresetFile, importPresetUrl, installCommunityPreset, listPresets, savePreset, useWorkflow, writePackFile
} from './presets'
import { addAssets, libraryRoot, listAssets, useAsset } from './assets/library'
import { bus, type MediaChanged, type TaskProgress } from './events'
import { assembleTimeline, setInTimeline, setTrim } from './media/timeline'
import {
  archiveProject, createProject, getProject, listProjects, projectPath, registerExisting, requireProject, updateProject
} from './projects/projects'
import { cancelRender, clearFinished, enqueueRender, getJob, listRenders, onRenderUpdate } from './render/queue'
import { getSettings, updateSettings } from './settings'
import { editComposition, getComposition, resetComposition, travelComposition } from './composition/store'
import { EFFECTS, TRANSITIONS } from '@shared/fx'
import { CATEGORIES } from './assets/library'
import { log } from './log'
import { registerAnalysisIpc } from './analysis/ipc'
import { listLuts } from './assets/luts'
import { renderPreview } from './render/preview'
import { fxPreview } from './render/fxPreview'
import { colorMatch } from './render/colorMatch'
import { runAutoStudio } from './auto/autoStudio'
import { checkProject, checkProjectRender } from './qc/qc'
import { applyStyleToProject, deleteStyle, learnFromProject, listStyles, projectStyle, setProjectStyle, updateStyle } from './styles/styles'
import type { AutoStudioRequest } from '@shared/api'
import { exportPackFolder, hubItems, installPack, packInfos, removePack, useHubItem } from './packs/packs'
import { registerImageIpc } from './image/ipc'
import { aqcInfo } from './skills/aqc'
import { clearToolCache } from './tools'
import { duplicateVersion, favoriteVersion, getVersion, listVersions, restoreVersion } from './versions/versions'

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function notify(title: string, body: string): void {
  const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
  if (!focused && getSettings().notifications && Notification.isSupported()) new Notification({ title, body }).show()
}

// Só a página do próprio app (o index.html empacotado ou a origem do servidor de desenvolvimento),
// no quadro principal, pode chamar o processo principal.
export function isAppUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev) return url.origin === new URL(dev).origin
    return url.protocol === 'file:' && url.pathname === pathToFileURL(join(__dirname, '../renderer/index.html')).pathname
  } catch {
    return false
  }
}
const trustedSender = (e: IpcMainInvokeEvent): boolean => !!e.senderFrame && e.senderFrame === e.sender.mainFrame && isAppUrl(e.senderFrame.url)

const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trustedSender(e)) throw new Error('Origem não autorizada.')
    try {
      return await fn(...args)
    } catch (err) {
      log.warn('ipc.error', { channel, error: (err as Error).message })
      throw err
    }
  })
}

const assetCategory = (c: unknown): AssetCategory => {
  if (!CATEGORIES.includes(c as AssetCategory)) throw new Error('Categoria de biblioteca inválida.')
  return c as AssetCategory
}

export function registerIpc(): void {
  // Ambiente
  handle('env:check', (id) => checkEnv(id))
  handle('env:aqcInfo', () => aqcInfo())
  handle('env:setupPython', () => setupPython())

  // Configurações
  handle('settings:get', () => getSettings())
  handle('settings:update', (patch: Partial<Settings>) => {
    for (const key of ['aqcRoot', 'projectsRoot', 'exportRoot'] as const) {
      // aqcRoot vazio = nenhum sistema de edição neste computador.
      if (patch[key] !== undefined && !(key === 'aqcRoot' && patch[key] === '')) validatePath(patch[key]!)
    }
    clearToolCache()
    return updateSettings(patch)
  })
  handle('settings:pickFolder', async (title: string, defaultPath?: string) => {
    const r = await dialog.showOpenDialog({ title, defaultPath, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('settings:pickFile', async (title: string) => {
    const r = await dialog.showOpenDialog({ title, properties: ['openFile'], filters: [{ name: 'Executável', extensions: ['exe'] }] })
    return r.canceled ? null : r.filePaths[0]
  })

  // Projetos
  handle('projects:list', () => listProjects())
  handle('projects:get', (id) => getProject(id))
  handle('projects:create', (input) => {
    const p = createProject(input)
    updateSettings({ lastProjectId: p.id })
    return p
  })
  handle('projects:rename', (id, name: string) => updateProject(id, { name: name.trim() || 'Projeto' }))
  handle('projects:update', (id, patch) => updateProject(id, patch))
  handle('projects:openFolder', async (id, sub?: string) => {
    const p = requireProject(id)
    const dir = sub ? projectPath(p, sub) : p.path
    await shell.openPath(existsSync(dir) ? dir : p.path)
  })
  handle('projects:openExisting', async () => {
    const r = await dialog.showOpenDialog({ title: 'Abrir pasta de projeto', defaultPath: getSettings().projectsRoot, properties: ['openDirectory'] })
    return r.canceled ? null : registerExisting(r.filePaths[0])
  })
  handle('projects:archive', (id) => archiveProject(id))

  // Mídia
  handle('media:list', (projectId) => listMedia(projectId))
  handle('media:import', (projectId, paths: string[]) => importMedia(projectId, paths))
  const pickMedia = async (): Promise<string[]> => {
    const r = await dialog.showOpenDialog({
      title: 'Importar mídia', properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Mídia', extensions: Object.values(EXTENSIONS).flat().map((e) => e.slice(1)) },
        { name: 'Vídeos', extensions: EXTENSIONS.video.map((e) => e.slice(1)) },
        { name: 'Áudio', extensions: EXTENSIONS.audio.map((e) => e.slice(1)) },
        { name: 'Imagens', extensions: EXTENSIONS.image.map((e) => e.slice(1)) }
      ]
    })
    return r.canceled ? [] : r.filePaths
  }
  handle('media:pickFiles', pickMedia)
  handle('media:pickAndImport', async (projectId) => {
    const paths = await pickMedia()
    return paths.length ? importMedia(projectId, paths) : { imported: [], skipped: [] }
  })
  handle('media:reorder', (projectId, ids: string[]) => editWithHistory(projectId, () => reorderMedia(projectId, ids)))
  handle('media:history', historyState)
  handle('media:undo', (id) => travelHistory(id, 'undo'))
  handle('media:redo', (id) => travelHistory(id, 'redo'))
  handle('media:waveform', waveform)
  handle('media:remove', (projectId, id) => removeMedia(projectId, id))
  handle('media:timeline', (projectId) => editTimeline(projectId))

  // Claude
  const emit = (e: ClaudeEvent): void => {
    broadcast('claude:event', e)
    if (e.type === 'done') {
      const name = getProject(e.projectId)?.name ?? 'Projeto'
      notify(`Claude terminou — ${name}`, e.versions.length ? `Nova versão: ${e.versions.map((v) => v.label).join(', ')}` : e.message.content.slice(0, 120))
    }
  }
  handle('chat:history', (projectId) => chatHistory(projectId))
  handle('chat:send', (projectId, text: string) => sendChat(projectId, text, emit))
  handle('chat:cancel', (projectId) => cancelChat(projectId))
  handle('chat:running', (projectId) => isRunning(projectId))
  handle('chat:resetSession', (projectId) => resetSession(projectId))
  handle('claude:usage', (force?: boolean) => getClaudeUsage(Boolean(force)))
  onUsageUpdate((u) => broadcast('claude:usage', u))

  // Memória usada por todos os processos do app (MB), como no Qyrex.
  handle('app:memory', () => Math.round(app.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024))
  handle('app:version', () => app.getVersion())
  handle('app:updateState', () => updateState())
  handle('app:checkUpdate', () => checkForUpdates())
  handle('app:installUpdate', () => installUpdate())

  // Versões
  handle('versions:list', (projectId) => listVersions(projectId))
  handle('versions:favorite', favoriteVersion)
  handle('versions:restore', (projectId, versionId) => restoreVersion(projectId, versionId))
  handle('versions:duplicate', (projectId, versionId) => duplicateVersion(projectId, versionId))
  handle('versions:reveal', (versionId) => {
    const v = getVersion(versionId)
    if (v) shell.showItemInFolder(v.path)
  })

  // Render
  onRenderUpdate((job) => {
    broadcast('render:update', job)
    if (job.status === 'concluido') notify('Render concluído', `${job.projectName} — ${job.label}`)
    if (job.status === 'erro') notify('Falha no render', `${job.projectName} — ${job.label}`)
  })
  handle('render:enqueue', (projectId, input, settings) => enqueueRender(projectId, input, settings))
  handle('render:list', () => listRenders())
  handle('render:retry', (id) => {
    const job = getJob(id)
    if (!job || !['erro', 'cancelado'].includes(job.status)) throw new Error('Este render não pode ser repetido.')
    return enqueueRender(job.projectId, { path: job.input, label: job.label }, job.settings)
  })
  handle('render:cancel', (id) => cancelRender(id))
  handle('render:reveal', (id) => {
    const job = getJob(id)
    if (job && existsSync(job.output)) shell.showItemInFolder(job.output)
  })
  handle('render:clearFinished', () => clearFinished())

  handle('presets:list', () => listPresets())
  handle('presets:save', (id: string | null, input) => savePreset(id, input))
  handle('presets:remove', (id: string) => deletePreset(id))
  handle('presets:exportToFile', async (id: string, options: PresetExportOptions) => {
    const preset = listPresets().find((p) => p.id === id)
    if (!preset) throw new Error('Preset não encontrado.')
    const r = await dialog.showSaveDialog({
      title: 'Exportar preset', defaultPath: `${slugify(preset.name)}.pqpreset`,
      filters: [{ name: 'Preset do PQueiroz Video Studio', extensions: ['pqpreset'] }]
    })
    if (r.canceled || !r.filePath) return null
    writePackFile(id, { includeWorkflow: Boolean(options?.includeWorkflow), includeResources: Boolean(options?.includeResources) }, r.filePath)
    shell.showItemInFolder(r.filePath)
    return r.filePath
  })
  handle('presets:importFromFile', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Importar preset', properties: ['openFile'],
      filters: [{ name: 'Preset do PQueiroz Video Studio', extensions: ['pqpreset', 'json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const result = await importPresetFile(r.filePaths[0])
    clearToolCache()
    return result
  })
  handle('presets:importFromUrl', async (url: string) => {
    const result = await importPresetUrl(url)
    clearToolCache()
    return result
  })
  handle('presets:community', () => communityPresets())
  handle('presets:installCommunity', async (item: CommunityPreset) => {
    const result = await installCommunityPreset(item)
    clearToolCache()
    return result
  })
  handle('presets:useWorkflow', (id: string) => {
    useWorkflow(id)
    return getSettings()
  })

  // Timeline manual
  handle('media:setTrim', (projectId, id, a, b) => editWithHistory(projectId, () => setTrim(projectId, id, a, b)))
  handle('media:setInTimeline', (projectId, id, on: boolean) => editWithHistory(projectId, () => setInTimeline(projectId, id, on)))
  handle('media:assemble', (projectId) => assembleTimeline(projectId))

  // Composição (trilhas, clipes, transições, efeitos)
  handle('composition:get', (projectId: string) => getComposition(projectId))
  handle('composition:edit', (projectId: string, commands) => editComposition(projectId, commands))
  handle('composition:undo', (projectId: string) => travelComposition(projectId, 'undo'))
  handle('composition:redo', (projectId: string) => travelComposition(projectId, 'redo'))
  handle('composition:reset', (projectId: string) => resetComposition(projectId))
  handle('composition:renderPreview', (projectId: string, start: number, seconds: number, bypass?: boolean) => renderPreview(projectId, start, seconds, bypass === true))
  handle('composition:colorMatch', (projectId: string, clipId: string, refClipId: string) => {
    if (typeof clipId !== 'string' || typeof refClipId !== 'string') throw new Error('Clipe inválido.')
    return colorMatch(projectId, clipId, refClipId)
  })
  handle('composition:fxPreview', (kind: 'transition' | 'effect' | 'lut', id: string) => {
    if (!['transition', 'effect', 'lut'].includes(kind)) throw new Error('Prévia inválida.')
    return fxPreview(kind, id)
  })
  handle('composition:luts', () => listLuts().map(({ id, name, builtIn }) => ({ id, name, builtIn })))
  handle('composition:catalog', () => ({
    transitions: TRANSITIONS.map(({ xfade: _x, ...t }) => t),
    effects: EFFECTS.map(({ filter: _f, ...e }) => e)
  }))
  registerAnalysisIpc(handle)
  bus.on('composition:changed', (e: MediaChanged) => broadcast('composition:changed', e.projectId))
  bus.on('media:changed', (e: MediaChanged) => broadcast('media:changed', e.projectId))
  bus.on('task:progress', (e: TaskProgress) => {
    broadcast('task:progress', e)
    const titles = { animacao: 'Arte animada', montagem: 'Timeline montada', analise: 'Análise concluída', transcricao: 'Transcrição pronta', download: 'Download concluído' }
    if (e.done && !e.error) notify(titles[e.task], getProject(e.projectId)?.name ?? '')
  })

  // Biblioteca de assets
  handle('subtitles:load', loadSubtitles)
  handle('subtitles:save', saveSubtitles)
  handle('subtitles:target', subtitleFile)
  handle('subtitles:generated', reloadGeneratedSubtitles)
  handle('subtitles:import', async (id, source) => {
    const r = await dialog.showOpenDialog({ title: 'Importar legendas SRT', properties: ['openFile'], filters: [{ name: 'Legendas', extensions: ['srt'] }] })
    return r.canceled ? null : saveSubtitles(id, source, { ...emptySubtitles(), cues: parseSrt(readFileSync(r.filePaths[0], 'utf8')) })
  })
  handle('subtitles:export', async (doc) => {
    const text = toSrt(doc)
    const r = await dialog.showSaveDialog({ title: 'Exportar legendas', defaultPath: 'legendas.srt', filters: [{ name: 'Legendas', extensions: ['srt'] }] })
    if (r.canceled || !r.filePath) return false
    writeSubtitleExport(r.filePath, text)
    return true
  })
  handle('auto:run', (projectId: string, req: AutoStudioRequest) => runAutoStudio(projectId, req))
  handle('qc:project', (projectId: string, presetId?: string) => checkProject(projectId, typeof presetId === 'string' ? presetId : undefined))
  handle('qc:render', (projectId: string, opts?: { path?: string; presetId?: string }) => checkProjectRender(projectId, { path: typeof opts?.path === 'string' ? opts.path : undefined, presetId: typeof opts?.presetId === 'string' ? opts.presetId : undefined }))
  handle('styles:list', () => listStyles())
  handle('styles:learn', (projectId: string, input: { name: string; brandId?: string | null; notes?: string; replaceId?: string }) => learnFromProject(projectId, input ?? { name: '' }))
  handle('styles:update', (id: string, patch: { name?: string; brandId?: string | null; notes?: string }) => updateStyle(id, patch ?? {}))
  handle('styles:remove', (id: string) => deleteStyle(String(id)))
  handle('styles:project', (projectId: string) => projectStyle(projectId))
  handle('styles:setProject', (projectId: string, patch: { brandId?: string | null; styleId?: string | null }) => setProjectStyle(projectId, patch ?? {}))
  handle('styles:apply', (projectId: string, styleId: string) => applyStyleToProject(projectId, String(styleId)))
  handle('hub:packs', () => packInfos())
  handle('hub:items', () => hubItems())
  handle('hub:use', (projectId: string, key: string) => useHubItem(projectId, key))
  handle('hub:install', async () => {
    const r = await dialog.showOpenDialog({ title: 'Instalar pacote do Asset Hub', properties: ['openFile'], filters: [{ name: 'Pacote PQueiroz Studio', extensions: ['pqs-pack', 'zip'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    return installPack(r.filePaths[0])
  })
  handle('hub:remove', (id: string) => {
    if (typeof id !== 'string') throw new Error('Pacote inválido.')
    removePack(id)
  })
  handle('hub:exportFolder', async () => {
    const src = await dialog.showOpenDialog({ title: 'Pasta do pacote (com pack.json)', properties: ['openDirectory'] })
    if (src.canceled || !src.filePaths[0]) return null
    const dest = await dialog.showSaveDialog({ title: 'Salvar pacote', defaultPath: src.filePaths[0] + '.pqs-pack', filters: [{ name: 'Pacote PQueiroz Studio', extensions: ['pqs-pack'] }] })
    if (dest.canceled || !dest.filePath) return null
    const r = exportPackFolder(src.filePaths[0], dest.filePath)
    return { path: dest.filePath, ...r }
  })
  handle('assets:list', () => listAssets())
  handle('assets:add', (category: AssetCategory, paths: string[]) => addAssets(assetCategory(category), paths))
  handle('assets:pickAndAdd', async (category: AssetCategory) => {
    assetCategory(category)
    const r = await dialog.showOpenDialog({ title: `Adicionar à biblioteca — ${category}`, properties: ['openFile', 'multiSelections'] })
    return r.canceled ? { added: 0, skipped: [] } : addAssets(category, r.filePaths)
  })
  handle('assets:use', (projectId, path: string) => useAsset(projectId, path))
  handle('assets:openFolder', async () => {
    await shell.openPath(libraryRoot())
  })

  // Image Studio
  registerImageIpc(handle)
}
