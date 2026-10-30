import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { copyFile, stat } from 'node:fs/promises'
import { basename, extname, join, normalize, relative, resolve, isAbsolute } from 'node:path'
import type { MediaKind } from '@shared/types'

export const EXTENSIONS: Record<MediaKind, string[]> = {
  video: ['.mp4', '.mov', '.mkv', '.webm', '.m4v'],
  audio: ['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac'],
  image: ['.png', '.jpg', '.jpeg', '.webp']
}

export function kindOf(path: string): MediaKind | null {
  const ext = extname(path).toLowerCase()
  for (const [kind, exts] of Object.entries(EXTENSIONS)) {
    if (exts.includes(ext)) return kind as MediaKind
  }
  return null
}

/** true se `child` está dentro de `parent` (ou é o próprio). */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Rejeita caminhos relativos ou com componentes suspeitos antes de qualquer operação. */
export function validatePath(p: string): string {
  if (!p || typeof p !== 'string' || !isAbsolute(p)) throw new Error(`Caminho inválido: ${p}`)
  return normalize(p)
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ').trim()
    .slice(0, 60)
  return s || 'Projeto'
}

/** Nunca sobrescreve: devolve "nome (2).ext", "nome (3).ext"… se já existir. */
export function uniquePath(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let candidate = join(dir, fileName)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Copia sem sobrescrever (COPYFILE_EXCL) para um nome livre no destino. */
export async function safeCopy(src: string, destDir: string, fileName = basename(src)): Promise<string> {
  ensureDir(destDir)
  const dest = uniquePath(destDir, fileName)
  await copyFile(src, dest, 1 /* fs.constants.COPYFILE_EXCL */)
  return dest
}

export async function fileSize(p: string): Promise<number> {
  return (await stat(p)).size
}

/** Grava um arquivo novo sem nunca sobrescrever (criação exclusiva, com nome livre "x (2).png"). */
export function writeUnique(dir: string, fileName: string, data: Buffer | string): string {
  ensureDir(dir)
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  for (let i = 1; i < 10000; i++) {
    const candidate = join(dir, i === 1 ? fileName : `${stem} (${i})${ext}`)
    try {
      writeFileSync(candidate, data, { flag: 'wx' })
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('Não foi possível reservar um nome de arquivo livre')
}
