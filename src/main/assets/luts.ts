import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import { getSettings } from '../settings'
import { packLuts } from '../packs/packs'

// Biblioteca de LUTs (.cube): as que vêm com o app (resources/luts, obra original dos packs do Pedro)
// e as que o usuário põe em <biblioteca>/luts. O id é estável e só tem [a-z0-9-], para ir no documento.

export interface LutItem {
  id: string
  name: string
  path: string
  builtIn: boolean
}

const MAX_BYTES = 64 * 1024 * 1024

function builtInDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'luts') : join(app.getAppPath(), 'resources', 'luts')
}

export function userLutDir(): string | null {
  const root = getSettings().assetsRoot
  return root ? join(root, 'luts') : null
}

const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'lut'
const title = (id: string): string => id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function scan(dir: string | null, builtIn: boolean): LutItem[] {
  if (!dir || !existsSync(dir)) return []
  const out: LutItem[] = []
  for (const f of readdirSync(dir)) {
    if (extname(f).toLowerCase() !== '.cube') continue
    const path = join(dir, f)
    try {
      const st = statSync(path)
      if (!st.isFile() || st.size > MAX_BYTES) continue
    } catch {
      continue
    }
    const base = slug(basename(f, extname(f)))
    out.push({ id: builtIn ? base : `user-${base}`, name: title(base), path, builtIn })
  }
  return out
}

export function listLuts(): LutItem[] {
  // Ordem de prioridade nos ids repetidos: as do app, as dos pacotes do Asset Hub, as da pasta do usuário.
  const all = [...scan(builtInDir(), true), ...packLuts().map((l) => ({ ...l, builtIn: true })), ...scan(userLutDir(), false)]
  const seen = new Set<string>()
  return all.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
}

export function lutMap(): Map<string, string> {
  return new Map(listLuts().map((l) => [l.id, l.path]))
}
