import { clipEnd, clipLength, dropBrokenTransitions, MIN_CLIP, splitKeyframes, toSource, type Composition } from './composition'

/**
 * Início seguro para recortar: se `start` cai no meio de uma transição, volta para o começo dela
 * (o recorte apagaria a transição e os dois clipes ficariam empilhados no zero).
 */
export function safeSliceStart(doc: Composition, start: number): number {
  let s = start
  for (let moved = true; moved;) {
    moved = false
    for (const c of doc.clips) {
      if (c.transitionIn && c.start < s - 0.001 && s < c.start + c.transitionIn.duration) {
        s = c.start
        moved = true
      }
    }
  }
  return s
}

/**
 * Recorta a composição no intervalo [start, end) e leva tudo para começar em 0:
 * clipes cortados nas bordas (com keyframes e fades ajustados), transições que perderam o par removidas.
 * Usado pela prévia exata de um trecho (renderiza só o que interessa, com o mesmo motor do export).
 */
export function sliceComposition(doc: Composition, start: number, end: number): Composition {
  const out: Composition = structuredClone(doc)
  out.clips = []
  for (const src of doc.clips) {
    if (clipEnd(src) <= start || src.start >= end) continue
    const c = structuredClone(src)
    const head = Math.max(0, start - c.start)
    const tail = Math.max(0, clipEnd(c) - end)
    const len = clipLength(c) - head - tail
    if (len < MIN_CLIP) continue
    if (c.hold > 0) c.hold = len
    if (head > 0) {
      c.keyframes = splitKeyframes(c.keyframes, head).right
      c.in += toSource(c, head)
      c.fadeIn = Math.max(0, c.fadeIn - head)
      c.transitionIn = null
    }
    if (tail > 0) {
      c.keyframes = splitKeyframes(c.keyframes, len).left
      if (c.hold <= 0) c.out -= toSource(c, tail)
      c.fadeOut = Math.max(0, c.fadeOut - tail)
    }
    c.start = Math.max(0, c.start - start)
    c.in = Math.round(c.in * 1000) / 1000
    c.out = Math.round(c.out * 1000) / 1000
    c.start = Math.round(c.start * 1000) / 1000
    out.clips.push(c)
  }
  out.markers = doc.markers.filter((m) => m.time >= start && m.time < end).map((m) => ({ ...m, time: m.time - start }))
  dropBrokenTransitions(out)
  return out
}
