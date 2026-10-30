import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { app } from 'electron'
import { extOf, PACK_EXT, safeRelPath, validateManifest, type HubItem, type PackInfo, type PackItemType, type PackManifest } from '@shared/packs'
import { isInside } from '../files'
import { log } from '../log'
import { importMedia, listMedia } from '../media/media'
import { ZipReader, writeZip } from './zip'
import type { MediaItem } from '@shared/types'

// Asset Hub: pacotes instalados (o essencial vem com o app; os outros o usuário instala de arquivos .pqs-pack).
// Cada pacote é uma pasta com pack.json validado; só os arquivos citados no manifesto são extraídos.

export const ESSENTIALS = 'pq-essentials'
const MAX_PACK_BYTES = 2 * 1024 ** 3
const MAX_MANIFEST = 2 * 1024 * 1024
const LICENSE_FILE = /^(licen[cs][ae]s?|license|licenca|readme|ofl)[^/]*\.(txt|md)$|\/(licen[cs][ae]s?|licencas)\/[^/]+\.(txt|md)$/i

interface Installed { manifest: PackManifest; dir: string; builtIn: boolean }

export function builtInPacksDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'packs') : join(app.getAppPath(), 'resources', 'packs')
}
export function userPacksDir(): string {
  const d = join(app.getPath('userData'), 'packs')
  mkdirSync(d, { recursive: true })
  return d
}

let cache: Installed[] | null = null
export function invalidatePacks(): void {
  cache = null
}

function readPackDir(dir: string, builtIn: boolean): Installed | null {
  try {
    const raw = readFileSync(join(dir, 'pack.json'), 'utf8')
    if (raw.length > MAX_MANIFEST) throw new Error('pack.json grande demais')
    const manifest = validateManifest(JSON.parse(raw))
    if (!builtIn && manifest.id !== basename(dir)) throw new Error('pasta não bate com o id do pacote')
    return { manifest, dir, builtIn }
  } catch (err) {
    log.warn('packs.invalid', { dir, error: (err as Error).message })
    return null
  }
}

export function installedPacks(): Installed[] {
  if (cache) return cache
  const out: Installed[] = []
  const scan = (root: string, builtIn: boolean): void => {
    if (!existsSync(root)) return
    for (const name of readdirSync(root)) {
      if (name.startsWith('.')) continue
      const dir = join(root, name)
      if (!statSync(dir).isDirectory()) continue
      const p = readPackDir(dir, builtIn)
      // Um pacote do usuário nunca substitui um que vem com o app.
      if (p && !out.some((x) => x.manifest.id === p.manifest.id)) out.push(p)
    }
  }
  scan(builtInPacksDir(), true)
  scan(userPacksDir(), false)
  cache = out
  return out
}

/** Arquivo do item, garantidamente dentro da pasta do pacote (sem atalhos para fora). */
function itemPath(p: Installed, file: string | undefined): string | undefined {
  const rel = safeRelPath(file)
  if (!rel) return undefined
  const full = join(p.dir, ...rel.split('/'))
  try {
    if (!existsSync(full) || !isInside(p.dir, realpathSync(full))) return undefined
  } catch {
    return undefined
  }
  return full
}

/**
 * Id global de fontes e LUTs. Os do pacote essencial ficam curtos (compatíveis com documentos antigos);
 * os outros levam o pacote separado por "." (que não existe em ids de pacote/item, então não há colisão).
 */
export const assetId = (packId: string, itemId: string): string => (packId === ESSENTIALS ? itemId : `${packId}.${itemId}`)

export function hubItems(type?: PackItemType): HubItem[] {
  const out: HubItem[] = []
  for (const p of installedPacks()) {
    for (const it of p.manifest.items) {
      if (type && it.type !== type) continue
      const path = it.file ? itemPath(p, it.file) : undefined
      if (it.file && !path) continue
      const { file: _file, ...rest } = it
      out.push({ ...rest, key: `${p.manifest.id}/${it.id}`, packId: p.manifest.id, packName: p.manifest.name, packVersion: p.manifest.version, path })
    }
  }
  return out
}

export function packInfos(): PackInfo[] {
  return installedPacks().map(({ manifest: m, builtIn }) => {
    const counts: PackInfo['counts'] = {}
    for (const it of m.items) counts[it.type] = (counts[it.type] ?? 0) + 1
    return { id: m.id, name: m.name, version: m.version, author: m.author, license: m.license, description: m.description ?? '', builtIn, counts }
  })
}

/** Fontes instaladas: id (usado nos títulos) → arquivo. */
export function fontMap(): Map<string, string> {
  return new Map(hubItems('font').filter((i) => i.path).map((i) => [assetId(i.packId, i.id), i.path!]))
}

/** LUTs vindas de pacotes: id (usado no efeito "lut") → arquivo. */
export function packLuts(): { id: string; name: string; path: string }[] {
  return hubItems('lut').filter((i) => i.path).map((i) => ({ id: assetId(i.packId, i.id), name: i.name, path: i.path! }))
}

export function hubItem(key: string): HubItem {
  const it = typeof key === 'string' ? hubItems().find((x) => x.key === key) : undefined
  if (!it) throw new Error('Item do Asset Hub não encontrado (o pacote foi removido?).')
  return it
}

/** Leva um SFX/overlay para o projeto (reaproveita se já foi importado). */
export async function useHubItem(projectId: string, key: string): Promise<MediaItem> {
  const it = hubItem(key)
  if ((it.type !== 'sfx' && it.type !== 'overlay') || !it.path) throw new Error('Esse item não é um arquivo de mídia.')
  // Reaproveita só se o conteúdo for o mesmo (mesmo tamanho e mesmo hash), não pelo nome.
  const size = statSync(it.path).size
  const hash = (p: string): string => createHash('sha1').update(readFileSync(p)).digest('hex')
  const want = size <= 256 * 1024 * 1024 ? hash(it.path) : null
  const existing = want ? listMedia(projectId).find((m) => m.size === size && existsSync(m.path) && hash(m.path) === want) : undefined
  if (existing) return existing
  const r = await importMedia(projectId, [it.path])
  if (!r.imported.length) throw new Error(r.skipped[0]?.reason ?? 'Não foi possível importar.')
  return r.imported[0]
}

/** Instala (ou atualiza) um pacote .pqs-pack. Só extrai pack.json, licenças e os arquivos citados no manifesto. */
export function installPack(file: string): PackInfo {
  if (extOf(file) !== PACK_EXT && extOf(file) !== '.zip') throw new Error(`Escolha um arquivo ${PACK_EXT}.`)
  const st = statSync(file)
  if (!st.isFile() || st.size > MAX_PACK_BYTES) throw new Error('Arquivo de pacote inválido ou grande demais (máximo 2 GB).')
  const zip = new ZipReader(file)
  const tmp = join(userPacksDir(), `.tmp-${randomUUID()}`)
  try {
    const entry = (name: string) => zip.entries.find((e) => e.name === name)
    const mf = entry('pack.json')
    if (!mf) throw new Error('O pacote não tem pack.json na raiz.')
    if (mf.size > MAX_MANIFEST) throw new Error('pack.json grande demais.')
    let manifest: PackManifest
    try {
      manifest = validateManifest(JSON.parse(zip.read(mf).toString('utf8')))
    } catch (err) {
      throw new Error(`Pacote inválido: ${(err as Error).message}`)
    }
    if (installedPacks().some((p) => p.builtIn && p.manifest.id === manifest.id)) throw new Error('Esse pacote já vem com o app e não pode ser substituído.')
    const wanted = new Set<string>(['pack.json'])
    for (const it of manifest.items) {
      if (!it.file) continue
      if (!entry(it.file)) throw new Error(`O pacote cita "${it.file}", que não está dentro dele.`)
      wanted.add(it.file)
    }
    for (const e of zip.entries) if (LICENSE_FILE.test(e.name)) wanted.add(e.name)
    for (const name of wanted) {
      const e = entry(name)!
      const dest = join(tmp, ...name.split('/'))
      if (!isInside(tmp, dest)) throw new Error('Caminho inválido no pacote.')
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, zip.read(e))
    }
    // Troca segura: a versão antiga vira backup e só é apagada depois que a nova entrou no lugar.
    const target = join(userPacksDir(), manifest.id)
    const backup = join(userPacksDir(), `.old-${randomUUID()}`)
    const hadOld = existsSync(target)
    if (hadOld) renameSync(target, backup)
    try {
      renameSync(tmp, target)
    } catch (err) {
      if (hadOld) renameSync(backup, target)
      throw err
    }
    if (hadOld) rmSync(backup, { recursive: true, force: true })
    invalidatePacks()
    log.info('packs.installed', { id: manifest.id, version: manifest.version, items: manifest.items.length })
    return packInfos().find((p) => p.id === manifest.id)!
  } finally {
    zip.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function removePack(id: string): void {
  const p = installedPacks().find((x) => x.manifest.id === id)
  if (!p) throw new Error('Pacote não encontrado.')
  if (p.builtIn) throw new Error('O pacote essencial vem com o app e não pode ser removido.')
  if (!isInside(userPacksDir(), p.dir)) throw new Error('Pasta de pacote inesperada.')
  rmSync(p.dir, { recursive: true, force: true })
  invalidatePacks()
  log.info('packs.removed', { id })
}

/** Gera um .pqs-pack a partir de uma pasta com pack.json (para quem cria pacotes). */
export function exportPackFolder(srcDir: string, outFile: string): { items: number; bytes: number } {
  const manifest = validateManifest(JSON.parse(readFileSync(join(srcDir, 'pack.json'), 'utf8')))
  const files: { name: string; data: Buffer }[] = [{ name: 'pack.json', data: readFileSync(join(srcDir, 'pack.json')) }]
  for (const it of manifest.items) {
    if (!it.file) continue
    const full = join(srcDir, ...it.file.split('/'))
    if (!existsSync(full) || !isInside(srcDir, realpathSync(full))) throw new Error(`Arquivo citado no pack.json não existe: ${it.file}`)
    files.push({ name: it.file, data: readFileSync(full) })
  }
  // Atalhos/junções são ignorados: nada de fora da pasta entra no pacote (e não há laços).
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 8) return
    for (const f of readdirSync(dir)) {
      const full = join(dir, f)
      const r = rel ? `${rel}/${f}` : f
      const st = lstatSync(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) walk(full, r, depth + 1)
      else if (st.isFile() && LICENSE_FILE.test(r) && !files.some((x) => x.name === r)) files.push({ name: r, data: readFileSync(full) })
    }
  }
  walk(srcDir, '', 0)
  const out = outFile.toLowerCase().endsWith(PACK_EXT) ? outFile : outFile + PACK_EXT
  writeZip(out, files)
  return { items: manifest.items.length, bytes: statSync(out).size }
}
