import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import type { Project, RenderJob, RenderSettings } from '@shared/types'
import { all, one, run } from '../db'
import { ensureDir, uniquePath, validatePath } from '../files'
import { hasEncoder, probe, runFfmpeg } from '../media/ffmpeg'
import { requireProject, updateProject } from '../projects/projects'
import { getSettings } from '../settings'
import { killTree, now, uid } from '../util'
import { fitFilter, targetSize } from './size'

// Fila de exportação: roda o ffmpeg em processos separados (a interface nunca trava),
// com progresso real, aceleração por GPU quando disponível e fallback automático para CPU.

type Listener = (job: RenderJob) => void
let listener: Listener = () => {}
export const onRenderUpdate = (fn: Listener): void => {
  listener = fn
}

const active = new Map<string, ChildProcess>()
const cancelled = new Set<string>()

interface RenderRow {
  id: string; project_id: string; label: string; input: string; output: string; settings: string; status: string
  progress: number; encoder: string | null; error: string | null; created_at: number; finished_at: number | null
}

function toJob(r: RenderRow): RenderJob {
  const p = one<{ name: string }>('SELECT name FROM projects WHERE id = ?', r.project_id)
  return {
    id: r.id, projectId: r.project_id, projectName: p?.name ?? '—', label: r.label, input: r.input, output: r.output,
    settings: JSON.parse(r.settings), status: r.status as RenderJob['status'], progress: r.progress, encoder: r.encoder,
    error: r.error, createdAt: r.created_at, finishedAt: r.finished_at
  }
}

const getJob = (id: string): RenderJob | null => {
  const r = one<RenderRow>('SELECT * FROM renders WHERE id = ?', id)
  return r ? toJob(r) : null
}

function update(id: string, patch: Partial<Record<'status' | 'progress' | 'encoder' | 'error' | 'finished_at', unknown>>): void {
  for (const [k, v] of Object.entries(patch)) run(`UPDATE renders SET ${k} = ? WHERE id = ?`, v ?? null, id)
  const job = getJob(id)
  if (job) listener(job)
}

export function listRenders(): RenderJob[] {
  return all<RenderRow>('SELECT * FROM renders ORDER BY created_at DESC LIMIT 100').map(toJob)
}

/** Ao abrir o app, renders interrompidos voltam para a fila. */
export function recoverRenders(): void {
  run("UPDATE renders SET status = 'aguardando', progress = 0 WHERE status = 'renderizando'")
  pump()
}

const QUALITY = {
  rapida: { preset: 'veryfast', crf: 23, nv: 'p2', cq: 26 },
  equilibrada: { preset: 'medium', crf: 20, nv: 'p4', cq: 23 },
  alta: { preset: 'slow', crf: 17, nv: 'p6', cq: 19 },
  maxima: { preset: 'slower', crf: 14, nv: 'p7', cq: 16 }
} as const

async function buildArgs(job: RenderJob, project: Project, encoder: string): Promise<{ args: string[]; duration: number | null }> {
  const info = await probe(job.input)
  const s = job.settings
  const { w, h } = targetSize(project.format, s.resolution, info.width ?? 1080, info.height ?? 1920)
  // Encaixa no quadro sem distorcer (preenche com preto se a proporção for diferente).
  const vf = [fitFilter(w, h)]
  if (s.fps !== 'original') vf.push(`fps=${s.fps}`)
  vf.push('format=yuv420p')
  const q = QUALITY[s.quality]
  const venc = encoder === 'h264_nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', q.nv, '-rc', 'vbr', '-cq', String(q.cq), '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf)]
  const args = ['-y', '-i', job.input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf.join(','), ...venc,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
  if (s.container === 'mp4') args.push('-movflags', '+faststart')
  args.push(job.output)
  return { args, duration: info.duration }
}

async function runJob(job: RenderJob): Promise<void> {
  const project = requireProject(job.projectId)
  const encoders = getSettings().hwAccel && (await hasEncoder('h264_nvenc')) ? ['h264_nvenc', 'libx264'] : ['libx264']
  update(job.id, { status: 'renderizando', progress: 0 })
  let lastError = ''
  for (const encoder of encoders) {
    update(job.id, { encoder })
    const { args, duration } = await buildArgs(job, project, encoder)
    let last = 0
    const ff = await runFfmpeg(args, duration, (p) => {
      if (p - last >= 0.01 || p === 1) {
        last = p
        update(job.id, { progress: p })
      }
    })
    active.set(job.id, ff.child)
    const res = await ff.done
    active.delete(job.id)
    if (cancelled.has(job.id)) {
      cancelled.delete(job.id)
      await unlink(job.output).catch(() => {})
      update(job.id, { status: 'cancelado', finished_at: now() })
      return
    }
    if (res.code === 0) {
      update(job.id, { status: 'concluido', progress: 1, finished_at: now() })
      updateProject(job.projectId, { status: 'renderizado' })
      return
    }
    lastError = res.stderr.trim().split(/\r?\n/).slice(-4).join('\n')
    await unlink(job.output).catch(() => {}) // GPU falhou: tenta de novo na CPU
  }
  update(job.id, { status: 'erro', error: lastError || 'ffmpeg falhou', finished_at: now() })
}

function pump(): void {
  const max = Math.max(1, getSettings().maxConcurrentRenders)
  if (active.size >= max) return
  const waiting = all<RenderRow>("SELECT * FROM renders WHERE status = 'aguardando' ORDER BY created_at")
  const running = all<{ id: string }>("SELECT id FROM renders WHERE status = 'renderizando'").length
  for (const r of waiting.slice(0, Math.max(0, max - running))) {
    runJob(toJob(r))
      .catch((err) => update(r.id, { status: 'erro', error: String(err.message ?? err), finished_at: now() }))
      .finally(pump)
  }
}

export function enqueueRender(projectId: string, input: { path: string; label: string }, settings: RenderSettings): RenderJob {
  const project = requireProject(projectId)
  const src = validatePath(input.path)
  if (!existsSync(src)) throw new Error('Arquivo de origem não encontrado')
  const outDir = ensureDir(getSettings().exportRoot)
  const name = `${project.name} - ${input.label}`.replace(/[<>:"/\\|?*]/g, '').trim()
  // O arquivo só passa a existir quando o ffmpeg começa: também evita nomes já reservados por outro job da fila.
  const reserved = new Set(all<{ output: string }>("SELECT output FROM renders WHERE status IN ('aguardando', 'renderizando')").map((r) => r.output.toLowerCase()))
  let output = uniquePath(outDir, `${name}.${settings.container}`)
  for (let i = 2; reserved.has(output.toLowerCase()); i++) output = uniquePath(outDir, `${name} (${i}).${settings.container}`)
  const id = uid()
  run(`INSERT INTO renders(id, project_id, label, input, output, settings, status, progress, created_at)
       VALUES(?, ?, ?, ?, ?, ?, 'aguardando', 0, ?)`, id, projectId, input.label, src, output, JSON.stringify(settings), now())
  const job = getJob(id)!
  listener(job)
  pump()
  return job
}

export function cancelRender(id: string): void {
  const child = active.get(id)
  if (child) {
    cancelled.add(id)
    killTree(child.pid)
  } else {
    update(id, { status: 'cancelado', finished_at: now() })
  }
}

export function clearFinished(): void {
  run("DELETE FROM renders WHERE status IN ('concluido', 'erro', 'cancelado')")
}

export { getJob }
