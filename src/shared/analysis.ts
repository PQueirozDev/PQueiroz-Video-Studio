// Resultado da análise automática de um arquivo (cenas, pretos, silêncios, volume, movimento, música).
// Gerado em src/main/analysis/analyze.ts e guardado em cache por arquivo.

export const ANALYSIS_VERSION = 1
/** Resolução das curvas (s por ponto). */
export const CURVE_STEP = 0.5

export interface TimeRange {
  start: number
  end: number
}

export interface MediaAnalysis {
  version: number
  mediaId: string
  duration: number
  /** Cortes de cena detectados (s). */
  scenes: number[]
  /** Movimento/mudança visual média por janela de CURVE_STEP (0–1). */
  motion: number[]
  black: TimeRange[]
  silences: TimeRange[]
  loudness: {
    /** Loudness integrada (LUFS), null se não houver áudio. */
    integrated: number | null
    /** Pico real (dBTP). */
    truePeak: number | null
    range: number | null
  }
  /** Energia do áudio (dB RMS) por janela de CURVE_STEP. */
  energy: number[]
  /** Transientes fortes (s): tiros, batidas, impactos. */
  transients: number[]
  /** Pico acima de -1 dBTP: risco de distorção na exportação. */
  clippingRisk: boolean
  music: {
    bpm: number
    beats: number[]
    confidence: number
    intensityChanges: { time: number; deltaDb: number }[]
  } | null
  /** true quando a análise musical foi tentada (mesmo sem achar ritmo), para não repetir. */
  musicAnalyzed: boolean
  analyzedAt: number
}

export interface Highlight {
  mediaId: string
  start: number
  end: number
  /** 0–1, relativo aos outros candidatos do mesmo pedido. */
  score: number
  reasons: string[]
}

export interface HighlightOptions {
  /** Duração de cada trecho (s). */
  length: number
  count: number
  /** 'gameplay' valoriza som alto e repentino (tiros, impactos); 'geral' equilibra fala, movimento e cenas. */
  mode: 'gameplay' | 'geral'
}
