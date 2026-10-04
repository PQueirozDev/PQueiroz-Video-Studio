import { existsSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
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
import { aqcInfo } from './skills/aqc'
import { clearToolCache } from './tools'
import { duplicateVersion, getVersion, listVersions, restoreVersion } from './versions/versions'

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function notify(title: string, body: string): void {
  const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
  if (!focused && getSettings().notifications && Notification.isSupported()) new Notification({ title, body }).show()
}

const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
  ipcMain.handle(channel, (_e, ...args) => fn(...args))
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
  handle('media:reorder', (projectId, ids: string[]) => reorderMedia(projectId, ids))
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
  handle('media:setTrim', (projectId, id, a, b) => setTrim(projectId, id, a, b))
  handle('media:setInTimeline', (projectId, id, on: boolean) => setInTimeline(projectId, id, on))
  handle('media:assemble', (projectId) => assembleTimeline(projectId))
  bus.on('media:changed', (e: MediaChanged) => broadcast('media:changed', e.projectId))
  bus.on('task:progress', (e: TaskProgress) => {
    broadcast('task:progress', e)
    if (e.done && !e.error) notify('Timeline montada', getProject(e.projectId)?.name ?? '')
  })

  // Biblioteca de assets
  handle('assets:list', () => listAssets())
  handle('assets:add', (category: AssetCategory, paths: string[]) => addAssets(category, paths))
  handle('assets:pickAndAdd', async (category: AssetCategory) => {
    const r = await dialog.showOpenDialog({ title: `Adicionar à biblioteca — ${category}`, properties: ['openFile', 'multiSelections'] })
    return r.canceled ? { added: 0, skipped: [] } : addAssets(category, r.filePaths)
  })
  handle('assets:use', (projectId, path: string) => useAsset(projectId, path))
  handle('assets:openFolder', async () => {
    await shell.openPath(libraryRoot())
  })
}
