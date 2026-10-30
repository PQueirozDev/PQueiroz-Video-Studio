import type { TimelineState } from '@shared/types'
import { getDb, one, run } from '../db'
import { bus } from '../events'
import { requireProject, touchProject } from '../projects/projects'

type Snapshot = { id: string; sort: number; trim_in: number | null; trim_out: number | null; in_timeline: number }[]
type History = { past: string; future: string }
const snapshot = (id: string): Snapshot => getDb().prepare('SELECT id, sort, trim_in, trim_out, in_timeline FROM media WHERE project_id = ? ORDER BY sort, added_at').all(id) as Snapshot
const read = (id: string): { past: Snapshot[]; future: Snapshot[] } => {
  const h = one<History>('SELECT * FROM timeline_history WHERE project_id = ?', id)
  return { past: JSON.parse(h?.past ?? '[]'), future: JSON.parse(h?.future ?? '[]') }
}
const write = (id: string, past: Snapshot[], future: Snapshot[]): void => run('INSERT INTO timeline_history(project_id, past, future) VALUES(?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET past=excluded.past, future=excluded.future', id, JSON.stringify(past.slice(-100)), JSON.stringify(future.slice(-100)))

export function historyState(id: string): TimelineState {
  requireProject(id)
  const h = read(id)
  return { undo: h.past.length > 0, redo: h.future.length > 0 }
}
export function editWithHistory(id: string, edit: () => void): void {
  requireProject(id)
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const before = snapshot(id)
    edit()
    if (JSON.stringify(before) !== JSON.stringify(snapshot(id))) {
      const h = read(id)
      write(id, [...h.past, before], [])
    }
    db.exec('COMMIT')
  } catch (err) { db.exec('ROLLBACK'); throw err }
  bus.emit('media:changed', { projectId: id })
}
export function travelHistory(id: string, direction: 'undo' | 'redo'): TimelineState {
  requireProject(id)
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const h = read(id)
    const from = direction === 'undo' ? h.past : h.future
    const to = direction === 'undo' ? h.future : h.past
    const target = from.pop()
    if (target) {
      to.push(snapshot(id))
      for (const m of target) run('UPDATE media SET sort=?, trim_in=?, trim_out=?, in_timeline=? WHERE id=? AND project_id=?', m.sort, m.trim_in, m.trim_out, m.in_timeline, m.id, id)
      write(id, h.past, h.future)
      touchProject(id)
    }
    db.exec('COMMIT')
  } catch (err) { db.exec('ROLLBACK'); throw err }
  bus.emit('media:changed', { projectId: id })
  return historyState(id)
}
