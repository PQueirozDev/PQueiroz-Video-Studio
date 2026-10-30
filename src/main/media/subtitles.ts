import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { SubtitleDocument } from '@shared/types'
import { emptySubtitles, parseSrt, validateSubtitles } from '@shared/subtitles'
import { one, run } from '../db'
import { projectPath, requireProject } from '../projects/projects'
import { listMedia } from './media'
import { listVersions } from '../versions/versions'
import { ensureDir } from '../files'

export function subtitleSource(id: string, source: string): string {
  requireProject(id)
  if (![...listMedia(id).filter((m) => m.kind === 'video'), ...listVersions(id)].some((m) => m.path === source)) throw new Error('O vídeo de origem não pertence ao projeto.')
  return source
}
export function subtitleFile(id: string, source: string): string {
  subtitleSource(id, source)
  const dir = ensureDir(projectPath(requireProject(id), 'edit', 'subtitles'))
  return `${dir}/${createHash('sha256').update(source).digest('hex').slice(0, 20)}.srt`
}
export function loadSubtitles(id: string, source: string): SubtitleDocument {
  const file = subtitleFile(id, source)
  const row = one<{ document: string }>('SELECT document FROM subtitles WHERE project_id=? AND source=?', id, source)
  return row ? validateSubtitles(JSON.parse(row.document)) : existsSync(file) ? { ...emptySubtitles(), cues: parseSrt(readFileSync(file, 'utf8')) } : emptySubtitles()
}
export function saveSubtitles(id: string, source: string, doc: SubtitleDocument): SubtitleDocument {
  subtitleSource(id, source)
  const valid = validateSubtitles(doc)
  run('INSERT INTO subtitles(project_id, source, document) VALUES(?, ?, ?) ON CONFLICT(project_id, source) DO UPDATE SET document=excluded.document', id, source, JSON.stringify(valid))
  return valid
}
export function reloadGeneratedSubtitles(id: string, source: string): SubtitleDocument {
  const file = subtitleFile(id, source)
  if (!existsSync(file)) throw new Error('O Claude ainda não gerou o SRT para esta origem.')
  return saveSubtitles(id, source, { ...loadSubtitles(id, source), cues: parseSrt(readFileSync(file, 'utf8')) })
}
export function writeSubtitleExport(path: string, text: string): void { writeFileSync(path, text, 'utf8') }
