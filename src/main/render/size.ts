import type { AspectFormat, Resolution } from '@shared/types'

/** Tamanho final pelo formato do projeto e pela resolução (lado menor = 1080/1440/2160). */
export function targetSize(format: AspectFormat, resolution: Resolution, srcW: number, srcH: number): { w: number; h: number } {
  const short = { '1080p': 1080, '1440p': 1440, '4k': 2160 }[resolution]
  const ratio = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, original: srcW / srcH }[format] || srcW / srcH
  const even = (n: number): number => Math.round(n / 2) * 2
  return ratio < 1 ? { w: short, h: even(short / ratio) } : { w: even(short * ratio), h: short }
}

/** Encaixa no quadro sem distorcer, completando com preto. */
export function fitFilter(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
}
