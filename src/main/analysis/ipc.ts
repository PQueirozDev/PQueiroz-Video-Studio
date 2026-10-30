import type { Highlight, HighlightOptions, MediaAnalysis } from '@shared/analysis'
import { findHighlights, keepRanges, rangesToCommands } from '@shared/highlights'
import { beatMontage, type BeatMontageOptions } from '@shared/music'
import type { SubtitleDocument } from '@shared/types'
import { bus } from '../events'
import { listMedia } from '../media/media'
import { loadSubtitles, saveSubtitles, subtitleSource } from '../media/subtitles'
import { requireProject } from '../projects/projects'
import { killTree } from '../util'
import { analyzeMedia, cachedAnalysis } from './analyze'
import { alignToSpeech, downloadModel, installedModels, transcribe, WHISPER_MODELS } from './whisper'

type Handle = (channel: string, fn: (...args: any[]) => unknown) => void

const running = new Map<string, AbortController>()

function mediaOf(projectId: string, mediaId: string) {
  requireProject(projectId)
  const m = listMedia(projectId).find((x) => x.id === mediaId)
  if (!m) throw new Error('Arquivo não encontrado no projeto.')
  return m
}

export async function analyze(projectId: string, mediaId: string, music = false): Promise<MediaAnalysis> {
  const m = mediaOf(projectId, mediaId)
  const key = `${projectId}:${mediaId}`
  const busy = running.get(key)
  if (busy) throw new Error('Este arquivo já está sendo analisado.')
  const ctrl = new AbortController()
  running.set(key, ctrl)
  const emit = (progress: number | null, text: string, extra: { done?: boolean; error?: string } = {}): void => {
    bus.emit('task:progress', { projectId, task: 'analise', text: `${m.name}: ${text}`, progress, ...extra })
  }
  try {
    const r = await analyzeMedia(projectId, m, { music, signal: ctrl.signal }, (p, text) => emit(p, text))
    emit(1, 'análise concluída', { done: true })
    return r
  } catch (err) {
    emit(null, 'falha na análise', { done: true, error: (err as Error).message })
    throw err
  } finally {
    running.delete(key)
  }
}

const transcriptions = new Map<string, () => void>()

export function registerAnalysisIpc(handle: Handle): void {
  handle('analysis:cached', (projectId: string, mediaId: string) => cachedAnalysis(projectId, mediaOf(projectId, mediaId)))
  handle('analysis:run', (projectId: string, mediaId: string, music?: boolean) => analyze(projectId, mediaId, Boolean(music)))
  handle('analysis:cancel', (projectId: string) => {
    for (const [k, c] of running) if (k.startsWith(`${projectId}:`)) c.abort()
    for (const [k, cancel] of transcriptions) if (k.startsWith(`${projectId}:`)) cancel()
  })
  handle('analysis:highlights', async (projectId: string, mediaIds: string[], opts: HighlightOptions): Promise<Highlight[]> => {
    if (!Array.isArray(mediaIds) || !mediaIds.length) throw new Error('Escolha pelo menos um vídeo.')
    const length = Number(opts?.length)
    const count = Number(opts?.count)
    if (!(length >= 1 && length <= 120) || !(count >= 1 && count <= 100)) throw new Error('Duração (1–120 s) ou quantidade (1–100) inválida.')
    const analyses: MediaAnalysis[] = []
    for (const id of mediaIds) analyses.push(await analyze(projectId, id).catch(() => { throw new Error(`Não foi possível analisar ${mediaOf(projectId, id).name}.`) }))
    return findHighlights(analyses, { length, count, mode: opts.mode === 'gameplay' ? 'gameplay' : 'geral' })
  })
  handle('analysis:silencePlan', async (projectId: string, mediaId: string, minSilence = 0.7, padding = 0.15) => {
    const a = await analyze(projectId, mediaId)
    const ranges = keepRanges(a, Math.max(0.3, Number(minSilence) || 0.7), Math.min(0.5, Math.max(0, Number(padding) || 0)))
    const removed = a.duration - ranges.reduce((s, r) => s + r.end - r.start, 0)
    return { ranges, removedSeconds: Math.round(removed * 10) / 10, commands: rangesToCommands(mediaId, ranges) }
  })
  handle('analysis:beatMontage', async (projectId: string, highlights: Highlight[], musicId: string, opts: BeatMontageOptions) => {
    const music = mediaOf(projectId, musicId)
    if (!Array.isArray(highlights) || !highlights.length || highlights.length > 500) throw new Error('Escolha de 1 a 500 trechos para a montagem.')
    // Trechos vêm da interface/agente: só vídeos do projeto, com limites dentro do arquivo.
    const clean: Highlight[] = highlights.map((h) => {
      const v = mediaOf(projectId, h?.mediaId)
      const start = Number(h.start)
      const end = Number(h.end)
      if (v.kind !== 'video') throw new Error(`"${v.name}" não é um vídeo.`)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || (v.duration != null && end > v.duration + 0.05)) throw new Error(`Trecho inválido em "${v.name}".`)
      return { mediaId: v.id, start, end, score: Number(h.score) || 0, reasons: [] }
    })
    const a = await analyze(projectId, musicId, true)
    if (!a.music) throw new Error('Não foi possível detectar as batidas desta música.')
    return beatMontage(clean, a.music.beats, musicId, music.duration ?? a.duration, opts)
  })

  // Transcrição local
  handle('transcription:models', () => ({ models: WHISPER_MODELS, installed: installedModels() }))
  handle('transcription:download', async (id: string) => {
    await downloadModel(id, (p) => bus.emit('task:progress', { projectId: '', task: 'download', text: `Baixando modelo de transcrição (${Math.round(p * 100)}%)`, progress: p }))
    bus.emit('task:progress', { projectId: '', task: 'download', text: 'Modelo de transcrição instalado', progress: 1, done: true })
    return installedModels()
  })
  handle('transcription:run', (projectId: string, source: string, opts: { model: string; language: string }) => runTranscription(projectId, source, opts))
}

/** Transcrição local de um vídeo do projeto (interface e agente). */
export async function runTranscription(projectId: string, source: string, opts: { model: string; language: string }): Promise<SubtitleDocument> {
  subtitleSource(projectId, source)
  const key = `${projectId}:${source}`
  if (transcriptions.has(key)) throw new Error('Este vídeo já está sendo transcrito.')
  const m = listMedia(projectId).find((x) => x.path === source)
  let cancelled = false
  let child: { pid?: number } | null = null
  // Um cancelamento antes do processo existir fica pendente e é aplicado assim que ele nasce.
  transcriptions.set(key, () => { cancelled = true; if (child) killTree(child.pid) })
  const emit = (progress: number | null, text: string, extra: { done?: boolean; error?: string } = {}): void => {
    bus.emit('task:progress', { projectId, task: 'transcricao', text, progress, ...extra })
  }
  try {
    emit(0, 'Transcrevendo (local)...')
    const cues = await transcribe(source, { model: opts?.model ?? 'small', language: opts?.language ?? 'pt' }, (p) => emit(p, 'Transcrevendo (local)...'), m?.duration ?? null,
      (c) => { child = c; if (cancelled) killTree(c.pid) })
    if (cancelled) throw new Error('Transcrição cancelada.')
    if (!cues.length) throw new Error('Nenhuma fala reconhecida neste vídeo.')
    // Refina os tempos pelos silêncios reais (análise em cache; só para arquivos importados).
    const silences = m ? (await analyze(projectId, m.id).catch(() => null))?.silences ?? [] : []
    if (cancelled) throw new Error('Transcrição cancelada.')
    const doc = saveSubtitles(projectId, source, { ...loadSubtitles(projectId, source), cues: alignToSpeech(cues, silences) })
    emit(1, `Transcrição pronta: ${cues.length} legendas`, { done: true })
    return doc
  } catch (err) {
    emit(null, 'Falha na transcrição', { done: true, error: (err as Error).message })
    throw err
  } finally {
    transcriptions.delete(key)
  }
}
