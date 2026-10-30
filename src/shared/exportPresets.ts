import type { RenderQuality } from './types'

// Presets de exportação por destino. A qualidade/tamanho e os limites daqui também alimentam o Quality Check.

export type ExportAspect = '16:9' | '9:16' | '1:1' | '4:5'
/** Como encaixar um vídeo de outra proporção: barras pretas, cortar para preencher ou fundo desfocado. */
export type FitMode = 'pad' | 'crop' | 'blur'

/** Área segura (fração do quadro) que a interface do app de destino não cobre. */
export interface SafeArea { top: number; bottom: number; left: number; right: number }

export interface ExportPreset {
  id: string
  name: string
  description: string
  aspect: ExportAspect
  /** Lado menor em pixels. */
  shortSide: 720 | 1080 | 1440 | 2160
  fps: 'original' | '30' | '60'
  quality: RenderQuality
  container: 'mp4' | 'mov'
  fit: FitMode
  /** Limite de tamanho do arquivo (bytes): o bitrate é calculado para caber. */
  maxBytes?: number
  /** Duração máxima aceita pelo destino (s). */
  maxDuration?: number
  safe: SafeArea
  /** Loudness esperada (LUFS integrada). */
  loudness: number
}

const NO_UI: SafeArea = { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 }
/** TikTok/Reels/Shorts: legenda, botões e nome cobrem a base e a lateral direita. */
const VERTICAL_UI: SafeArea = { top: 0.1, bottom: 0.22, left: 0.06, right: 0.16 }

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube-1080', name: 'YouTube 1080p', description: '16:9, 1080p, alta qualidade.', aspect: '16:9', shortSide: 1080, fps: 'original', quality: 'alta', container: 'mp4', fit: 'pad', safe: NO_UI, loudness: -14 },
  { id: 'youtube-4k', name: 'YouTube 4K', description: '16:9, 2160p (mais lento).', aspect: '16:9', shortSide: 2160, fps: 'original', quality: 'alta', container: 'mp4', fit: 'pad', safe: NO_UI, loudness: -14 },
  { id: 'shorts', name: 'Shorts / Reels / TikTok', description: '9:16, 1080x1920, até 3 min; vídeo horizontal ganha fundo desfocado.', aspect: '9:16', shortSide: 1080, fps: 'original', quality: 'alta', container: 'mp4', fit: 'blur', maxDuration: 180, safe: VERTICAL_UI, loudness: -14 },
  { id: 'instagram-feed', name: 'Instagram feed', description: '4:5, 1080x1350.', aspect: '4:5', shortSide: 1080, fps: 'original', quality: 'alta', container: 'mp4', fit: 'blur', maxDuration: 3600, safe: NO_UI, loudness: -14 },
  { id: 'quadrado', name: 'Quadrado 1:1', description: '1080x1080 (feed, anúncios).', aspect: '1:1', shortSide: 1080, fps: 'original', quality: 'alta', container: 'mp4', fit: 'blur', safe: NO_UI, loudness: -14 },
  { id: 'whatsapp', name: 'WhatsApp', description: '720p, cabe em 16 MB (envio sem perder qualidade extra).', aspect: '16:9', shortSide: 720, fps: '30', quality: 'equilibrada', container: 'mp4', fit: 'pad', maxBytes: 15.5 * 1024 * 1024, safe: NO_UI, loudness: -14 },
  { id: 'master', name: 'Master (arquivo)', description: 'MOV em qualidade máxima, para guardar ou reeditar.', aspect: '16:9', shortSide: 1080, fps: 'original', quality: 'maxima', container: 'mov', fit: 'pad', safe: NO_UI, loudness: -14 }
]

export const exportPresetById = (id: string | undefined): ExportPreset | undefined => EXPORT_PRESETS.find((p) => p.id === id)

/** Bitrate de vídeo (bits/s) para caber em `maxBytes` com `audioBps` de áudio, com 5% de folga. */
export function bitrateFor(maxBytes: number, duration: number, audioBps = 128_000): number {
  const total = (maxBytes * 8 * 0.95) / Math.max(1, duration)
  return Math.max(150_000, Math.floor(total - audioBps))
}
