import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Project, Version } from '@shared/types'
import { all, one, run } from '../db'
import { ensureDir, EXTENSIONS, safeCopy } from '../files'
import { probe, thumbnail } from '../media/ffmpeg'
import { projectPath, requireProject, updateProject } from '../projects/projects'
import { now, uid } from '../util'

// Cada vídeo produzido pelo Claude vira uma versão imutável em versions/ (V1, V2, V3…).
// "Original" é sempre o material importado em input/, que nunca é alterado.

interface VersionRow {
  id: string; project_id: string; number: number; label: string; path: string; source_path: string | null
  request: string; changes: string; parent_id: string | null; duration: number | null; thumbnail: string | null; created_at: number
}

const toVersion = (r: VersionRow): Version => ({
  id: r.id, projectId: r.project_id, number: r.number, label: r.label, path: r.path, sourcePath: r.source_path,
  request: r.request, changes: r.changes, parentId: r.parent_id, duration: r.duration,
  thumbnail: r.thumbnail && existsSync(r.thumbnail) ? r.thumbnail : null, createdAt: r.created_at
})

export function listVersions(projectId: string): Version[] {
  return all<VersionRow>('SELECT * FROM versions WHERE project_id = ? ORDER BY number', projectId).map(toVersion)
}

function nextNumber(projectId: string): number {
  return (one<{ n: number | null }>('SELECT MAX(number) AS n FROM versions WHERE project_id = ?', projectId)?.n ?? 0) + 1
}

async function addVersion(project: Project, src: string, label: (n: number) => string, request: string, changes: string, parentId: string | null): Promise<Version> {
  const n = nextNumber(project.id)
  const dest = await safeCopy(src, projectPath(project, 'versions'), `V${n}${extname(src).toLowerCase()}`)
  const id = uid()
  const info = await probe(dest).catch(() => null)
  const thumbDir = ensureDir(projectPath(project, 'temp', 'thumbs'))
  const thumb = join(thumbDir, `v-${id}.jpg`)
  const hasThumb = await thumbnail(dest, thumb, Math.min(2, (info?.duration ?? 0) / 3))
  run(`INSERT INTO versions(id, project_id, number, label, path, source_path, request, changes, parent_id, duration, thumbnail, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, project.id, n, label(n), dest, src, request, changes, parentId, info?.duration ?? null, hasThumb ? thumb : null, now())
  return toVersion(one<VersionRow>('SELECT * FROM versions WHERE id = ?', id)!)
}

/** Vídeos em output/ e no topo de edit/ (preview.mp4, final.mp4…) alterados desde `sinceMs`. */
function changedOutputs(project: Project, sinceMs: number): string[] {
  const found: string[] = []
  for (const sub of ['output', 'edit']) {
    const dir = projectPath(project, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!EXTENSIONS.video.includes(extname(f).toLowerCase()) || f.startsWith('_')) continue
      const p = join(dir, f)
      const st = statSync(p)
      if (!st.isFile() || st.mtimeMs < sinceMs - 1000 || st.size === 0) continue
      // Já virou versão depois da última modificação (ex.: saída de uma operação anterior há < 1 s).
      const done = one<{ n: number }>('SELECT COUNT(*) AS n FROM versions WHERE project_id = ? AND source_path = ? AND created_at >= ?', project.id, p, Math.floor(st.mtimeMs))
      if (!done?.n) found.push(p)
    }
  }
  return found.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

/** Chamado ao fim de cada resposta do Claude: registra como versão todo vídeo novo que ele gerou. */
export async function snapshotOutputs(projectId: string, sinceMs: number, request: string, changes: string, only?: string[]): Promise<Version[]> {
  const project = requireProject(projectId)
  const created: Version[] = []
  let parent = project.currentVersionId
  for (const file of only ?? changedOutputs(project, sinceMs)) {
    const preview = /preview|previa|prévia/i.test(file)
    const v = await addVersion(project, file, (n) => `V${n}${preview ? ' · prévia' : ''}`, request, changes, parent)
    created.push(v)
    parent = v.id
  }
  if (created.length) updateProject(projectId, { currentVersionId: created[created.length - 1].id, status: 'pronto' })
  return created
}

export function restoreVersion(projectId: string, versionId: string): Project {
  const v = one<VersionRow>('SELECT * FROM versions WHERE id = ? AND project_id = ?', versionId, projectId)
  if (!v) throw new Error('Versão não encontrada')
  return updateProject(projectId, { currentVersionId: versionId })
}

export async function duplicateVersion(projectId: string, versionId: string): Promise<Version> {
  const project = requireProject(projectId)
  const v = one<VersionRow>('SELECT * FROM versions WHERE id = ? AND project_id = ?', versionId, projectId)
  if (!v) throw new Error('Versão não encontrada')
  const copy = await addVersion(project, v.path, (n) => `V${n} · cópia de ${v.label}`, v.request, v.changes, v.id)
  updateProject(projectId, { currentVersionId: copy.id })
  return copy
}

export function getVersion(versionId: string): Version | null {
  const r = one<VersionRow>('SELECT * FROM versions WHERE id = ?', versionId)
  return r ? toVersion(r) : null
}
