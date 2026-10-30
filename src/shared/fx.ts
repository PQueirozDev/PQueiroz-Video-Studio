// Catálogo de transições e efeitos que o motor de render sabe executar.
// É a única fonte de verdade: a interface, o agente e o compilador do FFmpeg leem daqui,
// então nada aparece na tela (ou é oferecido ao Claude) sem ter uma implementação real.

export interface FxParam {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

export interface TransitionDef {
  id: string
  name: string
  category: 'basica' | 'cinematica' | 'gaming'
  /** Nome do efeito no filtro xfade do FFmpeg. */
  xfade: string
  defaultDuration: number
}

export interface EffectDef {
  id: string
  name: string
  /** 'audio' entra na cadeia de áudio do clipe; 'video' na de imagem. */
  kind?: 'video' | 'audio'
  category: 'cor' | 'estilo' | 'desfoque' | 'gaming' | 'audio'
  params: FxParam[]
  /** Precisa de um arquivo da biblioteca (ex.: LUT .cube). */
  asset?: 'lut'
  /**
   * Monta a cadeia de filtros FFmpeg com os parâmetros já validados, o caminho do arquivo (se houver)
   * e o tamanho do quadro de saída (alguns efeitos recortam e precisam voltar ao tamanho exato).
   */
  filter(p: Record<string, number>, assetPath?: string, size?: { w: number; h: number }): string
}

const T = (id: string, name: string, category: TransitionDef['category'], xfade: string, defaultDuration = 0.5): TransitionDef => ({ id, name, category, xfade, defaultDuration })

export const TRANSITIONS: TransitionDef[] = [
  T('cross-dissolve', 'Dissolver', 'basica', 'fade'),
  T('fade-black', 'Fade para preto', 'basica', 'fadeblack', 0.8),
  T('fade-white', 'Fade para branco', 'basica', 'fadewhite', 0.6),
  T('dissolve', 'Dissolver granulado', 'basica', 'dissolve'),
  T('slide-left', 'Deslizar à esquerda', 'basica', 'slideleft', 0.4),
  T('slide-right', 'Deslizar à direita', 'basica', 'slideright', 0.4),
  T('slide-up', 'Deslizar para cima', 'basica', 'slideup', 0.4),
  T('slide-down', 'Deslizar para baixo', 'basica', 'slidedown', 0.4),
  T('wipe-left', 'Wipe à esquerda', 'basica', 'wipeleft', 0.4),
  T('wipe-right', 'Wipe à direita', 'basica', 'wiperight', 0.4),
  T('push-left', 'Empurrar à esquerda', 'basica', 'coverleft', 0.4),
  T('zoom-in', 'Zoom in', 'basica', 'zoomin', 0.5),
  T('smooth-left', 'Suave à esquerda', 'cinematica', 'smoothleft', 0.6),
  T('smooth-right', 'Suave à direita', 'cinematica', 'smoothright', 0.6),
  T('circle-open', 'Íris abrindo', 'cinematica', 'circleopen', 0.7),
  T('circle-close', 'Íris fechando', 'cinematica', 'circleclose', 0.7),
  T('blur-horizontal', 'Desfoque horizontal', 'cinematica', 'hblur', 0.5),
  T('radial', 'Radial', 'cinematica', 'radial', 0.6),
  T('fade-grays', 'Fade em cinza', 'cinematica', 'fadegrays', 0.8),
  T('pixelize', 'Pixelizar', 'gaming', 'pixelize', 0.5),
  T('distance', 'Distorção', 'gaming', 'distance', 0.4),
  T('squeeze-h', 'Comprimir horizontal', 'gaming', 'squeezeh', 0.35),
  T('slice-h', 'Fatias horizontais', 'gaming', 'hlslice', 0.4),
  T('wipe-up', 'Wipe para cima', 'basica', 'wipeup', 0.4),
  T('wipe-down', 'Wipe para baixo', 'basica', 'wipedown', 0.4),
  T('smooth-up', 'Suave para cima', 'cinematica', 'smoothup', 0.6),
  T('smooth-down', 'Suave para baixo', 'cinematica', 'smoothdown', 0.6),
  T('vert-open', 'Abrir vertical', 'cinematica', 'vertopen', 0.6),
  T('horz-close', 'Fechar horizontal', 'cinematica', 'horzclose', 0.6),
  T('diagonal', 'Diagonal', 'basica', 'diagtl', 0.5),
  T('reveal-left', 'Revelar à esquerda', 'basica', 'revealleft', 0.4),
  T('squeeze-v', 'Comprimir vertical', 'gaming', 'squeezev', 0.35),
  T('wind', 'Vento', 'gaming', 'hlwind', 0.5)
]

const n = (v: number, digits = 3): string => Number(v.toFixed(digits)).toString()
const P = (key: string, label: string, min: number, max: number, def: number, step = 0.01): FxParam => ({ key, label, min, max, step, default: def })

const curvePoint = (x: number, dy: number): string => `${n(x)}/${n(Math.min(0.98, Math.max(0.02, x + dy)))}`
const dbToLin = (db: number): string => n(10 ** (db / 20), 5)

export const EFFECTS: EffectDef[] = [
  { id: 'color-grade', name: 'Correção de cor', category: 'cor',
    params: [P('exposure', 'Exposição', -2, 2, 0), P('contrast', 'Contraste', 0.5, 2, 1), P('saturation', 'Saturação', 0, 2, 1), P('temperature', 'Temperatura (K)', 2000, 12000, 6500, 100),
      P('tint', 'Matiz verde/magenta', -1, 1, 0), P('highlights', 'Realces', -1, 1, 0), P('shadows', 'Sombras', -1, 1, 0), P('gamma', 'Gama', 0.5, 2, 1)],
    filter: (p) => {
      // Só entra o estágio que saiu do neutro (menos trabalho por quadro).
      const f: string[] = []
      if (p.exposure !== 0) f.push(`exposure=exposure=${n(p.exposure)}`)
      if (p.temperature !== 6500) f.push(`colortemperature=temperature=${Math.round(p.temperature)}`)
      if (p.contrast !== 1 || p.saturation !== 1 || p.gamma !== 1) f.push(`eq=contrast=${n(p.contrast)}:saturation=${n(p.saturation)}:gamma=${n(p.gamma)}`)
      if (p.shadows !== 0 || p.highlights !== 0) f.push(`curves=master='0/0 ${curvePoint(0.25, p.shadows * 0.15)} 0.5/0.5 ${curvePoint(0.75, p.highlights * 0.15)} 1/1'`)
      if (p.tint !== 0) f.push(`colorbalance=gs=${n(-p.tint * 0.25)}:gm=${n(-p.tint * 0.25)}:gh=${n(-p.tint * 0.15)}`)
      return f.length ? f.join(',') : 'null'
    } },
  { id: 'lut', name: 'LUT (look de cor)', category: 'cor', asset: 'lut', params: [],
    filter: (_p, path) => `lut3d=file=${path}:interp=tetrahedral` },
  { id: 'color-match', name: 'Correspondência de cor', category: 'cor',
    params: [P('rGain', 'Ganho R', 0.5, 2, 1), P('gGain', 'Ganho G', 0.5, 2, 1), P('bGain', 'Ganho B', 0.5, 2, 1), P('rOffset', 'Desvio R', -0.3, 0.3, 0), P('gOffset', 'Desvio G', -0.3, 0.3, 0), P('bOffset', 'Desvio B', -0.3, 0.3, 0)],
    filter: (p) => `lutrgb=r='clipval*${n(p.rGain)}+${n(p.rOffset * 255)}':g='clipval*${n(p.gGain)}+${n(p.gOffset * 255)}':b='clipval*${n(p.bGain)}+${n(p.bOffset * 255)}'` },
  { id: 'denoise', name: 'Redução de ruído', kind: 'audio', category: 'audio',
    params: [P('amount', 'Redução (dB)', 3, 40, 12, 1)],
    filter: (p) => `afftdn=nr=${Math.round(p.amount)}:nf=-50` },
  { id: 'eq3', name: 'Equalizador (3 bandas)', kind: 'audio', category: 'audio',
    params: [P('low', 'Graves (dB)', -12, 12, 0, 0.5), P('mid', 'Médios (dB)', -12, 12, 0, 0.5), P('high', 'Agudos (dB)', -12, 12, 0, 0.5)],
    filter: (p) => `equalizer=f=100:t=q:w=0.8:g=${n(p.low)},equalizer=f=1500:t=q:w=1:g=${n(p.mid)},equalizer=f=8000:t=q:w=0.8:g=${n(p.high)}` },
  { id: 'compressor', name: 'Compressor', kind: 'audio', category: 'audio',
    params: [P('threshold', 'Limiar (dB)', -40, 0, -18, 0.5), P('ratio', 'Razão', 1, 20, 4, 0.5), P('makeup', 'Ganho (dB)', 0, 18, 3, 0.5)],
    filter: (p) => `acompressor=threshold=${dbToLin(p.threshold)}:ratio=${n(p.ratio)}:makeup=${dbToLin(p.makeup)}:attack=10:release=150` },
  { id: 'voice-clarity', name: 'Voz mais clara', kind: 'audio', category: 'audio',
    params: [P('presence', 'Presença (dB)', 0, 9, 3, 0.5)],
    filter: (p) => `highpass=f=80,equalizer=f=3000:t=q:w=1:g=${n(p.presence)}` },
  { id: 'loudness', name: 'Normalizar volume', kind: 'audio', category: 'audio',
    params: [P('target', 'Alvo (LUFS)', -24, -10, -14, 0.5)],
    filter: (p) => `loudnorm=I=${n(p.target)}:TP=-1.5:LRA=11,aresample=48000` },
  { id: 'color-adjust', name: 'Brilho e contraste', category: 'cor',
    params: [P('brightness', 'Brilho', -1, 1, 0), P('contrast', 'Contraste', 0, 3, 1), P('saturation', 'Saturação', 0, 3, 1), P('gamma', 'Gama', 0.1, 4, 1)],
    filter: (p) => `eq=brightness=${n(p.brightness)}:contrast=${n(p.contrast)}:saturation=${n(p.saturation)}:gamma=${n(p.gamma)}` },
  { id: 'exposure', name: 'Exposição', category: 'cor',
    params: [P('stops', 'Stops', -3, 3, 0.5)],
    filter: (p) => `exposure=exposure=${n(p.stops)}` },
  { id: 'temperature', name: 'Temperatura de cor', category: 'cor',
    params: [P('kelvin', 'Kelvin', 2000, 12000, 6500, 100)],
    filter: (p) => `colortemperature=temperature=${Math.round(p.kelvin)}` },
  { id: 'black-white', name: 'Preto e branco', category: 'cor', params: [], filter: () => 'hue=s=0' },
  { id: 'sepia', name: 'Sépia', category: 'cor', params: [],
    filter: () => 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131' },
  { id: 'gaussian-blur', name: 'Desfoque gaussiano', category: 'desfoque',
    params: [P('sigma', 'Intensidade', 0.5, 50, 8, 0.5)],
    filter: (p) => `gblur=sigma=${n(p.sigma, 2)}` },
  { id: 'sharpen', name: 'Nitidez', category: 'desfoque',
    params: [P('amount', 'Intensidade', 0, 3, 1)],
    filter: (p) => `unsharp=5:5:${n(p.amount, 2)}:5:5:0` },
  { id: 'vignette', name: 'Vinheta', category: 'estilo',
    params: [P('strength', 'Intensidade', 0, 1, 0.5)],
    filter: (p) => `vignette=angle=${n(0.1 + p.strength * 1.1)}` },
  { id: 'film-grain', name: 'Granulação', category: 'estilo',
    params: [P('amount', 'Intensidade', 0, 60, 18, 1)],
    filter: (p) => `noise=c0s=${Math.round(p.amount)}:c0f=t+u` },
  { id: 'curves', name: 'Curvas', category: 'cor',
    // Curva geral em 5 pontos (x fixo: preto, sombras, meios, realces, branco) + deslocamento dos meios-tons por canal.
    params: [P('p0', 'Preto', 0, 0.5, 0), P('p25', 'Sombras', 0, 1, 0.25), P('p50', 'Meios-tons', 0, 1, 0.5), P('p75', 'Realces', 0, 1, 0.75), P('p100', 'Branco', 0.5, 1, 1),
      P('red', 'Vermelho', -0.25, 0.25, 0), P('green', 'Verde', -0.25, 0.25, 0), P('blue', 'Azul', -0.25, 0.25, 0)],
    filter: (p) => {
      const ch = (v: number): string => `'0/0 0.5/${n(Math.min(0.98, Math.max(0.02, 0.5 + v)))} 1/1'`
      return `curves=master='0/${n(p.p0)} 0.25/${n(p.p25)} 0.5/${n(p.p50)} 0.75/${n(p.p75)} 1/${n(p.p100)}':red=${ch(p.red)}:green=${ch(p.green)}:blue=${ch(p.blue)}`
    } },
  { id: 'mask', name: 'Máscara', category: 'estilo',
    // Recorta o clipe numa forma (o que fica fora mostra as trilhas de baixo). shape: 0 = elipse, 1 = retângulo.
    params: [P('shape', 'Forma (0 elipse, 1 retângulo)', 0, 1, 0, 1), P('cx', 'Centro X', 0, 1, 0.5), P('cy', 'Centro Y', 0, 1, 0.5), P('w', 'Largura', 0.02, 2, 0.6), P('h', 'Altura', 0.02, 2, 0.6),
      P('feather', 'Suavização', 0, 0.5, 0.05), P('invert', 'Inverter (0/1)', 0, 1, 0, 1)],
    filter: (p) => {
      const dx = `(X/W-${n(p.cx)})/${n(p.w / 2)}`
      const dy = `(Y/H-${n(p.cy)})/${n(p.h / 2)}`
      const d = Math.round(p.shape) === 1 ? `max(abs(${dx}),abs(${dy}))` : `hypot(${dx},${dy})`
      // 1 dentro, 0 fora, rampa linear na borda (largura = suavização relativa ao tamanho da forma).
      const inside = p.feather > 0 ? `clip((1-${d})/${n(Math.max(0.001, p.feather * 2))},0,1)` : `lte(${d},1)`
      const m = Math.round(p.invert) === 1 ? `(1-${inside})` : inside
      return `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*${m}'`
    } },
  { id: 'pixelate', name: 'Pixelizar', category: 'estilo',
    params: [P('size', 'Tamanho do pixel', 2, 64, 12, 1)],
    filter: (p) => `pixelize=w=${Math.round(p.size)}:h=${Math.round(p.size)}:m=avg` },
  { id: 'mirror', name: 'Espelhar', category: 'estilo',
    params: [P('vertical', 'Vertical (0/1)', 0, 1, 0, 1)],
    filter: (p) => (Math.round(p.vertical) === 1 ? 'vflip' : 'hflip') },
  { id: 'invert', name: 'Negativo', category: 'estilo', params: [], filter: () => 'negate' },
  { id: 'hue-shift', name: 'Girar matiz', category: 'cor',
    params: [P('degrees', 'Graus', -180, 180, 90, 1)],
    filter: (p) => `hue=h=${Math.round(p.degrees)}` },
  { id: 'sketch', name: 'Esboço (bordas)', category: 'estilo',
    params: [P('detail', 'Detalhe', 0.05, 0.5, 0.2)],
    filter: (p) => `edgedetect=mode=colormix:high=${n(p.detail)}:low=${n(p.detail / 4)}` },
  { id: 'posterize', name: 'Posterizar', category: 'estilo',
    params: [P('levels', 'Níveis de cor', 2, 16, 5, 1)],
    filter: (p) => {
      const q = n(256 / Math.round(p.levels), 4)
      const e = `'floor(val/${q})*${q}'`
      return `lutrgb=r=${e}:g=${e}:b=${e}`
    } },
  { id: 'camera-shake', name: 'Tremor de câmera', category: 'gaming',
    // Recorta uma janela que passeia pelo quadro e volta ao tamanho cheio (sem bordas pretas).
    params: [P('amount', 'Intensidade', 0.005, 0.08, 0.02, 0.005), P('speed', 'Velocidade', 0.2, 3, 1, 0.1)],
    filter: (p, _a, size) => {
      const w = size?.w ?? 1920, h = size?.h ?? 1080
      const mx = Math.max(2, Math.round((w * p.amount) / 2) * 2), my = Math.max(2, Math.round((h * p.amount) / 2) * 2)
      const sp = n(p.speed)
      return `crop=${w - 2 * mx}:${h - 2 * my}:x='${mx}+${mx}*sin(t*${sp}*23)*cos(t*${sp}*9)':y='${my}+${my}*cos(t*${sp}*19)*sin(t*${sp}*7)',scale=${w}:${h}:flags=bicubic`
    } },
  { id: 'glitch', name: 'Glitch digital', category: 'gaming',
    params: [P('amount', 'Intensidade', 0, 1, 0.5)],
    filter: (p) => `rgbashift=rh=${-Math.round(4 + p.amount * 16)}:gv=${Math.round(2 + p.amount * 6)}:bh=${Math.round(4 + p.amount * 16)},noise=c0s=${Math.round(p.amount * 30)}:c0f=t` },
  { id: 'lens-distortion', name: 'Distorção de lente', category: 'estilo',
    params: [P('amount', 'Curvatura', -0.5, 0.5, -0.2)],
    filter: (p) => `lenscorrection=k1=${n(p.amount)}:k2=${n(p.amount / 3)}:i=bilinear` },
  { id: 'letterbox', name: 'Barras de cinema', category: 'estilo',
    params: [P('aspect', 'Proporção', 1.85, 2.76, 2.39)],
    filter: (p, _a, size) => {
      const w = size?.w ?? 1920, h = size?.h ?? 1080
      const bar = Math.max(0, Math.round((h - w / p.aspect) / 2))
      return bar > 0 ? `drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill,drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill` : 'null'
    } },
  { id: 'vhs', name: 'VHS', category: 'estilo',
    params: [P('amount', 'Intensidade', 0, 1, 0.6)],
    filter: (p) => `rgbashift=rh=${-Math.round(1 + p.amount * 4)}:bh=${Math.round(1 + p.amount * 4)},eq=saturation=${n(1 - p.amount * 0.25)}:contrast=1.05,noise=c0s=${Math.round(4 + p.amount * 14)}:c0f=t,drawgrid=w=iw:h=4:t=1:c=black@${n(0.1 + p.amount * 0.2)}` },
  { id: 'thermal', name: 'Câmera térmica', category: 'gaming',
    params: [P('palette', 'Paleta (0 calor, 1 inferno, 2 turbo)', 0, 2, 0, 1)],
    filter: (p) => `pseudocolor=preset=${['heat', 'inferno', 'turbo'][Math.round(p.palette)]}` },
  { id: 'rgb-split', name: 'RGB split', category: 'gaming',
    params: [P('offset', 'Deslocamento (px)', 0, 40, 6, 1)],
    filter: (p) => `rgbashift=rh=${-Math.round(p.offset)}:bh=${Math.round(p.offset)}` }
]

export const transitionById = (id: string): TransitionDef | undefined => TRANSITIONS.find((t) => t.id === id)
export const effectById = (id: string): EffectDef | undefined => EFFECTS.find((e) => e.id === id)

/** Completa e limita os parâmetros de um efeito; rejeita chaves que o efeito não conhece. */
export function normalizeParams(def: EffectDef, input: Record<string, unknown> = {}, base: Record<string, number> = {}): Record<string, number> {
  for (const key of Object.keys(input)) {
    if (!def.params.some((p) => p.key === key)) throw new Error(`O efeito "${def.name}" não tem o parâmetro "${key}".`)
  }
  const out: Record<string, number> = {}
  for (const p of def.params) {
    const raw = key(input, p.key) ?? base[p.key] ?? p.default
    const v = Number(raw)
    if (!Number.isFinite(v)) throw new Error(`Valor inválido para "${p.label}".`)
    out[p.key] = Math.min(p.max, Math.max(p.min, v))
  }
  return out
}

function key(o: Record<string, unknown>, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined
}
