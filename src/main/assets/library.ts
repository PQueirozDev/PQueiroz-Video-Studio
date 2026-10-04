import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { AssetCategory, AssetItem } from '@shared/types'
import { ensureDir, EXTENSIONS, isInside, safeCopy, validatePath } from '../files'
import { importMedia } from '../media/media'
import { projectPath, requireProject } from '../projects/projects'
import { getSettings } from '../settings'

// Biblioteca global (logos, músicas, fontes, overlays, intros, finalizações), compartilhada entre projetos.
// Os recursos do sistema de edição (Recursos/ e as fontes do Modelo edicao) aparecem como somente leitura.

export const CATEGORIES: AssetCategory[] = ['logos', 'musicas', 'fontes', 'overlays', 'intros', 'finais']
const FONT_EXT = ['.ttf', '.otf']

function allowedExt(category: AssetCategory): string[] {
  switch (category) {
    case 'musicas': return EXTENSIONS.audio
    case 'fontes': return FONT_EXT
    case 'logos': return EXTENSIONS.image
    default: return [...EXTENSIONS.image, ...EXTENSIONS.video]
  }
}

function files(dir: string, exts: string[], depth = 2): string[] {
  let out: string[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const f of entries) {
    const p = join(dir, f)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory() && depth > 0) out = out.concat(files(p, exts, depth - 1))
    else if (st.isFile() && exts.includes(extname(f).toLowerCase())) out.push(p)
  }
  return out
}

const item = (category: AssetCategory, path: string, readOnly: boolean): AssetItem => ({
  category, path, readOnly, name: path.split(/[\\/]/).pop()!, size: statSync(path).size,
  thumbnail: EXTENSIONS.image.includes(extname(path).toLowerCase()) ? path : null
})

export function libraryRoot(): string {
  const root = ensureDir(getSettings().assetsRoot)
  for (const c of CATEGORIES) ensureDir(join(root, c))
  return root
}

export function listAssets(): AssetItem[] {
  const root = libraryRoot()
  const out: AssetItem[] = []
  for (const c of CATEGORIES) for (const p of files(join(root, c), allowedExt(c))) out.push(item(c, p, false))
  const aqc = getSettings().aqcRoot
  if (!aqc) return out
  const recursos = join(aqc, 'Recursos')
  for (const p of files(recursos, EXTENSIONS.audio)) out.push(item('musicas', p, true))
  for (const p of files(recursos, EXTENSIONS.image, 0)) out.push(item(/final|cart|end/i.test(p) ? 'finais' : 'logos', p, true))
  for (const p of files(join(aqc, 'Modelo edicao', 'fonts'), FONT_EXT, 0)) out.push(item('fontes', p, true))
  return out
}

/** Copia arquivos para a biblioteca (sem sobrescrever). */
export async function addAssets(category: AssetCategory, paths: string[]): Promise<{ added: number; skipped: string[] }> {
  const dir = join(libraryRoot(), category)
  const exts = allowedExt(category)
  let added = 0
  const skipped: string[] = []
  for (const raw of paths) {
    const p = validatePath(raw)
    if (!exts.includes(extname(p).toLowerCase())) {
      skipped.push(`${p.split(/[\\/]/).pop()}: formato não aceito em ${category}`)
      continue
    }
    await safeCopy(p, dir)
    added++
  }
  return { added, skipped }
}

/** Leva um asset para o projeto: mídia vai para a biblioteca do projeto; fontes para assets/fonts. */
export async function useAsset(projectId: string, path: string): Promise<string> {
  const p = validatePath(path)
  const s = getSettings()
  if (!isInside(s.assetsRoot, p) && !(s.aqcRoot && isInside(s.aqcRoot, p))) throw new Error('Asset fora da biblioteca')
  if (FONT_EXT.includes(extname(p).toLowerCase())) {
    const dest = await safeCopy(p, projectPath(requireProject(projectId), 'assets', 'fonts'))
    return `Fonte copiada para ${dest}`
  }
  const r = await importMedia(projectId, [p])
  if (r.skipped.length) throw new Error(r.skipped[0].reason)
  return `${r.imported[0].name} adicionado ao projeto`
}
