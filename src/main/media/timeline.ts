import type { Version } from '@shared/types'
import { run } from '../db'
import { bus, type TaskProgress } from '../events'
import { ensureDir, uniquePath } from '../files'
import { projectPath, requireProject, touchProject } from '../projects/projects'
import { fitFilter, targetSize } from '../render/size'
import { now } from '../util'
import { snapshotOutputs } from '../versions/versions'
import { runFfmpeg } from './ffmpeg'
import { listMedia } from './media'

// Edição manual simples: cada clipe tem início/fim (sem tocar no arquivo) e pode sair da timeline.
// "Montar timeline" junta os clipes na ordem, no formato do projeto, e gera uma nova versão.

export function setTrim(projectId: string, mediaId: string, trimIn: number | null, trimOut: number | null): void {
  const m = listMedia(projectId).find((x) => x.id === mediaId)
  if (!m) throw new Error('Clipe não encontrado')
  const dur = m.duration ?? Infinity
  let a = trimIn == null ? null : Math.max(0, Math.min(trimIn, dur))
  let b = trimOut == null ? null : Math.max(0, Math.min(trimOut, dur))
  if (a != null && b != null && b - a < 0.2) b = Math.min(dur, a + 0.2)
  if (a === 0) a = null
  if (b != null && b >= dur) b = null
  run('UPDATE media SET trim_in = ?, trim_out = ? WHERE id = ? AND project_id = ?', a, b, mediaId, projectId)
  touchProject(projectId)
}

export function setInTimeline(projectId: string, mediaId: string, on: boolean): void {
  run('UPDATE media SET in_timeline = ? WHERE id = ? AND project_id = ?', on ? 1 : 0, mediaId, projectId)
  touchProject(projectId)
}

const running = new Set<string>()

export async function assembleTimeline(projectId: string): Promise<Version[]> {
  if (running.has(projectId)) throw new Error('A montagem já está em andamento.')
  const project = requireProject(projectId)
  const media = listMedia(projectId).filter((m) => m.inTimeline)
  const clips = media.filter((m) => m.kind === 'video')
  const music = media.find((m) => m.kind === 'audio')
  if (!clips.length) throw new Error('Não há vídeos na timeline.')

  const emit = (p: Omit<TaskProgress, 'projectId' | 'task'>): void => {
    bus.emit('task:progress', { projectId, task: 'montagem', ...p })
  }

  const first = clips[0]
  const { w, h } = targetSize(project.format, project.resolution, first.width ?? 1080, first.height ?? 1920)
  const fps = project.fps === 'original' ? Math.round(first.fps ?? 30) || 30 : Number(project.fps)
  const args: string[] = ['-y']
  const fc: string[] = []
  let total = 0
  clips.forEach((c, i) => {
    const a = c.trimIn ?? 0
    const b = c.trimOut ?? c.duration ?? 0
    const d = Math.max(0.2, b - a)
    total += d
    args.push('-ss', a.toFixed(3), '-t', d.toFixed(3), '-i', c.path)
    fc.push(`[${i}:v]fps=${fps},${fitFilter(w, h)},format=yuv420p[v${i}]`)
    fc.push(c.hasAudio
      ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${d.toFixed(3)}[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${d.toFixed(3)}[a${i}]`)
  })
  fc.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[v][a]`)
  let audioOut = '[a]'
  if (music) {
    const mi = clips.length
    args.push('-i', music.path)
    const fadeAt = Math.max(0, total - 2.5)
    // Sem áudio nos clipes, a música entra cheia; com fala, fica baixa por baixo.
    const vol = clips.some((c) => c.hasAudio) ? 0.3 : 1
    fc.push(`[${mi}:a]atrim=${(music.trimIn ?? 0).toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${vol},afade=t=out:st=${fadeAt.toFixed(3)}:d=2.5[mu]`)
    fc.push('[a][mu]amix=inputs=2:duration=first:normalize=0[am]')
    audioOut = '[am]'
  }
  const outDir = ensureDir(projectPath(project, 'output'))
  const out = uniquePath(outDir, 'timeline.mp4')
  args.push('-filter_complex', fc.join(';'), '-map', '[v]', '-map', audioOut,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out)

  running.add(projectId)
  const startedAt = now()
  try {
    emit({ text: 'Montando timeline...', progress: 0 })
    const ff = await runFfmpeg(args, total, (p) => emit({ text: 'Montando timeline...', progress: p }))
    const res = await ff.done
    if (res.code !== 0) throw new Error(res.stderr.trim().split(/\r?\n/).slice(-3).join('\n') || 'ffmpeg falhou')
    const desc = clips.map((c) => `${c.name}${c.trimIn != null || c.trimOut != null ? ` (${(c.trimIn ?? 0).toFixed(1)}–${(c.trimOut ?? c.duration ?? 0).toFixed(1)} s)` : ''}`).join(' + ')
    const versions = await snapshotOutputs(projectId, startedAt, 'Montagem manual da timeline', `${desc}${music ? ` · música: ${music.name}` : ''}`, [out])
    emit({ text: 'Timeline montada', progress: 1, done: true })
    return versions
  } catch (err) {
    emit({ text: 'Falha na montagem', progress: null, done: true, error: (err as Error).message })
    throw err
  } finally {
    running.delete(projectId)
  }
}
