import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { NewProjectInput, Project } from '@shared/types'
import { all, one, run } from '../db'
import { ensureDir, isInside, slugify, validatePath } from '../files'
import { getSettings } from '../settings'
import { now, uid } from '../util'

// Estrutura de cada projeto. "edit/" é criada pelo Claude ao copiar o "Modelo edicao" de E:\aqc,
// do mesmo jeito que o fluxo atual faz com "<pasta do trabalho>/edit".
export const PROJECT_DIRS = ['input', 'assets', 'temp', 'output', 'versions'] as const

interface ProjectRow {
  id: string; name: string; path: string; format: string; resolution: string; fps: string; preset: string
  status: string; claude_session_id: string | null; current_version_id: string | null; created_at: number; updated_at: number
  kind: string | null; brand_id: string | null
}

function toProject(r: ProjectRow): Project {
  type Thumb = { thumbnail: string | null; duration: number | null }
  const thumb =
    (r.current_version_id ? one<Thumb>('SELECT thumbnail, duration FROM versions WHERE id = ?', r.current_version_id) : undefined) ??
    one<Thumb>("SELECT thumbnail, duration FROM media WHERE project_id = ? AND kind = 'video' ORDER BY sort LIMIT 1", r.id) ??
    one<Thumb>('SELECT thumbnail, duration FROM media WHERE project_id = ? AND thumbnail IS NOT NULL ORDER BY sort LIMIT 1', r.id)
  return {
    id: r.id, kind: r.kind === 'image' ? 'image' : 'video', brandId: r.brand_id ?? null, name: r.name, path: r.path,
    format: r.format as Project['format'], resolution: r.resolution as Project['resolution'], fps: r.fps as Project['fps'],
    preset: r.preset, status: r.status as Project['status'],
    claudeSessionId: r.claude_session_id, currentVersionId: r.current_version_id,
    thumbnail: thumb?.thumbnail ?? null, duration: thumb?.duration ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

export function listProjects(): Project[] {
  return all<ProjectRow>('SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC').map(toProject)
}

export function getProject(id: string): Project | null {
  const r = one<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
  return r ? toProject(r) : null
}

export function requireProject(id: string): Project {
  const p = getProject(id)
  if (!p) throw new Error('Projeto não encontrado')
  return p
}

/** Garante que um caminho pertence à pasta do projeto antes de qualquer escrita. */
export function projectPath(p: Project, ...parts: string[]): string {
  const full = join(p.path, ...parts)
  if (!isInside(p.path, full)) throw new Error(`Caminho fora do projeto: ${full}`)
  return full
}

export function touchProject(id: string): void {
  run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), id)
  writeManifest(id)
}

/** project.json: cópia legível do projeto dentro da própria pasta (autosave e portabilidade). */
export function writeManifest(id: string): void {
  const p = getProject(id)
  if (!p || !existsSync(p.path)) return
  const media = all('SELECT name, kind, path, duration, width, height, fps, codec FROM media WHERE project_id = ? ORDER BY sort', id)
  const versions = all('SELECT number, label, path, request, changes, created_at FROM versions WHERE project_id = ? ORDER BY number', id)
  const manifest = {
    app: 'PQueiroz Video Studio', schema: 1,
    id: p.id, kind: p.kind, brandId: p.brandId, name: p.name, format: p.format, resolution: p.resolution, fps: p.fps, preset: p.preset, status: p.status,
    claudeSessionId: p.claudeSessionId, currentVersionId: p.currentVersionId,
    createdAt: p.createdAt, updatedAt: p.updatedAt, media, versions
  }
  writeFileSync(join(p.path, 'project.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

export function createProject(input: NewProjectInput): Project {
  const name = input.name.trim() || 'Novo projeto'
  const root = ensureDir(getSettings().projectsRoot)
  let dir = join(root, slugify(name))
  for (let i = 2; existsSync(dir); i++) dir = join(root, `${slugify(name)} (${i})`)
  ensureDir(dir)
  for (const d of PROJECT_DIRS) ensureDir(join(dir, d))
  const id = uid()
  const t = now()
  run(`INSERT INTO projects(id, name, path, format, resolution, fps, preset, status, kind, brand_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?, ?)`, id, name, dir, input.format, input.resolution, input.fps, input.preset,
  input.kind === 'image' ? 'image' : 'video', input.brandId ?? null, t, t)
  writeManifest(id)
  return requireProject(id)
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'format' | 'resolution' | 'fps' | 'preset' | 'status' | 'currentVersionId'>>): Project {
  const cols: Record<string, string> = {
    name: 'name', format: 'format', resolution: 'resolution', fps: 'fps', preset: 'preset', status: 'status', currentVersionId: 'current_version_id'
  }
  for (const [k, v] of Object.entries(patch)) {
    if (cols[k]) run(`UPDATE projects SET ${cols[k]} = ? WHERE id = ?`, v ?? null, id)
  }
  touchProject(id)
  return requireProject(id)
}

export function setClaudeSession(id: string, sessionId: string | null): void {
  run('UPDATE projects SET claude_session_id = ? WHERE id = ?', sessionId, id)
}

/** Arquiva (some da lista) — a pasta e os arquivos ficam intactos no disco. */
export function archiveProject(id: string): void {
  run('UPDATE projects SET archived = 1 WHERE id = ?', id)
}

/** Abre uma pasta de projeto já existente (com project.json) e a registra no banco. */
export function registerExisting(dir: string): Project {
  validatePath(dir)
  const existing = one<ProjectRow>('SELECT * FROM projects WHERE path = ?', dir)
  if (existing) {
    run('UPDATE projects SET archived = 0, updated_at = ? WHERE id = ?', now(), existing.id)
    return requireProject(existing.id)
  }
  let manifest: Partial<Project> = {}
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  } catch {
    /* pasta sem manifesto: vira um projeto novo com os padrões */
  }
  for (const d of PROJECT_DIRS) ensureDir(join(dir, d))
  const id = uid()
  const t = now()
  run(`INSERT INTO projects(id, name, path, format, resolution, fps, preset, status, claude_session_id, kind, brand_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, manifest.name ?? basename(dir), dir, manifest.format ?? '9:16', manifest.resolution ?? '1080p', manifest.fps ?? 'original',
    manifest.preset ?? 'nenhum', manifest.status ?? 'novo', manifest.claudeSessionId ?? null,
    manifest.kind === 'image' || existsSync(join(dir, 'design.json')) ? 'image' : 'video', manifest.brandId ?? null, manifest.createdAt ?? t, t)
  return requireProject(id)
}
