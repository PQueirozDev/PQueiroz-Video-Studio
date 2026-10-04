import { join } from 'node:path'
import type { Project } from '@shared/types'
import { run } from '../db'
import { bus } from '../events'
import { ensureDir } from '../files'
import { projectPath } from '../projects/projects'
import { getSettings } from '../settings'
import { runFfmpeg, type ProbeResult } from './ffmpeg'

// Proxies: cópias leves (540p H.264) para o player não engasgar com 4K/HEVC/bitrate alto.
// Só o preview usa o proxy — edições e renders sempre partem do arquivo original.

const queue: (() => Promise<void>)[] = []
let busy = false

export function needsProxy(info: ProbeResult, size: number): boolean {
  const pixels = (info.width ?? 0) * (info.height ?? 0)
  const mbps = info.duration ? (size * 8) / info.duration / 1e6 : 0
  return pixels > 1920 * 1080 || (info.codec !== 'h264' && info.codec !== 'vp9') || mbps > 25
}

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  while (queue.length) await queue.shift()!().catch(() => {})
  busy = false
}

export function queueProxy(project: Project, mediaId: string, src: string, duration: number | null): void {
  if (!getSettings().useProxies) return
  queue.push(async () => {
    const out = join(ensureDir(projectPath(project, 'temp', 'proxies')), `${mediaId}.mp4`)
    const ff = await runFfmpeg(['-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:540,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], duration, () => {})
    const res = await ff.done
    if (res.code === 0) {
      run('UPDATE media SET proxy = ? WHERE id = ?', out, mediaId)
      bus.emit('media:changed', { projectId: project.id })
    }
  })
  void pump()
}
