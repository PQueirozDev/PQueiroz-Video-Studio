import { execFile } from 'node:child_process'
import { effectById, normalizeParams } from '@shared/fx'
import { getComposition } from '../composition/store'
import { listMedia } from '../media/media'
import { ffmpegPath } from '../tools'

// Correspondência de cor automática: mede média e desvio de cada canal num quadro do meio de cada clipe
// (arquivo original, antes de efeitos) e calcula ganho/desvio do efeito "Correspondência de cor" para o
// clipe alvo ficar com a mesma distribuição de cor do clipe de referência.

interface Stats { mean: [number, number, number]; std: [number, number, number] }

async function frameStats(bin: string, path: string, t: number): Promise<Stats> {
  const buf = await new Promise<Buffer>((resolve, reject) => {
    execFile(bin, ['-v', 'error', '-ss', t.toFixed(3), '-i', path, '-frames:v', '1', '-vf', 'scale=96:54:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      { encoding: 'buffer', windowsHide: true, timeout: 30000, maxBuffer: 1 << 20 }, (err, out) => (err ? reject(new Error('Não foi possível ler um quadro do vídeo.')) : resolve(out)))
  })
  const n = Math.floor(buf.length / 3)
  if (n < 10) throw new Error('Quadro vazio ao medir a cor.')
  const mean: [number, number, number] = [0, 0, 0]
  const sq: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = buf[i * 3 + c] / 255
      mean[c] += v
      sq[c] += v * v
    }
  }
  const std = mean.map((m, c) => Math.sqrt(Math.max(0, sq[c] / n - (m / n) ** 2))) as Stats['std']
  return { mean: mean.map((m) => m / n) as Stats['mean'], std }
}

export async function colorMatch(projectId: string, clipId: string, refClipId: string): Promise<Record<string, number>> {
  const { doc } = getComposition(projectId)
  const media = listMedia(projectId)
  const clipOf = (id: string): { path: string; t: number } => {
    const c = doc.clips.find((x) => x.id === id)
    if (!c) throw new Error('Clipe não encontrado.')
    const m = media.find((x) => x.id === c.mediaId)
    if (!m || m.kind === 'audio') throw new Error('A correspondência de cor só vale para vídeo e imagem.')
    return { path: m.path, t: m.kind === 'image' || c.hold > 0 ? c.in : c.in + (c.out - c.in) / 2 }
  }
  if (clipId === refClipId) throw new Error('Escolha outro clipe como referência.')
  const bin = await ffmpegPath()
  if (!bin) throw new Error('FFmpeg não encontrado.')
  const a = clipOf(clipId)
  const b = clipOf(refClipId)
  const [target, ref] = await Promise.all([frameStats(bin, a.path, a.t), frameStats(bin, b.path, b.t)])
  const keys = ['r', 'g', 'b'] as const
  const raw: Record<string, number> = {}
  keys.forEach((k, c) => {
    // Imagem quase lisa num canal (desvio ~0) não dá para esticar: fica só o ajuste de média.
    const gain = target.std[c] > 0.01 ? ref.std[c] / target.std[c] : 1
    const g = Math.min(2, Math.max(0.5, gain))
    raw[`${k}Gain`] = Math.round(g * 1000) / 1000
    raw[`${k}Offset`] = Math.round(Math.min(0.3, Math.max(-0.3, ref.mean[c] - g * target.mean[c])) * 1000) / 1000
  })
  return normalizeParams(effectById('color-match')!, raw)
}
