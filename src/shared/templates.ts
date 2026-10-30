import { formatById, safeAreaFor, type Brand, type BrandLogo, type Fill, type ImageDoc, type ImageFormatId, type Layer } from './image'
import { effectLayer, emptyDoc, imageLayer, placeLogo, shapeLayer, textLayer } from './imageDoc'

// Galeria de templates do Image Studio. Cada template é uma função que monta a composição
// para qualquer formato e marca: posições são proporcionais à área segura, as cores vêm da
// paleta da marca e a logo é sempre o arquivo original. Textos são genéricos e verdadeiros
// (o que precisa de informação real aparece entre colchetes para o Pedro preencher).

export type TemplateCategory = 'datas' | 'promocoes' | 'servicos' | 'anuncios' | 'social' | 'empresa'

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: 'datas', label: 'Datas comemorativas' },
  { id: 'promocoes', label: 'Promoções e descontos' },
  { id: 'servicos', label: 'Serviços' },
  { id: 'anuncios', label: 'Anúncios' },
  { id: 'social', label: 'Stories, Reels e YouTube' },
  { id: 'empresa', label: 'Antes e depois · Comunicados' }
]

export interface TemplateContext {
  brand: Brand | null
  logo: BrandLogo | null
  /** Textos que substituem os padrões (ex.: vindos do pedido do usuário). */
  texts?: Record<string, string>
}

export interface Template {
  id: string
  name: string
  category: TemplateCategory
  description: string
  /** Formato sugerido quando o template é escolhido no "novo projeto". */
  formatId: ImageFormatId
  /** Campos de texto editáveis (id → rótulo). */
  fields: { id: string; label: string; value: string }[]
  build(doc: ImageDoc, ctx: TemplateContext): ImageDoc
}

// ————— Paleta —————

const lum = (hex: string): number => {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const sat = (hex: string): number => {
  const h = hex.replace('#', '').slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

export interface Palette { primary: string; secondary: string; accent: string; dark: string; light: string }

export function paletteOf(brand: Brand | null): Palette {
  const hexes = (brand?.colors ?? []).map((c) => c.hex).filter((h) => /^#[0-9a-f]{6}$/i.test(h))
  if (!hexes.length) return { primary: '#8b5cf6', secondary: '#f472b6', accent: '#fbbf24', dark: '#120f1c', light: '#ffffff' }
  const byLum = [...hexes].sort((a, b) => lum(a) - lum(b))
  const dark = lum(byLum[0]) < 0.2 ? byLum[0] : '#141019'
  const light = lum(byLum[byLum.length - 1]) > 0.85 ? byLum[byLum.length - 1] : '#ffffff'
  const vivid = hexes.filter((h) => h !== dark && h !== light && sat(h) > 0.35)
  const primary = vivid[1] ?? vivid[0] ?? '#8b5cf6'
  const secondary = vivid.find((h) => h !== primary && lum(h) > lum(primary)) ?? vivid.find((h) => h !== primary) ?? primary
  const accent = vivid.find((h) => h !== primary && h !== secondary) ?? secondary
  return { primary, secondary, accent, dark, light }
}

const lin = (angle: number, ...colors: string[]): Fill => ({ type: 'linear', angle, stops: colors.map((color, i) => ({ offset: i / Math.max(1, colors.length - 1), color })) })
const solid = (color: string): Fill => ({ type: 'solid', color })
const SHADOW = { color: 'rgba(0,0,0,0.45)', blur: 24, x: 0, y: 8 }

// ————— Montagem comum —————

interface Frame {
  W: number; H: number; u: number
  left: number; right: number; top: number; bottom: number
  /** Largura e altura úteis dentro da área segura. */
  cw: number; ch: number
  tall: boolean; wide: boolean
}

function frame(doc: ImageDoc): Frame {
  const s = safeAreaFor(doc)
  const pad = Math.round(Math.min(doc.width, doc.height) * 0.02)
  const left = s.left + pad, right = doc.width - s.right - pad, top = s.top + pad, bottom = doc.height - s.bottom - pad
  return {
    W: doc.width, H: doc.height, u: Math.min(doc.width, doc.height) / 1080,
    left, right, top, bottom, cw: right - left, ch: bottom - top,
    tall: doc.height / doc.width > 1.5, wide: doc.width / doc.height > 1.3
  }
}

const t = (ctx: TemplateContext, id: string, fallback: string): string => ctx.texts?.[id] ?? fallback

function withLogo(doc: ImageDoc, ctx: TemplateContext, corner: Parameters<typeof placeLogo>[3], widthRatio?: number): Layer[] {
  const logo = ctx.logo
  if (!logo || !logo.width || !logo.height) return []
  const box = placeLogo(doc, logo, ctx.brand?.logoMargin ?? 0.04, corner, widthRatio)
  return [imageLayer(logo.path, box.x, box.y, box.w, box.h, { role: 'logo', name: logo.name, logoId: logo.id, fit: 'contain' })]
}

/** Espaço reservado para foto/mascote: vira imagem quando o Pedro soltar uma ou gerar com IA. */
const slot = (x: number, y: number, w: number, h: number, name = 'Espaço para imagem'): Layer =>
  shapeLayer('rect', x, y, w, h, solid('rgba(255,255,255,0.06)'), {
    role: 'subject', name, radius: Math.round(Math.min(w, h) * 0.04), stroke: { color: 'rgba(255,255,255,0.28)', width: 3 }
  })

const heading = (brand: Brand | null): string => brand?.fonts.heading || 'Poppins'
const body = (brand: Brand | null): string => brand?.fonts.body || 'Poppins'

function finish(doc: ImageDoc, ctx: TemplateContext, id: string, layers: Layer[], background: Fill): ImageDoc {
  return { ...doc, background, layers, meta: { ...doc.meta, brandId: ctx.brand?.id ?? null, templateId: id } }
}

// ————— Templates —————

export const TEMPLATES: Template[] = [
  {
    id: 'data-premium',
    name: 'Data comemorativa premium',
    category: 'datas',
    description: 'Fundo escuro e quente, data espaçada, título forte com palavra manuscrita e espaço para o mascote.',
    formatId: 'ig-story',
    fields: [
      { id: 'data', label: 'Data', value: '16 de outubro' },
      { id: 'titulo', label: 'Título', value: 'Dia do' },
      { id: 'destaque', label: 'Palavra em destaque', value: 'Chefe' },
      { id: 'texto', label: 'Mensagem', value: 'Hoje é o dia de valorizar quem lidera, inspira e faz tudo acontecer!' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const logo = withLogo(doc, ctx, 'tc', f.wide ? 0.22 : 0.42)
      const y0 = (logo[0]?.y ?? f.top) + (logo[0]?.h ?? 0) + 60 * f.u
      const textW = f.wide ? f.cw * 0.55 : f.cw
      const date = textLayer(t(ctx, 'data', '16 de outubro'), f.left, y0, textW * 0.8, 44 * f.u, {
        font: body(ctx.brand), weight: 600, size: 38 * f.u, align: 'left', uppercase: true, letterSpacing: 16 * f.u, fill: solid('#ffffff'), name: 'Data'
      })
      date.fill = solid(p.secondary)
      const rule = shapeLayer('line', f.left, y0 + 60 * f.u, textW * 0.38, 7 * f.u, lin(90, p.primary, p.secondary), { name: 'Sublinhado' })
      const title = textLayer(t(ctx, 'titulo', 'Dia do'), f.left, y0 + 90 * f.u, textW, 150 * f.u, {
        font: heading(ctx.brand), weight: 900, size: 150 * f.u, align: 'left', uppercase: true, fill: solid('#ffffff'), shadow: SHADOW, name: 'Título'
      })
      const script = textLayer(t(ctx, 'destaque', 'Chefe'), f.left - 10 * f.u, y0 + 220 * f.u, textW, 300 * f.u, {
        font: 'Kaushan Script', weight: 400, size: 280 * f.u, align: 'left', lineHeight: 1, fill: lin(100, p.secondary, p.primary), shadow: { color: 'rgba(0,0,0,0.5)', blur: 30, x: 0, y: 10 }, name: 'Destaque'
      })
      const msgY = y0 + 560 * f.u
      const msg = textLayer(t(ctx, 'texto', 'Hoje é o dia de valorizar quem lidera, inspira e faz tudo acontecer!'), f.left, msgY, f.wide ? textW : f.cw * 0.48, 300 * f.u, {
        font: body(ctx.brand), weight: 500, size: 44 * f.u, align: 'left', vAlign: 'top', lineHeight: 1.25, fill: solid('#ffffff'), shadow: SHADOW, name: 'Mensagem'
      })
      const sw = f.wide ? f.cw * 0.42 : f.cw * 0.62
      const sh = f.wide ? f.ch * 0.9 : Math.min(f.ch * 0.5, sw * 1.3)
      const subject = slot(f.right - sw, f.wide ? f.top : f.bottom - sh, sw, sh, 'Espaço para o mascote')
      return finish(doc, ctx, 'data-premium', [
        effectLayer('glow', doc, [p.primary], { x: -f.W * 0.3, y: -f.H * 0.1, w: f.W * 1.1, h: f.H * 0.8, density: 0.45, name: 'Luz quente' }),
        effectLayer('bokeh', doc, [p.secondary, p.primary], { density: 0.35, opacity: 0.55, name: 'Bokeh' }),
        effectLayer('vignette', doc, ['#000000'], { density: 0.6, name: 'Vinheta' }),
        subject, ...logo, date, rule, title, script, msg
      ], { type: 'radial', cx: 0.25, cy: 0.3, r: 1.1, stops: [{ offset: 0, color: '#3a2412' }, { offset: 0.55, color: '#1a120c' }, { offset: 1, color: '#08070a' }] })
    }
  },
  {
    id: 'data-celebracao',
    name: 'Homenagem colorida',
    category: 'datas',
    description: 'Fundo na cor da marca com raios de luz, confete e título centralizado.',
    formatId: 'ig-feed',
    fields: [
      { id: 'pre', label: 'Chamada', value: 'Feliz' },
      { id: 'titulo', label: 'Título', value: 'Dia dos Professores' },
      { id: 'texto', label: 'Mensagem', value: 'Obrigado por ensinar com tanto carinho.' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const logo = withLogo(doc, ctx, 'tc', f.wide ? 0.2 : 0.36)
      const y0 = (logo[0]?.y ?? f.top) + (logo[0]?.h ?? 0) + 50 * f.u
      return finish(doc, ctx, 'data-celebracao', [
        effectLayer('rays', doc, ['#ffffff'], { x: -f.W * 0.25, y: f.H * 0.05, w: f.W * 1.5, h: f.H * 1.2, opacity: 0.18, density: 0.5, name: 'Raios' }),
        effectLayer('confetti', doc, [p.light, p.secondary, p.accent], { density: 0.35, opacity: 0.9, name: 'Confete' }),
        slot(f.left + f.cw * 0.18, f.bottom - f.ch * 0.46, f.cw * 0.64, f.ch * 0.46, 'Espaço para o mascote'),
        ...logo,
        textLayer(t(ctx, 'pre', 'Feliz'), f.left, y0, f.cw, 110 * f.u, { font: 'Kaushan Script', weight: 400, size: 110 * f.u, fill: solid(p.light), shadow: SHADOW, name: 'Chamada' }),
        textLayer(t(ctx, 'titulo', 'Dia dos Professores'), f.left, y0 + 110 * f.u, f.cw, 230 * f.u, { font: heading(ctx.brand), weight: 900, size: 120 * f.u, uppercase: true, fill: solid('#ffffff'), shadow: SHADOW, name: 'Título' }),
        textLayer(t(ctx, 'texto', 'Obrigado por ensinar com tanto carinho.'), f.left + f.cw * 0.1, y0 + 350 * f.u, f.cw * 0.8, 110 * f.u, { font: body(ctx.brand), weight: 500, size: 42 * f.u, fill: solid('#ffffff'), name: 'Mensagem' })
      ], lin(170, p.secondary, p.primary))
    }
  },
  {
    id: 'promocao',
    name: 'Promoção relâmpago',
    category: 'promocoes',
    description: 'Selo explosão com a oferta, título grande e botão de chamada.',
    formatId: 'ig-feed',
    fields: [
      { id: 'titulo', label: 'Título', value: 'Promoção' },
      { id: 'oferta', label: 'Oferta no selo', value: '[oferta]' },
      { id: 'texto', label: 'Detalhe', value: 'Por tempo limitado' },
      { id: 'cta', label: 'Botão', value: 'Chame no WhatsApp' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const logo = withLogo(doc, ctx, 'tl', 0.3)
      const burst = Math.min(f.cw * 0.42, f.ch * 0.32)
      return finish(doc, ctx, 'promocao', [
        effectLayer('rays', doc, [p.secondary], { opacity: 0.25, density: 0.6, name: 'Raios' }),
        slot(f.left, f.top + f.ch * 0.3, f.cw * 0.62, f.ch * 0.5, 'Espaço para o produto'),
        shapeLayer('burst', f.right - burst, f.top + f.ch * 0.22, burst, burst, lin(160, p.accent, p.primary), { points: 18, innerRatio: 0.8, shadow: SHADOW, name: 'Selo', rotation: -8 }),
        textLayer(t(ctx, 'oferta', '[oferta]'), f.right - burst * 0.9, f.top + f.ch * 0.22 + burst * 0.25, burst * 0.8, burst * 0.5, { font: heading(ctx.brand), weight: 900, size: burst * 0.22, rotation: -8, fill: solid('#ffffff'), name: 'Oferta' }),
        ...logo,
        textLayer(t(ctx, 'titulo', 'Promoção'), f.left, f.bottom - f.ch * 0.3, f.cw, f.ch * 0.14, { font: heading(ctx.brand), weight: 900, size: 150 * f.u, uppercase: true, align: 'left', fill: solid('#ffffff'), shadow: SHADOW, name: 'Título' }),
        textLayer(t(ctx, 'texto', 'Por tempo limitado'), f.left, f.bottom - f.ch * 0.16, f.cw, 60 * f.u, { font: body(ctx.brand), weight: 600, size: 44 * f.u, align: 'left', fill: solid(p.light), name: 'Detalhe' }),
        textLayer(t(ctx, 'cta', 'Chame no WhatsApp'), f.left, f.bottom - 84 * f.u, f.cw * 0.6, 84 * f.u, {
          font: body(ctx.brand), weight: 700, size: 38 * f.u, align: 'left', autoFit: true, fill: solid(p.dark),
          background: { fill: solid(p.light), padding: 22 * f.u, radius: 60 * f.u }, name: 'Botão'
        })
      ], lin(160, p.primary, p.dark))
    }
  },
  {
    id: 'desconto',
    name: 'Desconto em destaque',
    category: 'promocoes',
    description: 'Número gigante com contorno, faixa de chamada e espaço para o produto.',
    formatId: 'ig-square',
    fields: [
      { id: 'pre', label: 'Antes do número', value: 'Até' },
      { id: 'numero', label: 'Desconto', value: 'XX%' },
      { id: 'pos', label: 'Depois do número', value: 'OFF' },
      { id: 'faixa', label: 'Faixa', value: '[condição da oferta]' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const logo = withLogo(doc, ctx, 'tr', 0.28)
      const colW = f.wide ? f.cw * 0.5 : f.cw * 0.56
      return finish(doc, ctx, 'desconto', [
        effectLayer('glow', doc, [p.secondary], { x: f.W * 0.35, y: 0, w: f.W * 0.9, h: f.H, density: 0.5, name: 'Brilho' }),
        slot(f.left + colW, f.top + f.ch * 0.2, f.cw - colW, f.ch * 0.65, 'Espaço para o produto'),
        ...logo,
        textLayer(t(ctx, 'pre', 'Até'), f.left, f.top + f.ch * 0.16, colW, 70 * f.u, { font: body(ctx.brand), weight: 700, size: 58 * f.u, align: 'left', uppercase: true, fill: solid('#ffffff'), name: 'Antes' }),
        textLayer(t(ctx, 'numero', 'XX%'), f.left, f.top + f.ch * 0.25, colW, f.ch * 0.3, { font: heading(ctx.brand), weight: 900, size: 260 * f.u, align: 'left', fill: lin(180, '#ffffff', p.secondary), stroke: { color: p.dark, width: 6 * f.u }, shadow: SHADOW, name: 'Número' }),
        textLayer(t(ctx, 'pos', 'OFF'), f.left, f.top + f.ch * 0.55, colW, 120 * f.u, { font: heading(ctx.brand), weight: 900, size: 120 * f.u, align: 'left', fill: solid(p.secondary), name: 'Depois' }),
        shapeLayer('rect', 0, f.bottom - 120 * f.u, f.W, 120 * f.u, solid(p.accent), { name: 'Faixa', role: 'decor' }),
        textLayer(t(ctx, 'faixa', '[condição da oferta]'), f.left, f.bottom - 120 * f.u, f.cw, 120 * f.u, { font: body(ctx.brand), weight: 800, size: 46 * f.u, uppercase: true, fill: solid(p.dark), name: 'Texto da faixa' })
      ], lin(135, p.dark, p.primary))
    }
  },
  {
    id: 'servico',
    name: 'Serviço com lista',
    category: 'servicos',
    description: 'Título do serviço, três benefícios e chamada para contato.',
    formatId: 'ig-feed',
    fields: [
      { id: 'titulo', label: 'Serviço', value: 'Instalação e manutenção' },
      { id: 'b1', label: 'Benefício 1', value: 'Equipe especializada' },
      { id: 'b2', label: 'Benefício 2', value: 'Atendimento rápido' },
      { id: 'b3', label: 'Benefício 3', value: 'Garantia no serviço' },
      { id: 'cta', label: 'Chamada', value: 'Solicite seu orçamento' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const logo = withLogo(doc, ctx, 'tl', 0.32)
      const y0 = (logo[0]?.y ?? f.top) + (logo[0]?.h ?? 0) + 50 * f.u
      const items = ['b1', 'b2', 'b3'].flatMap((id, i) => {
        const y = y0 + 260 * f.u + i * 92 * f.u
        return [
          shapeLayer('ellipse', f.left, y + 14 * f.u, 40 * f.u, 40 * f.u, solid(p.secondary), { name: `Marcador ${i + 1}` }),
          textLayer(t(ctx, id, ['Equipe especializada', 'Atendimento rápido', 'Garantia no serviço'][i]), f.left + 64 * f.u, y, f.cw * 0.6, 68 * f.u, { font: body(ctx.brand), weight: 600, size: 44 * f.u, align: 'left', fill: solid('#ffffff'), name: `Benefício ${i + 1}` })
        ]
      })
      return finish(doc, ctx, 'servico', [
        slot(f.left + f.cw * 0.45, f.top + f.ch * 0.38, f.cw * 0.55, f.ch * 0.5, 'Espaço para foto do serviço'),
        ...logo,
        textLayer(t(ctx, 'titulo', 'Instalação e manutenção'), f.left, y0, f.cw * 0.8, 230 * f.u, { font: heading(ctx.brand), weight: 900, size: 100 * f.u, align: 'left', uppercase: true, fill: solid('#ffffff'), shadow: SHADOW, name: 'Título' }),
        ...items,
        textLayer(t(ctx, 'cta', 'Solicite seu orçamento'), f.left, f.bottom - 90 * f.u, f.cw * 0.55, 90 * f.u, {
          font: body(ctx.brand), weight: 800, size: 40 * f.u, fill: solid('#ffffff'), background: { fill: lin(90, p.primary, p.secondary), padding: 24 * f.u, radius: 18 * f.u }, align: 'left', name: 'Chamada'
        })
      ], lin(170, '#1b1f2e', p.dark))
    }
  },
  {
    id: 'anuncio',
    name: 'Anúncio com foto',
    category: 'anuncios',
    description: 'Foto de fundo com degradê escuro, título forte e botão.',
    formatId: 'ig-feed',
    fields: [
      { id: 'titulo', label: 'Título', value: 'Água quente o ano inteiro' },
      { id: 'texto', label: 'Subtítulo', value: 'Conforto e economia para a sua casa' },
      { id: 'cta', label: 'Botão', value: 'Saiba mais' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      return finish(doc, ctx, 'anuncio', [
        shapeLayer('rect', 0, 0, f.W, f.H, solid('rgba(255,255,255,0.04)'), { role: 'background', name: 'Espaço para foto de fundo', stroke: { color: 'rgba(255,255,255,0.18)', width: 3 } }),
        shapeLayer('rect', 0, f.H * 0.4, f.W, f.H * 0.6, lin(180, 'rgba(0,0,0,0)', 'rgba(0,0,0,0.85)'), { name: 'Degradê' }),
        ...withLogo(doc, ctx, 'tl', 0.3),
        textLayer(t(ctx, 'titulo', 'Água quente o ano inteiro'), f.left, f.bottom - f.ch * 0.42, f.cw, f.ch * 0.22, { font: heading(ctx.brand), weight: 900, size: 104 * f.u, align: 'left', vAlign: 'bottom', fill: solid('#ffffff'), shadow: SHADOW, name: 'Título' }),
        textLayer(t(ctx, 'texto', 'Conforto e economia para a sua casa'), f.left, f.bottom - f.ch * 0.19, f.cw, 70 * f.u, { font: body(ctx.brand), weight: 500, size: 42 * f.u, align: 'left', fill: solid('#ffffffdd'), name: 'Subtítulo' }),
        textLayer(t(ctx, 'cta', 'Saiba mais'), f.left, f.bottom - 86 * f.u, f.cw * 0.4, 86 * f.u, { font: body(ctx.brand), weight: 800, size: 38 * f.u, align: 'left', fill: solid('#ffffff'), background: { fill: solid(p.primary), padding: 22 * f.u, radius: 60 * f.u }, name: 'Botão' })
      ], lin(160, '#2a2a33', '#0e0e12'))
    }
  },
  {
    id: 'stories-chamada',
    name: 'Stories com chamada',
    category: 'social',
    description: 'Vertical, título centralizado e botão dentro da área segura do Stories.',
    formatId: 'ig-story',
    fields: [
      { id: 'pre', label: 'Chamada', value: 'Novidade' },
      { id: 'titulo', label: 'Título', value: 'Seu banho mais quente' },
      { id: 'cta', label: 'Botão', value: 'Arraste para cima' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const logo = withLogo(doc, ctx, 'tc', 0.4)
      const y0 = (logo[0]?.y ?? f.top) + (logo[0]?.h ?? 0) + 70 * f.u
      return finish(doc, ctx, 'stories-chamada', [
        effectLayer('bokeh', doc, [p.secondary, p.light], { density: 0.4, opacity: 0.5, name: 'Bokeh' }),
        ...logo,
        textLayer(t(ctx, 'pre', 'Novidade'), f.left, y0, f.cw, 80 * f.u, { font: body(ctx.brand), weight: 700, size: 40 * f.u, uppercase: true, letterSpacing: 12 * f.u, fill: solid(p.secondary), name: 'Chamada' }),
        textLayer(t(ctx, 'titulo', 'Seu banho mais quente'), f.left, y0 + 90 * f.u, f.cw, 320 * f.u, { font: heading(ctx.brand), weight: 900, size: 130 * f.u, uppercase: true, fill: solid('#ffffff'), shadow: SHADOW, name: 'Título' }),
        slot(f.left + f.cw * 0.1, y0 + 450 * f.u, f.cw * 0.8, Math.max(200, f.bottom - 140 * f.u - (y0 + 470 * f.u)), 'Espaço para imagem'),
        textLayer(t(ctx, 'cta', 'Arraste para cima'), f.left + f.cw * 0.2, f.bottom - 96 * f.u, f.cw * 0.6, 96 * f.u, { font: body(ctx.brand), weight: 800, size: 40 * f.u, fill: solid(p.dark), background: { fill: solid('#ffffff'), padding: 24 * f.u, radius: 60 * f.u }, name: 'Botão' })
      ], lin(180, p.primary, p.dark))
    }
  },
  {
    id: 'capa-reels',
    name: 'Capa de Reels',
    category: 'social',
    description: 'Título enorme com contorno no centro do quadro (fica legível na grade do perfil).',
    formatId: 'ig-story',
    fields: [{ id: 'titulo', label: 'Título', value: 'Como funciona um aquecedor a gás' }],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const midH = Math.min(f.ch, f.cw * 1.25)
      return finish(doc, ctx, 'capa-reels', [
        shapeLayer('rect', 0, 0, f.W, f.H, solid('rgba(255,255,255,0.04)'), { role: 'background', name: 'Espaço para foto de fundo', stroke: { color: 'rgba(255,255,255,0.18)', width: 3 } }),
        effectLayer('vignette', doc, ['#000000'], { density: 0.8, name: 'Vinheta' }),
        ...withLogo(doc, ctx, 'tc', 0.36),
        textLayer(t(ctx, 'titulo', 'Como funciona um aquecedor a gás'), f.left, f.top + (f.ch - midH * 0.5) / 2, f.cw, midH * 0.5, {
          font: heading(ctx.brand), weight: 900, size: 150 * f.u, uppercase: true, lineHeight: 1, fill: solid('#ffffff'), stroke: { color: p.dark, width: 8 * f.u }, shadow: SHADOW, name: 'Título'
        }),
        shapeLayer('line', f.left + f.cw * 0.3, f.top + (f.ch + midH * 0.5) / 2 + 30 * f.u, f.cw * 0.4, 12 * f.u, solid(p.secondary), { name: 'Detalhe' })
      ], lin(180, '#222', '#000'))
    }
  },
  {
    id: 'thumb-youtube',
    name: 'Miniatura de YouTube',
    category: 'social',
    description: 'Texto curto e grande à esquerda, rosto/objeto à direita, contraste alto.',
    formatId: 'yt-thumb',
    fields: [
      { id: 'titulo', label: 'Texto principal', value: 'Água fria no banho?' },
      { id: 'tag', label: 'Etiqueta', value: 'Resolvido' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      return finish(doc, ctx, 'thumb-youtube', [
        effectLayer('rays', doc, [p.secondary], { x: f.W * 0.3, w: f.W, opacity: 0.3, density: 0.6, name: 'Raios' }),
        slot(f.left + f.cw * 0.52, f.top, f.cw * 0.48, f.ch, 'Espaço para rosto ou produto'),
        textLayer(t(ctx, 'titulo', 'Água fria no banho?'), f.left, f.top + f.ch * 0.08, f.cw * 0.56, f.ch * 0.6, { font: heading(ctx.brand), weight: 900, size: 120 * f.u, uppercase: true, align: 'left', lineHeight: 1, fill: solid('#ffffff'), stroke: { color: '#000000', width: 6 * f.u }, shadow: SHADOW, name: 'Texto principal' }),
        textLayer(t(ctx, 'tag', 'Resolvido'), f.left, f.top + f.ch * 0.72, f.cw * 0.36, f.ch * 0.18, { font: heading(ctx.brand), weight: 900, size: 64 * f.u, uppercase: true, rotation: -4, fill: solid(p.dark), background: { fill: solid(p.accent), padding: 14 * f.u, radius: 10 * f.u }, name: 'Etiqueta' }),
        ...withLogo(doc, ctx, 'bl', 0.14)
      ], lin(120, p.primary, p.dark))
    }
  },
  {
    id: 'antes-depois',
    name: 'Antes e depois',
    category: 'empresa',
    description: 'Duas fotos lado a lado (ou empilhadas no vertical) com etiquetas.',
    formatId: 'ig-square',
    fields: [
      { id: 'titulo', label: 'Título', value: 'Antes e depois' },
      { id: 'a', label: 'Etiqueta 1', value: 'Antes' },
      { id: 'b', label: 'Etiqueta 2', value: 'Depois' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const top = f.top + 150 * f.u
      const gap = 24 * f.u
      const vertical = f.H > f.W * 1.1
      const bw = vertical ? f.cw : (f.cw - gap) / 2
      const bh = vertical ? (f.bottom - top - gap - 90 * f.u) / 2 : f.bottom - top - 90 * f.u
      const b2x = vertical ? f.left : f.left + bw + gap
      const b2y = vertical ? top + bh + gap : top
      const tag = (txt: string, x: number, y: number, fill: string, name: string): Layer =>
        textLayer(txt, x + 20 * f.u, y + 20 * f.u, Math.min(bw * 0.5, 300 * f.u), 70 * f.u, { font: heading(ctx.brand), weight: 900, size: 38 * f.u, uppercase: true, fill: solid('#ffffff'), background: { fill: solid(fill), padding: 14 * f.u, radius: 10 * f.u }, align: 'left', name })
      return finish(doc, ctx, 'antes-depois', [
        slot(f.left, top, bw, bh, 'Foto antes'),
        slot(b2x, b2y, bw, bh, 'Foto depois'),
        tag(t(ctx, 'a', 'Antes'), f.left, top, '#3f3f46', 'Etiqueta antes'),
        tag(t(ctx, 'b', 'Depois'), b2x, b2y, p.primary, 'Etiqueta depois'),
        textLayer(t(ctx, 'titulo', 'Antes e depois'), f.left, f.top, f.cw * 0.65, 120 * f.u, { font: heading(ctx.brand), weight: 900, size: 84 * f.u, uppercase: true, align: 'left', fill: solid('#ffffff'), name: 'Título' }),
        ...withLogo(doc, ctx, 'tr', 0.26)
      ], solid(p.dark))
    }
  },
  {
    id: 'comunicado',
    name: 'Comunicado',
    category: 'empresa',
    description: 'Etiqueta "Comunicado", título, texto e rodapé com a logo.',
    formatId: 'ig-feed',
    fields: [
      { id: 'tag', label: 'Etiqueta', value: 'Comunicado' },
      { id: 'titulo', label: 'Título', value: '[assunto do comunicado]' },
      { id: 'texto', label: 'Texto', value: '[escreva aqui a informação oficial — datas, horários e contatos reais]' }
    ],
    build(doc, ctx) {
      const f = frame(doc), p = paletteOf(ctx.brand)
      const footer = 170 * f.u
      return finish(doc, ctx, 'comunicado', [
        shapeLayer('rect', 0, f.H - footer - (f.H - f.bottom), f.W, footer + (f.H - f.bottom), solid('#ffffff'), { name: 'Rodapé' }),
        textLayer(t(ctx, 'tag', 'Comunicado'), f.left, f.top + 40 * f.u, f.cw * 0.5, 70 * f.u, { font: body(ctx.brand), weight: 800, size: 34 * f.u, uppercase: true, letterSpacing: 8 * f.u, align: 'left', fill: solid('#ffffff'), background: { fill: solid(p.primary), padding: 16 * f.u, radius: 10 * f.u }, name: 'Etiqueta' }),
        textLayer(t(ctx, 'titulo', '[assunto do comunicado]'), f.left, f.top + 160 * f.u, f.cw, 260 * f.u, { font: heading(ctx.brand), weight: 900, size: 96 * f.u, align: 'left', vAlign: 'top', fill: solid('#ffffff'), name: 'Título' }),
        textLayer(t(ctx, 'texto', '[escreva aqui a informação oficial — datas, horários e contatos reais]'), f.left, f.top + 450 * f.u, f.cw, Math.max(100, f.H - footer - (f.H - f.bottom) - (f.top + 480 * f.u)), { font: body(ctx.brand), weight: 500, size: 44 * f.u, align: 'left', vAlign: 'top', lineHeight: 1.3, fill: solid('#ffffffdd'), name: 'Texto' }),
        ...withLogo(doc, ctx, 'bc', 0.3)
      ], lin(170, p.dark, '#000000'))
    }
  }
]

export const templateById = (id: string | null | undefined): Template | undefined => TEMPLATES.find((x) => x.id === id)

/** Monta o template no formato pedido (com o tamanho do formato ou um tamanho personalizado). */
export function buildTemplate(tpl: Template, formatId: ImageFormatId, ctx: TemplateContext, size?: { width: number; height: number }): ImageDoc {
  const f = formatById(formatId)
  const base = emptyDoc(formatId, size?.width ?? f.width, size?.height ?? f.height)
  return tpl.build(base, ctx)
}
