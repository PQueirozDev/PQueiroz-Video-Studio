import type { ChildProcess } from 'node:child_process'
import { bitrateFor, exportPresetById } from '@shared/exportPresets'
import { checkRender } from '@shared/qc'
import { measureFile } from '../qc/qc'
import { log } from '../log'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { toAss, validateSubtitles } from '@shared/subtitles'
import type { Project, RenderJob, RenderSettings } from '@shared/types'
import { all, one, run } from '../db'
import { ensureDir, uniquePath, validatePath } from '../files'
import { hasEncoder, probe, runFfmpeg } from '../media/ffmpeg'
import { projectPath, requireProject, updateProject } from '../projects/projects'
import { subtitleSource } from '../media/subtitles'
import { getSettings } from '../settings'
import { killTree, now, uid } from '../util'
import { fitFilter, fitModeFilter, presetSize, targetSize } from './size'
import { encoderArgs, QUALITY } from './encode'

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
  remaining_seconds: number | null; estimated_bytes: number | null; notice: string | null
  id: string; project_id: string; label: string; input: string; output: string; settings: string; status: string
  progress: number; encoder: string | null; error: string | null; created_at: number; finished_at: number | null
}

function toJob(r: RenderRow): RenderJob {
  const p = one<{ name: string }>('SELECT name FROM projects WHERE id = ?', r.project_id)
  return {
    remainingSeconds: r.remaining_seconds, estimatedBytes: r.estimated_bytes, notice: r.notice,
    id: r.id, projectId: r.project_id, projectName: p?.name ?? '—', label: r.label, input: r.input, output: r.output,
    settings: JSON.parse(r.settings), status: r.status as RenderJob['status'], progress: r.progress, encoder: r.encoder,
    error: r.error, createdAt: r.created_at, finishedAt: r.finished_at
  }
}

const getJob = (id: string): RenderJob | null => {
  const r = one<RenderRow>('SELECT * FROM renders WHERE id = ?', id)
  return r ? toJob(r) : null
}

function update(id: string, patch: Partial<Record<'status' | 'progress' | 'encoder' | 'error' | 'finished_at' | 'remaining_seconds' | 'estimated_bytes' | 'notice', unknown>>): void {
  for (const [k, v] of Object.entries(patch)) run(`UPDATE renders SET ${k} = ? WHERE id = ?`, v ?? null, id)
  const job = getJob(id)
  if (job) listener(job)
}

export function listRenders(): RenderJob[] {
  return all<RenderRow>('SELECT * FROM renders ORDER BY created_at DESC LIMIT 100').map(toJob)
}

/** Ao abrir o app, renders interrompidos voltam para a fila. */
export function recoverRenders(): void {
  run("UPDATE renders SET status = 'aguardando', progress = 0, remaining_seconds = NULL, notice = 'Render interrompido: reiniciando do início.' WHERE status = 'renderizando'")
  pump()
}

async function buildArgs(job: RenderJob, project: Project, encoder: string): Promise<{ args: string[]; duration: number | null }> {
  const info = await probe(job.input)
  const s = job.settings
  const preset = exportPresetById(s.presetId)
  const { w, h } = preset ? presetSize(preset.aspect, preset.shortSide) : targetSize(project.format, s.resolution, info.width ?? 1080, info.height ?? 1920)
  // Encaixa no quadro sem distorcer (barras, corte ou fundo desfocado, conforme o preset).
  const vf = [preset ? fitModeFilter(w, h, preset.fit) : fitFilter(w, h)]
  if (s.fps !== 'original') vf.push(`fps=${s.fps}`)
  vf.push('format=yuv420p')
  if (s.subtitles?.cues.length) {
    const dir = ensureDir(projectPath(project, 'temp', 'render'))
    writeFileSync(join(dir, `${job.id}.ass`), toAss(s.subtitles, w, h), 'utf8')
    vf.push(`ass=${job.id}.ass`)
  }
  // Limite de tamanho (ex.: WhatsApp): bitrate calculado pela duração, em vez de qualidade constante.
  let venc = encoderArgs(encoder, s.quality)
  let audioRate = '192k'
  if (preset?.maxBytes && info.duration) {
    // Cabe no limite, mas sem passar de ~4 Mbps (720p não ganha nada acima disso; vídeo curto ficaria enorme).
    // Orçamento impossível (vídeo longo demais para o limite): avisa antes de renderizar.
    const budget = (preset.maxBytes * 8 * 0.95) / info.duration
    if (budget < 250_000) throw new Error(`${Math.round(info.duration)} s não cabem em ${Math.round(preset.maxBytes / 1048576)} MB com qualidade aceitável. Corte para até ${Math.floor((preset.maxBytes * 8 * 0.95) / 250_000)} s ou use outro destino.`)
    const audioBps = budget < 1_000_000 ? 64_000 : 128_000
    const bps = Math.min(4_000_000, bitrateFor(preset.maxBytes, info.duration, audioBps))
    const k = `${Math.floor(bps / 1000)}k`
    venc = encoder === 'h264_nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', k, '-maxrate', k, '-bufsize', `${Math.floor(bps / 500)}k`]
      : ['-c:v', 'libx264', '-preset', 'medium', '-b:v', k, '-maxrate', k, '-bufsize', `${Math.floor(bps / 500)}k`]
    audioRate = `${audioBps / 1000}k`
  }
  // Entregas por destino: recodificar o áudio (ainda mais em bitrate baixo) cria picos novos; o limitador
  // (medido em 4x) mantém o pico real ≤ -1 dBTP sem mexer no volume médio.
  const af = preset && info.hasAudio ? ['-af', 'aresample=192000,alimiter=limit=0.708:attack=1:release=60:level=false,aresample=48000'] : []
  const args = ['-y', '-i', job.input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf.join(','), ...af, ...venc,
    '-c:a', 'aac', '-b:a', audioRate, '-ar', '48000']
  if (s.container === 'mp4') args.push('-movflags', '+faststart')
  args.push(job.output)
  return { args, duration: info.duration }
}

async function runJob(job: RenderJob): Promise<void> {
  const project = requireProject(job.projectId)
  const encoders = getSettings().hwAccel && (await hasEncoder('h264_nvenc')) ? ['h264_nvenc', 'libx264'] : ['libx264']
  if (getJob(job.id)?.status !== 'renderizando') return
  let lastError = ''
  for (const encoder of encoders) {
    if (getJob(job.id)?.status !== 'renderizando') return
    update(job.id, { encoder })
    const { args, duration } = await buildArgs(job, project, encoder)
    if (getJob(job.id)?.status !== 'renderizando') return
    let last = 0
    const started = now()
    update(job.id, { progress: 0, remaining_seconds: null })
    const ff = await runFfmpeg(args, duration, (p) => {
      if (p - last >= 0.01 || p === 1) {
        last = p
        const elapsed = (now() - started) / 1000
        let estimatedBytes: number | null = null
        try { if (p > 0.03) estimatedBytes = statSync(job.output).size / p } catch { /* arquivo ainda não criado */ }
        update(job.id, { progress: p, remaining_seconds: p > 0.03 && elapsed > 2 ? elapsed * (1 - p) / p : null, estimated_bytes: estimatedBytes })
      }
    }, ensureDir(projectPath(project, 'temp', 'render')))
    active.set(job.id, ff.child)
    if (getJob(job.id)?.status === 'cancelado') { cancelled.add(job.id); killTree(ff.child.pid) }
    const res = await ff.done
    active.delete(job.id)
    await unlink(join(projectPath(project, 'temp', 'render'), `${job.id}.ass`)).catch(() => {})
    if (cancelled.has(job.id)) {
      cancelled.delete(job.id)
      await unlink(job.output).catch(() => {})
      update(job.id, { status: 'cancelado', finished_at: now(), remaining_seconds: null })
      return
    }
    if (res.code === 0) {
      update(job.id, { status: 'concluido', progress: 1, finished_at: now(), remaining_seconds: 0, estimated_bytes: statSync(job.output).size })
      updateProject(job.projectId, { status: 'renderizado' })
      void qualityNotice(job)
      return
    }
    lastError = res.stderr.trim().split(/\r?\n/).slice(-4).join('\n')
    if (encoder === 'h264_nvenc') update(job.id, { notice: 'A GPU falhou. O render foi reiniciado usando a CPU.', progress: 0, remaining_seconds: null })
    await unlink(job.output).catch(() => {}) // GPU falhou: tenta de novo na CPU
  }
  update(job.id, { status: 'erro', error: lastError || 'ffmpeg falhou', finished_at: now(), remaining_seconds: null })
}

/** Quality Check automático do arquivo exportado: o resultado aparece na fila (sem atrasar o próximo render). */
async function qualityNotice(job: RenderJob): Promise<void> {
  try {
    const items = checkRender(await measureFile(job.output), exportPresetById(job.settings.presetId))
    const bad = items.filter((i) => i.level !== 'info')
    update(job.id, { notice: bad.length ? `Quality Check: ${bad.length} ${bad.length === 1 ? 'aviso' : 'avisos'} — ${bad.map((i) => i.message).join(' · ')}` : 'Quality Check: tudo certo.' })
  } catch (err) {
    log.warn('qc.after_render_failed', { id: job.id, error: (err as Error).message })
  }
}

function pump(): void {
  const max = Math.max(1, getSettings().maxConcurrentRenders)
  if (active.size >= max) return
  const waiting = all<RenderRow>("SELECT * FROM renders WHERE status = 'aguardando' ORDER BY created_at")
  const running = all<{ id: string }>("SELECT id FROM renders WHERE status = 'renderizando'").length
  for (const r of waiting.slice(0, Math.max(0, max - running))) {
    update(r.id, { status: 'renderizando', progress: 0 })
    runJob(toJob(r))
      .catch((err) => { if (getJob(r.id)?.status !== 'cancelado') update(r.id, { status: 'erro', error: String(err.message ?? err), finished_at: now(), remaining_seconds: null }) })
      .finally(pump)
  }
}

export function enqueueRender(projectId: string, input: { path: string; label: string }, settings: RenderSettings): RenderJob {
  const project = requireProject(projectId)
  const src = validatePath(input.path)
  subtitleSource(projectId, src)
  if (!['mp4', 'mov'].includes(settings.container) || !['1080p', '1440p', '4k'].includes(settings.resolution) || !['original', '30', '60'].includes(settings.fps) || !Object.hasOwn(QUALITY, settings.quality)) throw new Error('Configurações de render inválidas.')
  if (settings.presetId !== undefined && !exportPresetById(settings.presetId)) throw new Error('Preset de exportação desconhecido.')
  if (settings.subtitles) settings = { ...settings, subtitles: validateSubtitles(settings.subtitles) }
  if (!existsSync(src)) throw new Error('Arquivo de origem não encontrado')
  const outDir = ensureDir(getSettings().exportRoot)
  const preset = exportPresetById(settings.presetId)
  if (preset) settings = { ...settings, container: preset.container, fps: preset.fps, quality: preset.quality }
  const name = `${project.name} - ${input.label}${preset ? ` - ${preset.name}` : ''}`.replace(/[<>:"/\\|?*]/g, '').trim()
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
  const job = getJob(id)
  if (!job || !['aguardando', 'renderizando'].includes(job.status)) return
  const child = active.get(id)
  if (child) {
    cancelled.add(id)
    killTree(child.pid)
  } else {
    update(id, { status: 'cancelado', finished_at: now(), remaining_seconds: null })
    pump()
  }
}

export function clearFinished(): void {
  run("DELETE FROM renders WHERE status IN ('concluido', 'erro', 'cancelado')")
}

export { getJob }
