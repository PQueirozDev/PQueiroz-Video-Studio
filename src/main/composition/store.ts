import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { MediaItem } from '@shared/types'
import { applyCommand, resolveRefs, emptyComposition, NEUTRAL_TRANSFORM, migrateComposition, pruneMissingMedia, UnsupportedVersionError, validateComposition, validateStructure, type Command, type Composition, type MediaRef } from '@shared/composition'
import { getDb, one, run } from '../db'
import { bus } from '../events'
import { log } from '../log'
import { listMedia } from '../media/media'
import { projectPath, requireProject, touchProject } from '../projects/projects'
import { now, uid } from '../util'

// Guarda a composição de cada projeto:
//  - SQLite (documento + pilhas de desfazer/refazer), gravado a cada edição dentro de uma transação;
//  - cópia em `<projeto>/composition.json` (gravação atômica) para recuperar o projeto se o banco se perder.
// Enquanto ninguém editou por comandos, a composição é derivada da timeline simples (origin 'legacy'),
// assim os projetos antigos continuam se comportando exatamente como antes.

const HISTORY_LIMIT = 100
const FILE = 'composition.json'

type Row = { doc: string; past: string; future: string }

export interface CompositionState {
  doc: Composition
  undo: boolean
  redo: boolean
}

export function mediaRefs(items: MediaItem[]): Map<string, MediaRef & { path: string }> {
  return new Map(items.map((m) => [m.id, { id: m.id, kind: m.kind, duration: m.duration, hasAudio: m.hasAudio, path: m.path }]))
}

/** Reproduz a montagem simples antiga: vídeos em sequência com os cortes + a primeira música por baixo. */
export function legacyComposition(items: MediaItem[]): Composition {
  const doc = emptyComposition()
  doc.origin = 'legacy'
  const inTl = items.filter((m) => m.inTimeline)
  let t = 0
  for (const m of inTl.filter((x) => x.kind === 'video')) {
    const a = m.trimIn ?? 0
    const b = m.trimOut ?? m.duration ?? 0
    if (b - a < 0.1) continue
    doc.clips.push({ id: `L-${m.id}`, trackId: 'V1', mediaId: m.id, start: t, in: a, out: b, volume: 1, opacity: 1, fadeIn: 0, fadeOut: 0, transitionIn: null, effects: [], transform: { ...NEUTRAL_TRANSFORM }, speed: 1, hold: 0, keyframes: {} })
    t += b - a
  }
  const music = inTl.find((x) => x.kind === 'audio')
  if (music && t > 0) {
    const a = music.trimIn ?? 0
    const available = (music.trimOut ?? music.duration ?? t + a) - a
    const len = Math.min(available, t)
    if (len >= 0.1) {
      const hasSpeech = doc.clips.some((c) => items.find((m) => m.id === c.mediaId)?.hasAudio)
      doc.clips.push({ id: `L-${music.id}`, trackId: 'A1', mediaId: music.id, start: 0, in: a, out: a + len, volume: hasSpeech ? 0.3 : 1, opacity: 1, fadeIn: 0, fadeOut: Math.min(2.5, len), transitionIn: null, effects: [], transform: { ...NEUTRAL_TRANSFORM }, speed: 1, hold: 0, keyframes: {} })
    }
  }
  return doc
}

/** Lê e valida um documento salvo. Versão futura é propagada (nunca tratada como corrupção). */
function parseDoc(raw: string, media: Map<string, MediaRef>): Composition {
  const doc = migrateComposition(JSON.parse(raw))
  validateStructure(doc, media)
  return doc
}

/** Pilha de desfazer/refazer; se estiver corrompida, recomeça vazia em vez de travar o projeto. */
function parseStack(raw: string | undefined, projectId: string): unknown[] {
  try {
    const v = JSON.parse(raw ?? '[]')
    if (Array.isArray(v)) return v
  } catch { /* cai no aviso abaixo */ }
  log.warn('composition.history_reset', { projectId })
  return []
}

function readFileBackup(projectId: string, media: Map<string, MediaRef>): Composition | null {
  const file = projectPath(requireProject(projectId), FILE)
  if (!existsSync(file)) return null
  try {
    return parseDoc(readFileSync(file, 'utf8'), media)
  } catch (err) {
    if (err instanceof UnsupportedVersionError) throw err
    log.warn('composition.file_unreadable', { projectId, error: (err as Error).message })
    return null
  }
}

/** Escreve em arquivo temporário e renomeia: uma queda no meio nunca deixa um JSON pela metade. */
function writeFileBackup(projectId: string, doc: Composition): void {
  try {
    const file = projectPath(requireProject(projectId), FILE)
    writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 1), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    log.warn('composition.autosave_failed', { projectId, error: (err as Error).message })
  }
}

function loadRow(projectId: string): Row | undefined {
  return one<Row>('SELECT doc, past, future FROM compositions WHERE project_id = ?', projectId)
}

/** Documento atual. Nunca lança por dados ruins: cai para o arquivo de backup e, por último, para a timeline simples. */
export function getComposition(projectId: string): CompositionState {
  requireProject(projectId)
  const items = listMedia(projectId)
  const media = mediaRefs(items)
  let row = loadRow(projectId)
  let doc: Composition | null = null
  if (row) {
    try {
      doc = parseDoc(row.doc, media)
    } catch (err) {
      // Formato mais novo: para tudo aqui, sem cair para backup nem gravar nada por cima.
      if (err instanceof UnsupportedVersionError) throw err
      log.error('composition.db_unreadable', { projectId, error: (err as Error).message })
    }
  }
  if (!doc) {
    doc = readFileBackup(projectId, media)
    if (doc && doc.origin === 'manual') {
      log.info('composition.recovered_from_file', { projectId })
      persist(projectId, doc, [], [])
      row = loadRow(projectId)
    }
  }
  if (!doc || doc.origin === 'legacy') doc = legacyComposition(items)
  // Arquivos removidos do projeto saem da composição (com as transições que dependiam deles).
  const pruned = pruneMissingMedia(doc, media)
  if (pruned.removed) log.info('composition.pruned_missing_media', { projectId, clips: pruned.removed })
  const past = parseStack(row?.past, projectId)
  const future = parseStack(row?.future, projectId)
  return { doc: pruned.doc, undo: past.length > 0, redo: future.length > 0 }
}

function persist(projectId: string, doc: Composition, past: unknown[], future: unknown[]): void {
  run(`INSERT INTO compositions(project_id, doc, past, future, updated_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET doc=excluded.doc, past=excluded.past, future=excluded.future, updated_at=excluded.updated_at`,
  projectId, JSON.stringify(doc), JSON.stringify(past.slice(-HISTORY_LIMIT)), JSON.stringify(future.slice(-HISTORY_LIMIT)), now())
}

export interface EditResult extends CompositionState {
  createdIds: (string | undefined)[]
}

/**
 * Aplica uma lista de comandos de forma atômica: ou todos entram (como UM passo de desfazer),
 * ou nenhum entra e o erro do primeiro comando inválido é devolvido.
 */
export function editComposition(projectId: string, commands: Command[], opts: { maxCommands?: number } = {}): EditResult {
  if (!Array.isArray(commands) || !commands.length) throw new Error('Nenhuma edição enviada.')
  const max = opts.maxCommands ?? 500
  if (commands.length > max) throw new Error(`Edições demais de uma vez (máximo ${max}).`)
  const current = getComposition(projectId)
  const media = mediaRefs(listMedia(projectId))
  const ctx = { media, newId: (p: string) => `${p}-${uid().slice(0, 8)}` }
  let doc = current.doc
  const createdIds: (string | undefined)[] = []
  commands.forEach((cmd, i) => {
    try {
      const r = applyCommand(doc, resolveRefs(cmd, createdIds), ctx)
      doc = r.doc
      createdIds.push(r.createdId)
    } catch (err) {
      throw new Error(commands.length > 1 ? `Edição ${i + 1} (${cmd?.type}): ${(err as Error).message}` : (err as Error).message)
    }
  })
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = loadRow(projectId)
    const past = parseStack(row?.past, projectId)
    persist(projectId, doc, [...past, current.doc], [])
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  writeFileBackup(projectId, doc)
  touchProject(projectId)
  log.info('composition.edit', { projectId, commands: commands.map((c) => c.type) })
  bus.emit('composition:changed', { projectId })
  return { doc, undo: true, redo: false, createdIds }
}

export function travelComposition(projectId: string, direction: 'undo' | 'redo'): CompositionState {
  const current = getComposition(projectId)
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  let doc = current.doc
  try {
    const row = loadRow(projectId)
    const past = parseStack(row?.past, projectId)
    const future = parseStack(row?.future, projectId)
    const from = direction === 'undo' ? past : future
    const to = direction === 'undo' ? future : past
    // Passos ilegíveis da pilha são descartados até achar um válido.
    let target: Composition | null = null
    while (from.length && !target) {
      try {
        target = migrateComposition(from.pop())
      } catch (err) {
        if (err instanceof UnsupportedVersionError) throw err
        log.warn('composition.history_entry_skipped', { projectId, error: (err as Error).message })
      }
    }
    if (target) {
      to.push(current.doc)
      doc = target
      persist(projectId, doc, past, future)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  writeFileBackup(projectId, doc)
  bus.emit('composition:changed', { projectId })
  return getComposition(projectId)
}

/** Volta para a timeline simples (descarta a composição manual, mas deixa um passo de desfazer). */
export function resetComposition(projectId: string): CompositionState {
  const current = getComposition(projectId)
  const row = loadRow(projectId)
  const past = parseStack(row?.past, projectId)
  const legacy = legacyComposition(listMedia(projectId))
  persist(projectId, legacy, current.doc.origin === 'manual' ? [...past, current.doc] : past, [])
  writeFileBackup(projectId, legacy)
  bus.emit('composition:changed', { projectId })
  return getComposition(projectId)
}

/** Confere se a composição ainda é executável (arquivos removidos, cortes que passaram do fim etc.). */
export function checkComposition(projectId: string): string | null {
  try {
    validateComposition(getComposition(projectId).doc, mediaRefs(listMedia(projectId)))
    return null
  } catch (err) {
    return (err as Error).message
  }
}
