import { planAutoEdit, type AutoAssets, type AutoStyle, AUTO_STYLES } from '@shared/autoStudio'
import type { MediaAnalysis } from '@shared/analysis'
import { analyze } from '../analysis/ipc'
import { editComposition } from '../composition/store'
import { bus } from '../events'
import { log } from '../log'
import { listMedia } from '../media/media'
import { hubItems, useHubItem } from '../packs/packs'
import { getStyle, projectStyle } from '../styles/styles'

// Auto Studio no processo principal: analisa os arquivos, junta os recursos do Asset Hub e aplica o plano
// como UMA edição (Ctrl+Z desfaz tudo). Usado pelo botão da interface e pela ferramenta do agente.

export interface AutoStudioRequest {
  style: AutoStyle
  mediaIds: string[]
  musicId?: string | null
  targetDuration: number
  title?: string
  /** Estilo da Style Memory (padrão: o do projeto/cliente). null = sem estilo. */
  styleId?: string | null
}

export interface AutoStudioResult {
  duration: number
  clips: number
  notes: string[]
}

/** Recursos do pacote essencial usados por estilo (se o pacote faltar, o Auto Studio segue sem eles). */
const STYLE_ASSETS: Record<AutoStyle, { intro?: string; look?: string; cut?: string; accent?: string; drift?: string[]; whoosh?: string }> = {
  gaming: { intro: 'impacto', look: 'look-valorant', cut: 'zoom-punch', accent: 'flash-branco', whoosh: 'whoosh-fast' },
  shorts: { intro: 'legenda-caixa', look: 'look-vibrante', drift: ['zoom-in-suave', 'zoom-out-suave'] },
  vlog: { intro: 'lower-third' },
  cinema: { intro: 'cinema', look: 'look-cinema' }
}

const running = new Set<string>()

export async function runAutoStudio(projectId: string, req: AutoStudioRequest, signal?: AbortSignal): Promise<AutoStudioResult> {
  if (!AUTO_STYLES.some((s) => s.id === req?.style)) throw new Error('Estilo do Auto Studio desconhecido.')
  if (!Array.isArray(req.mediaIds) || !req.mediaIds.length || req.mediaIds.length > 50) throw new Error('Escolha de 1 a 50 vídeos.')
  if (running.has(projectId)) throw new Error('O Auto Studio já está trabalhando neste projeto.')
  running.add(projectId)
  const progress = (p: number | null, text: string, done = false, error?: string): void => {
    bus.emit('task:progress', { projectId, task: 'analise', text: `Auto Studio: ${text}`, progress: p, done, error })
  }
  try {
    const media = listMedia(projectId)
    const videos = req.mediaIds.map((id) => {
      const m = media.find((x) => x.id === id)
      if (!m || m.kind !== 'video') throw new Error('O Auto Studio usa apenas vídeos do projeto.')
      return m
    })
    const musicItem = req.musicId ? media.find((x) => x.id === req.musicId) : null
    if (req.musicId && (!musicItem || musicItem.kind !== 'audio')) throw new Error('A música precisa ser um arquivo de áudio do projeto.')

    const analyses: MediaAnalysis[] = []
    for (const [i, v] of videos.entries()) {
      progress(i / (videos.length + 1), `analisando ${v.name}`)
      analyses.push(await analyze(projectId, v.id))
    }
    let music: Parameters<typeof planAutoEdit>[0]['music'] = null
    if (musicItem) {
      progress(videos.length / (videos.length + 1), `ouvindo a música ${musicItem.name}`)
      const a = await analyze(projectId, musicItem.id, true)
      music = { mediaId: musicItem.id, duration: musicItem.duration ?? a.duration, beats: a.music?.beats ?? [], bpm: a.music?.bpm ?? 0 }
    }

    const want = STYLE_ASSETS[req.style]
    const items = hubItems()
    const item = (id?: string) => (id ? items.find((i) => i.packId === 'pq-essentials' && i.id === id) : undefined)
    const assets: AutoAssets = {
      intro: item(want.intro)?.title,
      look: item(want.look)?.preset,
      cutMotion: item(want.cut)?.preset,
      accent: item(want.accent)?.preset,
      drift: want.drift?.map((d) => item(d)?.preset).filter((p): p is NonNullable<typeof p> => Boolean(p))
    }
    if (want.whoosh && item(want.whoosh)) {
      const m = await useHubItem(projectId, `pq-essentials/${want.whoosh}`)
      assets.whooshId = m.id
      assets.whooshLength = m.duration ?? 0.5
    }
    // Style Memory: o look, a cara do título, o ritmo e a mixagem do estilo têm prioridade sobre os padrões.
    const learned = req.styleId === null ? null : req.styleId ? getStyle(req.styleId) : projectStyle(projectId).style
    if (learned) {
      // O look aprendido vale mesmo vazio (estilo "sem cor" não herda o look forte do estilo base).
      assets.look = learned.look.length ? { kind: 'look', effects: learned.look } : undefined
      if (learned.title && assets.intro) assets.intro = { ...assets.intro, style: { ...assets.intro.style, ...learned.title } }
    }
    progress(0.95, 'montando a edição')
    const plan = planAutoEdit({ style: req.style, videos: analyses, music, targetDuration: Number(req.targetDuration) || 30, title: req.title, assets,
      ...(learned ? { pace: learned.pacing.medianClip || undefined, mix: { normalize: learned.audio.normalize, targetLufs: learned.audio.targetLufs, duck: learned.audio.duck }, musicVolume: learned.audio.musicVolume } : {}) })
    if (learned) plan.notes.unshift(`Estilo "${learned.name}" aplicado.`)
    if (signal?.aborted) throw new Error('Pedido cancelado: a edição não foi aplicada.')
    // Plano interno (validado comando a comando): o limite maior vale só para o Auto Studio.
    editComposition(projectId, plan.commands, { maxCommands: 5000 })
    log.info('auto.studio', { projectId, style: req.style, clips: plan.clips, duration: plan.duration, commands: plan.commands.length })
    progress(1, 'edição pronta', true)
    return { duration: plan.duration, clips: plan.clips, notes: plan.notes }
  } catch (err) {
    progress(null, 'não foi possível montar', true, (err as Error).message)
    throw err
  } finally {
    running.delete(projectId)
  }
}
