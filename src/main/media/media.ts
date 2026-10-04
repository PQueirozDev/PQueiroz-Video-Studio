import { existsSync, readFileSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EditTimeline, ImportResult, MediaItem } from '@shared/types'
import { all, one, run } from '../db'
import { ensureDir, isInside, kindOf, safeCopy, validatePath } from '../files'
import { projectPath, requireProject, touchProject, updateProject } from '../projects/projects'
import { now, uid } from '../util'
import { probe, thumbnail } from './ffmpeg'
import { needsProxy, queueProxy } from './proxy'

interface MediaRow {
  id: string; project_id: string; kind: string; name: string; path: string; size: number; duration: number | null
  width: number | null; height: number | null; fps: number | null; codec: string | null; has_audio: number
  thumbnail: string | null; sort: number; added_at: number
  trim_in: number | null; trim_out: number | null; in_timeline: number; proxy: string | null
}

const toItem = (r: MediaRow): MediaItem => ({
  id: r.id, projectId: r.project_id, kind: r.kind as MediaItem['kind'], name: r.name, path: r.path, size: r.size,
  duration: r.duration, width: r.width, height: r.height, fps: r.fps, codec: r.codec, hasAudio: Boolean(r.has_audio),
  thumbnail: r.thumbnail && existsSync(r.thumbnail) ? r.thumbnail : null, sort: r.sort, addedAt: r.added_at,
  trimIn: r.trim_in, trimOut: r.trim_out, inTimeline: r.in_timeline !== 0, proxy: r.proxy && existsSync(r.proxy) ? r.proxy : null
})

export function listMedia(projectId: string): MediaItem[] {
  return all<MediaRow>('SELECT * FROM media WHERE project_id = ? ORDER BY sort, added_at', projectId).map(toItem)
}

/**
 * Copia os arquivos para o projeto (vídeos → input/, áudio e imagens → assets/).
 * O original nunca é movido nem alterado, e nada é sobrescrito: nomes repetidos ganham " (2)".
 */
export async function importMedia(projectId: string, paths: string[]): Promise<ImportResult> {
  const project = requireProject(projectId)
  const result: ImportResult = { imported: [], skipped: [] }
  let sort = (one<{ m: number | null }>('SELECT MAX(sort) AS m FROM media WHERE project_id = ?', projectId)?.m ?? -1) + 1
  const thumbs = ensureDir(projectPath(project, 'temp', 'thumbs'))

  for (const raw of paths) {
    let src: string
    try {
      src = validatePath(raw)
    } catch (err) {
      result.skipped.push({ path: raw, reason: String((err as Error).message) })
      continue
    }
    const kind = kindOf(src)
    if (!kind) {
      result.skipped.push({ path: src, reason: 'Formato não suportado' })
      continue
    }
    if (!existsSync(src) || !statSync(src).isFile()) {
      result.skipped.push({ path: src, reason: 'Arquivo não encontrado' })
      continue
    }
    try {
      // Arquivo que já está dentro do projeto (ex.: saída do Claude) é registrado sem nova cópia.
      const dest = isInside(project.path, src) ? src : await safeCopy(src, projectPath(project, kind === 'video' ? 'input' : 'assets'))
      const info = await probe(dest).catch(() => null)
      const id = uid()
      let thumb: string | null = null
      if (kind !== 'audio') {
        // Imagens viram PNG para manter a transparência (logos).
        const t = join(thumbs, `${id}.${kind === 'image' ? 'png' : 'jpg'}`)
        if (await thumbnail(dest, t, kind === 'video' ? Math.min(1, (info?.duration ?? 0) / 3) : 0)) thumb = t
      }
      run(`INSERT INTO media(id, project_id, kind, name, path, size, duration, width, height, fps, codec, has_audio, thumbnail, sort, added_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, projectId, kind, basename(dest), dest, statSync(dest).size, kind === 'image' ? null : info?.duration ?? null,
        info?.width ?? null, info?.height ?? null, kind === 'video' ? info?.fps ?? null : null, info?.codec ?? null,
        info?.hasAudio ? 1 : 0, thumb, sort++, now())
      result.imported.push(toItem(one<MediaRow>('SELECT * FROM media WHERE id = ?', id)!))
      if (kind === 'video' && info && needsProxy(info, statSync(dest).size)) queueProxy(project, id, dest, info.duration)
    } catch (err) {
      result.skipped.push({ path: src, reason: (err as Error).message })
    }
  }
  if (result.imported.length) {
    if (project.status === 'novo') updateProject(projectId, { status: 'editando' })
    else touchProject(projectId)
  }
  return result
}

export function reorderMedia(projectId: string, ids: string[]): void {
  ids.forEach((id, i) => run('UPDATE media SET sort = ? WHERE id = ? AND project_id = ?', i, id, projectId))
  touchProject(projectId)
}

/** Remove da biblioteca. A cópia dentro do projeto vai junto; o arquivo original de origem nunca é tocado. */
export async function removeMedia(projectId: string, id: string): Promise<void> {
  const project = requireProject(projectId)
  const row = one<MediaRow>('SELECT * FROM media WHERE id = ? AND project_id = ?', id, projectId)
  if (!row) return
  run('DELETE FROM media WHERE id = ?', id)
  if (row.thumbnail && isInside(project.path, row.thumbnail)) await unlink(row.thumbnail).catch(() => {})
  touchProject(projectId)
}

/** Lê a timeline gerada pelo montar.py (edit/timeline.json), nos dois formatos já usados. */
export function editTimeline(projectId: string): EditTimeline | null {
  const project = requireProject(projectId)
  const file = projectPath(project, 'edit', 'timeline.json')
  if (!existsSync(file)) return null
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    const cuts: number[] = j.cortes_s ?? j.cuts_s ?? []
    const segments: string[] = j.trechos ?? j.segments ?? []
    return { cuts, segments, duration: j.duracao_s ?? j.total_s ?? cuts[cuts.length - 1] ?? 0 }
  } catch {
    return null
  }
}
