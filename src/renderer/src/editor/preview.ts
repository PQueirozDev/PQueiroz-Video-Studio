import { clipEnd, clipLength, trackClips, type Clip, type Composition } from '@shared/composition'
import { valueAt, type AnimProp } from '@shared/keyframes'

// Cálculo puro do que o preview aproximado mostra num instante: quais clipes estão visíveis,
// com que transformação, opacidade e filtro CSS. A interpolação é a mesma do render.
// Efeitos sem equivalente em CSS são listados em `approximate` para a interface avisar.

export interface LayerState {
  clip: Clip
  trackIndex: number
  /** Tempo dentro do arquivo (s). */
  sourceTime: number
  opacity: number
  transform: string
  transformOrigin: string
  filter: string
  clipPath: string | undefined
  vignette: number
  /** Máscara (CSS mask-image) equivalente ao efeito "Máscara". */
  mask: string | undefined
  /** mix-blend-mode equivalente ao modo de mesclagem da trilha. */
  blend: string | undefined
  volume: number
}

const CSS_BLEND: Record<string, string> = { screen: 'screen', add: 'plus-lighter', lighten: 'lighten', multiply: 'multiply', overlay: 'overlay', softlight: 'soft-light' }

const kv = (c: Clip, p: AnimProp, local: number, fallback: number): number => valueAt(c.keyframes?.[p], local, fallback)

/** Efeitos que o preview não reproduz (só a prévia exata/render mostram). */
const NO_CSS = new Set(['film-grain', 'rgb-split', 'sharpen', 'lut', 'color-match', 'temperature', 'curves'])

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`

/** Máscara do efeito "Máscara" em CSS (gradientes com a mesma forma e borda suave). */
export function cssMask(c: Clip): string | undefined {
  const e = c.effects.find((x) => x.enabled && x.type === 'mask')
  if (!e) return undefined
  const p = e.params
  const inv = Math.round(p.invert) === 1
  const [a, b] = inv ? ['transparent', '#000'] : ['#000', 'transparent']
  if (Math.round(p.shape) === 1) {
    // Retângulo: interseção de duas faixas (horizontal e vertical) com borda suave.
    const band = (dir: string, center: number, size: number): string => {
      const half = size / 2
      const f = p.feather * size
      return `linear-gradient(${dir}, ${b} ${pct(center - half)}, ${a} ${pct(center - half + f)}, ${a} ${pct(center + half - f)}, ${b} ${pct(center + half)})`
    }
    return `${band('to right', p.cx, p.w)}, ${band('to bottom', p.cy, p.h)}`
  }
  const edge = Math.max(0, 1 - p.feather * 2)
  return `radial-gradient(ellipse ${pct(p.w / 2)} ${pct(p.h / 2)} at ${pct(p.cx)} ${pct(p.cy)}, ${a} ${pct(edge)}, ${b} 100%)`
}

export function approximateEffects(c: Clip): string[] {
  return c.effects.filter((e) => e.enabled && NO_CSS.has(e.type)).map((e) => e.type)
}

function cssFilter(c: Clip, local: number, scale: number): { filter: string; vignette: number } {
  const parts: string[] = []
  let vignette = 0
  for (const e of c.effects) {
    if (!e.enabled) continue
    const p = e.params
    switch (e.type) {
      case 'color-adjust': parts.push(`brightness(${1 + p.brightness})`, `contrast(${p.contrast})`, `saturate(${p.saturation})`); break
      case 'color-grade': parts.push(`brightness(${2 ** p.exposure})`, `contrast(${p.contrast})`, `saturate(${p.saturation})`); break
      case 'exposure': parts.push(`brightness(${2 ** p.stops})`); break
      case 'black-white': parts.push('grayscale(1)'); break
      case 'sepia': parts.push('sepia(1)'); break
      case 'gaussian-blur': parts.push(`blur(${(p.sigma * scale).toFixed(2)}px)`); break
      case 'vignette': vignette = Math.max(vignette, p.strength); break
    }
  }
  const b = kv(c, 'brightness', local, 0)
  const ct = kv(c, 'contrast', local, 1)
  const s = kv(c, 'saturation', local, 1)
  if (b !== 0 || ct !== 1 || s !== 1) parts.push(`brightness(${1 + b})`, `contrast(${ct})`, `saturate(${s})`)
  const blur = kv(c, 'blur', local, 0)
  if (blur > 0) parts.push(`blur(${(blur * scale).toFixed(2)}px)`)
  return { filter: parts.join(' '), vignette }
}

/** Aproxima a transição de entrada por CSS (progresso p de 0 a 1). */
function transitionStyle(type: string, p: number): { opacity: number; translate: string; clipPath?: string; scale: number } {
  const off = (1 - p) * 100
  switch (type) {
    case 'slide-left': case 'push-left': case 'smooth-left': return { opacity: 1, translate: `${off}%, 0`, scale: 1 }
    case 'slide-right': case 'smooth-right': return { opacity: 1, translate: `${-off}%, 0`, scale: 1 }
    case 'slide-up': return { opacity: 1, translate: `0, ${off}%`, scale: 1 }
    case 'slide-down': return { opacity: 1, translate: `0, ${-off}%`, scale: 1 }
    case 'wipe-left': return { opacity: 1, translate: '0, 0', clipPath: `inset(0 0 0 ${off}%)`, scale: 1 }
    case 'wipe-right': return { opacity: 1, translate: '0, 0', clipPath: `inset(0 ${off}% 0 0)`, scale: 1 }
    case 'circle-open': return { opacity: 1, translate: '0, 0', clipPath: `circle(${(p * 75).toFixed(1)}% at 50% 50%)`, scale: 1 }
    case 'zoom-in': return { opacity: p, translate: '0, 0', scale: 0.6 + 0.4 * p }
    default: return { opacity: p, translate: '0, 0', scale: 1 }
  }
}

/**
 * Camadas visíveis no tempo `t` (de baixo para cima). `stageScale` = largura do palco / largura de saída,
 * para o desfoque ter o mesmo tamanho aparente do render.
 */
export function layersAt(doc: Composition, t: number, stageScale: number, mediaKind: (id: string) => string | undefined): LayerState[] {
  const out: LayerState[] = []
  doc.tracks.forEach((track, trackIndex) => {
    if (track.kind !== 'video' || track.hidden) return
    for (const c of trackClips(doc, track.id)) {
      if (t < c.start || t >= clipEnd(c)) continue
      if (mediaKind(c.mediaId) === 'audio') continue
      const local = t - c.start
      const len = clipLength(c)
      const tf = c.transform
      let opacity = c.opacity * kv(c, 'opacity', local, 1)
      if (c.fadeIn > 0 && local < c.fadeIn) opacity *= local / c.fadeIn
      if (c.fadeOut > 0 && local > len - c.fadeOut) opacity *= Math.max(0, (len - local) / c.fadeOut)
      let translate = '0, 0'
      let tScale = 1
      let clipPath: string | undefined
      if (c.transitionIn && local < c.transitionIn.duration) {
        const st = transitionStyle(c.transitionIn.type, local / c.transitionIn.duration)
        opacity *= st.opacity
        translate = st.translate
        tScale = st.scale
        clipPath = st.clipPath
      }
      const x = kv(c, 'x', local, tf.x)
      const y = kv(c, 'y', local, tf.y)
      const scale = kv(c, 'scale', local, tf.scale) * kv(c, 'zoom', local, tf.zoom) * tScale
      const rot = kv(c, 'rotation', local, tf.rotation)
      const zoomed = tf.zoom > 1.001 || (c.keyframes?.zoom?.length ?? 0) > 0
      const { filter, vignette } = cssFilter(c, local, stageScale)
      out.push({
        clip: c,
        trackIndex,
        sourceTime: c.hold > 0 ? c.in : c.in + local * c.speed,
        opacity: Math.max(0, Math.min(1, opacity)),
        transform: `translate(${translate}) translate(${(x * 100).toFixed(2)}%, ${(y * 100).toFixed(2)}%) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: zoomed ? `${(tf.anchorX * 100).toFixed(1)}% ${(tf.anchorY * 100).toFixed(1)}%` : '50% 50%',
        filter,
        clipPath,
        vignette,
        mask: cssMask(c),
        blend: track.blend ? CSS_BLEND[track.blend] : undefined,
        volume: track.muted ? 0 : Math.min(1, c.volume * kv(c, 'volume', local, 1))
      })
    }
  })
  return out
}

/** Clipes de áudio (trilhas de áudio) ativos no tempo `t`, com o volume já interpolado. */
export function audioAt(doc: Composition, t: number): { clip: Clip; sourceTime: number; volume: number }[] {
  const out: { clip: Clip; sourceTime: number; volume: number }[] = []
  for (const track of doc.tracks) {
    if (track.kind !== 'audio') continue
    for (const c of trackClips(doc, track.id)) {
      if (t < c.start || t >= clipEnd(c)) continue
      const local = t - c.start
      const len = clipLength(c)
      let v = c.volume * kv(c, 'volume', local, 1)
      if (c.fadeIn > 0 && local < c.fadeIn) v *= local / c.fadeIn
      if (c.fadeOut > 0 && local > len - c.fadeOut) v *= Math.max(0, (len - local) / c.fadeOut)
      out.push({ clip: c, sourceTime: c.in + local * c.speed, volume: track.muted ? 0 : Math.max(0, Math.min(1, v)) })
    }
  }
  return out
}

/** Tamanho de saída (mesma regra do render: lado menor 1080/1440/2160 no formato do projeto). */
export function outputSize(format: string, resolution: string, srcW: number, srcH: number): { w: number; h: number } {
  const short = ({ '1080p': 1080, '1440p': 1440, '4k': 2160 } as Record<string, number>)[resolution] ?? 1080
  const ratio = ({ '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5 } as Record<string, number>)[format] || srcW / srcH || 16 / 9
  const even = (n: number): number => Math.round(n / 2) * 2
  return ratio < 1 ? { w: short, h: even(short / ratio) } : { w: even(short * ratio), h: short }
}
