import type { RenderQuality } from '@shared/types'
import type { CompiledGraph } from './compose'

// Parâmetros de codificação compartilhados pela fila de render e pela montagem da timeline.

export const QUALITY = {
  rapida: { preset: 'veryfast', crf: 23, nv: 'p2', cq: 26 },
  equilibrada: { preset: 'medium', crf: 20, nv: 'p4', cq: 23 },
  alta: { preset: 'slow', crf: 17, nv: 'p6', cq: 19 },
  maxima: { preset: 'slower', crf: 14, nv: 'p7', cq: 16 }
} as const

export function encoderArgs(encoder: string, quality: RenderQuality): string[] {
  const q = QUALITY[quality]
  return encoder === 'h264_nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', q.nv, '-rc', 'vbr', '-cq', String(q.cq), '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf)]
}

/**
 * Comando completo para renderizar uma composição. O grafo vai num arquivo (`-/filter_complex`)
 * para não estourar o limite de 32 mil caracteres da linha de comando do Windows.
 */
export function compositionArgs(g: CompiledGraph, filterScript: string, venc: string[], output: string): string[] {
  return ['-y', ...g.inputArgs, '-/filter_complex', filterScript, '-map', g.video, '-map', g.audio,
    ...venc, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(g.duration),
    '-movflags', '+faststart', output]
}
