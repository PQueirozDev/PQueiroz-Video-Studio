import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateComposition } from '@shared/composition'
import { effectById } from '@shared/fx'
import { safeSliceStart, sliceComposition } from '@shared/slice'
import { lutMap } from '../assets/luts'
import { fontMap } from '../packs/packs'
import { getComposition, mediaRefs } from '../composition/store'
import { ensureDir } from '../files'
import { log } from '../log'
import { hasEncoder, runFfmpeg } from '../media/ffmpeg'
import { listMedia } from '../media/media'
import { outputFormat } from '../media/timeline'
import { projectPath, requireProject } from '../projects/projects'
import { getSettings } from '../settings'
import { compileComposition } from './compose'
import { compositionArgs } from './encode'

// Prévia exata: renderiza um trecho da timeline em 540p com o MESMO motor do export.
// Fica em cache pelo conteúdo (mesmo trecho + mesma edição = mesmo arquivo), e só as 30 últimas ficam no disco.

const MAX_SECONDS = 30
const KEEP = 30
const running = new Map<string, Promise<string>>()

/** `bypassEffects`: renderiza o "antes" (sem efeitos de imagem) para a comparação antes/depois. */
export async function renderPreview(projectId: string, start: number, seconds: number, bypassEffects = false): Promise<{ path: string; start: number; duration: number }> {
  const project = requireProject(projectId)
  const s = Number(start)
  const len = Math.min(MAX_SECONDS, Number(seconds))
  if (!Number.isFinite(s) || s < 0 || !Number.isFinite(len) || len <= 0.2) throw new Error('Trecho de prévia inválido.')
  const items = listMedia(projectId)
  const media = mediaRefs(items)
  const { doc } = getComposition(projectId)
  validateComposition(doc, media)
  // Começando no meio de uma transição, a prévia volta para o início dela (a interface usa o `start` devolvido).
  const from = safeSliceStart(doc, s)
  const part = sliceComposition(doc, from, s + len)
  if (!part.clips.length) throw new Error('Não há nada na timeline neste trecho.')
  if (bypassEffects) for (const c of part.clips) c.effects = c.effects.filter((e) => effectById(e.type)?.kind === 'audio')
  const full = outputFormat(project, items, doc)
  // 540 no lado menor, mantendo a proporção do projeto.
  const k = 540 / Math.min(full.w, full.h)
  const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2)
  const size = { w: even(full.w * k), h: even(full.h * k), fps: Math.min(30, full.fps) }
  const luts = lutMap()
  const fonts = fontMap()
  const graph = compileComposition(part, media, size, { luts, fonts })
  // Arquivos substituídos no mesmo caminho (mídia ou LUT) precisam invalidar a prévia: entra tamanho + data de cada um.
  const files = [...graph.inputArgs.filter((_, i, a) => a[i - 1] === '-i'), ...luts.values(), ...fonts.values()]
  const key = createHash('sha1').update(JSON.stringify({ g: graph.filter, i: graph.inputArgs, s: from, len, f: files.map(fileStamp) })).digest('hex').slice(0, 20)
  const dir = ensureDir(projectPath(project, 'temp', 'preview'))
  const out = join(dir, `${key}.mp4`)
  if (existsSync(out)) return { path: out, start: from, duration: graph.duration }
  const busy = running.get(out)
  if (busy) return { path: await busy, start: from, duration: graph.duration }

  const job = (async () => {
    const script = join(dir, `${key}.filter`)
    writeFileSync(script, graph.filter, 'utf8')
    const tmp = join(dir, `${key}.part.mp4`)
    const encoders = getSettings().hwAccel && (await hasEncoder('h264_nvenc')) ? ['h264_nvenc', 'libx264'] : ['libx264']
    let lastError = ''
    try {
      for (const enc of encoders) {
        const venc = enc === 'h264_nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '30'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28']
        const ff = await runFfmpeg(compositionArgs(graph, script, venc, tmp), graph.duration, () => {})
        const r = await ff.done
        if (r.code === 0) {
          lastError = ''
          break
        }
        lastError = r.stderr.trim().split(/\r?\n/).slice(-3).join('\n') || 'ffmpeg falhou'
      }
      if (lastError) throw new Error(lastError)
      const { renameSync } = await import('node:fs')
      renameSync(tmp, out)
      prune(dir)
      return out
    } catch (err) {
      log.warn('preview.failed', { projectId, error: (err as Error).message })
      try { unlinkSync(tmp) } catch { /* sem arquivo parcial */ }
      throw err
    } finally {
      try { unlinkSync(script) } catch { /* já removido */ }
      running.delete(out)
    }
  })()
  running.set(out, job)
  return { path: await job, start: from, duration: graph.duration }
}

/** Identifica a versão de um arquivo no disco (tamanho + data de modificação). */
export function fileStamp(path: string): string {
  try {
    const st = statSync(path)
    return `${st.size}-${Math.floor(st.mtimeMs)}`
  } catch {
    return 'ausente'
  }
}

/** Mantém só as prévias mais recentes. */
function prune(dir: string): void {
  const files = readdirSync(dir).filter((f) => f.endsWith('.mp4') && !f.includes('.part.')).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
  files.sort((a, b) => b.t - a.t)
  for (const { f } of files.slice(KEEP)) {
    try { unlinkSync(join(dir, f)) } catch { /* em uso */ }
  }
}
