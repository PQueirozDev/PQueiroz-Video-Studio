import { existsSync, realpathSync } from 'node:fs'
import { extname } from 'node:path'
import type { AspectFormat } from '@shared/types'
import { bus, type TaskProgress } from '../events'
import { EXTENSIONS, isInside, validatePath, writeUnique } from '../files'
import { probe, runFfmpeg } from '../media/ffmpeg'
import { importMedia } from '../media/media'
import { createProject, projectPath, requireProject } from '../projects/projects'
import { getSettings } from '../settings'
import { AF_ID } from './brands'
import { requireImageProject } from './imageProjects'
import { imageSize } from './providers'

// "Enviar para Video Studio": a arte vira um clipe animado. O renderer manda três camadas
// já renderizadas no tamanho da arte — fundo (opaco), elemento principal e textos/logo
// (transparentes) — e o FFmpeg anima cada uma separadamente.

export interface ToVideoInput {
  background: Uint8Array
  subject: Uint8Array | null
  foreground: Uint8Array | null
  duration: number
  motion: 'zoom-in' | 'zoom-out' | 'none'
  subjectMotion: 'float' | 'none'
  textIn: 'fade' | 'slide' | 'none'
  music: string | null
  targetProjectId: string | null
}

const progress = (e: Omit<TaskProgress, 'task'>): void => {
  bus.emit('task:progress', { ...e, task: 'animacao' } satisfies TaskProgress)
}

export async function imageToVideo(imageProjectId: string, input: ToVideoInput): Promise<{ projectId: string; mediaId: string }> {
  const project = requireImageProject(imageProjectId)
  const duration = Math.min(30, Math.max(2, Number(input.duration) || 6))
  const layers: { name: string; bytes: Buffer }[] = [{ name: 'fundo', bytes: Buffer.from(input.background) }]
  if (input.subject) layers.push({ name: 'elemento', bytes: Buffer.from(input.subject) })
  if (input.foreground) layers.push({ name: 'textos', bytes: Buffer.from(input.foreground) })
  let W = 0, H = 0
  for (const l of layers) {
    const s = imageSize(l.bytes)
    if (s.ext !== 'png' || s.width > 4096 || s.height > 4096) throw new Error('Camada inválida para animação.')
    if (!W) {
      W = s.width
      H = s.height
    } else if (s.width !== W || s.height !== H) throw new Error('As camadas precisam ter o mesmo tamanho.')
  }
  let music: string | null = null
  if (input.music) {
    music = validatePath(input.music)
    const s = getSettings()
    const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p)
    if (!EXTENSIONS.audio.includes(extname(music).toLowerCase()) || !existsSync(music) || ![s.assetsRoot, s.aqcRoot, project.path].some((r) => isInside(real(r), real(music!)))) {
      throw new Error('Trilha fora da biblioteca de assets.')
    }
  }
  // Vídeo H.264 precisa de dimensões pares.
  const OW = W - (W % 2)
  const OH = H - (H % 2)
  const dir = projectPath(project, 'temp', 'animacao')
  const files = layers.map((l) => writeUnique(dir, `${l.name}.png`, l.bytes))

  const args: string[] = ['-y', '-v', 'error']
  for (const f of files) args.push('-loop', '1', '-framerate', '30', '-t', duration.toFixed(2), '-i', f)
  if (music) args.push('-i', music)
  else args.push('-f', 'lavfi', '-t', duration.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo')
  const audioIndex = files.length

  const Z = 0.08 // zoom total ao longo do clipe
  const D = duration.toFixed(2)
  const zoom = input.motion === 'zoom-in' ? `(1+${Z}*t/${D})` : input.motion === 'zoom-out' ? `(1+${Z}-${Z}*t/${D})` : '1'
  const graph: string[] = [
    `[0:v]scale=w='ceil(${W}*${zoom}/2)*2':h='ceil(${H}*${zoom}/2)*2':eval=frame,crop=${OW}:${OH},format=rgba[bg]`
  ]
  let last = 'bg'
  let i = 1
  if (input.subject) {
    const y = input.subjectMotion === 'float' ? `'${Math.round(H * 0.008)}*sin(2*PI*t/2.6)'` : '0'
    graph.push(`[${i}:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1[s]`, `[${last}][s]overlay=x=0:y=${y}:eval=frame[v${i}]`)
    last = `v${i}`
    i++
  }
  if (input.foreground) {
    const fade = input.textIn === 'none' ? '' : ',fade=t=in:st=0.35:d=0.6:alpha=1'
    const y = input.textIn === 'slide' ? `'if(lt(t,0.35),${Math.round(H * 0.025)},max(0,${Math.round(H * 0.025)}-(t-0.35)*${Math.round(H * 0.05)}))'` : '0'
    graph.push(`[${i}:v]format=rgba${fade}[f]`, `[${last}][f]overlay=x=0:y=${y}:eval=frame[v${i}]`)
    last = `v${i}`
  }
  graph.push(`[${last}]format=yuv420p,setsar=1[vout]`)
  graph.push(`[${audioIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, duration - 1.5).toFixed(2)}:d=1.5[aout]`)

  const out = writeUnique(dir, `${project.name.replace(/[<>:"/\\|?*]/g, '')} animado.mp4`, '')
  args.push('-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', D, '-r', '30',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '192k', out)

  progress({ projectId: imageProjectId, text: 'Animando a arte…', progress: 0 })
  try {
    const job = await runFfmpeg(args, duration, (p) => progress({ projectId: imageProjectId, text: 'Animando a arte…', progress: p }))
    const r = await job.done
    if (r.code !== 0) throw new Error(r.stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `FFmpeg terminou com código ${r.code}`)
    const info = await probe(out).catch(() => null)
    if (!info?.duration) throw new Error('O vídeo animado saiu vazio.')

    let targetId = input.targetProjectId
    if (targetId) {
      if (requireProject(targetId).kind !== 'video') throw new Error('O destino precisa ser um projeto de vídeo.')
    } else {
      const format: AspectFormat = Math.abs(OW / OH - 1) < 0.1 ? '1:1' : OW > OH ? '16:9' : '9:16'
      targetId = createProject({
        name: `${project.name} (vídeo)`, format, resolution: '1080p', fps: '30',
        preset: project.brandId === AF_ID ? 'aquecedores-fortes' : 'nenhum', kind: 'video'
      }).id
    }
    const imported = await importMedia(targetId, [out])
    if (!imported.imported.length) throw new Error(imported.skipped[0]?.reason ?? 'Falha ao importar o vídeo animado')
    progress({ projectId: imageProjectId, text: 'Vídeo enviado ao Video Studio', progress: 1, done: true })
    return { projectId: targetId, mediaId: imported.imported[0].id }
  } catch (err) {
    progress({ projectId: imageProjectId, text: 'Falha ao animar', progress: null, done: true, error: (err as Error).message })
    throw err
  }
}
