import type { EffectLayer, Fill, ImageDoc, ImageLayer, Layer, ShapeLayer, TextLayer } from '@shared/image'
import type { FontFile } from '@shared/fonts'
import { api } from '@/lib/format'
import kaushanUrl from '@/assets/fonts/KaushanScript-Regular.ttf?url'
import pacificoUrl from '@/assets/fonts/Pacifico-Regular.ttf?url'

/** Fontes manuscritas que vêm com o app (licença OFL). */
const BUNDLED: { family: string; url: string }[] = [{ family: 'Kaushan Script', url: kaushanUrl }, { family: 'Pacifico', url: pacificoUrl }]

// Motor de renderização único do Image Studio: a mesma função desenha a prévia do editor,
// as miniaturas dos templates, as versões e a exportação final em alta resolução.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// ————— Imagens e fontes —————

const images = new Map<string, Promise<HTMLImageElement | null>>()

export function loadImage(path: string): Promise<HTMLImageElement | null> {
  let p = images.get(path)
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous' // o protocolo studio-media responde com CORS: o canvas não fica "contaminado"
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = api.app.toMediaUrl(path)
    })
    images.set(path, p)
  }
  return p
}

let fontsReady: Promise<void> | null = null
export let fontFiles: FontFile[] = []

/** Registra as fontes da biblioteca (e de E:\aqc) para o Canvas. */
export function registerFonts(): Promise<void> {
  if (!fontsReady) {
    for (const b of BUNDLED) {
      try {
        document.fonts.add(new FontFace(b.family, `url("${b.url}")`, { weight: '400' }))
      } catch {
        /* sem a fonte embutida o Canvas usa a de reserva */
      }
    }
    fontsReady = api.image.fonts().then((list) => {
      fontFiles = list
      for (const f of list) {
        try {
          const face = new FontFace(f.family, `url("${api.app.toMediaUrl(f.path)}")`, { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' })
          document.fonts.add(face)
        } catch {
          /* arquivo de fonte inválido: o Canvas usa a fonte de reserva */
        }
      }
    }).catch(() => undefined)
  }
  return fontsReady
}

export function fontString(l: Pick<TextLayer, 'italic' | 'weight' | 'size' | 'font'>, size = l.size): string {
  return `${l.italic ? 'italic ' : ''}${l.weight} ${Math.max(1, size)}px "${l.font}", "Segoe UI", system-ui, sans-serif`
}

export interface Loaded { images: Map<string, HTMLImageElement> }

/** Carrega imagens e fontes de um documento antes de desenhar (a exportação nunca sai sem fonte). */
export async function prepare(doc: ImageDoc): Promise<Loaded> {
  await registerFonts()
  const map = new Map<string, HTMLImageElement>()
  const srcs = [...new Set(doc.layers.filter((l): l is ImageLayer => l.type === 'image').map((l) => l.src))]
  const loaded = await Promise.all(srcs.map(loadImage))
  srcs.forEach((s, i) => loaded[i] && map.set(s, loaded[i]!))
  await Promise.all(doc.layers.filter((l): l is TextLayer => l.type === 'text').map((t) => document.fonts.load(fontString(t, 40), t.text).catch(() => null)))
  return { images: map }
}

// ————— Utilitários de desenho —————

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Converte uma cor para rgba com a opacidade pedida (para os efeitos). */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim()
  if (c.startsWith('#')) {
    let hex = c.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((x) => x + x).join('')
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => x.trim())
    return `rgba(${r},${g},${b},${alpha})`
  }
  return c
}

/** Preenchimento no espaço local da camada (origem no centro, caixa w×h). */
export function makeFill(ctx: Ctx, fill: Fill, w: number, h: number): string | CanvasGradient {
  if (fill.type === 'solid') return fill.color
  if (fill.type === 'linear') {
    const a = (fill.angle * Math.PI) / 180
    const dx = Math.sin(a), dy = -Math.cos(a)
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy)
    const g = ctx.createLinearGradient(-dx * half, -dy * half, dx * half, dy * half)
    for (const s of fill.stops) g.addColorStop(s.offset, s.color)
    return g
  }
  const cx = fill.cx * w - w / 2, cy = fill.cy * h - h / 2
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, fill.r * Math.max(w, h)))
  for (const s of fill.stops) g.addColorStop(s.offset, s.color)
  return g
}

const BLEND: Record<Layer['blend'], GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', 'soft-light': 'soft-light', lighter: 'lighter'
}

function applyShadow(ctx: Ctx, l: Layer): void {
  if (l.shadow) {
    ctx.shadowColor = l.shadow.color
    ctx.shadowBlur = l.shadow.blur
    ctx.shadowOffsetX = l.shadow.x
    ctx.shadowOffsetY = l.shadow.y
  }
}

function clearShadow(ctx: Ctx): void {
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

function shapePath(ctx: Ctx, l: ShapeLayer): void {
  const { w, h } = l
  ctx.beginPath()
  switch (l.shape) {
    case 'rect':
    case 'line':
      ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(l.shape === 'line' ? h / 2 : l.radius, w / 2, h / 2))
      break
    case 'ellipse':
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'triangle':
      ctx.moveTo(0, -h / 2)
      ctx.lineTo(w / 2, h / 2)
      ctx.lineTo(-w / 2, h / 2)
      ctx.closePath()
      break
    case 'burst': {
      const n = Math.max(3, l.points)
      for (let i = 0; i < n * 2; i++) {
        const a = (Math.PI * i) / n - Math.PI / 2
        const r = i % 2 === 0 ? 1 : l.innerRatio
        const x = Math.cos(a) * (w / 2) * r, y = Math.sin(a) * (h / 2) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      break
    }
    case 'blob': {
      const rand = rng(hash(l.id))
      const n = 8
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (Math.PI * 2 * i) / n
        const r = 0.78 + rand() * 0.22
        return [Math.cos(a) * (w / 2) * r, Math.sin(a) * (h / 2) * r] as const
      })
      const mid = (i: number): [number, number] => {
        const a = pts[i % n], b = pts[(i + 1) % n]
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      }
      const start = mid(n - 1)
      ctx.moveTo(start[0], start[1])
      for (let i = 0; i < n; i++) {
        const m = mid(i)
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1])
      }
      ctx.closePath()
      break
    }
  }
}

function drawShape(ctx: Ctx, l: ShapeLayer): void {
  shapePath(ctx, l)
  applyShadow(ctx, l)
  ctx.fillStyle = makeFill(ctx, l.fill, l.w, l.h)
  ctx.fill()
  clearShadow(ctx)
  if (l.stroke) {
    ctx.lineWidth = l.stroke.width
    ctx.strokeStyle = l.stroke.color
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
}

function drawImage(ctx: Ctx, l: ImageLayer, img: HTMLImageElement | undefined): void {
  const { w, h } = l
  if (!img) {
    // Imagem ausente: placeholder discreto (nunca some sem avisar).
    ctx.fillStyle = 'rgba(139,92,246,0.15)'
    ctx.strokeStyle = 'rgba(139,92,246,0.6)'
    ctx.lineWidth = 2
    ctx.setLineDash([10, 8])
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    ctx.setLineDash([])
    return
  }
  const iw = img.naturalWidth, ih = img.naturalHeight
  let sx = 0, sy = 0, sw = iw, sh = ih, dx = -w / 2, dy = -h / 2, dw = w, dh = h
  if (l.fit === 'cover') {
    const s = Math.max(w / iw, h / ih)
    sw = w / s
    sh = h / s
    sx = (iw - sw) * l.focusX
    sy = (ih - sh) * l.focusY
  } else if (l.fit === 'contain') {
    const s = Math.min(w / iw, h / ih)
    dw = iw * s
    dh = ih * s
    dx = -dw / 2
    dy = -dh / 2
  }
  ctx.save()
  if (l.radius > 0) {
    ctx.beginPath()
    ctx.roundRect(dx, dy, dw, dh, Math.min(l.radius, dw / 2, dh / 2))
    if (l.shadow) {
      // Sombra da caixa arredondada antes de recortar.
      applyShadow(ctx, l)
      ctx.fillStyle = '#000'
      ctx.fill()
      clearShadow(ctx)
    }
    ctx.clip()
  } else applyShadow(ctx, l)
  if (l.flipX) ctx.scale(-1, 1)
  const filters: string[] = []
  if (l.brightness !== 1) filters.push(`brightness(${l.brightness})`)
  if (l.contrast !== 1) filters.push(`contrast(${l.contrast})`)
  if (l.saturation !== 1) filters.push(`saturate(${l.saturation})`)
  if (filters.length) ctx.filter = filters.join(' ')
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  ctx.restore()
  if (l.stroke) {
    ctx.beginPath()
    ctx.roundRect(dx, dy, dw, dh, Math.min(l.radius, dw / 2, dh / 2))
    ctx.lineWidth = l.stroke.width
    ctx.strokeStyle = l.stroke.color
    ctx.stroke()
  }
}

// ————— Texto —————

export interface TextLayout { size: number; lines: { text: string; width: number }[]; lineHeight: number; height: number }

function setTextStyle(ctx: Ctx, l: TextLayer, size: number): void {
  ctx.font = fontString(l, size)
  ;(ctx as CanvasRenderingContext2D).letterSpacing = `${(l.letterSpacing * size) / Math.max(1, l.size)}px`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
}

function wrap(ctx: Ctx, text: string, maxW: number): { text: string; width: number }[] {
  const out: { text: string; width: number }[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push({ text: '', width: 0 })
      continue
    }
    let line = words[0]
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`
      if (ctx.measureText(next).width <= maxW) line = next
      else {
        out.push({ text: line, width: ctx.measureText(line).width })
        line = word
      }
    }
    out.push({ text: line, width: ctx.measureText(line).width })
  }
  return out
}

export function layoutText(ctx: Ctx, l: TextLayer): TextLayout {
  const text = l.uppercase ? l.text.toLocaleUpperCase('pt-BR') : l.text
  const pad = l.background ? l.background.padding : 0
  const maxW = Math.max(10, l.w - pad * 2)
  const maxH = Math.max(10, l.h - pad * 2)
  let size = l.size
  for (let i = 0; i < 40; i++) {
    setTextStyle(ctx, l, size)
    const lines = wrap(ctx, text, maxW)
    const lh = size * l.lineHeight
    const height = lh * (lines.length - 1) + size
    const widest = Math.max(...lines.map((x) => x.width))
    if (!l.autoFit || (height <= maxH && widest <= maxW + 0.5) || size <= 8) return { size, lines, lineHeight: lh, height }
    size = Math.max(8, size * 0.94)
  }
  setTextStyle(ctx, l, size)
  const lines = wrap(ctx, text, maxW)
  return { size, lines, lineHeight: size * l.lineHeight, height: size * l.lineHeight * (lines.length - 1) + size }
}

function drawText(ctx: Ctx, l: TextLayer): void {
  const lay = layoutText(ctx, l)
  const pad = l.background ? l.background.padding : 0
  const top = l.vAlign === 'top' ? -l.h / 2 + pad : l.vAlign === 'bottom' ? l.h / 2 - pad - lay.height : -lay.height / 2
  const xFor = (width: number): number =>
    l.align === 'left' ? -l.w / 2 + pad : l.align === 'right' ? l.w / 2 - pad - width : -width / 2
  if (l.background) {
    const widest = Math.max(...lay.lines.map((x) => x.width))
    const bx = l.align === 'left' ? -l.w / 2 : l.align === 'right' ? l.w / 2 - widest - pad * 2 : -widest / 2 - pad
    ctx.beginPath()
    ctx.roundRect(bx, top - pad, widest + pad * 2, lay.height + pad * 2 + lay.size * 0.12, l.background.radius)
    applyShadow(ctx, l)
    ctx.fillStyle = makeFill(ctx, l.background.fill, widest + pad * 2, lay.height + pad * 2)
    ctx.fill()
    clearShadow(ctx)
  }
  setTextStyle(ctx, l, lay.size)
  // Ascent aproximado: a primeira linha começa no topo da caixa de texto.
  const ascent = lay.size * 0.82
  const fill = makeFill(ctx, l.fill, l.w, lay.height)
  lay.lines.forEach((line, i) => {
    const x = xFor(line.width)
    const y = top + ascent + i * lay.lineHeight
    if (l.stroke) {
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.lineWidth = l.stroke.width * 2 * (lay.size / l.size)
      ctx.strokeStyle = l.stroke.color
      if (!l.background) applyShadow(ctx, l)
      ctx.strokeText(line.text, x, y)
      clearShadow(ctx)
    } else if (!l.background) applyShadow(ctx, l)
    ctx.fillStyle = fill
    ctx.fillText(line.text, x, y)
    clearShadow(ctx)
  })
}

// ————— Efeitos —————

const grainCache = new Map<number, HTMLCanvasElement>()

function drawEffect(ctx: Ctx, l: EffectLayer): void {
  const { w, h } = l
  const rand = rng(l.seed || 1)
  const colors = l.colors.length ? l.colors : ['#ffffff']
  const pickColor = (): string => colors[Math.floor(rand() * colors.length)]
  const minSide = Math.min(w, h)
  switch (l.effect) {
    case 'rays': {
      const n = Math.round(10 + l.density * 22)
      const R = Math.hypot(w, h)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.6)
      g.addColorStop(0, withAlpha(colors[0], 0.55))
      g.addColorStop(1, withAlpha(colors[0], 0))
      ctx.fillStyle = g
      for (let i = 0; i < n; i++) {
        const a0 = (Math.PI * 2 * i) / n
        const a1 = a0 + (Math.PI * 2) / n / 2.2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, R, a0, a1)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'glow': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2)
      g.addColorStop(0, withAlpha(colors[0], 0.35 + l.density * 0.5))
      g.addColorStop(1, withAlpha(colors[0], 0))
      ctx.fillStyle = g
      ctx.fillRect(-w / 2, -h / 2, w, h)
      break
    }
    case 'bokeh': {
      const n = Math.round(8 + l.density * 46)
      for (let i = 0; i < n; i++) {
        const x = (rand() - 0.5) * w, y = (rand() - 0.5) * h
        const r = minSide * (0.012 + rand() * 0.07)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const c = pickColor()
        g.addColorStop(0, withAlpha(c, 0.55))
        g.addColorStop(0.7, withAlpha(c, 0.25))
        g.addColorStop(1, withAlpha(c, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'confetti': {
      const n = Math.round(24 + l.density * 140)
      for (let i = 0; i < n; i++) {
        const x = (rand() - 0.5) * w, y = (rand() - 0.5) * h
        const s = minSide * (0.006 + rand() * 0.016)
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rand() * Math.PI)
        ctx.fillStyle = pickColor()
        if (rand() > 0.35) ctx.fillRect(-s, -s * 0.45, s * 2, s * 0.9)
        else {
          ctx.beginPath()
          ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
      break
    }
    case 'sparkles': {
      const n = Math.round(5 + l.density * 28)
      for (let i = 0; i < n; i++) {
        const x = (rand() - 0.5) * w, y = (rand() - 0.5) * h
        const s = minSide * (0.01 + rand() * 0.03)
        const c = pickColor()
        ctx.save()
        ctx.translate(x, y)
        ctx.shadowColor = c
        ctx.shadowBlur = s * 1.5
        ctx.fillStyle = c
        ctx.beginPath()
        for (let k = 0; k < 8; k++) {
          const a = (Math.PI * k) / 4
          const r = k % 2 === 0 ? s : s * 0.18
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
        }
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
      break
    }
    case 'vignette': {
      const g = ctx.createRadialGradient(0, 0, minSide * 0.35, 0, 0, Math.hypot(w, h) / 2)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, withAlpha(colors[0] === '#ffffff' ? '#000000' : colors[0], 0.25 + l.density * 0.55))
      ctx.fillStyle = g
      ctx.fillRect(-w / 2, -h / 2, w, h)
      break
    }
    case 'grain': {
      let tile = grainCache.get(l.seed)
      if (!tile) {
        tile = document.createElement('canvas')
        tile.width = tile.height = 160
        const t = tile.getContext('2d')!
        const data = t.createImageData(160, 160)
        const r = rng(l.seed || 3)
        for (let i = 0; i < data.data.length; i += 4) {
          const v = Math.floor(r() * 255)
          data.data[i] = data.data[i + 1] = data.data[i + 2] = v
          data.data[i + 3] = 255
        }
        t.putImageData(data, 0, 0)
        grainCache.set(l.seed, tile)
      }
      ctx.globalAlpha *= 0.05 + l.density * 0.12
      ctx.globalCompositeOperation = 'overlay'
      const pattern = ctx.createPattern(tile, 'repeat')
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(-w / 2, -h / 2, w, h)
      }
      break
    }
  }
}

// ————— Documento —————

export interface DrawOptions {
  /** Pixels de saída por pixel do documento. */
  scale?: number
  /** Desenha só as camadas aceitas (passes para a animação no Video Studio). */
  filter?: (l: Layer, index: number) => boolean
  background?: boolean
  /** Fundo opaco por baixo de tudo (JPG não tem transparência). */
  matte?: string
}

export function drawDoc(ctx: Ctx, doc: ImageDoc, loaded: Loaded, opts: DrawOptions = {}): void {
  const scale = opts.scale ?? 1
  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, doc.width, doc.height)
  if (opts.matte) {
    ctx.fillStyle = opts.matte
    ctx.fillRect(0, 0, doc.width, doc.height)
  }
  if (opts.background !== false) {
    ctx.save()
    ctx.translate(doc.width / 2, doc.height / 2)
    ctx.fillStyle = makeFill(ctx, doc.background, doc.width, doc.height)
    ctx.fillRect(-doc.width / 2, -doc.height / 2, doc.width, doc.height)
    ctx.restore()
  }
  doc.layers.forEach((l, i) => {
    if (!l.visible || l.opacity <= 0) return
    if (opts.filter && !opts.filter(l, i)) return
    ctx.save()
    ctx.globalAlpha = l.opacity
    ctx.globalCompositeOperation = BLEND[l.blend] ?? 'source-over'
    ctx.translate(l.x + l.w / 2, l.y + l.h / 2)
    if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180)
    if (l.type === 'image') drawImage(ctx, l, loaded.images.get(l.src))
    else if (l.type === 'text') drawText(ctx, l)
    else if (l.type === 'shape') drawShape(ctx, l)
    else drawEffect(ctx, l)
    ctx.restore()
  })
  ctx.restore()
}

export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const

export async function renderBlob(doc: ImageDoc, opts: DrawOptions & { type?: keyof typeof MIME; quality?: number } = {}): Promise<Blob> {
  const loaded = await prepare(doc)
  const scale = opts.scale ?? 1
  const canvas = new OffscreenCanvas(Math.round(doc.width * scale), Math.round(doc.height * scale))
  const ctx = canvas.getContext('2d')!
  const type = opts.type ?? 'png'
  drawDoc(ctx, doc, loaded, { ...opts, matte: type === 'jpg' ? opts.matte ?? '#ffffff' : opts.matte })
  return canvas.convertToBlob({ type: MIME[type], quality: opts.quality ?? 0.92 })
}

export async function renderBytes(doc: ImageDoc, opts: Parameters<typeof renderBlob>[1] = {}): Promise<Uint8Array> {
  return new Uint8Array(await (await renderBlob(doc, opts)).arrayBuffer())
}

/** Miniatura (data URL) para galerias. */
export async function renderThumb(doc: ImageDoc, maxSide = 360): Promise<string> {
  const blob = await renderBlob(doc, { scale: maxSide / Math.max(doc.width, doc.height), type: 'webp', quality: 0.8 })
  return URL.createObjectURL(blob)
}

/** Divide a arte em fundo / elemento principal / textos+logo para a animação no Video Studio. */
export function videoPasses(doc: ImageDoc): { background: (l: Layer, i: number) => boolean; subject: ((l: Layer, i: number) => boolean) | null; foreground: ((l: Layer, i: number) => boolean) | null } {
  // Espaços reservados vazios dos templates não vão para o vídeo.
  const slot = (l: Layer): boolean => l.type === 'shape' && /^Espaço/i.test(l.name)
  const first = doc.layers.findIndex((l) => l.visible && l.role === 'subject' && !slot(l))
  const isFront = (l: Layer): boolean => l.role === 'text' || l.role === 'logo'
  if (first < 0) {
    const hasFront = doc.layers.some((l) => l.visible && isFront(l))
    return { background: (l) => !isFront(l) && !slot(l), subject: null, foreground: hasFront ? (l) => isFront(l) : null }
  }
  const hasFg = doc.layers.some((l, i) => l.visible && i > first && l.role !== 'subject' && !slot(l))
  return {
    background: (l, i) => i < first && !slot(l),
    subject: (l, i) => i >= first && l.role === 'subject' && !slot(l),
    foreground: hasFg ? (l, i) => i > first && l.role !== 'subject' && !slot(l) : null
  }
}

// ————— Recorte inteligente: remover fundo liso —————

/**
 * Remove um fundo de cor uniforme (ex.: mascote gerado sobre branco) por preenchimento a partir
 * das bordas, com transição suave nas bordas do objeto. Não altera o arquivo original.
 */
export async function removeFlatBackground(path: string, tolerance = 38): Promise<Blob> {
  const img = await loadImage(path)
  if (!img) throw new Error('Não consegui abrir a imagem.')
  const w = img.naturalWidth, h = img.naturalHeight
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data
  const corners = [0, w - 1, (h - 1) * w, h * w - 1]
  const ref = [0, 1, 2].map((k) => corners.reduce((s, c) => s + px[c * 4 + k], 0) / 4)
  const dist = (i: number): number => Math.hypot(px[i * 4] - ref[0], px[i * 4 + 1] - ref[1], px[i * 4 + 2] - ref[2])
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1)
  while (stack.length) {
    const i = stack.pop()!
    if (seen[i]) continue
    seen[i] = 1
    const d = dist(i)
    if (d > tolerance * 1.6) continue
    // Transição: totalmente transparente perto da cor do fundo, parcial na borda do objeto.
    const a = d <= tolerance ? 0 : Math.round(((d - tolerance) / (tolerance * 0.6)) * 255)
    px[i * 4 + 3] = Math.min(px[i * 4 + 3], a)
    if (d > tolerance) continue
    const x = i % w, y = (i - x) / w
    if (x > 0) stack.push(i - 1)
    if (x < w - 1) stack.push(i + 1)
    if (y > 0) stack.push(i - w)
    if (y < h - 1) stack.push(i + w)
  }
  ctx.putImageData(data, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

export const blobBytes = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer())
