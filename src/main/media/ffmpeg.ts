import { spawn, type ChildProcess } from 'node:child_process'
import { ffmpegPath, ffprobePath } from '../tools'
import { exec, ownGroup } from '../util'

export interface ProbeResult {
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  hasAudio: boolean
  rotation: number
}

function parseRate(rate?: string): number | null {
  if (!rate) return null
  const [n, d] = rate.split('/').map(Number)
  if (!n || !d) return null
  return Math.round((n / d) * 100) / 100
}

export async function probe(file: string): Promise<ProbeResult> {
  const bin = await ffprobePath()
  if (!bin) throw new Error('ffprobe não encontrado')
  const r = await exec(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30000 })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'ffprobe falhou')
  const info = JSON.parse(r.stdout) as {
    format?: { duration?: string }
    streams?: Array<{
      codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string
      r_frame_rate?: string; duration?: string; side_data_list?: Array<{ rotation?: number }>; tags?: { rotate?: string }
    }>
  }
  const v = info.streams?.find((s) => s.codec_type === 'video')
  const a = info.streams?.find((s) => s.codec_type === 'audio')
  const rotation = Math.abs(Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0))
  const rotated = rotation === 90 || rotation === 270
  const dur = Number(info.format?.duration ?? v?.duration ?? a?.duration)
  return {
    duration: Number.isFinite(dur) && dur > 0 ? dur : null,
    width: (rotated ? v?.height : v?.width) ?? null,
    height: (rotated ? v?.width : v?.height) ?? null,
    fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate),
    codec: v?.codec_name ?? a?.codec_name ?? null,
    hasAudio: Boolean(a),
    rotation
  }
}

/** Gera uma miniatura JPG (320 px de largura máx.) de um vídeo ou imagem. */
export async function thumbnail(file: string, out: string, atSeconds = 0): Promise<boolean> {
  const bin = await ffmpegPath()
  if (!bin) return false
  const args = ['-y', '-v', 'error']
  if (atSeconds > 0) args.push('-ss', atSeconds.toFixed(2))
  args.push('-i', file, '-frames:v', '1', '-vf', "scale='min(320,iw)':-2", '-q:v', '4', out)
  const r = await exec(bin, args, { timeoutMs: 30000 })
  return r.code === 0
}

export interface FfmpegRun {
  child: ChildProcess
  done: Promise<{ code: number; stderr: string }>
}

/**
 * Executa o ffmpeg com `-progress pipe:1` e reporta o progresso real (0–1)
 * a partir de `out_time_us` sobre a duração conhecida.
 */
export async function runFfmpeg(args: string[], duration: number | null, onProgress: (p: number) => void): Promise<FfmpegRun> {
  const bin = await ffmpegPath()
  if (!bin) throw new Error('FFmpeg não encontrado')
  const child = spawn(bin, ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true, detached: ownGroup })
  let stderr = ''
  let buf = ''
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
      if (m && duration) onProgress(Math.min(0.999, Number(m[1]) / 1e6 / duration))
      if (line === 'progress=end') onProgress(1)
    }
  })
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-8000)
  })
  const done = new Promise<{ code: number; stderr: string }>((res) => {
    child.on('error', (err) => res({ code: -1, stderr: String(err) }))
    child.on('close', (code) => res({ code: code ?? -1, stderr }))
  })
  return { child, done }
}

let encodersCache: string | null = null

export async function hasEncoder(name: string): Promise<boolean> {
  if (encodersCache === null) {
    const bin = await ffmpegPath()
    encodersCache = bin ? (await exec(bin, ['-hide_banner', '-encoders'], { timeoutMs: 15000 })).stdout : ''
  }
  return encodersCache.includes(` ${name} `)
}

export async function ffmpegVersion(): Promise<string | null> {
  const bin = await ffmpegPath()
  if (!bin) return null
  const r = await exec(bin, ['-version'], { timeoutMs: 10000 })
  return /ffmpeg version (\S+)/.exec(r.stdout)?.[1] ?? null
}
