// Image Studio: documento de composição (camadas), formatos, marcas e provedores de geração.
// Compartilhado entre o processo principal (valida tudo que chega do Claude e da interface)
// e o renderer (desenha no Canvas e exporta).

export type ImageFormatId = 'ig-feed' | 'ig-story' | 'ig-square' | 'tiktok' | 'yt-thumb' | 'full-hd' | 'custom'

export interface SafeArea { top: number; right: number; bottom: number; left: number }

export interface ImageFormat {
  id: ImageFormatId
  label: string
  width: number
  height: number
  /** Margens (px) onde a plataforma sobrepõe a interface: textos e logo devem ficar dentro. */
  safe: SafeArea
  note: string
}

export const IMAGE_FORMATS: ImageFormat[] = [
  { id: 'ig-feed', label: 'Instagram Feed', width: 1080, height: 1350, safe: { top: 60, right: 60, bottom: 60, left: 60 }, note: 'Na grade do perfil aparece cortado em 3:4 — deixe as laterais livres.' },
  { id: 'ig-story', label: 'Instagram Stories', width: 1080, height: 1920, safe: { top: 250, right: 64, bottom: 340, left: 64 }, note: 'Topo (perfil) e base (resposta) ficam cobertos pela interface.' },
  { id: 'ig-square', label: 'Instagram Quadrado', width: 1080, height: 1080, safe: { top: 60, right: 60, bottom: 60, left: 60 }, note: '' },
  { id: 'tiktok', label: 'TikTok', width: 1080, height: 1920, safe: { top: 160, right: 150, bottom: 420, left: 64 }, note: 'Botões à direita e legenda/descrição na base.' },
  { id: 'yt-thumb', label: 'YouTube Thumbnail', width: 1280, height: 720, safe: { top: 40, right: 220, bottom: 90, left: 40 }, note: 'O canto inferior direito recebe a duração do vídeo.' },
  { id: 'full-hd', label: 'Full HD', width: 1920, height: 1080, safe: { top: 54, right: 96, bottom: 54, left: 96 }, note: '' },
  { id: 'custom', label: 'Personalizado', width: 1080, height: 1080, safe: { top: 48, right: 48, bottom: 48, left: 48 }, note: 'Tamanho definido por você.' }
]

export function formatById(id: string | null | undefined): ImageFormat {
  return IMAGE_FORMATS.find((f) => f.id === id) ?? IMAGE_FORMATS[0]
}

/** Margem de segurança proporcional para formatos personalizados. */
export function safeAreaFor(doc: { width: number; height: number; formatId: ImageFormatId }): SafeArea {
  const f = formatById(doc.formatId)
  if (f.id !== 'custom' && f.width === doc.width && f.height === doc.height) return f.safe
  const m = Math.round(Math.min(doc.width, doc.height) * 0.05)
  return { top: m, right: m, bottom: m, left: m }
}

export interface GradientStop { offset: number; color: string }
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: GradientStop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: GradientStop[] }

export interface Shadow { color: string; blur: number; x: number; y: number }
export interface Stroke { color: string; width: number }

export type LayerRole = 'background' | 'subject' | 'logo' | 'text' | 'decor'
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'lighter'

interface LayerBase {
  id: string
  name: string
  role: LayerRole
  /** Caixa da camada em pixels do documento (canto superior esquerdo). */
  x: number
  y: number
  w: number
  h: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  shadow: Shadow | null
  blend: BlendMode
}

export interface ImageLayer extends LayerBase {
  type: 'image'
  /** Caminho absoluto: pasta do projeto ou biblioteca de assets (validado no processo principal). */
  src: string
  fit: 'cover' | 'contain' | 'fill'
  /** Ponto de interesse para o recorte inteligente (0–1). */
  focusX: number
  focusY: number
  radius: number
  stroke: Stroke | null
  flipX: boolean
  /** Ajustes não destrutivos. */
  brightness: number
  contrast: number
  saturation: number
  /** Para logos: id da versão da logo na marca. */
  logoId: string | null
}

export interface TextLayer extends LayerBase {
  type: 'text'
  text: string
  font: string
  weight: number
  italic: boolean
  size: number
  fill: Fill
  align: 'left' | 'center' | 'right'
  vAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
  letterSpacing: number
  uppercase: boolean
  stroke: Stroke | null
  /** Reduz a fonte automaticamente até o texto caber na caixa. */
  autoFit: boolean
  /** Faixa/pílula atrás do texto. */
  background: { fill: Fill; padding: number; radius: number } | null
}

export type ShapeKind = 'rect' | 'ellipse' | 'burst' | 'triangle' | 'line' | 'blob'

export interface ShapeLayer extends LayerBase {
  type: 'shape'
  shape: ShapeKind
  fill: Fill
  stroke: Stroke | null
  radius: number
  points: number
  innerRatio: number
}

export type EffectKind = 'rays' | 'bokeh' | 'confetti' | 'sparkles' | 'vignette' | 'grain' | 'glow'

export interface EffectLayer extends LayerBase {
  type: 'effect'
  effect: EffectKind
  colors: string[]
  seed: number
  density: number
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | EffectLayer
export type LayerType = Layer['type']

export interface ImageDoc {
  version: 1
  width: number
  height: number
  formatId: ImageFormatId
  background: Fill
  layers: Layer[]
  meta: { brandId: string | null; templateId: string | null; style: string | null; title: string }
}

export const MAX_DOC_SIDE = 4096
export const MAX_LAYERS = 120

// ————— Marcas —————

export interface BrandColor { name: string; hex: string }

export interface BrandLogo {
  id: string
  name: string
  path: string
  /** colorida = fundos claros; branca = fundos escuros/laranja. */
  variant: 'colorida' | 'branca' | 'escura' | 'outra'
  width: number
  height: number
  /** Arquivo de onde foi extraída (ex.: o PDF original). */
  source: string | null
}

export interface Brand {
  id: string
  name: string
  slogan: string
  colors: BrandColor[]
  fonts: { heading: string; body: string }
  style: string
  preferences: string
  /** Regras obrigatórias (aplicadas pelo Claude e verificadas pelo editor). */
  rules: string[]
  logos: BrandLogo[]
  defaultLogoId: string | null
  /** Margem livre ao redor da logo, em fração do menor lado da arte. */
  logoMargin: number
  assets: string[]
  folder: string
  createdAt: number
  updatedAt: number
}

export type BrandInput = Partial<Pick<Brand, 'name' | 'slogan' | 'colors' | 'fonts' | 'style' | 'preferences' | 'rules' | 'defaultLogoId' | 'logoMargin' | 'assets'>>

// ————— Projetos de imagem —————

export interface ImageProjectInfo {
  projectId: string
  brandId: string | null
  formatId: ImageFormatId
  originalPrompt: string
  style: string
  provider: ProviderId
  lastExport: string | null
  /** Incrementa a cada gravação do design.json (detecta mudanças feitas pelo Claude). */
  revision: number
}

export interface NewImageProjectInput {
  name: string
  brandId: string | null
  formatId: ImageFormatId
  width?: number
  height?: number
  prompt: string
  style: string
  /** Documento inicial (ex.: template já preenchido). */
  doc?: ImageDoc
}

export interface PendingRender { versionId: string; doc: ImageDoc }

export type ExportFormat = 'png' | 'jpg' | 'webp'

// ————— Provedores de geração —————

export type ProviderId = 'composition' | 'openai' | 'gemini' | 'sd-local' | 'pollinations'

export interface ProviderInfo {
  id: ProviderId
  name: string
  kind: 'composicao' | 'api' | 'local' | 'externo-gratuito'
  paid: boolean
  /** O que custa e quem cobra — mostrado antes de gerar. */
  costNote: string
  /** O que sai do computador ao gerar. */
  privacyNote: string
  needsKey: boolean
  hasKey: boolean
  /** Últimos 4 caracteres da chave (nunca a chave inteira). */
  keyHint: string | null
  model: string
  endpoint: string
  enabled: boolean
  ready: boolean
  setupHint: string
}

export interface ProviderConfigInput { model?: string; endpoint?: string; enabled?: boolean }

export interface GenerateRequest {
  projectId: string
  provider: ProviderId
  prompt: string
  negative?: string
  role: 'background' | 'subject'
  width: number
  height: number
  /** Identifica o cartão do chat que pediu (evita gerar duas vezes o mesmo pedido). */
  requestKey?: string
}

export interface GenerateResult {
  path: string
  width: number
  height: number
  provider: ProviderId
  prompt: string
}

export interface StylePreset {
  id: string
  name: string
  description: string
  /** Acrescentado ao prompt enviado ao gerador. */
  prompt: string
  negative: string
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'premium-3d',
    name: 'Premium Advertising 3D',
    description: 'Campanha publicitária com mascote 3D, materiais realistas e luz cinematográfica.',
    prompt: 'premium advertising key visual, high-end 3D render, expressive friendly 3D mascot character with appealing proportions (Pixar-like quality) when appropriate, realistic materials (glossy plastic, brushed metal, soft fabric), soft cinematic studio lighting with warm rim light, shallow depth of field, natural contact shadows, vibrant harmonious color palette, tasteful thematic props, clean professional composition with clear focal point and generous empty space for headline and logo, sharp details, 8k quality',
    negative: 'text, letters, words, typography, logo, watermark, signature, brand names, distorted hands, extra limbs, deformed face, cluttered composition, low quality, blurry, amateur, clip art, oversaturated'
  },
  {
    id: 'foto-produto',
    name: 'Foto de produto',
    description: 'Produto em cenário fotográfico realista, luz de estúdio.',
    prompt: 'professional commercial product photography, realistic studio scene, softbox lighting, subtle reflections, shallow depth of field, premium color grading, clean background with space for text',
    negative: 'text, letters, logo, watermark, people, clutter, low quality, blurry'
  },
  {
    id: 'flat-moderno',
    name: 'Flat moderno',
    description: 'Ilustração vetorial limpa, formas geométricas e cores chapadas.',
    prompt: 'modern flat vector illustration, clean geometric shapes, bold harmonious colors, subtle grain texture, balanced composition with empty space for headline',
    negative: 'text, letters, logo, watermark, photorealistic, clutter, low quality'
  },
  {
    id: 'minimalista',
    name: 'Minimalista elegante',
    description: 'Poucos elementos, muito respiro, tons sóbrios.',
    prompt: 'minimal elegant advertising background, soft gradient lighting, single refined focal object, lots of negative space, premium editorial look',
    negative: 'text, letters, logo, watermark, busy, clutter, low quality'
  }
]

export const styleById = (id: string | null | undefined): StylePreset => STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS[0]
