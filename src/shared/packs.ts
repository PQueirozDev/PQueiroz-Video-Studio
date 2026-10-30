import type { Clip, TitleSpec } from './composition'
import type { AnimProp, Keyframe } from './keyframes'

// Formato dos pacotes do Asset Hub (.pqs-pack = zip com um pack.json na raiz + arquivos).
// O mesmo manifesto descreve o pacote essencial que vem com o app (pasta em resources/packs).
// Tudo que vem de um pacote é validado aqui antes de aparecer na interface ou ser oferecido ao Claude.

export const PACK_FORMAT = 1
export const PACK_EXT = '.pqs-pack'

export type PackItemType = 'sfx' | 'overlay' | 'font' | 'lut' | 'title' | 'preset'

/** Template de título: estilo + animação (keyframes e fades), aplicados com o comando addTitle. */
export interface TitleTemplate {
  style: Partial<TitleSpec>
  duration: number
  fadeIn?: number
  fadeOut?: number
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>
}

/** Preset: efeitos e/ou animação aplicados a um clipe selecionado. */
export interface PresetDef {
  /** "look" = cor/estilo; "motion" = movimento (zoom, shake...) */
  kind: 'look' | 'motion'
  effects?: { type: string; params?: Record<string, number>; asset?: string }[]
  /** Keyframes relativos ao ponto de aplicação (`anchor`). */
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>
  anchor?: 'start' | 'playhead' | 'end'
  transform?: Partial<Clip['transform']>
}

export interface PackItem {
  type: PackItemType
  /** Único dentro do pacote: letras, números, - e _. */
  id: string
  name: string
  tags?: string[]
  /** Caminho relativo dentro do pacote (sfx, overlay, font, lut). */
  file?: string
  /** Overlays: modo de mesclagem sugerido. */
  blend?: 'screen' | 'add' | 'normal' | 'multiply' | 'overlay'
  title?: TitleTemplate
  preset?: PresetDef
}

export interface PackManifest {
  format: number
  id: string
  name: string
  version: string
  author: string
  /** Licença do conteúdo (ex.: "OFL-1.1", "CC0-1.0", "Original — uso livre no app"). */
  license: string
  description?: string
  items: PackItem[]
}

export interface PackInfo {
  id: string
  name: string
  version: string
  author: string
  license: string
  description: string
  builtIn: boolean
  counts: Partial<Record<PackItemType, number>>
}

/** Item pronto para a interface/agente: id global = "pacote/item", arquivo já resolvido. */
export interface HubItem extends Omit<PackItem, 'file'> {
  key: string
  packId: string
  packName: string
  packVersion: string
  path?: string
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const FILE_EXT: Record<string, string[]> = {
  sfx: ['.wav', '.mp3', '.ogg', '.flac', '.m4a'],
  overlay: ['.mp4', '.mov', '.webm', '.png', '.jpg'],
  font: ['.ttf', '.otf'],
  lut: ['.cube']
}
const MAX_ITEMS = 2000

/** Caminho relativo seguro dentro do pacote (sem .., sem absoluto, só / como separador). */
export function safeRelPath(p: unknown): string | null {
  if (typeof p !== 'string' || !p || p.length > 200) return null
  const norm = p.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-z]:/i.test(norm) || norm.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null
  if (/[<>:"|?*\x00-\x1f]/.test(norm)) return null
  return norm
}

export const extOf = (p: string): string => (/\.[^./]+$/.exec(p)?.[0] ?? '').toLowerCase()

/** Lança erro legível se o manifesto não for utilizável; devolve uma cópia limpa. */
export function validateManifest(raw: unknown): PackManifest {
  if (!raw || typeof raw !== 'object') throw new Error('pack.json inválido.')
  const o = raw as Record<string, unknown>
  if (o.format !== PACK_FORMAT) throw new Error(`Formato de pacote não suportado (${String(o.format)}).`)
  const text = (v: unknown, what: string, max = 120): string => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`pack.json: falta "${what}".`)
    return v.trim().slice(0, max)
  }
  const id = text(o.id, 'id', 64)
  if (!ID.test(id)) throw new Error('pack.json: "id" só pode ter letras minúsculas, números, - e _.')
  if (!Array.isArray(o.items)) throw new Error('pack.json: falta a lista "items".')
  if (o.items.length > MAX_ITEMS) throw new Error(`Pacote com itens demais (máximo ${MAX_ITEMS}).`)
  const seen = new Set<string>()
  const items: PackItem[] = o.items.map((it: Record<string, unknown>, i: number) => {
    if (!it || typeof it !== 'object') throw new Error(`Item ${i + 1} inválido.`)
    const type = it.type as PackItemType
    if (!['sfx', 'overlay', 'font', 'lut', 'title', 'preset'].includes(type)) throw new Error(`Item ${i + 1}: tipo desconhecido.`)
    const itemId = typeof it.id === 'string' ? it.id : ''
    if (!ID.test(itemId)) throw new Error(`Item ${i + 1}: id inválido.`)
    if (seen.has(itemId)) throw new Error(`Item repetido: ${itemId}.`)
    seen.add(itemId)
    const out: PackItem = { type, id: itemId, name: text(it.name, `items[${i}].name`, 80) }
    if (Array.isArray(it.tags)) out.tags = it.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 30)).slice(0, 12)
    if (FILE_EXT[type]) {
      const file = safeRelPath(it.file)
      if (!file || !FILE_EXT[type].includes(extOf(file))) throw new Error(`Item "${itemId}": arquivo ausente ou de tipo não permitido.`)
      out.file = file
    }
    if (type === 'overlay' && typeof it.blend === 'string' && ['screen', 'add', 'normal', 'multiply', 'overlay'].includes(it.blend)) out.blend = it.blend as PackItem['blend']
    if (type === 'title') {
      const t = it.title as Record<string, unknown> | undefined
      if (!t || typeof t !== 'object' || typeof t.duration !== 'number') throw new Error(`Título "${itemId}" sem estilo/duração.`)
      out.title = { style: (t.style && typeof t.style === 'object' ? t.style : {}) as Partial<TitleSpec>, duration: Math.min(60, Math.max(0.5, t.duration)),
        fadeIn: typeof t.fadeIn === 'number' ? t.fadeIn : undefined, fadeOut: typeof t.fadeOut === 'number' ? t.fadeOut : undefined,
        keyframes: (t.keyframes && typeof t.keyframes === 'object' ? t.keyframes : undefined) as TitleTemplate['keyframes'] }
    }
    if (type === 'preset') {
      const p = it.preset as Record<string, unknown> | undefined
      if (!p || (p.kind !== 'look' && p.kind !== 'motion')) throw new Error(`Preset "${itemId}" inválido.`)
      out.preset = {
        kind: p.kind,
        effects: Array.isArray(p.effects) ? p.effects.filter((e) => e && typeof e === 'object' && typeof e.type === 'string').slice(0, 12) : undefined,
        keyframes: (p.keyframes && typeof p.keyframes === 'object' ? p.keyframes : undefined) as PresetDef['keyframes'],
        anchor: p.anchor === 'playhead' || p.anchor === 'end' ? p.anchor : 'start',
        transform: (p.transform && typeof p.transform === 'object' ? p.transform : undefined) as PresetDef['transform']
      }
    }
    return out
  })
  return {
    format: PACK_FORMAT, id, name: text(o.name, 'name', 80), version: text(o.version, 'version', 20), author: text(o.author, 'author', 80),
    license: text(o.license, 'license', 200), description: typeof o.description === 'string' ? o.description.slice(0, 500) : undefined, items
  }
}
