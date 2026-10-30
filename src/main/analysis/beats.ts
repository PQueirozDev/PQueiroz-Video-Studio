// Análise musical leve, sem Python: envelope de onsets por fluxo espectral, BPM por autocorrelação
// (com preferência suave por ~120 BPM, como o librosa) e rastreamento de batidas por programação
// dinâmica (Ellis, 2007). Roda sobre PCM mono já decodificado pelo FFmpeg.

export interface BeatAnalysis {
  bpm: number
  /** Batidas (s). */
  beats: number[]
  /** Transientes fortes (s): bons pontos para impacto, flash ou corte seco. */
  onsets: number[]
  /** Energia (dB RMS) a cada 0,5 s, para achar quedas e subidas de intensidade. */
  energy: number[]
  /** Mudanças bruscas de intensidade (s), por exemplo a entrada de um drop. */
  intensityChanges: { time: number; deltaDb: number }[]
  /** Confiança do tempo (0–1): pico da autocorrelação em relação à média. */
  confidence: number
}

/**
 * Tudo fica dentro de uma função sem dependências externas: assim o mesmo código roda direto
 * ou numa worker thread (via toString), sem travar o processo principal em músicas longas.
 */
export function createBeatAnalyzer(): { analyzeBeats(pcm: Float32Array, sr: number): BeatAnalysis; onsetEnvelope(pcm: Float32Array, sr: number): { env: Float64Array; rate: number } } {
  const FRAME = 1024
  const HOP = 256

  /** FFT radix-2 in-place (re/im), tamanho potência de 2. */
  function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) {
        ;[re[i], re[j]] = [re[j], re[i]]
        ;[im[i], im[j]] = [im[j], im[i]]
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len
      const wr = Math.cos(ang)
      const wi = Math.sin(ang)
      for (let i = 0; i < n; i += len) {
        let cr = 1
        let ci = 0
        for (let k = 0; k < len / 2; k++) {
          const a = i + k
          const b = a + len / 2
          const tr = re[b] * cr - im[b] * ci
          const ti = re[b] * ci + im[b] * cr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
          const nr = cr * wr - ci * wi
          ci = cr * wi + ci * wr
          cr = nr
        }
      }
    }
  }

  /** Envelope de onsets (fluxo espectral log-comprimido, retificado e sem a média local). */
  function onsetEnvelope(pcm: Float32Array, sr: number): { env: Float64Array; rate: number } {
    const frames = Math.max(0, Math.floor((pcm.length - FRAME) / HOP) + 1)
    const env = new Float64Array(frames)
    const win = new Float64Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)))
    const bins = FRAME / 2
    const lowBins = Math.max(2, Math.round((200 * FRAME) / sr))
    let prev = new Float64Array(bins)
    const re = new Float64Array(FRAME)
    const im = new Float64Array(FRAME)
    for (let f = 0; f < frames; f++) {
      const off = f * HOP
      for (let i = 0; i < FRAME; i++) {
        re[i] = pcm[off + i] * win[i]
        im[i] = 0
      }
      fft(re, im)
      const mag = new Float64Array(bins)
      let flux = 0
      let low = 0
      for (let k = 1; k < bins; k++) {
        mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
        const d = mag[k] - prev[k]
        if (d > 0) {
          flux += d
          if (k <= lowBins) low += d
        }
      }
      // Média por banda: o grave (bumbo, baixo) pesa tanto quanto o espectro inteiro,
      // senão chimbais e ruído dominam e as batidas caem no contratempo.
      env[f] = flux / (bins - 1) + low / lowBins
      prev = mag
    }
    const rate = sr / HOP
    // Remove a média local (~0,5 s) para que trechos altos não pareçam um onset contínuo.
    const half = Math.round(rate * 0.25)
    const out = new Float64Array(frames)
    let acc = 0
    const pre = new Float64Array(frames + 1)
    for (let i = 0; i < frames; i++) pre[i + 1] = pre[i] + env[i]
    for (let i = 0; i < frames; i++) {
      const a = Math.max(0, i - half)
      const b = Math.min(frames, i + half + 1)
      acc = (pre[b] - pre[a]) / (b - a)
      out[i] = Math.max(0, env[i] - acc)
    }
    return { env: out, rate }
  }

  function estimateTempo(env: Float64Array, rate: number, minBpm = 60, maxBpm = 200): { lag: number; confidence: number } {
    const minLag = Math.floor((60 * rate) / maxBpm)
    const maxLag = Math.ceil((60 * rate) / minBpm)
    const n = env.length
    let best = minLag
    let bestScore = -Infinity
    const scores: number[] = []
    const ac = (lag: number): number => {
      let s = 0
      for (let i = lag; i < n; i++) s += env[i] * env[i - lag]
      return s / (n - lag)
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * rate) / lag
      // Preferência log-normal em torno de 120 BPM (desvio de 1 oitava), evita escolher o dobro/metade.
      const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2)
      const score = ac(lag) * prior
      scores.push(score)
      if (score > bestScore) {
        bestScore = score
        best = lag
      }
    }
    // Refino sub-amostra (parábola nos vizinhos).
    const y0 = best > minLag ? scores[best - minLag - 1] : bestScore
    const y2 = best < maxLag ? scores[best - minLag + 1] : bestScore
    const denom = y0 - 2 * bestScore + y2
    const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const confidence = bestScore > 0 ? Math.max(0, Math.min(1, 1 - mean / bestScore)) : 0
    return { lag: best + shift, confidence }
  }

  function trackBeats(env: Float64Array, period: number, tightness = 100): number[] {
    const n = env.length
    if (!n || period < 1) return []
    let std = 0
    const mean = env.reduce((a, b) => a + b, 0) / n
    for (const v of env) std += (v - mean) ** 2
    std = Math.sqrt(std / n) || 1
    const local = Float64Array.from(env, (v) => v / std)
    const score = new Float64Array(n)
    const back = new Int32Array(n).fill(-1)
    const lo = Math.round(period / 2)
    const hi = Math.round(period * 2)
    for (let t = 0; t < n; t++) {
      // Recomeçar do zero também é uma opção: um caminho com pontuação negativa não deve ser arrastado.
      let bestVal = 0
      let bestPrev = -1
      for (let p = t - hi; p <= t - lo; p++) {
        if (p < 0) continue
        const v = score[p] - tightness * Math.log((t - p) / period) ** 2
        if (v > bestVal) {
          bestVal = v
          bestPrev = p
        }
      }
      score[t] = local[t] + (bestPrev >= 0 ? bestVal : 0)
      back[t] = bestPrev
    }
    // Começa pela melhor posição no último período e volta pelo caminho.
    let t = n - 1
    let best = -Infinity
    for (let i = Math.max(0, n - Math.ceil(period)); i < n; i++) if (score[i] > best) { best = score[i]; t = i }
    const beats: number[] = []
    while (t >= 0) {
      beats.push(t)
      t = back[t]
    }
    return beats.reverse()
  }

  function pickOnsets(env: Float64Array, rate: number): number[] {
    const n = env.length
    if (!n) return []
    const mean = env.reduce((a, b) => a + b, 0) / n
    const std = Math.sqrt(env.reduce((a, v) => a + (v - mean) ** 2, 0) / n)
    const thr = mean + 1.5 * std
    const gap = Math.round(rate * 0.08)
    const out: number[] = []
    let last = -Infinity
    for (let i = 1; i < n - 1; i++) {
      if (env[i] >= thr && env[i] >= env[i - 1] && env[i] > env[i + 1] && i - last >= gap) {
        out.push(i)
        last = i
      }
    }
    return out
  }

  function analyzeBeats(pcm: Float32Array, sr: number): BeatAnalysis {
    const { env, rate } = onsetEnvelope(pcm, sr)
    const { lag, confidence } = estimateTempo(env, rate)
    // Sem ataques de verdade (silêncio, tom contínuo) não existe grade de batidas para inventar.
    const evidence = env.reduce((a, b) => a + b, 0) / Math.max(1, env.length)
    const rhythmic = evidence > 1e-3 && confidence >= 0.3
    const beatFrames = rhythmic ? trackBeats(env, lag) : []
    // Cada quadro do envelope representa o centro da janela de FFT.
    const toSec = (f: number): number => Math.round(((f * HOP + FRAME / 2) / sr) * 1000) / 1000
    const block = Math.round(sr * 0.5)
    const energy: number[] = []
    for (let i = 0; i + block <= pcm.length; i += block) {
      let s = 0
      for (let j = i; j < i + block; j++) s += pcm[j] * pcm[j]
      energy.push(Math.round(10 * Math.log10(s / block + 1e-12) * 10) / 10)
    }
    const intensityChanges: BeatAnalysis['intensityChanges'] = []
    for (let i = 2; i < energy.length; i++) {
      const before = (energy[i - 1] + energy[i - 2]) / 2
      const d = energy[i] - before
      if (Math.abs(d) >= 6 && energy[i] > -50) intensityChanges.push({ time: i * 0.5, deltaDb: Math.round(d * 10) / 10 })
    }
    return {
      bpm: rhythmic ? Math.round(((60 * rate) / lag) * 10) / 10 : 0,
      beats: beatFrames.map(toSec),
      onsets: evidence > 1e-3 ? pickOnsets(env, rate).map(toSec) : [],
      energy,
      intensityChanges,
      confidence: Math.round(confidence * 100) / 100
    }
  }

  return { analyzeBeats, onsetEnvelope }
}

const local = createBeatAnalyzer()
export const analyzeBeats = local.analyzeBeats
export const onsetEnvelope = local.onsetEnvelope
