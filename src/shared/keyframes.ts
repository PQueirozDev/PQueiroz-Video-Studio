// Keyframes: a mesma interpolação serve o preview (valueAt, no navegador) e o render
// (toExpr gera a expressão do FFmpeg; samples alimenta o sendcmd). Assim o que se vê é o que sai.

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'hold'
export const EASES: { id: Ease; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'in', label: 'Acelerando' },
  { id: 'out', label: 'Desacelerando' },
  { id: 'inOut', label: 'Suave' },
  { id: 'hold', label: 'Segurar' }
]

export interface Keyframe {
  /** Tempo dentro do clipe (s, 0 = início do clipe na timeline). */
  t: number
  v: number
  /** Curva do trecho que COMEÇA neste keyframe. */
  ease: Ease
}

export type AnimProp = 'opacity' | 'volume' | 'x' | 'y' | 'scale' | 'rotation' | 'zoom' | 'brightness' | 'contrast' | 'saturation' | 'blur'

export interface AnimPropDef {
  id: AnimProp
  label: string
  min: number
  max: number
  step: number
  /** Valor neutro (sem animação). */
  neutral: number
  unit?: string
}

export const ANIM_PROPS: AnimPropDef[] = [
  { id: 'opacity', label: 'Opacidade', min: 0, max: 1, step: 0.01, neutral: 1 },
  { id: 'volume', label: 'Volume', min: 0, max: 2, step: 0.01, neutral: 1 },
  { id: 'x', label: 'Posição X', min: -1, max: 1, step: 0.005, neutral: 0 },
  { id: 'y', label: 'Posição Y', min: -1, max: 1, step: 0.005, neutral: 0 },
  { id: 'scale', label: 'Escala', min: 0.05, max: 1, step: 0.01, neutral: 1 },
  { id: 'rotation', label: 'Rotação', min: -360, max: 360, step: 0.5, neutral: 0, unit: '°' },
  { id: 'zoom', label: 'Zoom', min: 1, max: 4, step: 0.01, neutral: 1, unit: '×' },
  { id: 'brightness', label: 'Brilho', min: -1, max: 1, step: 0.01, neutral: 0 },
  { id: 'contrast', label: 'Contraste', min: 0, max: 3, step: 0.01, neutral: 1 },
  { id: 'saturation', label: 'Saturação', min: 0, max: 3, step: 0.01, neutral: 1 },
  { id: 'blur', label: 'Desfoque', min: 0, max: 40, step: 0.5, neutral: 0 }
]
export const animProp = (id: string): AnimPropDef | undefined => ANIM_PROPS.find((p) => p.id === id)
export const MAX_KEYFRAMES = 64

export function ease(e: Ease, p: number): number {
  switch (e) {
    case 'in': return p * p
    case 'out': return p * (2 - p)
    case 'inOut': return p * p * (3 - 2 * p)
    case 'hold': return 0
    default: return p
  }
}

export function valueAt(keys: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!keys?.length) return fallback
  if (t <= keys[0].t) return keys[0].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t < b.t) return a.v + (b.v - a.v) * ease(a.ease, (t - a.t) / (b.t - a.t))
  }
  return keys[keys.length - 1].v
}

const n = (v: number): string => Number(v.toFixed(5)).toString()

function easeExpr(e: Ease, p: string): string {
  switch (e) {
    case 'in': return `(${p})*(${p})`
    case 'out': return `(${p})*(2-(${p}))`
    case 'inOut': return `(${p})*(${p})*(3-2*(${p}))`
    case 'hold': return '0'
    default: return p
  }
}

/**
 * Expressão do FFmpeg equivalente a valueAt (sem aspas simples, para ir entre aspas no filtro).
 * `tv` é a variável de tempo do filtro (t, T...). `map` transforma cada valor (ex.: graus → radianos).
 */
export function toExpr(keys: Keyframe[] | undefined, fallback: number, tv = 't', map: (v: number) => number = (v) => v): string {
  if (!keys?.length) return n(map(fallback))
  let expr = n(map(keys[keys.length - 1].v))
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i]
    const b = keys[i + 1]
    const p = `(${tv}-${n(a.t)})/${n(b.t - a.t)}`
    const seg = `${n(map(a.v))}+${n(map(b.v) - map(a.v))}*${easeExpr(a.ease, p)}`
    expr = `if(lt(${tv},${n(b.t)}),${seg},${expr})`
  }
  return `if(lt(${tv},${n(keys[0].t)}),${n(map(keys[0].v))},${expr})`
}

/** Valores quadro a quadro (para filtros que só mudam por comando, como opacidade e desfoque). */
export function samples(keys: Keyframe[], length: number, fps: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = []
  const frames = Math.max(1, Math.ceil(length * fps))
  let last: number | null = null
  for (let f = 0; f <= frames; f++) {
    const t = f / fps
    const v = Math.round(valueAt(keys, t, keys[0].v) * 1000) / 1000
    if (v !== last) out.push({ t, v })
    last = v
  }
  return out
}

/** Normaliza uma lista vinda de fora: ordena, limita ao clipe e à faixa da propriedade, sem tempos repetidos. */
export function normalizeKeys(prop: AnimPropDef, keys: unknown, length: number): Keyframe[] {
  if (!Array.isArray(keys)) return []
  const valid = keys
    .filter((k): k is Keyframe => !!k && Number.isFinite((k as Keyframe).t) && Number.isFinite((k as Keyframe).v))
    .map((k) => ({
      t: Math.round(Math.min(length, Math.max(0, k.t)) * 1000) / 1000,
      v: Math.min(prop.max, Math.max(prop.min, k.v)),
      ease: (EASES.some((e) => e.id === k.ease) ? k.ease : 'linear') as Ease
    }))
    .sort((a, b) => a.t - b.t)
  const out: Keyframe[] = []
  for (const k of valid) {
    if (out.length && Math.abs(out[out.length - 1].t - k.t) < 0.001) out[out.length - 1] = k
    else out.push(k)
  }
  return out.slice(0, MAX_KEYFRAMES)
}
