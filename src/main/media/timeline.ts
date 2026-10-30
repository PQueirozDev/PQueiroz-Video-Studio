import type { MediaItem, Project, Version } from '@shared/types'
import { run } from '../db'
import { bus, type TaskProgress } from '../events'
import { ensureDir, uniquePath } from '../files'
import { projectPath, requireProject, touchProject } from '../projects/projects'
import { targetSize } from '../render/size'
import { compileComposition } from '../render/compose'
import { lutMap } from '../assets/luts'
import { fontMap } from '../packs/packs'
import { compositionArgs, encoderArgs } from '../render/encode'
import { getComposition, mediaRefs } from '../composition/store'
import { validateComposition, type Composition } from '@shared/composition'
import { getSettings } from '../settings'
import { log } from '../log'
import { writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { now } from '../util'
import { snapshotOutputs } from '../versions/versions'
import { hasEncoder, runFfmpeg } from './ffmpeg'
import { listMedia } from './media'

// Edição manual simples: cada clipe tem início/fim (sem tocar no arquivo) e pode sair da timeline.
// "Montar timeline" renderiza a composição do projeto (derivada desses cortes enquanto ninguém
// editou por comandos) no formato do projeto e gera uma nova versão.

export function setTrim(projectId: string, mediaId: string, trimIn: number | null, trimOut: number | null): void {
  const m = listMedia(projectId).find((x) => x.id === mediaId)
  if (!m) throw new Error('Clipe não encontrado')
  const dur = m.duration ?? Infinity
  if ((trimIn != null && !Number.isFinite(trimIn)) || (trimOut != null && !Number.isFinite(trimOut))) throw new Error('Tempo de corte inválido.')
  let a = trimIn == null ? null : Math.max(0, Math.min(trimIn, dur))
  let b = trimOut == null ? null : Math.max(0, Math.min(trimOut, dur))
  if ((b ?? dur) - (a ?? 0) < 0.2) throw new Error('O corte deve ter pelo menos 0,2 segundo.')
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

/** Renderiza a composição do projeto (todas as trilhas, transições e efeitos) como uma nova versão. */
export async function assembleTimeline(projectId: string): Promise<Version[]> {
  if (running.has(projectId)) throw new Error('A montagem já está em andamento.')
  // Reserva antes de qualquer await: duas chamadas seguidas não podem disputar o mesmo arquivo de saída.
  running.add(projectId)
  try {
    return await assemble(projectId)
  } finally {
    running.delete(projectId)
  }
}

/** Formato de saída: o do projeto, usando o primeiro vídeo da timeline como referência quando for "original". */
export function outputFormat(project: Project, items: MediaItem[], doc: Composition): { w: number; h: number; fps: number } {
  const visual = doc.clips.filter((c) => items.find((m) => m.id === c.mediaId)?.kind !== 'audio').sort((a, b) => a.start - b.start)
  const first = items.find((m) => m.id === visual[0]?.mediaId)
  const { w, h } = targetSize(project.format, project.resolution, first?.width ?? 1080, first?.height ?? 1920)
  const fps = project.fps === 'original' ? Math.round(first?.fps ?? 30) || 30 : Number(project.fps)
  return { w, h, fps }
}

async function assemble(projectId: string): Promise<Version[]> {
  const project = requireProject(projectId)
  const items = listMedia(projectId)
  const { doc } = getComposition(projectId)
  const media = mediaRefs(items)
  validateComposition(doc, media)
  const visual = doc.clips.filter((c) => media.get(c.mediaId)?.kind !== 'audio')
  if (!visual.length) throw new Error('Não há vídeos na timeline.')

  const emit = (p: Omit<TaskProgress, 'projectId' | 'task'>): void => {
    bus.emit('task:progress', { projectId, task: 'montagem', ...p })
  }

  const { w, h, fps } = outputFormat(project, items, doc)
  const graph = compileComposition(doc, media, { w, h, fps }, { luts: lutMap(), fonts: fontMap() })
  const tempDir = ensureDir(projectPath(project, 'temp', 'render'))
  const script = join(tempDir, `timeline-${now()}.filter`)
  writeFileSync(script, graph.filter, 'utf8')
  const outDir = ensureDir(projectPath(project, 'output'))
  const out = uniquePath(outDir, 'timeline.mp4')
  const encoders = getSettings().hwAccel && (await hasEncoder('h264_nvenc')) ? ['h264_nvenc', 'libx264'] : ['libx264']

  const startedAt = now()
  try {
    let lastError = ''
    for (const encoder of encoders) {
      emit({ text: encoder === 'h264_nvenc' ? 'Montando timeline (GPU)...' : 'Montando timeline...', progress: 0 })
      const ff = await runFfmpeg(compositionArgs(graph, script, encoderArgs(encoder, 'alta'), out), graph.duration, (p) => emit({ text: 'Montando timeline...', progress: p }))
      const res = await ff.done
      if (res.code === 0) { lastError = ''; break }
      lastError = res.stderr.trim().split(/\r?\n/).slice(-3).join('\n') || 'ffmpeg falhou'
      log.warn('timeline.encode_failed', { projectId, encoder, error: lastError })
      await unlink(out).catch(() => {})
    }
    if (lastError) throw new Error(lastError)
    const names = visual.map((c) => items.find((m) => m.id === c.mediaId)?.name ?? '?')
    const desc = `${doc.clips.length} clipe(s) em ${new Set(doc.clips.map((c) => c.trackId)).size} trilha(s): ${[...new Set(names)].slice(0, 6).join(', ')}`
    const versions = await snapshotOutputs(projectId, startedAt, 'Montagem da timeline', desc, [out])
    emit({ text: 'Timeline montada', progress: 1, done: true })
    log.info('timeline.rendered', { projectId, clips: doc.clips.length, seconds: graph.duration, ms: now() - startedAt })
    return versions
  } catch (err) {
    emit({ text: 'Falha na montagem', progress: null, done: true, error: (err as Error).message })
    throw err
  } finally {
    await unlink(script).catch(() => {})
  }
}
