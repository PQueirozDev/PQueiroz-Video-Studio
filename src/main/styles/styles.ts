import { learnStyle, applyStyleCommands, type StyleProfile } from '@shared/style'
import { AUTO_STYLES } from '@shared/autoStudio'
import { all, one, run } from '../db'
import { editComposition, getComposition, mediaRefs } from '../composition/store'
import { getBrand } from '../image/brands'
import { listMedia } from '../media/media'
import { requireProject } from '../projects/projects'
import { now, uid } from '../util'

// Style Memory: estilos aprendidos de edições prontas, ligados (ou não) a um cliente (Marca).
// Cada projeto de vídeo pode ter um cliente e um estilo; o Auto Studio e o Claude usam os dois.

interface StyleRow { id: string; name: string; brand_id: string | null; data: string; created_at: number; updated_at: number }

const toStyle = (r: StyleRow): StyleProfile => ({ ...(JSON.parse(r.data) as StyleProfile), id: r.id, name: r.name, brandId: r.brand_id, createdAt: r.created_at, updatedAt: r.updated_at })

export function listStyles(): StyleProfile[] {
  return all<StyleRow>('SELECT * FROM styles ORDER BY updated_at DESC').map(toStyle)
}

export function getStyle(id: string | null | undefined): StyleProfile | null {
  if (!id) return null
  const r = one<StyleRow>('SELECT * FROM styles WHERE id = ?', id)
  return r ? toStyle(r) : null
}

export function requireStyle(id: string): StyleProfile {
  const s = getStyle(id)
  if (!s) throw new Error('Estilo não encontrado.')
  return s
}

const cleanName = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim().slice(0, 80) : ''
  if (!s) throw new Error('Dê um nome ao estilo.')
  return s
}
const cleanBrand = (v: unknown): string | null => (typeof v === 'string' && v && getBrand(v) ? v : null)

/** Aprende o estilo da timeline do projeto e salva (como novo estilo ou atualizando um existente). */
export function learnFromProject(projectId: string, input: { name: string; brandId?: string | null; notes?: string; replaceId?: string }): StyleProfile {
  const project = requireProject(projectId)
  const learned = learnStyle(getComposition(projectId).doc, mediaRefs(listMedia(projectId)))
  const t = now()
  const old = input.replaceId ? requireStyle(input.replaceId) : null
  const id = old?.id ?? uid()
  const data: StyleProfile = {
    ...learned, id, name: cleanName(input.name), brandId: input.brandId === undefined ? old?.brandId ?? project.brandId ?? null : cleanBrand(input.brandId),
    source: project.name, notes: typeof input.notes === 'string' ? input.notes.slice(0, 2000) : old?.notes ?? '', createdAt: old?.createdAt ?? t, updatedAt: t
  }
  run('INSERT OR REPLACE INTO styles(id, name, brand_id, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)', id, data.name, data.brandId, JSON.stringify(data), data.createdAt, t)
  return getStyle(id)!
}

export function updateStyle(id: string, patch: { name?: string; brandId?: string | null; notes?: string }): StyleProfile {
  const s = requireStyle(id)
  const next: StyleProfile = {
    ...s, name: patch.name !== undefined ? cleanName(patch.name) : s.name, brandId: patch.brandId !== undefined ? cleanBrand(patch.brandId) : s.brandId,
    notes: typeof patch.notes === 'string' ? patch.notes.slice(0, 2000) : s.notes, updatedAt: now()
  }
  if (!AUTO_STYLES.some((a) => a.id === next.autoStyle)) next.autoStyle = 'gaming'
  run('UPDATE styles SET name = ?, brand_id = ?, data = ?, updated_at = ? WHERE id = ?', next.name, next.brandId, JSON.stringify(next), next.updatedAt, id)
  return getStyle(id)!
}

export function deleteStyle(id: string): void {
  run('DELETE FROM styles WHERE id = ?', id)
  run('UPDATE projects SET style_id = NULL WHERE style_id = ?', id)
}

/** Valor guardado em projects.style_id quando o Pedro escolhe "nenhum estilo" (diferente de herdar do cliente). */
const NO_STYLE = 'none'

/**
 * Cliente e estilo do projeto. `choice`: '' = herda o estilo mais recente do cliente; 'none' = sem estilo;
 * outro = estilo escolhido.
 */
export function projectStyle(projectId: string): { brandId: string | null; styleId: string | null; style: StyleProfile | null; choice: string } {
  const p = requireProject(projectId)
  const raw = one<{ style_id: string | null }>('SELECT style_id FROM projects WHERE id = ?', projectId)?.style_id ?? ''
  let style = raw === NO_STYLE ? null : getStyle(raw)
  if (!style && raw !== NO_STYLE && p.brandId) style = listStyles().find((s) => s.brandId === p.brandId) ?? null
  return { brandId: p.brandId ?? null, styleId: style?.id ?? null, style, choice: raw === NO_STYLE ? NO_STYLE : style && raw === style.id ? raw : '' }
}

export function setProjectStyle(projectId: string, patch: { brandId?: string | null; styleId?: string | null }): ReturnType<typeof projectStyle> {
  requireProject(projectId)
  if (patch.brandId !== undefined) {
    const brandId = cleanBrand(patch.brandId)
    run('UPDATE projects SET brand_id = ? WHERE id = ?', brandId, projectId)
    // Estilo escolhido de OUTRO cliente não acompanha a troca (estilos gerais continuam).
    const cur = one<{ style_id: string | null }>('SELECT style_id FROM projects WHERE id = ?', projectId)?.style_id
    const st = cur && cur !== NO_STYLE ? getStyle(cur) : null
    if (st?.brandId && st.brandId !== brandId) run('UPDATE projects SET style_id = NULL WHERE id = ?', projectId)
  }
  if (patch.styleId !== undefined) {
    const v = patch.styleId === NO_STYLE ? NO_STYLE : patch.styleId && getStyle(patch.styleId) ? patch.styleId : null
    run('UPDATE projects SET style_id = ? WHERE id = ?', v, projectId)
  }
  return projectStyle(projectId)
}

/** Veste a timeline do projeto com o estilo (uma etapa de desfazer). */
export function applyStyleToProject(projectId: string, styleId: string): { commands: number } {
  const s = requireStyle(styleId)
  const cmds = applyStyleCommands(getComposition(projectId).doc, mediaRefs(listMedia(projectId)), s)
  editComposition(projectId, cmds, { maxCommands: 5000 })
  return { commands: cmds.length }
}
