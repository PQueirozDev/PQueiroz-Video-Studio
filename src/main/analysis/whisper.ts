import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import type { SubtitleCue } from '@shared/types'
import { log } from '../log'
import { runFfmpeg } from '../media/ffmpeg'

// Transcrição local com o filtro `whisper` do FFmpeg (whisper.cpp). Nada sai do computador.
// Os modelos (whisper.cpp, licença MIT) só são baixados quando o usuário pede, e a integridade
// é conferida pelo SHA-256 publicado no Hugging Face antes de o arquivo ser aceito.

export interface WhisperModel {
  id: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo'
  label: string
  bytes: number
  sha256: string
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'tiny', label: 'Mínimo (rápido, erra mais)', bytes: 77691713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21' },
  { id: 'base', label: 'Leve', bytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  { id: 'small', label: 'Equilibrado (recomendado para português)', bytes: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  { id: 'medium', label: 'Preciso (lento)', bytes: 1533763059, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208' },
  { id: 'large-v3-turbo', label: 'Máxima precisão', bytes: 1624555275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' }
]

const fileName = (m: WhisperModel): string => `ggml-${m.id}.bin`
export const modelsDir = (): string => {
  const d = join(app.getPath('userData'), 'models', 'whisper')
  mkdirSync(d, { recursive: true })
  return d
}

export function requireModel(id: string): WhisperModel {
  const m = WHISPER_MODELS.find((x) => x.id === id)
  if (!m) throw new Error(`Modelo de transcrição desconhecido: ${id}.`)
  return m
}

/** Registro de arquivos já conferidos (tamanho + data): o SHA-256 de 1,5 GB não é recalculado a cada abertura. */
const VERIFIED = 'verified.json'
type Verified = Record<string, { size: number; mtimeMs: number }>
function readVerified(): Verified {
  try { return JSON.parse(readFileSync(join(modelsDir(), VERIFIED), 'utf8')) as Verified } catch { return {} }
}
function markVerified(m: WhisperModel): void {
  const st = statSync(join(modelsDir(), fileName(m)))
  const v = readVerified()
  v[m.id] = { size: st.size, mtimeMs: st.mtimeMs }
  writeFileSync(join(modelsDir(), VERIFIED), JSON.stringify(v), 'utf8')
}

/** Só conta como instalado o arquivo que já passou pela conferência de SHA-256 e não mudou desde então. */
export function installedModels(): WhisperModel['id'][] {
  const dir = modelsDir()
  const verified = readVerified()
  return WHISPER_MODELS.filter((m) => {
    const f = join(dir, fileName(m))
    if (!existsSync(f)) return false
    const st = statSync(f)
    const v = verified[m.id]
    return st.size === m.bytes && v?.size === st.size && v.mtimeMs === st.mtimeMs
  }).map((m) => m.id)
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

const downloads = new Map<string, Promise<void>>()
/** Sem dados por este tempo, o download é abortado (não prende o modelo para sempre). */
const IDLE_TIMEOUT_MS = 30_000

/** Baixa o modelo (chamado só por ação explícita do usuário). Confere tamanho e SHA-256 antes de aceitar. */
export function downloadModel(id: string, onProgress: (p: number) => void): Promise<void> {
  const m = requireModel(id)
  const running = downloads.get(m.id)
  if (running) return running
  const job = (async () => {
    const dir = modelsDir()
    const target = join(dir, fileName(m))
    if (installedModels().includes(m.id)) return
    // Arquivo já presente (cópia manual, download antigo): confere antes de baixar de novo.
    if (existsSync(target) && statSync(target).size === m.bytes && (await sha256File(target)) === m.sha256) {
      markVerified(m)
      onProgress(1)
      return
    }
    const part = `${target}.part`
    const ctrl = new AbortController()
    let idle = setTimeout(() => ctrl.abort(), IDLE_TIMEOUT_MS)
    const hash = createHash('sha256')
    let got = 0
    try {
      const res = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName(m)}`, { signal: ctrl.signal })
      if (!res.ok || !res.body) throw new Error(`Falha ao baixar o modelo (HTTP ${res.status}).`)
      const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
      body.on('data', (chunk: Buffer) => {
        clearTimeout(idle)
        idle = setTimeout(() => ctrl.abort(), IDLE_TIMEOUT_MS)
        got += chunk.length
        // Nunca grava mais que o tamanho oficial (resposta errada ou maliciosa não enche o disco).
        if (got > m.bytes) { body.destroy(new Error('O servidor enviou mais dados que o modelo oficial. Download cancelado.')); return }
        hash.update(chunk)
        onProgress(Math.min(0.999, got / m.bytes))
      })
      await pipeline(body, createWriteStream(part))
      const digest = hash.digest('hex')
      if (got !== m.bytes || digest !== m.sha256) throw new Error('O arquivo baixado não confere com o modelo oficial (tamanho ou SHA-256). Nada foi instalado.')
      renameSync(part, target)
      markVerified(m)
      log.info('whisper.model_installed', { model: m.id, bytes: got })
      onProgress(1)
    } catch (err) {
      try { unlinkSync(part) } catch { /* já removido */ }
      if (ctrl.signal.aborted) throw new Error('O download ficou parado por mais de 30 s e foi cancelado. Tente de novo.')
      throw err
    } finally {
      clearTimeout(idle)
    }
  })().finally(() => downloads.delete(m.id))
  downloads.set(m.id, job)
  return job
}

export interface TranscribeOptions {
  model: string
  /** 'pt', 'en' ou 'auto'. */
  language: string
  /** Trecho do arquivo (s); omitido = arquivo inteiro. */
  start?: number
  duration?: number
}

/** Converte a saída JSON (uma linha por segmento, tempos em ms) do filtro em legendas. */
export function parseWhisperJson(text: string, offset = 0): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let seg: { start?: number; end?: number; text?: string }
    try { seg = JSON.parse(line) } catch { continue }
    const t = (seg.text ?? '').replace(/\s+/g, ' ').trim()
    // O whisper às vezes devolve só pontuação, "[Música]" ou reticências em trechos sem fala.
    if (!t || /^[\s\-.…,!?]*$/.test(t) || /^\[.*\]$/.test(t) || /^\(.*\)$/.test(t)) continue
    const start = offset + (seg.start ?? 0) / 1000
    const end = offset + (seg.end ?? 0) / 1000
    if (!(end > start)) continue
    const prev = cues.at(-1)
    cues.push({ id: `w${cues.length + 1}`, start: prev ? Math.max(start, prev.end) : start, end, text: t })
  }
  return cues.filter((c) => c.end - c.start >= 0.05)
}

/**
 * O whisper devolve tempos grosseiros (às vezes a legenda começa no silêncio antes da fala).
 * Com os silêncios medidos pelo FFmpeg, o início vai para o fim do silêncio e o fim para o começo do próximo.
 */
export function alignToSpeech(cues: SubtitleCue[], silences: { start: number; end: number }[]): SubtitleCue[] {
  return cues.map((c) => {
    let { start, end } = c
    const s0 = silences.find((s) => start >= s.start - 0.01 && start < s.end && s.end < end - 0.3)
    if (s0) start = Math.max(c.start, s0.end - 0.05)
    const s1 = silences.find((s) => end > s.start && end <= s.end + 0.01 && s.start > start + 0.3)
    if (s1) end = Math.min(c.end, s1.start + 0.15)
    return { ...c, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }
  })
}

export async function transcribe(file: string, opts: TranscribeOptions, onProgress: (p: number) => void, total: number | null, onStart?: (child: ChildProcess) => void): Promise<SubtitleCue[]> {
  const m = requireModel(opts.model)
  if (!installedModels().includes(m.id)) throw new Error('Baixe o modelo de transcrição antes (Configurações → Transcrição).')
  const language = ['pt', 'en', 'auto'].includes(opts.language) ? opts.language : 'auto'
  const dir = modelsDir()
  // Caminhos relativos e ASCII: o whisper.cpp não abre caminhos com acento no Windows.
  const out = `t-${randomUUID()}.json`
  const args = ['-y']
  if (opts.start) args.push('-ss', String(opts.start))
  if (opts.duration) args.push('-t', String(opts.duration))
  args.push('-i', file, '-vn', '-af', `aresample=16000,whisper=model=${fileName(m)}:language=${language}:queue=30:destination=${out}:format=json`, '-f', 'null', '-')
  const ff = await runFfmpeg(args, opts.duration ?? total, onProgress, dir)
  onStart?.(ff.child)
  const res = await ff.done
  const outPath = join(dir, out)
  try {
    if (res.code !== 0) throw new Error(res.stderr.trim().split(/\r?\n/).slice(-2).join('\n') || 'A transcrição falhou.')
    const cues = existsSync(outPath) ? parseWhisperJson(readFileSync(outPath, 'utf8'), opts.start ?? 0) : []
    // O último bloco do whisper às vezes devolve tempos além do fim do áudio.
    const limit = (opts.start ?? 0) + (opts.duration ?? total ?? Infinity)
    return cues.filter((c) => c.start < limit - 0.1).map((c) => ({ ...c, end: Math.min(c.end, limit) }))
  } finally {
    try { unlinkSync(outPath) } catch { /* sem saída */ }
  }
}
