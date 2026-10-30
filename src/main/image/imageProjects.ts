import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Project, Version } from '@shared/types'
import {
  formatById, IMAGE_FORMATS, STYLE_PRESETS,
  type ExportFormat, type ImageDoc, type ImageProjectInfo, type NewImageProjectInput, type PendingRender, type ProviderId
} from '@shared/image'
import { emptyDoc, imageLayer, placeLogo, sanitizeDoc } from '@shared/imageDoc'
import { one, run } from '../db'
import { ensureDir, EXTENSIONS, isInside, safeCopy, slugify, validatePath, writeUnique } from '../files'
import { thumbnail } from '../media/ffmpeg'
import { createProject, projectPath, requireProject, touchProject, updateProject } from '../projects/projects'
import { getSettings } from '../settings'
import { now, uid } from '../util'
import { getVersion, listVersions, nextNumber } from '../versions/versions'
import { getBrand } from './brands'
import { imageSize, listProviders } from './providers'

// Projeto de imagem = pasta do projeto + design.json (composição de trabalho, salva automaticamente)
// + versions/Vn.json (composição imutável) + versions/Vn.png (renderização daquela versão).

const PROVIDER_IDS: ProviderId[] = ['composition', 'openai', 'gemini', 'sd-local', 'pollinations']
const MAX_IMAGE_BYTES = 80 * 1024 * 1024

interface InfoRow {
  project_id: string; brand_id: string | null; format_id: string; original_prompt: string; style: string; provider: string
  last_export: string | null; revision: number
}

export function requireImageProject(id: string): Project {
  const p = requireProject(id)
  if (p.kind !== 'image') throw new Error('Este projeto não é do Image Studio.')
  return p
}

export function imageInfo(projectId: string): ImageProjectInfo {
  const p = requireImageProject(projectId)
  let r = one<InfoRow>('SELECT * FROM image_projects WHERE project_id = ?', projectId)
  if (!r) {
    // Projeto de imagem reaberto de uma pasta (registerExisting): recria os metadados.
    run('INSERT INTO image_projects(project_id, brand_id, format_id) VALUES(?, ?, ?)', projectId, p.brandId, readDesign(projectId).formatId)
    r = one<InfoRow>('SELECT * FROM image_projects WHERE project_id = ?', projectId)!
  }
  return {
    projectId, brandId: r.brand_id, formatId: formatById(r.format_id).id, originalPrompt: r.original_prompt,
    style: r.style, provider: (PROVIDER_IDS.includes(r.provider as ProviderId) ? r.provider : 'composition') as ProviderId,
    lastExport: r.last_export, revision: r.revision
  }
}

export function updateImageInfo(projectId: string, patch: Partial<Pick<ImageProjectInfo, 'brandId' | 'formatId' | 'style' | 'provider' | 'originalPrompt'>>): ImageProjectInfo {
  const cur = imageInfo(projectId)
  const brandId = patch.brandId !== undefined ? (patch.brandId && getBrand(patch.brandId) ? patch.brandId : null) : cur.brandId
  const formatId = patch.formatId && IMAGE_FORMATS.some((f) => f.id === patch.formatId) ? patch.formatId : cur.formatId
  const style = patch.style && STYLE_PRESETS.some((s) => s.id === patch.style) ? patch.style : cur.style
  const provider = patch.provider && PROVIDER_IDS.includes(patch.provider) ? patch.provider : cur.provider
  const prompt = typeof patch.originalPrompt === 'string' ? patch.originalPrompt.slice(0, 4000) : cur.originalPrompt
  run('UPDATE image_projects SET brand_id = ?, format_id = ?, style = ?, provider = ?, original_prompt = ? WHERE project_id = ?', brandId, formatId, style, provider, prompt, projectId)
  if (brandId !== cur.brandId) run('UPDATE projects SET brand_id = ? WHERE id = ?', brandId, projectId)
  touchProject(projectId)
  return imageInfo(projectId)
}

/** Só aceita imagens existentes dentro do projeto, da biblioteca de assets ou de E:\aqc (caminho real, sem junções). */
export function pathChecker(project: Project): (p: string) => string | null {
  const s = getSettings()
  const real = (p: string): string | null => {
    try {
      return realpathSync(p)
    } catch {
      return null
    }
  }
  const roots = [project.path, s.assetsRoot, s.aqcRoot].map(real).filter((r): r is string => Boolean(r))
  return (p: string) => {
    if (typeof p !== 'string' || !p) return null
    const resolved = real(p)
    if (!resolved || !EXTENSIONS.image.includes(extname(resolved).toLowerCase())) return null
    return roots.some((root) => isInside(root, resolved)) ? p : null
  }
}

const designFile = (p: Project): string => projectPath(p, 'design.json')

export function readDesign(projectId: string): ImageDoc {
  const p = requireProject(projectId)
  const file = designFile(p)
  if (!existsSync(file)) return emptyDoc('ig-feed')
  try {
    return sanitizeDoc(JSON.parse(readFileSync(file, 'utf8')), { checkPath: pathChecker(p) })
  } catch {
    return emptyDoc('ig-feed')
  }
}

export function designHash(projectId: string): string | null {
  const file = designFile(requireProject(projectId))
  return existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex') : null
}

/** Projetos com o Claude trabalhando: a interface não grava por cima do que ele está editando. */
const locked = new Set<string>()
export function lockDesign(projectId: string, on: boolean): void {
  if (on) locked.add(projectId)
  else locked.delete(projectId)
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${uid().slice(0, 8)}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

export function saveDesign(projectId: string, raw: unknown, opts: { force?: boolean } = {}): { revision: number; doc: ImageDoc } {
  const p = requireImageProject(projectId)
  if (locked.has(projectId) && !opts.force) throw new Error('O Claude está editando esta arte. Aguarde ele terminar.')
  const doc = sanitizeDoc(raw, { checkPath: pathChecker(p) })
  writeAtomic(designFile(p), JSON.stringify(doc, null, 2))
  run('UPDATE image_projects SET revision = revision + 1, format_id = ? WHERE project_id = ?', doc.formatId, projectId)
  return { revision: imageInfo(projectId).revision, doc }
}

/** Formato de vídeo mais próximo (o projeto continua aparecendo bem no dashboard). */
const aspectFor = (w: number, h: number): Project['format'] => (Math.abs(w / h - 1) < 0.1 ? '1:1' : w > h ? '16:9' : '9:16')

export function createImageProject(input: NewImageProjectInput): { project: Project; info: ImageProjectInfo; doc: ImageDoc } {
  const f = formatById(input.formatId)
  const width = f.id === 'custom' ? Math.round(Math.min(4096, Math.max(64, Number(input.width) || f.width))) : f.width
  const height = f.id === 'custom' ? Math.round(Math.min(4096, Math.max(64, Number(input.height) || f.height))) : f.height
  const brand = getBrand(input.brandId)
  const project = createProject({
    name: input.name.trim() || 'Nova arte', format: aspectFor(width, height), resolution: '1080p', fps: 'original', preset: 'nenhum',
    kind: 'image', brandId: brand?.id ?? null
  })
  const style = STYLE_PRESETS.some((s) => s.id === input.style) ? input.style : STYLE_PRESETS[0].id
  // Com um gerador configurado, ele já vem escolhido; senão, composição gratuita.
  const provider = listProviders().find((p) => p.ready && p.id !== 'composition')?.id ?? 'composition'
  run('INSERT INTO image_projects(project_id, brand_id, format_id, original_prompt, style, provider) VALUES(?, ?, ?, ?, ?, ?)',
    project.id, brand?.id ?? null, f.id, String(input.prompt ?? '').slice(0, 4000), style, provider)
  let doc: ImageDoc
  if (input.doc) {
    doc = sanitizeDoc({ ...input.doc, width, height, formatId: f.id }, { checkPath: pathChecker(project) })
  } else {
    doc = emptyDoc(f.id, width, height)
    // Arte de marca já nasce com a logo oficial no lugar certo.
    const logo = brand?.logos.find((l) => l.id === brand.defaultLogoId) ?? brand?.logos[0]
    if (brand && logo && logo.width && logo.height) {
      const box = placeLogo(doc, logo, brand.logoMargin)
      doc.layers.push(imageLayer(logo.path, box.x, box.y, box.w, box.h, { role: 'logo', name: logo.name, logoId: logo.id, fit: 'contain' }))
    }
  }
  doc.meta = { ...doc.meta, brandId: brand?.id ?? null, style, title: project.name }
  saveDesign(project.id, doc)
  return { project: requireProject(project.id), info: imageInfo(project.id), doc: readDesign(project.id) }
}

// ————— Versões —————

const jsonOf = (v: Version): string => v.path.replace(/\.png$/i, '.json')

export function createImageVersion(projectId: string, raw: unknown, request: string, changes: string, parentId: string | null = null): Version {
  const p = requireImageProject(projectId)
  const doc = sanitizeDoc(raw, { checkPath: pathChecker(p) })
  if (parentId && getVersion(parentId)?.projectId !== projectId) parentId = null
  const n = nextNumber(projectId)
  const json = writeUnique(projectPath(p, 'versions'), `V${n}.json`, JSON.stringify(doc, null, 2))
  const png = json.replace(/\.json$/i, '.png')
  const id = uid()
  run(`INSERT INTO versions(id, project_id, number, label, path, source_path, request, changes, parent_id, duration, thumbnail, created_at)
       VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?)`,
    id, projectId, n, `V${n}`, png, request.slice(0, 2000), changes.slice(0, 2000), parentId ?? p.currentVersionId, now())
  updateProject(projectId, { currentVersionId: id, status: 'pronto' })
  return getVersion(id)!
}

function requireImageVersion(projectId: string, versionId: string): Version {
  const v = getVersion(versionId)
  if (!v || v.projectId !== projectId) throw new Error('Versão não encontrada')
  // A versão (JSON e PNG) precisa estar dentro de versions/ do próprio projeto.
  if (!isInside(projectPath(requireProject(projectId), 'versions'), v.path)) throw new Error('Versão fora do projeto')
  return v
}

export function versionDoc(projectId: string, versionId: string): ImageDoc {
  const p = requireImageProject(projectId)
  const v = requireImageVersion(projectId, versionId)
  return sanitizeDoc(JSON.parse(readFileSync(jsonOf(v), 'utf8')), { checkPath: pathChecker(p) })
}

/** Versões cujo PNG ainda não foi renderizado (ex.: app fechado logo depois do Claude terminar). */
export function pendingRenders(projectId: string): PendingRender[] {
  requireImageProject(projectId)
  const dir = projectPath(requireProject(projectId), 'versions')
  return listVersions(projectId)
    .filter((v) => isInside(dir, v.path) && !existsSync(v.path) && existsSync(jsonOf(v)))
    .map((v) => {
      try {
        return { versionId: v.id, doc: versionDoc(projectId, v.id) }
      } catch {
        return null
      }
    })
    .filter((x): x is PendingRender => Boolean(x))
}

function checkMagic(bytes: Buffer, ext: ExportFormat): void {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Imagem vazia ou grande demais.')
  const size = imageSize(bytes)
  if (size.ext !== ext) throw new Error('O conteúdo não corresponde ao formato pedido.')
  if (size.width > 8192 || size.height > 8192) throw new Error('Resolução acima do limite (8192 px).')
}

export async function attachRender(projectId: string, versionId: string, data: Uint8Array): Promise<Version> {
  const p = requireImageProject(projectId)
  const v = requireImageVersion(projectId, versionId)
  const bytes = Buffer.from(data)
  checkMagic(bytes, 'png')
  if (!existsSync(v.path)) {
    try {
      writeFileSync(v.path, bytes, { flag: 'wx' })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  const thumb = join(ensureDir(projectPath(p, 'temp', 'thumbs')), `v-${v.id}.jpg`)
  if (await thumbnail(v.path, thumb)) run('UPDATE versions SET thumbnail = ? WHERE id = ?', thumb, v.id)
  touchProject(projectId)
  return getVersion(v.id)!
}

export function restoreImageVersion(projectId: string, versionId: string): { doc: ImageDoc; revision: number } {
  const doc = versionDoc(projectId, versionId)
  const r = saveDesign(projectId, doc, { force: true })
  updateProject(projectId, { currentVersionId: versionId })
  return { doc: r.doc, revision: r.revision }
}

// ————— Arquivos —————

export function exportImage(projectId: string, data: Uint8Array, ext: ExportFormat, name?: string): string {
  const p = requireImageProject(projectId)
  if (!['png', 'jpg', 'webp'].includes(ext)) throw new Error('Formato de exportação inválido')
  const bytes = Buffer.from(data)
  checkMagic(bytes, ext)
  const { width, height } = imageSize(bytes)
  const file = writeUnique(projectPath(p, 'output'), `${slugify(name || p.name)} ${width}x${height}.${ext}`, bytes)
  run('UPDATE image_projects SET last_export = ? WHERE project_id = ?', file, projectId)
  updateProject(projectId, { status: 'renderizado' })
  return file
}

/** Prévia que o Claude pode abrir (Read) para "ver" a arte antes de sugerir mudanças. */
export function savePreview(projectId: string, data: Uint8Array): string {
  const p = requireImageProject(projectId)
  const bytes = Buffer.from(data)
  checkMagic(bytes, 'png')
  const file = projectPath(p, 'temp', 'preview.png')
  ensureDir(projectPath(p, 'temp'))
  writeFileSync(file, bytes)
  return file
}

/** Imagens criadas no editor (ex.: fundo removido) — sempre arquivo novo, o original fica intacto. */
export function saveImageAsset(projectId: string, data: Uint8Array, name: string): string {
  const p = requireImageProject(projectId)
  const bytes = Buffer.from(data)
  checkMagic(bytes, 'png')
  return writeUnique(projectPath(p, 'assets', 'editado'), `${slugify(basename(name, extname(name)))}.png`, bytes)
}

export async function importImages(projectId: string, paths: string[]): Promise<{ path: string; width: number; height: number }[]> {
  const p = requireImageProject(projectId)
  const out: { path: string; width: number; height: number }[] = []
  for (const raw of paths) {
    const src = validatePath(raw)
    if (!EXTENSIONS.image.includes(extname(src).toLowerCase()) || !statSync(src).isFile() || statSync(src).size > MAX_IMAGE_BYTES) continue
    // Assets da biblioteca são referenciados direto; arquivos de fora são copiados para o projeto.
    const dest = pathChecker(p)(src) ?? (await safeCopy(src, projectPath(p, 'assets')))
    try {
      const size = imageSize(readFileSync(dest))
      out.push({ path: dest, width: size.width, height: size.height })
    } catch {
      /* arquivo com extensão de imagem mas conteúdo inválido */
    }
  }
  return out
}

// ————— Mudanças feitas pelo Claude —————

const variantsDir = (p: Project): string => projectPath(p, 'variacoes')

export function variantFiles(projectId: string): Map<string, number> {
  const p = requireProject(projectId)
  const dir = variantsDir(p)
  const out = new Map<string, number>()
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) if (f.toLowerCase().endsWith('.json')) out.set(join(dir, f), statSync(join(dir, f)).mtimeMs)
  return out
}

export interface DesignSnapshot { versions: Version[]; designChanged: boolean; notes: string[] }

/**
 * Chamado quando o Claude termina um turno: valida o design.json que ele editou (se inválido,
 * volta ao anterior) e transforma a composição nova e cada variação nova em versões.
 */
export function snapshotDesign(projectId: string, before: { hash: string | null; text: string | null; variants: Map<string, number> }, request: string, changes: string): DesignSnapshot {
  const p = requireImageProject(projectId)
  const out: DesignSnapshot = { versions: [], designChanged: false, notes: [] }
  const afterHash = designHash(projectId)
  if (afterHash && afterHash !== before.hash) {
    try {
      const raw = JSON.parse(readFileSync(designFile(p), 'utf8'))
      const { doc } = saveDesign(projectId, raw, { force: true })
      out.versions.push(createImageVersion(projectId, doc, request, changes))
      out.designChanged = true
    } catch (err) {
      if (before.text !== null) writeAtomic(designFile(p), before.text)
      else unlinkSync(designFile(p))
      out.notes.push(`design.json inválido (${(err as Error).message.slice(0, 120)}) — mantida a composição anterior`)
    }
  }
  for (const [file, mtime] of variantFiles(projectId)) {
    if (before.variants.get(file) === mtime) continue
    try {
      const v = createImageVersion(projectId, JSON.parse(readFileSync(file, 'utf8')), request, `Variação: ${basename(file, '.json')}`)
      out.versions.push(v)
      out.notes.push(`Variação ${basename(file, '.json')} → ${v.label}`)
    } catch (err) {
      out.notes.push(`Variação ${basename(file)} ignorada: ${(err as Error).message.slice(0, 120)}`)
    }
  }
  // A composição de trabalho continua sendo o design.json: a "versão atual" aponta para ela.
  if (out.designChanged && out.versions.length > 1) updateProject(projectId, { currentVersionId: out.versions[0].id })
  return out
}

export function captureDesignState(projectId: string): { hash: string | null; text: string | null; variants: Map<string, number> } {
  const p = requireImageProject(projectId)
  const file = designFile(p)
  return { hash: designHash(projectId), text: existsSync(file) ? readFileSync(file, 'utf8') : null, variants: variantFiles(projectId) }
}
