import { spawn } from 'node:child_process'
import { ffmpegPath } from '../tools'
import { listMedia } from './media'

const cache = new Map<string, Promise<number[]>>()
let active = 0
const waiting: (() => void)[] = []
async function schedule<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  else active++
  try { return await work() }
  finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}
export function waveform(projectId: string, id: string): Promise<number[]> {
  const m = listMedia(projectId).find((x) => x.id === id)
  if (!m || !m.hasAudio || !m.duration) return Promise.resolve([])
  const key = `${m.path}:${m.size}`
  const cached = cache.get(key)
  if (cached) return cached
  const result = schedule(async () => {
    const bin = await ffmpegPath()
    if (!bin) throw new Error('FFmpeg não encontrado')
    return new Promise<number[]>((resolve, reject) => {
      const peaks = new Array<number>(240).fill(0)
      const samples = m.duration! * 8000
      let index = 0
      let pending = Buffer.alloc(0)
      const child = spawn(bin, ['-v', 'error', '-i', m.path, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { windowsHide: true })
      const timer = setTimeout(() => { child.kill(); reject(new Error('Tempo limite ao analisar áudio.')) }, 120000)
      child.stdout.on('data', (chunk: Buffer) => {
        const data = Buffer.concat([pending, chunk])
        const length = data.length - data.length % 2
        for (let i = 0; i < length; i += 2) {
          const bucket = Math.min(239, Math.floor(index++ / samples * 240))
          peaks[bucket] = Math.max(peaks[bucket], Math.abs(data.readInt16LE(i)) / 32768)
        }
        pending = data.subarray(length)
      })
      child.on('error', (err) => { clearTimeout(timer); reject(err) })
      child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(peaks) : reject(new Error('Não foi possível analisar o áudio.')) })
    })
  })
  cache.set(key, result)
  if (cache.size > 100) cache.delete(cache.keys().next().value!)
  result.catch(() => cache.delete(key))
  return result
}
