import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANALYSIS_VERSION, CURVE_STEP, type MediaAnalysis, type TimeRange } from '@shared/analysis'
import type { MediaItem } from '@shared/types'
import { ensureDir } from '../files'
import { log } from '../log'
import { projectPath, requireProject } from '../projects/projects'
import { ffmpegPath } from '../tools'
import { killTree, ownGroup } from '../util'
import { analyzeBeatsInWorker } from './beatsWorker'

// Análise automática de um arquivo em duas passadas leves do FFmpeg:
//  - vídeo: decodifica a 10 qps em 160 px (cenas, pretos, movimento) — barato mesmo em gameplay longa;
//  - áudio: silêncio e loudness (EBU R128) no log + PCM mono 11 kHz processado em streaming
//    (energia, transientes) — sem guardar o áudio inteiro na memória.
// O log também é lido linha a linha (gameplays de horas geram dezenas de MB de log).
// O resultado fica em cache por arquivo (caminho + tamanho + data), então nada é reprocessado.

const AUDIO_RATE = 11025
const BLOCK_SECONDS = 0.1
/** Música é analisada com PCM completo (BPM/batidas); limite para não pesar na memória. */
const MAX_MUSIC_SECONDS = 20 * 60

const round = (v: number): number => Math.round(v * 1000) / 1000

/** Lê o log da passada de vídeo linha a linha. */
export function videoLogParser(): { push(line: string): void; result(): { scenes: number[]; motion: number[]; black: TimeRange[] } } {
  const scenes: number[] = []
  const motionSum: number[] = []
  const motionN: number[] = []
  const black: TimeRange[] = []
  let t: number | null = null
  return {
    push(line) {
      const pts = /pts_time:(-?[\d.]+)/.exec(line)
      if (pts) { t = Number(pts[1]); return }
      const sc = /lavfi\.scene_score=([\d.]+)/.exec(line)
      if (sc && t != null) {
        const v = Number(sc[1])
        // Cortes muito próximos (flashes, menus) contam uma vez só.
        if (v >= 0.3 && t > 0 && (!scenes.length || t - scenes[scenes.length - 1] > 0.4)) scenes.push(Math.round(t * 100) / 100)
        const b = Math.floor(t / CURVE_STEP)
        motionSum[b] = (motionSum[b] ?? 0) + v
        motionN[b] = (motionN[b] ?? 0) + 1
        return
      }
      const bl = /black_start:([\d.]+)\s+black_end:([\d.]+)/.exec(line)
      if (bl) black.push({ start: Number(bl[1]), end: Number(bl[2]) })
    },
    result() {
      const motion: number[] = []
      for (let i = 0; i < motionSum.length; i++) {
        // Cortes de cena saturam a curva; o que interessa é movimento contínuo.
        motion.push(motionN[i] ? Math.round(Math.min(1, (motionSum[i] / motionN[i]) * 8) * 1000) / 1000 : 0)
      }
      return { scenes, motion, black }
    }
  }
}

/** Lê o log da passada de áudio linha a linha (silêncios e resumo EBU R128). */
export function audioLogParser(duration: number): { push(line: string): void; result(): { silences: TimeRange[]; loudness: MediaAnalysis['loudness'] } } {
  const silences: TimeRange[] = []
  let open: number | null = null
  let inSummary = false
  const loudness: MediaAnalysis['loudness'] = { integrated: null, truePeak: null, range: null }
  return {
    push(line) {
      const s = /silence_start: (-?[\d.]+)/.exec(line)
      if (s) open = Math.max(0, Number(s[1]))
      const e = /silence_end: ([\d.]+)/.exec(line)
      if (e && open != null) { silences.push({ start: round(open), end: round(Number(e[1])) }); open = null }
      if (line.includes('Summary:')) inSummary = true
      if (!inSummary) return
      const i = /I:\s+(-?[\d.]+) LUFS/.exec(line)
      if (i) loudness.integrated = Number(i[1]) > -70 ? Number(i[1]) : null
      const pk = /Peak:\s+(-?[\d.]+) dBFS/.exec(line)
      if (pk) loudness.truePeak = Number(pk[1])
      const lra = /LRA:\s+([\d.]+) LU/.exec(line)
      if (lra) loudness.range = Number(lra[1])
    },
    result() {
      const out = [...silences]
      if (open != null) out.push({ start: round(open), end: round(duration) })
      return { silences: out, loudness }
    }
  }
}

export function parseVideoLog(text: string): ReturnType<ReturnType<typeof videoLogParser>['result']> {
  const p = videoLogParser()
  for (const line of text.split(/\r?\n/)) p.push(line)
  return p.result()
}

export function parseAudioLog(text: string, duration: number): ReturnType<ReturnType<typeof audioLogParser>['result']> {
  const p = audioLogParser(duration)
  for (const line of text.split(/\r?\n/)) p.push(line)
  return p.result()
}

/** Energia (dB) e transientes a partir dos blocos RMS de 100 ms. */
export function energyAndTransients(blocksDb: number[]): { energy: number[]; transients: number[] } {
  const per = Math.round(CURVE_STEP / BLOCK_SECONDS)
  const energy: number[] = []
  for (let i = 0; i < blocksDb.length; i += per) {
    const slice = blocksDb.slice(i, i + per)
    const lin = slice.reduce((a, d) => a + 10 ** (d / 10), 0) / slice.length
    energy.push(Math.round(10 * Math.log10(lin + 1e-12) * 10) / 10)
  }
  // Transiente: salto de pelo menos 9 dB sobre a média dos 400 ms anteriores, acima do ruído de fundo.
  const transients: number[] = []
  for (let i = 4; i < blocksDb.length; i++) {
    const before = (blocksDb[i - 1] + blocksDb[i - 2] + blocksDb[i - 3] + blocksDb[i - 4]) / 4
    if (blocksDb[i] > -35 && blocksDb[i] - before >= 9 && (!transients.length || i * BLOCK_SECONDS - transients[transients.length - 1] > 0.25)) transients.push(round(i * BLOCK_SECONDS))
  }
  return { energy, transients }
}

/** RMS em blocos de exatamente 0,1 s (limites fracionários em amostras, sem deriva em arquivos longos). */
export function blockMeter(rate: number): { push(sample: number): void; flush(): void; blocks: number[] } {
  const blocks: number[] = []
  let acc = 0
  let n = 0
  let index = 0
  let next = rate * BLOCK_SECONDS
  return {
    blocks,
    push(v) {
      acc += v * v
      n++
      index++
      if (index >= next) {
        blocks.push(10 * Math.log10(acc / n + 1e-12))
        acc = 0
        n = 0
        next = rate * BLOCK_SECONDS * (blocks.length + 1)
      }
    },
    flush() {
      if (n > 0) blocks.push(10 * Math.log10(acc / n + 1e-12))
      acc = 0
      n = 0
    }
  }
}

interface Pass { child: ChildProcess; done: Promise<{ code: number; tail: string }> }

async function ffmpegPass(args: string[], onLine: (line: string) => void, signal: AbortSignal | undefined, onStdout?: (b: Buffer) => void): Promise<Pass> {
  if (signal?.aborted) throw new Error('Análise cancelada.')
  const bin = await ffmpegPath()
  if (!bin) throw new Error('FFmpeg não encontrado')
  if (signal?.aborted) throw new Error('Análise cancelada.')
  const child = spawn(bin, ['-hide_banner', '-nostats', ...args], { windowsHide: true, detached: ownGroup })
  const abort = (): void => killTree(child.pid)
  signal?.addEventListener('abort', abort, { once: true })
  let partial = ''
  let tail = ''
  child.stderr.on('data', (d: Buffer) => {
    const text = partial + d.toString()
    const lines = text.split(/\r?\n/)
    partial = lines.pop() ?? ''
    for (const line of lines) onLine(line)
    tail = (tail + d.toString()).slice(-4000) // só para a mensagem de erro
  })
  if (onStdout) child.stdout.on('data', onStdout)
  else child.stdout.resume()
  const done = new Promise<{ code: number; tail: string }>((res) => {
    child.on('error', (err) => res({ code: -1, tail: String(err) }))
    child.on('close', (code) => {
      if (partial) onLine(partial)
      signal?.removeEventListener('abort', abort)
      res({ code: code ?? -1, tail })
    })
  })
  return { child, done }
}

export interface AnalyzeOptions {
  /** Força BPM/batidas mesmo em vídeo (ex.: trilha dentro de um clipe). */
  music?: boolean
  signal?: AbortSignal
}

function cacheFile(projectId: string, m: MediaItem): string {
  const st = statSync(m.path)
  const key = createHash('sha1').update(`${ANALYSIS_VERSION}|${m.path}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)
  return join(ensureDir(projectPath(requireProject(projectId), 'cache', 'analysis')), `${m.id}-${key}.json`)
}

export function cachedAnalysis(projectId: string, m: MediaItem): MediaAnalysis | null {
  try {
    const f = cacheFile(projectId, m)
    if (!existsSync(f)) return null
    const a = JSON.parse(readFileSync(f, 'utf8')) as MediaAnalysis
    return a.version === ANALYSIS_VERSION ? a : null
  } catch {
    return null
  }
}

const failMessage = (tail: string, fallback: string): string => tail.trim().split(/\r?\n/).slice(-2).join('\n') || fallback

export async function analyzeMedia(projectId: string, m: MediaItem, opts: AnalyzeOptions = {}, onProgress?: (p: number, text: string) => void): Promise<MediaAnalysis> {
  const cached = cachedAnalysis(projectId, m)
  const wantsMusic = opts.music || m.kind === 'audio'
  if (cached && (!wantsMusic || cached.musicAnalyzed || !m.hasAudio)) return cached
  if (m.kind === 'image') throw new Error('Imagens não têm o que analisar no tempo.')
  const { signal } = opts
  const duration = m.duration ?? 0
  const cancelled = (): boolean => Boolean(signal?.aborted)

  let video = { scenes: [] as number[], motion: [] as number[], black: [] as TimeRange[] }
  if (m.kind === 'video') {
    onProgress?.(0, 'Analisando imagem (cenas, movimento, pretos)...')
    const parser = videoLogParser()
    const p = await ffmpegPass(['-i', m.path, '-map', '0:v:0', '-an', '-vf', "fps=10,scale=160:-2,blackdetect=d=0.2:pix_th=0.10,select='gte(scene\\,0)',metadata=print:key=lavfi.scene_score", '-f', 'null', '-'], parser.push, signal)
    const r = await p.done
    if (cancelled()) throw new Error('Análise cancelada.')
    if (r.code !== 0) throw new Error(failMessage(r.tail, 'Falha ao analisar o vídeo.'))
    video = parser.result()
  }

  let audio: ReturnType<ReturnType<typeof audioLogParser>['result']> = { silences: [], loudness: { integrated: null, truePeak: null, range: null } }
  let curves = { energy: [] as number[], transients: [] as number[] }
  let music: MediaAnalysis['music'] = null
  let musicAnalyzed = false
  if (m.hasAudio) {
    onProgress?.(0.5, 'Analisando áudio (volume, silêncios, transientes)...')
    const meter = blockMeter(AUDIO_RATE)
    let carry: Buffer = Buffer.alloc(0)
    const keep = wantsMusic && duration <= MAX_MUSIC_SECONDS
    const pcm = keep ? new Float32Array(Math.ceil((duration + 1) * AUDIO_RATE)) : null
    let w = 0
    const parser = audioLogParser(duration)
    const p = await ffmpegPass(['-i', m.path, '-map', '0:a:0', '-vn', '-af', `silencedetect=n=-40dB:d=0.5,ebur128=peak=true,aresample=${AUDIO_RATE},aformat=sample_fmts=s16:channel_layouts=mono`, '-f', 's16le', '-'], parser.push, signal, (chunk) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i) / 32768
        meter.push(v)
        if (pcm && w < pcm.length) pcm[w++] = v
      }
      carry = buf.subarray(usable)
    })
    const r = await p.done
    if (cancelled()) throw new Error('Análise cancelada.')
    if (r.code !== 0) throw new Error(failMessage(r.tail, 'Falha ao analisar o áudio.'))
    meter.flush()
    audio = parser.result()
    curves = energyAndTransients(meter.blocks)
    if (pcm && w > AUDIO_RATE * 4) {
      onProgress?.(0.9, 'Detectando BPM e batidas...')
      const b = await analyzeBeatsInWorker(pcm.subarray(0, w), AUDIO_RATE, signal)
      musicAnalyzed = true
      if (b.beats.length >= 4) music = { bpm: b.bpm, beats: b.beats, confidence: b.confidence, intensityChanges: b.intensityChanges }
    }
  }
  if (cancelled()) throw new Error('Análise cancelada.')
  const result: MediaAnalysis = {
    version: ANALYSIS_VERSION,
    mediaId: m.id,
    duration,
    ...video,
    ...audio,
    ...curves,
    clippingRisk: (audio.loudness.truePeak ?? -99) > -1,
    music,
    musicAnalyzed,
    analyzedAt: Date.now()
  }
  writeFileSync(cacheFile(projectId, m), JSON.stringify(result), 'utf8')
  log.info('analysis.done', { projectId, mediaId: m.id, scenes: result.scenes.length, silences: result.silences.length, bpm: music?.bpm ?? null })
  onProgress?.(1, 'Análise concluída')
  return result
}
