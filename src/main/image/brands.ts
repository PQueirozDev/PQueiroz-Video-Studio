import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { Brand, BrandInput, BrandLogo } from '@shared/image'
import { safeColor } from '@shared/imageDoc'
import { all, one, run } from '../db'
import { ensureDir, isInside, slugify, validatePath, writeUnique } from '../files'
import { getSettings } from '../settings'
import { now, uid } from '../util'
import { extractPdfImages, looksWhite } from './pdf'
import { decodePng, encodePng } from './png'

// Marcas do Image Studio. Cada marca tem uma pasta própria em <biblioteca>/marcas/<nome>/
// com as logos originais (nunca alteradas) e os assets da marca.

export const AF_ID = 'aquecedores-fortes'
const LOGO_EXT = ['.png', '.jpg', '.jpeg', '.webp']

interface BrandRow { id: string; name: string; data: string; created_at: number; updated_at: number }

export function brandsRoot(): string {
  return ensureDir(join(getSettings().assetsRoot, 'marcas'))
}

function toBrand(r: BrandRow): Brand {
  const d = JSON.parse(r.data) as Partial<Brand>
  return {
    id: r.id, name: r.name, slogan: d.slogan ?? '', colors: d.colors ?? [], fonts: d.fonts ?? { heading: 'Segoe UI', body: 'Segoe UI' },
    style: d.style ?? '', preferences: d.preferences ?? '', rules: d.rules ?? [],
    logos: (d.logos ?? []).filter((l) => existsSync(l.path)), defaultLogoId: d.defaultLogoId ?? null, logoMargin: d.logoMargin ?? 0.04,
    assets: (d.assets ?? []).filter((p) => existsSync(p)), folder: d.folder ?? join(brandsRoot(), slugify(r.name)),
    createdAt: r.created_at, updatedAt: r.updated_at
  }
}

function save(b: Brand): Brand {
  const { id, name, createdAt, ...rest } = b
  const t = now()
  run(`INSERT INTO brands(id, name, data, created_at, updated_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
    id, name, JSON.stringify(rest), createdAt, t)
  return { ...b, updatedAt: t }
}

export function listBrands(): Brand[] {
  ensureDefaultBrands()
  return all<BrandRow>('SELECT * FROM brands ORDER BY name').map(toBrand)
}

export function getBrand(id: string | null | undefined): Brand | null {
  if (!id) return null
  ensureDefaultBrands()
  const r = one<BrandRow>('SELECT * FROM brands WHERE id = ?', id)
  return r ? toBrand(r) : null
}

export function requireBrand(id: string): Brand {
  const b = getBrand(id)
  if (!b) throw new Error('Marca não encontrada')
  return b
}

/** Caminho real (sem atalhos/junções) de uma imagem existente dentro da biblioteca. */
function insideLibrary(p: string): boolean {
  try {
    const real = realpathSync(p)
    return LOGO_EXT.includes(extname(real).toLowerCase()) && statSync(real).isFile() && isInside(realpathSync(getSettings().assetsRoot), real)
  } catch {
    return false
  }
}

function clean(input: BrandInput, current: Brand): Brand {
  const text = (v: unknown, max: number, def: string): string => (typeof v === 'string' ? v.slice(0, max) : def)
  return {
    ...current,
    name: text(input.name, 80, current.name).trim() || current.name,
    slogan: text(input.slogan, 200, current.slogan),
    style: text(input.style, 2000, current.style),
    preferences: text(input.preferences, 2000, current.preferences),
    colors: Array.isArray(input.colors)
      ? input.colors.slice(0, 16).map((c) => ({ name: text(c?.name, 40, 'Cor'), hex: safeColor(c?.hex, '#000000') }))
      : current.colors,
    fonts: input.fonts ? { heading: text(input.fonts.heading, 80, current.fonts.heading), body: text(input.fonts.body, 80, current.fonts.body) } : current.fonts,
    rules: Array.isArray(input.rules) ? input.rules.slice(0, 30).map((r) => text(r, 300, '')).filter(Boolean) : current.rules,
    defaultLogoId: input.defaultLogoId !== undefined && current.logos.some((l) => l.id === input.defaultLogoId) ? input.defaultLogoId : current.defaultLogoId,
    logoMargin: typeof input.logoMargin === 'number' && Number.isFinite(input.logoMargin) ? Math.min(0.2, Math.max(0, input.logoMargin)) : current.logoMargin,
    assets: Array.isArray(input.assets) ? input.assets.filter((p) => typeof p === 'string' && insideLibrary(p)) : current.assets
  }
}

export function createBrand(input: BrandInput): Brand {
  const name = (input.name ?? '').trim() || 'Nova marca'
  let id = slugify(name).toLowerCase().replace(/\s+/g, '-')
  if (one('SELECT id FROM brands WHERE id = ?', id)) id = `${id}-${uid().slice(0, 6)}`
  let folder = join(brandsRoot(), slugify(name))
  for (let i = 2; existsSync(folder); i++) folder = join(brandsRoot(), `${slugify(name)} (${i})`)
  ensureDir(join(folder, 'logos'))
  const t = now()
  const blank: Brand = {
    id, name, slogan: '', colors: [], fonts: { heading: 'Poppins', body: 'Poppins' }, style: '', preferences: '', rules: [],
    logos: [], defaultLogoId: null, logoMargin: 0.04, assets: [], folder, createdAt: t, updatedAt: t
  }
  return save(clean(input, blank))
}

export function updateBrand(id: string, input: BrandInput): Brand {
  return save(clean(input, requireBrand(id)))
}

export function deleteBrand(id: string): void {
  if (id === AF_ID) throw new Error('A marca Aquecedores Fortes é fixa e não pode ser excluída.')
  // Só sai da lista: a pasta com as logos fica no disco.
  run('DELETE FROM brands WHERE id = ?', id)
}

/** Importa logos de um arquivo (PDF → extrai as imagens originais; PNG/JPG/WebP → copia sem alterar). */
export function importLogo(brandId: string, file: string): BrandLogo[] {
  const b = requireBrand(brandId)
  const src = validatePath(file)
  const ext = extname(src).toLowerCase()
  const dir = ensureDir(join(b.folder, 'logos'))
  const added: BrandLogo[] = []
  if (ext === '.pdf') {
    const images = extractPdfImages(readFileSync(src))
    if (!images.length) throw new Error('Nenhuma imagem de logo encontrada dentro do PDF. Exporte a logo como PNG e importe o PNG.')
    // Guarda o PDF original junto, como referência.
    const original = join(ensureDir(join(b.folder, 'original')), basename(src))
    if (!existsSync(original)) copyFileSync(src, original)
    const stem = basename(src, ext)
    images.forEach((img, i) => {
      const white = looksWhite(img.averageColor)
      const variant: BrandLogo['variant'] = white ? 'branca' : 'colorida'
      const path = writeUnique(dir, `${slugify(stem)} - ${variant}.png`, encodePng(img))
      added.push({ id: uid().slice(0, 8), name: `${variant === 'branca' ? 'Logo branca' : 'Logo colorida'}${images.length > 2 ? ` ${i + 1}` : ''}`, path, variant, width: img.width, height: img.height, source: original })
    })
  } else if (LOGO_EXT.includes(ext)) {
    let width = 0, height = 0
    let variant: BrandLogo['variant'] = 'outra'
    if (ext === '.png') {
      try {
        const img = decodePng(readFileSync(src))
        width = img.width
        height = img.height
        let r = 0, g = 0, bl = 0, n = 0
        for (let i = 0; i < img.data.length; i += 16) if (img.data[i + 3] > 128) { r += img.data[i]; g += img.data[i + 1]; bl += img.data[i + 2]; n++ }
        if (n) variant = looksWhite([r / n, g / n, bl / n]) ? 'branca' : 'colorida'
      } catch {
        /* PNG fora do padrão simples: dimensões vêm do renderer depois */
      }
    }
    const path = writeUnique(dir, basename(src), readFileSync(src))
    added.push({ id: uid().slice(0, 8), name: basename(src, ext), path, variant, width, height, source: src })
  } else {
    throw new Error('Formato de logo não suportado (use PDF, PNG, JPG ou WebP).')
  }
  const logos = [...b.logos, ...added]
  save({ ...b, logos, defaultLogoId: b.defaultLogoId ?? added.find((l) => l.variant === 'colorida')?.id ?? added[0].id })
  return added
}

export function updateLogo(brandId: string, logoId: string, patch: Partial<Pick<BrandLogo, 'name' | 'variant' | 'width' | 'height'>>): Brand {
  const b = requireBrand(brandId)
  const logos = b.logos.map((l) => {
    if (l.id !== logoId) return l
    return {
      ...l,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.slice(0, 60) : l.name,
      variant: ['colorida', 'branca', 'escura', 'outra'].includes(patch.variant ?? '') ? patch.variant! : l.variant,
      // Dimensões medidas pelo renderer quando o main não consegue ler o arquivo (JPG/WebP).
      width: !l.width && patch.width ? Math.round(patch.width) : l.width,
      height: !l.height && patch.height ? Math.round(patch.height) : l.height
    }
  })
  return save({ ...b, logos })
}

export function removeLogo(brandId: string, logoId: string): Brand {
  const b = requireBrand(brandId)
  const logos = b.logos.filter((l) => l.id !== logoId)
  return save({ ...b, logos, defaultLogoId: b.defaultLogoId === logoId ? logos[0]?.id ?? null : b.defaultLogoId })
}

export function addBrandAssets(brandId: string, files: string[]): Brand {
  const b = requireBrand(brandId)
  const dir = ensureDir(join(b.folder, 'assets'))
  const added = files.map(validatePath).filter((p) => LOGO_EXT.includes(extname(p).toLowerCase())).map((p) => writeUnique(dir, basename(p), readFileSync(p)))
  return save({ ...b, assets: [...b.assets, ...added] })
}

// ————— Marca padrão —————

const AF_RULES = [
  'Usar exclusivamente a logo oficial extraída do arquivo original (versão colorida ou branca). Nunca inventar, redesenhar ou gerar por IA uma logo substituta.',
  'Nunca modificar a tipografia do logotipo nem recolorir a logo.',
  'O símbolo é um SOL amarelo/laranja — nunca substituir por chama, fogo ou outro ícone.',
  'Preservar as proporções originais da logo (sem esticar, achatar ou cortar).',
  'Manter margem de segurança livre ao redor da logo.',
  'Logo colorida sobre fundos claros; logo branca sobre o laranja institucional ou fundos escuros.',
  'Não inventar preços, endereço, telefone, slogan ou serviços — pedir ao Pedro quando faltar informação.'
]

let seeded = false

/** Locais onde o PDF da logo costuma estar (importado automaticamente na primeira vez). */
function findAfLogoPdf(): string | null {
  const dirs = [join(getSettings().assetsRoot, 'marcas'), getSettings().assetsRoot, join(homedir(), 'Desktop'), join(homedir(), 'Downloads'), join(homedir(), 'Documents'), join(getSettings().aqcRoot, 'Recursos')]
  for (const d of dirs) {
    let entries: string[] = []
    try {
      entries = readdirSync(d)
    } catch {
      continue
    }
    const hit = entries.filter((f) => /^logo aquecedores.*\.pdf$/i.test(f)).map((f) => join(d, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    if (hit) return hit
  }
  return null
}

export function ensureDefaultBrands(): void {
  if (seeded) return
  seeded = true
  if (one('SELECT id FROM brands WHERE id = ?', AF_ID)) return
  const folder = ensureDir(join(brandsRoot(), 'Aquecedores Fortes'))
  ensureDir(join(folder, 'logos'))
  const t = now()
  save({
    id: AF_ID, name: 'Aquecedores Fortes', slogan: '',
    colors: [
      { name: 'Laranja institucional', hex: '#CD6D1E' },
      { name: 'Laranja', hex: '#EF7F13' },
      { name: 'Amarelo sol', hex: '#FFC301' },
      { name: 'Vermelho', hex: '#EE1E26' },
      { name: 'Azul marinho', hex: '#102344' },
      { name: 'Branco', hex: '#FFFFFF' }
    ],
    fonts: { heading: 'Poppins', body: 'Poppins' },
    style: 'Premium Advertising 3D: campanhas quentes e acolhedoras (sol, calor, conforto, banho quente), laranja e amarelo dominantes com contraste em azul marinho; mascote aquecedor simpático quando combinar.',
    preferences: 'Logo no canto superior esquerdo. Títulos em Poppins Black ou Anton; faixas em vermelho #EE1E26, laranja #EF7F13 ou azul #102344 (mesma identidade dos vídeos).',
    rules: AF_RULES, logos: [], defaultLogoId: null, logoMargin: 0.04, assets: [], folder, createdAt: t, updatedAt: t
  })
  const pdf = findAfLogoPdf()
  if (pdf) {
    try {
      importLogo(AF_ID, pdf)
    } catch {
      /* o Pedro importa manualmente pelo gerenciador de marcas */
    }
  }
}
