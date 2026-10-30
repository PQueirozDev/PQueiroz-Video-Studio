import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { dialog, shell } from 'electron'
import type { BrandInput, ExportFormat, GenerateRequest, NewImageProjectInput, ProviderConfigInput, ProviderId } from '@shared/image'
import { fontFromFile } from '@shared/fonts'
import { listAssets } from '../assets/library'
import { EXTENSIONS, isInside, writeUnique } from '../files'
import { requireProject } from '../projects/projects'
import { getSettings } from '../settings'
import {
  addBrandAssets, createBrand, deleteBrand, getBrand, importLogo, listBrands, removeLogo, requireBrand, updateBrand, updateLogo
} from './brands'
import { styleGuide } from './context'
import {
  attachRender, createImageProject, createImageVersion, exportImage, imageInfo, importImages, pendingRenders, readDesign,
  restoreImageVersion, saveDesign, saveImageAsset, savePreview, updateImageInfo, versionDoc
} from './imageProjects'
import { configureProvider, generateImage, generationFor, listProviders, setProviderKey } from './providers'
import { imageToVideo, type ToVideoInput } from './toVideo'

type Handle = (channel: string, fn: (...args: any[]) => unknown) => void

const IMAGE_FILTER = { name: 'Imagens', extensions: EXTENSIONS.image.map((e) => e.slice(1)) }

export function registerImageIpc(handle: Handle): void {
  // Projetos de imagem
  handle('image:create', (input: NewImageProjectInput) => createImageProject(input))
  handle('image:open', (projectId: string) => ({ info: imageInfo(projectId), doc: readDesign(projectId) }))
  handle('image:updateInfo', (projectId: string, patch) => updateImageInfo(projectId, patch))
  handle('image:saveDesign', (projectId: string, doc: unknown) => saveDesign(projectId, doc).revision)
  handle('image:createVersion', (projectId: string, doc: unknown, request: string, changes: string) => createImageVersion(projectId, doc, String(request ?? ''), String(changes ?? '')))
  handle('image:attachRender', (projectId: string, versionId: string, bytes: Uint8Array) => attachRender(projectId, versionId, bytes))
  handle('image:pendingRenders', (projectId: string) => pendingRenders(projectId))
  handle('image:versionDoc', (projectId: string, versionId: string) => versionDoc(projectId, versionId))
  handle('image:restoreVersion', (projectId: string, versionId: string) => restoreImageVersion(projectId, versionId))
  handle('image:export', (projectId: string, bytes: Uint8Array, ext: ExportFormat, name?: string) => exportImage(projectId, bytes, ext, name))
  handle('image:exportAs', async (projectId: string, bytes: Uint8Array, ext: ExportFormat, name?: string) => {
    const saved = exportImage(projectId, bytes, ext, name) // cópia sempre fica em output/
    const r = await dialog.showSaveDialog({ title: 'Exportar arte', defaultPath: basename(saved), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (r.canceled || !r.filePath) return saved
    // Nunca sobrescreve: se o arquivo escolhido existir, grava "nome (2).ext" ao lado.
    return writeUnique(dirname(r.filePath), basename(r.filePath), readFileSync(saved))
  })
  handle('image:savePreview', (projectId: string, bytes: Uint8Array) => savePreview(projectId, bytes))
  handle('image:saveAsset', (projectId: string, bytes: Uint8Array, name: string) => saveImageAsset(projectId, bytes, String(name ?? 'imagem')))
  handle('image:importImages', (projectId: string, paths: string[]) => importImages(projectId, Array.isArray(paths) ? paths : []))
  handle('image:pickImages', async (projectId: string) => {
    const r = await dialog.showOpenDialog({ title: 'Adicionar imagem', properties: ['openFile', 'multiSelections'], filters: [IMAGE_FILTER] })
    return r.canceled ? [] : importImages(projectId, r.filePaths)
  })
  handle('image:generate', (req: GenerateRequest) => generateImage(req))
  handle('image:generation', (projectId: string, key: string) => generationFor(String(projectId), String(key)))
  handle('image:toVideo', (projectId: string, input: ToVideoInput) => imageToVideo(projectId, input))
  handle('image:fonts', () => listAssets().filter((a) => a.category === 'fontes').map((a) => fontFromFile(a.path)))
  handle('image:styleGuide', () => styleGuide())
  handle('image:reveal', (projectId: string, path: string) => {
    const p = requireProject(projectId)
    if (typeof path === 'string' && existsSync(path) && (isInside(p.path, path) || isInside(getSettings().assetsRoot, path))) shell.showItemInFolder(path)
  })

  // Marcas
  handle('brands:list', () => listBrands())
  handle('brands:get', (id: string) => getBrand(id))
  handle('brands:create', (input: BrandInput) => createBrand(input ?? {}))
  handle('brands:update', (id: string, input: BrandInput) => updateBrand(id, input ?? {}))
  handle('brands:remove', (id: string) => deleteBrand(id))
  handle('brands:importLogo', async (id: string) => {
    requireBrand(id)
    const r = await dialog.showOpenDialog({
      title: 'Importar logo original', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Logo (PDF, PNG, JPG, WebP)', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (r.canceled) return []
    return r.filePaths.flatMap((f) => importLogo(id, f))
  })
  handle('brands:importLogoFile', (id: string, path: string) => importLogo(id, path))
  handle('brands:updateLogo', (id: string, logoId: string, patch) => updateLogo(id, logoId, patch ?? {}))
  handle('brands:removeLogo', (id: string, logoId: string) => removeLogo(id, logoId))
  handle('brands:addAssets', async (id: string) => {
    const r = await dialog.showOpenDialog({ title: 'Adicionar assets da marca', properties: ['openFile', 'multiSelections'], filters: [IMAGE_FILTER] })
    return r.canceled ? requireBrand(id) : addBrandAssets(id, r.filePaths)
  })
  handle('brands:openFolder', async (id: string) => {
    await shell.openPath(requireBrand(id).folder)
  })

  // Provedores de geração (as chaves nunca voltam para a interface)
  handle('providers:list', () => listProviders())
  handle('providers:configure', (id: ProviderId, input: ProviderConfigInput) => configureProvider(id, input ?? {}))
  handle('providers:setKey', (id: ProviderId, key: string | null) => setProviderKey(id, typeof key === 'string' ? key : null))
}
