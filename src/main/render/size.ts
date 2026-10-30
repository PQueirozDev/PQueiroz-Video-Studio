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

/** Tamanho por proporção e lado menor (presets de exportação). */
export function presetSize(aspect: '16:9' | '9:16' | '1:1' | '4:5', shortSide: number): { w: number; h: number } {
  const ratio = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 }[aspect]
  const even = (n: number): number => Math.round(n / 2) * 2
  return ratio < 1 ? { w: shortSide, h: even(shortSide / ratio) } : { w: even(shortSide * ratio), h: shortSide }
}

/**
 * Encaixe em outra proporção: "pad" = barras pretas; "crop" = preenche cortando as bordas;
 * "blur" = vídeo inteiro no centro sobre ele mesmo ampliado e desfocado (padrão de Shorts/Reels).
 */
export function fitModeFilter(w: number, h: number, mode: 'pad' | 'crop' | 'blur'): string {
  if (mode === 'crop') return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1`
  if (mode === 'blur') {
    return `split=2[bg][fg];[bg]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bilinear,crop=${w}:${h},gblur=sigma=28,eq=brightness=-0.08[b];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[f];[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1`
  }
  return fitFilter(w, h)
}
