import {
  formatById, IMAGE_FORMATS, MAX_DOC_SIDE, MAX_LAYERS, safeAreaFor,
  type BlendMode, type EffectKind, type EffectLayer, type Fill, type ImageDoc, type ImageFormatId, type ImageLayer, type Layer,
  type LayerRole, type ShapeKind, type ShapeLayer, type Shadow, type Stroke, type TextLayer
} from './image'

// Validação e operações puras sobre o documento de composição. Tudo que chega do Claude
// (design.json editado por ele) ou da interface passa por sanitizeDoc antes de ser gravado.

const ROLES: LayerRole[] = ['background', 'subject', 'logo', 'text', 'decor']
const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'lighter']
const SHAPES: ShapeKind[] = ['rect', 'ellipse', 'burst', 'triangle', 'line', 'blob']
const EFFECTS: EffectKind[] = ['rays', 'bokeh', 'confetti', 'sparkles', 'vignette', 'grain', 'glow']

const num = (v: unknown, def: number, min = -1e6, max = 1e6): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
const str = (v: unknown, def: string, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : def)
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def)
const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def)

/** Aceita #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() e "transparent". */
export function safeColor(v: unknown, def = '#000000'): string {
  if (typeof v !== 'string') return def
  const s = v.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)$/i.test(s)) return s
  if (s === 'transparent') return s
  return def
}

export function sanitizeFill(v: unknown, def: Fill = { type: 'solid', color: '#ffffff' }): Fill {
  if (typeof v === 'string') return { type: 'solid', color: safeColor(v, '#ffffff') }
  if (!v || typeof v !== 'object') return def
  const f = v as Record<string, unknown>
  const stops = Array.isArray(f.stops)
    ? (f.stops as unknown[]).slice(0, 8).map((s, i, a) => {
        const o = (s ?? {}) as Record<string, unknown>
        return { offset: num(o.offset, a.length > 1 ? i / (a.length - 1) : 0, 0, 1), color: safeColor(o.color, '#ffffff') }
      })
    : []
  if (f.type === 'linear' && stops.length >= 2) return { type: 'linear', angle: num(f.angle, 180, -360, 720), stops }
  if (f.type === 'radial' && stops.length >= 2) return { type: 'radial', cx: num(f.cx, 0.5, -1, 2), cy: num(f.cy, 0.5, -1, 2), r: num(f.r, 0.7, 0.01, 3), stops }
  if (f.type === 'solid' || typeof f.color === 'string') return { type: 'solid', color: safeColor(f.color, '#ffffff') }
  return def
}

function sanitizeShadow(v: unknown): Shadow | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  return { color: safeColor(s.color, 'rgba(0,0,0,0.45)'), blur: num(s.blur, 20, 0, 400), x: num(s.x, 0, -500, 500), y: num(s.y, 8, -500, 500) }
}

function sanitizeStroke(v: unknown): Stroke | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  const width = num(s.width, 0, 0, 200)
  return width > 0 ? { color: safeColor(s.color, '#000000'), width } : null
}

let idSeq = 0
export const newId = (prefix = 'l'): string => `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export interface SanitizeOptions {
  /** Devolve o caminho permitido (ou null) para cada imagem referenciada. */
  checkPath?: (p: string) => string | null
}

function sanitizeLayer(raw: unknown, doc: { width: number; height: number }, opts: SanitizeOptions, seen: Set<string>): Layer | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type
  let id = str(r.id, '', 64).replace(/[^\w-]/g, '')
  if (!id || seen.has(id)) id = newId()
  seen.add(id)
  const big = Math.max(doc.width, doc.height) * 4
  const base = {
    id,
    name: str(r.name, '', 80),
    role: pick(r.role, ROLES, type === 'text' ? 'text' : 'decor'),
    x: num(r.x, 0, -big, big),
    y: num(r.y, 0, -big, big),
    w: num(r.w, doc.width / 2, 1, big),
    h: num(r.h, doc.height / 2, 1, big),
    rotation: num(r.rotation, 0, -360, 360),
    opacity: num(r.opacity, 1, 0, 1),
    visible: bool(r.visible, true),
    locked: bool(r.locked, false),
    shadow: sanitizeShadow(r.shadow),
    blend: pick(r.blend, BLENDS, 'normal')
  }
  if (type === 'image') {
    const src = str(r.src, '', 1024)
    const ok = src && opts.checkPath ? opts.checkPath(src) : src || null
    if (!ok) return null
    const layer: ImageLayer = {
      ...base, type: 'image', src: ok,
      fit: pick(r.fit, ['cover', 'contain', 'fill'] as const, 'contain'),
      focusX: num(r.focusX, 0.5, 0, 1), focusY: num(r.focusY, 0.5, 0, 1),
      radius: num(r.radius, 0, 0, 2000), stroke: sanitizeStroke(r.stroke), flipX: bool(r.flipX, false),
      brightness: num(r.brightness, 1, 0, 3), contrast: num(r.contrast, 1, 0, 3), saturation: num(r.saturation, 1, 0, 3),
      logoId: typeof r.logoId === 'string' ? r.logoId.slice(0, 64) : null
    }
    // A logo nunca é distorcida nem recortada.
    if (layer.role === 'logo') {
      layer.fit = 'contain'
      layer.flipX = false
      layer.rotation = 0
      layer.brightness = layer.contrast = layer.saturation = 1
    }
    if (!layer.name) layer.name = layer.role === 'logo' ? 'Logo' : layer.role === 'background' ? 'Fundo' : 'Imagem'
    return layer
  }
  if (type === 'text') {
    const bg = r.background && typeof r.background === 'object' ? (r.background as Record<string, unknown>) : null
    const layer: TextLayer = {
      ...base, type: 'text', role: base.role === 'text' ? 'text' : base.role,
      text: str(r.text, 'Texto', 600),
      font: str(r.font, 'Segoe UI', 80).replace(/["\\;{}]/g, ''),
      weight: Math.round(num(r.weight, 700, 100, 900) / 100) * 100,
      italic: bool(r.italic, false),
      size: num(r.size, 64, 4, 1200),
      fill: sanitizeFill(r.fill ?? r.color, { type: 'solid', color: '#ffffff' }),
      align: pick(r.align, ['left', 'center', 'right'] as const, 'center'),
      vAlign: pick(r.vAlign, ['top', 'middle', 'bottom'] as const, 'middle'),
      lineHeight: num(r.lineHeight, 1.1, 0.6, 3),
      letterSpacing: num(r.letterSpacing, 0, -50, 200),
      uppercase: bool(r.uppercase, false),
      stroke: sanitizeStroke(r.stroke),
      autoFit: bool(r.autoFit, true),
      background: bg ? { fill: sanitizeFill(bg.fill, { type: 'solid', color: '#000000' }), padding: num(bg.padding, 16, 0, 400), radius: num(bg.radius, 12, 0, 400) } : null
    }
    if (!layer.name) layer.name = layer.text.split('\n')[0].slice(0, 30) || 'Texto'
    return layer
  }
  if (type === 'shape') {
    const layer: ShapeLayer = {
      ...base, type: 'shape',
      shape: pick(r.shape, SHAPES, 'rect'),
      fill: sanitizeFill(r.fill ?? r.color, { type: 'solid', color: '#ffffff' }),
      stroke: sanitizeStroke(r.stroke),
      radius: num(r.radius, 0, 0, 4000),
      points: Math.round(num(r.points, 12, 3, 48)),
      innerRatio: num(r.innerRatio, 0.6, 0.05, 0.98)
    }
    if (!layer.name) layer.name = 'Forma'
    return layer
  }
  if (type === 'effect') {
    const colors = Array.isArray(r.colors) ? (r.colors as unknown[]).slice(0, 8).map((c) => safeColor(c, '#ffffff')) : []
    const layer: EffectLayer = {
      ...base, type: 'effect',
      effect: pick(r.effect, EFFECTS, 'bokeh'),
      colors: colors.length ? colors : ['#ffffff'],
      seed: Math.round(num(r.seed, 7, 0, 1e6)),
      density: num(r.density, 0.5, 0, 1)
    }
    if (!layer.name) layer.name = 'Efeito'
    return layer
  }
  return null
}

/** Normaliza um documento vindo de fonte não confiável. Lança erro se for irrecuperável. */
export function sanitizeDoc(raw: unknown, opts: SanitizeOptions = {}): ImageDoc {
  if (!raw || typeof raw !== 'object') throw new Error('Documento de imagem inválido')
  const r = raw as Record<string, unknown>
  const formatId = pick(r.formatId, IMAGE_FORMATS.map((f) => f.id), 'custom') as ImageFormatId
  const f = formatById(formatId)
  const width = Math.round(num(r.width, f.width, 64, MAX_DOC_SIDE))
  const height = Math.round(num(r.height, f.height, 64, MAX_DOC_SIDE))
  const seen = new Set<string>()
  const layers = (Array.isArray(r.layers) ? r.layers : [])
    .slice(0, MAX_LAYERS)
    .map((l) => sanitizeLayer(l, { width, height }, opts, seen))
    .filter((l): l is Layer => Boolean(l))
  const meta = (r.meta && typeof r.meta === 'object' ? r.meta : {}) as Record<string, unknown>
  return {
    version: 1, width, height, formatId,
    background: sanitizeFill(r.background, { type: 'solid', color: '#1b1b24' }),
    layers,
    meta: {
      brandId: typeof meta.brandId === 'string' ? meta.brandId.slice(0, 64) : null,
      templateId: typeof meta.templateId === 'string' ? meta.templateId.slice(0, 64) : null,
      style: typeof meta.style === 'string' ? meta.style.slice(0, 64) : null,
      title: str(meta.title, '', 200)
    }
  }
}

export function emptyDoc(formatId: ImageFormatId, width?: number, height?: number): ImageDoc {
  const f = formatById(formatId)
  return {
    version: 1, formatId, width: width ?? f.width, height: height ?? f.height,
    background: { type: 'linear', angle: 160, stops: [{ offset: 0, color: '#26213a' }, { offset: 1, color: '#0d0c14' }] },
    layers: [],
    meta: { brandId: null, templateId: null, style: null, title: '' }
  }
}

// ————— Fábricas de camadas (usadas pelos templates e pela barra de ferramentas) —————

const baseLayer = (role: LayerRole, x: number, y: number, w: number, h: number) => ({
  id: newId(), name: '', role, x, y, w, h, rotation: 0, opacity: 1, visible: true, locked: false, shadow: null as Shadow | null, blend: 'normal' as BlendMode
})

export function textLayer(text: string, x: number, y: number, w: number, h: number, patch: Partial<TextLayer> = {}): TextLayer {
  return {
    ...baseLayer('text', x, y, w, h), type: 'text', name: text.split('\n')[0].slice(0, 30), text,
    font: 'Segoe UI', weight: 800, italic: false, size: 96, fill: { type: 'solid', color: '#ffffff' }, align: 'center', vAlign: 'middle',
    lineHeight: 1.05, letterSpacing: 0, uppercase: false, stroke: null, autoFit: true, background: null, ...patch
  }
}

export function shapeLayer(shape: ShapeKind, x: number, y: number, w: number, h: number, fill: Fill, patch: Partial<ShapeLayer> = {}): ShapeLayer {
  return { ...baseLayer('decor', x, y, w, h), type: 'shape', name: 'Forma', shape, fill, stroke: null, radius: 0, points: 14, innerRatio: 0.72, ...patch }
}

export function imageLayer(src: string, x: number, y: number, w: number, h: number, patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    ...baseLayer('subject', x, y, w, h), type: 'image', name: 'Imagem', src, fit: 'contain', focusX: 0.5, focusY: 0.5, radius: 0, stroke: null,
    flipX: false, brightness: 1, contrast: 1, saturation: 1, logoId: null, ...patch
  }
}

export function effectLayer(effect: EffectKind, doc: { width: number; height: number }, colors: string[], patch: Partial<EffectLayer> = {}): EffectLayer {
  return { ...baseLayer('decor', 0, 0, doc.width, doc.height), type: 'effect', name: 'Efeito', effect, colors, seed: Math.floor(Math.random() * 9999), density: 0.5, ...patch }
}

/** Posição padrão da logo: canto superior esquerdo, dentro da área segura e com a margem da marca. */
export function placeLogo(doc: ImageDoc, logo: { width: number; height: number }, margin: number, corner: 'tl' | 'tr' | 'bl' | 'br' | 'tc' | 'bc' = 'tl', widthRatio = 0.34): { x: number; y: number; w: number; h: number } {
  const safe = safeAreaFor(doc)
  const pad = Math.round(Math.min(doc.width, doc.height) * margin)
  const w = Math.round(Math.min(doc.width * widthRatio, (doc.height * 0.16 * logo.width) / logo.height))
  const h = Math.round((w * logo.height) / logo.width)
  const left = Math.max(safe.left, pad)
  const right = doc.width - Math.max(safe.right, pad) - w
  const top = Math.max(safe.top, pad)
  const bottom = doc.height - Math.max(safe.bottom, pad) - h
  const cx = Math.round((doc.width - w) / 2)
  const x = corner === 'tl' || corner === 'bl' ? left : corner === 'tr' || corner === 'br' ? right : cx
  const y = corner.startsWith('t') ? top : bottom
  return { x, y, w, h }
}

// ————— Adaptação de formato ("transforma em Stories") —————

/**
 * Leva a composição para outro tamanho preservando a composição: fundos cobrem o quadro novo,
 * os demais elementos mantêm a posição relativa do centro e escalam sem distorcer,
 * e textos/logo são puxados para dentro da área segura do novo formato.
 */
export function adaptDoc(doc: ImageDoc, formatId: ImageFormatId, width?: number, height?: number): ImageDoc {
  const f = formatById(formatId)
  const W = Math.round(width ?? f.width)
  const H = Math.round(height ?? f.height)
  const sx = W / doc.width
  const sy = H / doc.height
  const s = Math.min(sx, sy)
  const next: ImageDoc = { ...doc, formatId, width: W, height: H, layers: [] }
  const safe = safeAreaFor(next)
  for (const l of doc.layers) {
    const fullBleed = l.role === 'background' || (l.type === 'effect' && l.w >= doc.width * 0.95 && l.h >= doc.height * 0.95)
    if (fullBleed) {
      next.layers.push({ ...l, x: 0, y: 0, w: W, h: H })
      continue
    }
    const cx = (l.x + l.w / 2) * sx
    const cy = (l.y + l.h / 2) * sy
    let w = l.w * s
    let h = l.h * s
    // Texto ganha a largura útil do novo formato quando ela cresce (ex.: feed → stories).
    if (l.type === 'text' && l.w >= doc.width * 0.6) w = Math.min(W - safe.left - safe.right, l.w * sx)
    if (l.type === 'text') h = l.h * s
    let x = cx - w / 2
    let y = cy - h / 2
    if (l.role === 'text' || l.role === 'logo') {
      x = Math.min(Math.max(x, safe.left), W - safe.right - w)
      y = Math.min(Math.max(y, safe.top), H - safe.bottom - h)
    }
    const moved: Layer = { ...l, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } as Layer
    if (moved.type === 'text') moved.size = Math.max(8, Math.round((l as TextLayer).size * s))
    if (moved.shadow) moved.shadow = { ...moved.shadow, blur: moved.shadow.blur * s, x: moved.shadow.x * s, y: moved.shadow.y * s }
    if ('stroke' in moved && moved.stroke) moved.stroke = { ...moved.stroke, width: moved.stroke.width * s }
    next.layers.push(moved)
  }
  return next
}

// ————— Análise de qualidade (sugestões de melhoria) —————

export interface DocIssue {
  level: 'aviso' | 'dica'
  layerId: string | null
  text: string
  /** Pedido pronto para o Claude corrigir. */
  fix: string
}

const rotatedOutside = (l: Layer, safe: { top: number; right: number; bottom: number; left: number }, doc: ImageDoc): boolean =>
  l.x < safe.left - 1 || l.y < safe.top - 1 || l.x + l.w > doc.width - safe.right + 1 || l.y + l.h > doc.height - safe.bottom + 1

export function analyzeDoc(doc: ImageDoc, brand?: { logoMargin: number } | null): DocIssue[] {
  const issues: DocIssue[] = []
  const safe = safeAreaFor(doc)
  const visible = doc.layers.filter((l) => l.visible)
  const texts = visible.filter((l): l is TextLayer => l.type === 'text')
  const words = texts.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0)
  for (const t of texts) {
    if (rotatedOutside(t, safe, doc)) issues.push({ level: 'aviso', layerId: t.id, text: `"${t.name}" sai da área segura do formato.`, fix: `Traga o texto "${t.text.slice(0, 40)}" para dentro da área segura, sem mudar o resto.` })
    const minSize = Math.min(doc.width, doc.height) * 0.032
    if (t.size < minSize) issues.push({ level: 'aviso', layerId: t.id, text: `"${t.name}" pode ficar ilegível no celular (${Math.round(t.size)} px).`, fix: `Aumente o texto "${t.text.slice(0, 40)}" para ficar legível no celular.` })
  }
  if (words > 32) issues.push({ level: 'dica', layerId: null, text: `Muito texto na arte (${words} palavras).`, fix: 'Reduza o texto da arte ao essencial (título curto + chamada), mantendo o restante.' })
  const logos = visible.filter((l) => l.role === 'logo')
  if (doc.meta.brandId && logos.length === 0) issues.push({ level: 'aviso', layerId: null, text: 'A arte é de uma marca mas está sem a logo.', fix: 'Insira a logo oficial da marca no canto adequado, respeitando a margem de segurança.' })
  for (const l of logos) {
    const m = Math.min(doc.width, doc.height) * (brand?.logoMargin ?? 0.03)
    if (l.x < m - 1 || l.y < m - 1 || l.x + l.w > doc.width - m + 1 || l.y + l.h > doc.height - m + 1) {
      issues.push({ level: 'aviso', layerId: l.id, text: 'A logo está sem a margem de segurança.', fix: 'Afaste a logo das bordas respeitando a margem de segurança da marca.' })
    }
    if (l.w < doc.width * 0.14) issues.push({ level: 'dica', layerId: l.id, text: 'A logo está pequena demais.', fix: 'Aumente um pouco a logo, mantendo a proporção.' })
  }
  const slots = visible.filter((l) => l.type === 'shape' && /^Espaço/i.test(l.name))
  if (slots.length) issues.push({ level: 'aviso', layerId: slots[0].id, text: `${slots.length} espaço(s) reservado(s) ainda sem imagem (${slots.map((l) => l.name.replace(/^Espaço para /i, '')).join(', ')}).`, fix: 'Preencha os espaços reservados: proponha a geração da imagem que falta ou remova o espaço e reequilibre a composição.' })
  if (visible.length > 28) issues.push({ level: 'dica', layerId: null, text: `Muitos elementos (${visible.length}). A arte pode parecer poluída.`, fix: 'Simplifique a composição removendo elementos decorativos que não ajudam a mensagem.' })
  if (!visible.some((l) => l.role === 'background' || l.role === 'subject') && !texts.length) {
    issues.push({ level: 'dica', layerId: null, text: 'A arte ainda está vazia.', fix: 'Monte uma composição profissional para este projeto.' })
  }
  return issues
}

/** Resumo legível do documento para o contexto do Claude. */
export function describeDoc(doc: ImageDoc): string {
  const lines = doc.layers.map((l, i) => {
    const box = `x=${Math.round(l.x)} y=${Math.round(l.y)} w=${Math.round(l.w)} h=${Math.round(l.h)}`
    const extra = l.type === 'text' ? ` "${l.text.replace(/\n/g, ' / ').slice(0, 60)}" ${l.font} ${l.weight} ${Math.round(l.size)}px`
      : l.type === 'image' ? ` ${l.src.split(/[\\/]/).pop()}` : l.type === 'shape' ? ` ${l.shape}` : ` ${l.effect}`
    return `${i + 1}. [${l.type}/${l.role}] id=${l.id} ${box}${extra}${l.visible ? '' : ' (oculta)'}`
  })
  return `${doc.width}x${doc.height} (${formatById(doc.formatId).label}), ${doc.layers.length} camada(s) — da mais ao fundo para a mais à frente:\n${lines.join('\n') || '(nenhuma)'}`
}
