import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { app } from 'electron'
import type {
  AspectFormat, CommunityPreset, Preset, PresetExportOptions, PresetImportResult, PresetInput, PresetPack, PresetPackFile
} from '@shared/types'
import { all, one, run } from './db'
import { EXTENSIONS, isInside } from './files'
import { getSettings, updateSettings } from './settings'
import { aqcInfo } from './skills/aqc'
import { now, uid } from './util'

// Presets embutidos. O texto de `prompt` entra no contexto do Claude quando o projeto usa o preset.
export const PRESETS: Preset[] = [
  {
    id: 'nenhum', name: 'Nenhum', builtin: true, author: 'PQueiroz', workflowDir: null, format: 'original',
    description: 'Sem preset — o Claude segue apenas o pedido e as regras do CLAUDE.md.',
    prompt: ''
  },
  {
    id: 'reel-rapido', name: 'Reel rápido', builtin: true, author: 'PQueiroz', workflowDir: null, format: '9:16',
    description: '1080×1920, 15–30 s, cortes rápidos, música e textos curtos.',
    prompt: 'Preset "Reel rápido": 1080×1920, 30 fps, 15–30 s, cortes rápidos nas batidas, remova tudo que for parado, textos curtos na parte de baixo, loudnorm -14 LUFS.'
  },
  {
    id: 'reel-profissional', name: 'Reel profissional', builtin: true, author: 'PQueiroz', workflowDir: null, format: '9:16',
    description: '1080×1920, 30–60 s, ritmo calmo, correção de cor e áudio caprichados.',
    prompt: 'Preset "Reel profissional": 1080×1920, 30 fps, 30–60 s, gancho forte nos primeiros 2 s, cortes naturais, zooms sutis, correção de cor leve, áudio limpo -14 LUFS / -1 dBTP.'
  },
  {
    id: 'story', name: 'Story', builtin: true, author: 'PQueiroz', workflowDir: null, format: '9:16',
    description: '1080×1920, até 15 s por cartela, texto grande e legível.',
    prompt: 'Preset "Story": 1080×1920, 30 fps, até 15 s, texto grande dentro das margens seguras (topo 250 px e base 340 px livres).'
  },
  {
    id: 'youtube', name: 'YouTube', builtin: true, author: 'PQueiroz', workflowDir: null, format: '16:9',
    description: '1920×1080, sem cortes agressivos, áudio -14 LUFS.',
    prompt: 'Preset "YouTube": 1920×1080 (16:9), ritmo natural, preserve as falas, música baixa sob a voz, loudnorm -14 LUFS.'
  },
  {
    id: 'antes-depois', name: 'Antes e Depois', builtin: true, author: 'PQueiroz', workflowDir: null, format: '9:16',
    description: 'Estrutura ANTES → DEPOIS com rótulos e transição marcada.',
    prompt: 'Preset "Antes e Depois": estrutura ANTES (plano aberto + zoom na peça) → transição marcada → DEPOIS (um trecho por peça) → resultado, com os rótulos "ANTES"/"DEPOIS" na parte de baixo da tela.'
  },
  {
    id: 'aquecedores-fortes', name: 'Aquecedores Fortes', builtin: true, author: 'PQueiroz', workflowDir: null, format: '9:16',
    description: 'O vídeo padrão aprovado: Modelo edicao/montar.py, 1080×1920, ~45–55 s.',
    prompt: 'Preset "Aquecedores Fortes": siga exatamente a seção "Vídeo padrão (aprovado pelo Pedro)" e "Como fazer um vídeo novo" do CLAUDE.md, usando uma cópia de "Modelo edicao" (montar.py). Pergunte endereço, bairro e nome exato do serviço se não estiverem no pedido.'
  }
]

interface PresetRow { id: string; name: string; format: string; description: string; prompt: string; author: string | null; workflow_dir: string | null }

const FORMATS: AspectFormat[] = ['9:16', '16:9', '1:1', 'original']

function fromRow(r: PresetRow): Preset {
  return {
    id: r.id, name: r.name, builtin: false, format: r.format as AspectFormat, description: r.description, prompt: r.prompt,
    author: r.author ?? '', workflowDir: r.workflow_dir && existsSync(r.workflow_dir) ? r.workflow_dir : null
  }
}

/** Embutidos + personalizados/importados (guardados no SQLite). */
export function listPresets(): Preset[] {
  return [...PRESETS, ...all<PresetRow>('SELECT * FROM presets ORDER BY created_at').map(fromRow)]
}

export function presetById(id: string): Preset {
  return listPresets().find((p) => p.id === id) ?? PRESETS[0]
}

function clean(input: PresetInput): Required<PresetInput> {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('Dê um nome ao preset.')
  return {
    name: name.slice(0, 60),
    format: FORMATS.includes(input.format) ? input.format : 'original',
    description: String(input.description ?? '').trim().slice(0, 200),
    prompt: String(input.prompt ?? '').trim().slice(0, 4000),
    author: String(input.author ?? '').trim().slice(0, 60)
  }
}

export function savePreset(id: string | null, input: PresetInput): Preset {
  const c = clean(input)
  if (id && PRESETS.some((p) => p.id === id)) throw new Error('Presets embutidos não podem ser alterados — duplique-o.')
  if (id) {
    run('UPDATE presets SET name = ?, format = ?, description = ?, prompt = ?, author = ? WHERE id = ?', c.name, c.format, c.description, c.prompt, c.author, id)
  } else {
    id = `custom-${uid()}`
    run('INSERT INTO presets(id, name, format, description, prompt, author, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
      id, c.name, c.format, c.description, c.prompt, c.author, now())
  }
  return presetById(id)
}

/** Pasta onde ficam os sistemas de edição que vieram com presets importados. */
function workflowsRoot(): string {
  return join(app.getPath('userData'), 'workflows')
}

export function deletePreset(id: string): void {
  const row = one<PresetRow>('SELECT * FROM presets WHERE id = ?', id)
  run('DELETE FROM presets WHERE id = ?', id)
  // Projetos que usavam o preset voltam para "Nenhum".
  run("UPDATE projects SET preset = 'nenhum' WHERE preset = ?", id)
  // O fluxo instalado pelo preset fica na pasta do app; só ela é removida.
  const dir = row?.workflow_dir
  if (dir && isInside(workflowsRoot(), dir) && relative(workflowsRoot(), dir) !== '') {
    if (getSettings().aqcRoot === dir) updateSettings({ aqcRoot: '' })
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------------------
// Pacotes de preset (.pqpreset): exportar, importar de arquivo/link e catálogo da comunidade.
// ---------------------------------------------------------------------------------------------

const MAX_FILE = 50 * 1024 * 1024
const MAX_TOTAL = 400 * 1024 * 1024
const SKIP_DIRS = new Set(['__pycache__', '.venv', 'venv', '.git', 'node_modules', 'output', 'temp'])
const TEXT_EXT = new Set(['.md', '.txt', '.py', '.json', '.js', '.ts', '.sh', '.ps1', '.bat', '.cmd', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.csv', '.srt', '.ass', '.html', '.css', '.svg'])

export const COMMUNITY_BASE = 'https://raw.githubusercontent.com/PQueirozDev/PQueiroz-Video-Studio/main/presets/'

class PackBuilder {
  files: PresetPackFile[] = []
  private total = 0
  private seen = new Set<string>()

  add(abs: string, rel: string): void {
    const key = rel.split(sep).join('/')
    if (this.seen.has(key)) return
    let size: number
    try {
      size = statSync(abs).size
    } catch {
      return
    }
    if (size > MAX_FILE) return
    this.total += size
    if (this.total > MAX_TOTAL) {
      throw new Error('O preset passou de 400 MB. Exporte sem as músicas/recursos ou diminua a pasta Recursos.')
    }
    const text = TEXT_EXT.has(extname(abs).toLowerCase())
    const buf = readFileSync(abs)
    this.seen.add(key)
    this.files.push({ path: key, encoding: text ? 'utf8' : 'base64', content: text ? buf.toString('utf8') : buf.toString('base64') })
  }

  /** Adiciona uma pasta inteira (sem caches, ambientes Python e, por padrão, sem vídeos). */
  addDir(abs: string, rel: string, keepVideos = false): void {
    let entries: string[]
    try {
      entries = readdirSync(abs)
    } catch {
      return
    }
    for (const name of entries) {
      const p = join(abs, name)
      const r = join(rel, name)
      let isDir: boolean
      try {
        isDir = statSync(p).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        if (!SKIP_DIRS.has(name)) this.addDir(p, r, keepVideos)
      } else if (keepVideos || !EXTENSIONS.video.includes(extname(name).toLowerCase())) {
        this.add(p, r)
      }
    }
  }
}

/** Monta o pacote de um preset; com `includeWorkflow`, leva junto o sistema de edição e as skills de vídeo. */
export function buildPack(id: string, options: PresetExportOptions): PresetPack {
  const preset = listPresets().find((p) => p.id === id)
  if (!preset) throw new Error('Preset não encontrado.')
  const pack: PresetPack = {
    kind: 'pqueiroz-preset', version: 1, name: preset.name, author: preset.author, format: preset.format,
    description: preset.description, prompt: preset.prompt, createdAt: now()
  }
  if (!options.includeWorkflow) return pack

  const b = new PackBuilder()
  const info = aqcInfo()
  const root = preset.workflowDir ?? (info.exists ? info.root : '')
  if (root) {
    for (const f of readdirSync(root)) {
      const p = join(root, f)
      if (statSync(p).isFile() && (['.md', '.txt'].includes(extname(f).toLowerCase()) || f === 'historico_videos.json')) b.add(p, f)
    }
    b.addDir(join(root, 'Modelo edicao'), 'Modelo edicao')
    b.addDir(join(root, '.claude', 'skills'), join('.claude', 'skills'))
    if (options.includeResources) b.addDir(join(root, 'Recursos'), 'Recursos', true)
  }
  // Skills de vídeo do Claude instaladas neste computador (~/.claude/skills) vão dentro de .claude/skills.
  for (const s of info.workflow.filter((w) => w.kind === 'skill' && w.found)) {
    b.addDir(dirname(s.path), join('.claude', 'skills', s.name))
  }
  if (!b.files.length) {
    throw new Error('Não há sistema de edição nem skills de vídeo neste computador para incluir. Exporte só as instruções.')
  }
  pack.workflow = { files: b.files }
  return pack
}

export function encodePack(pack: PresetPack): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(pack), 'utf8'))
}

export function decodePack(buf: Buffer): PresetPack {
  let text: string
  try {
    text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')
  } catch {
    throw new Error('Arquivo de preset corrompido.')
  }
  let data: PresetPack
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new Error('Isto não é um preset do PQueiroz Video Studio (JSON inválido).')
  }
  if (!data || data.kind !== 'pqueiroz-preset' || typeof data.name !== 'string') {
    throw new Error('Isto não é um preset do PQueiroz Video Studio.')
  }
  if (data.version !== 1) throw new Error('Preset feito numa versão mais nova do estúdio — atualize o app.')
  return data
}

/** Caminho relativo seguro dentro do pacote (sem "..", sem caminho absoluto). */
function safeRel(p: unknown): string | null {
  if (typeof p !== 'string' || !p || p.includes('\0') || isAbsolute(p) || /^[a-zA-Z]:/.test(p) || /^[\\/]/.test(p)) return null
  const parts = p.split(/[\\/]+/).filter((x) => x && x !== '.')
  if (!parts.length || parts.includes('..')) return null
  return join(...parts)
}

function uniqueName(name: string): string {
  const names = new Set(listPresets().map((p) => p.name.toLowerCase()))
  if (!names.has(name.toLowerCase())) return name
  for (let i = 2; ; i++) {
    const n = `${name} (${i})`
    if (!names.has(n.toLowerCase())) return n
  }
}

/** Instala um pacote: cria o preset e, se houver, o sistema de edição e as skills do Claude. */
export async function installPack(pack: PresetPack): Promise<PresetImportResult> {
  const c = clean({ name: uniqueName(pack.name.trim() || 'Preset importado'), format: pack.format, description: pack.description, prompt: pack.prompt, author: pack.author })
  const id = `custom-${uid()}`
  let workflowDir: string | null = null
  let workflowFiles = 0
  const files = Array.isArray(pack.workflow?.files) ? pack.workflow!.files : []

  if (files.length) {
    workflowDir = join(workflowsRoot(), id)
    for (const f of files) {
      const rel = safeRel(f?.path)
      if (!rel || typeof f.content !== 'string') continue
      const dest = join(workflowDir, rel)
      if (!isInside(workflowDir, dest)) continue
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : f.content)
      workflowFiles++
    }
    if (!workflowFiles) workflowDir = null
  }

  run('INSERT INTO presets(id, name, format, description, prompt, author, workflow_dir, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
    id, c.name, c.format, c.description, c.prompt, c.author, workflowDir, now())

  // Skills vão também para ~/.claude/skills, onde o Claude Code as carrega sozinho. Nunca sobrescreve.
  const skillsInstalled: string[] = []
  const packSkills = workflowDir ? join(workflowDir, '.claude', 'skills') : ''
  if (packSkills && existsSync(packSkills)) {
    const userSkills = join(homedir(), '.claude', 'skills')
    for (const name of readdirSync(packSkills)) {
      const src = join(packSkills, name)
      const dest = join(userSkills, name)
      if (!existsSync(join(src, 'SKILL.md')) || existsSync(dest)) continue
      mkdirSync(userSkills, { recursive: true })
      await cp(src, dest, { recursive: true, errorOnExist: false, force: false })
      skillsInstalled.push(name)
    }
  }

  // Num computador sem sistema de edição, o fluxo do preset vira o ativo automaticamente.
  let activated = false
  const hasSystem = workflowDir && (existsSync(join(workflowDir, 'CLAUDE.md')) || existsSync(join(workflowDir, 'Modelo edicao')))
  if (hasSystem && !aqcInfo().exists) {
    updateSettings({ aqcRoot: workflowDir! })
    activated = true
  }
  return { preset: presetById(id), workflowFiles, skillsInstalled, activated }
}

export function writePackFile(id: string, options: PresetExportOptions, dest: string): void {
  writeFileSync(dest, encodePack(buildPack(id, options)))
}

export async function importPresetFile(path: string): Promise<PresetImportResult> {
  return installPack(decodePack(readFileSync(path)))
}

/** Aceita links do GitHub (blob → raw) e qualquer https que devolva o arquivo. */
function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(String(raw).trim())
  } catch {
    throw new Error('Link inválido.')
  }
  if (url.protocol !== 'https:') throw new Error('Use um link https.')
  if (url.hostname === 'github.com' && url.pathname.includes('/blob/')) {
    return `https://raw.githubusercontent.com${url.pathname.replace('/blob/', '/')}`
  }
  return url.toString()
}

async function download(url: string, limit = MAX_TOTAL * 2): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`Não foi possível baixar (HTTP ${res.status}).`)
  if (Number(res.headers.get('content-length') ?? 0) > limit) throw new Error('Arquivo grande demais.')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > limit) throw new Error('Arquivo grande demais.')
  return buf
}

export async function importPresetUrl(raw: string): Promise<PresetImportResult> {
  return installPack(decodePack(await download(normalizeUrl(raw))))
}

/** Catálogo da comunidade: presets/index.json no repositório do estúdio. */
export async function communityPresets(): Promise<CommunityPreset[]> {
  let data: unknown
  try {
    data = JSON.parse((await download(`${COMMUNITY_BASE}index.json`, 5 * 1024 * 1024)).toString('utf8'))
  } catch (err) {
    throw new Error(`Não foi possível carregar os presets da comunidade. Verifique a internet. (${(err as Error).message})`)
  }
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray((data as { presets?: unknown })?.presets) ? (data as { presets: unknown[] }).presets : []
  return list
    .filter((x): x is CommunityPreset => Boolean(x) && typeof (x as CommunityPreset).name === 'string' && typeof (x as CommunityPreset).file === 'string')
    .map((x) => ({
      id: String(x.id ?? x.file), name: x.name.slice(0, 60), author: String(x.author ?? ''),
      format: FORMATS.includes(x.format) ? x.format : 'original',
      description: String(x.description ?? '').slice(0, 200), file: x.file, hasWorkflow: Boolean(x.hasWorkflow)
    }))
}

export async function installCommunityPreset(item: CommunityPreset): Promise<PresetImportResult> {
  const url = /^https:\/\//.test(item.file) ? item.file : new URL(item.file, COMMUNITY_BASE).toString()
  return importPresetUrl(url)
}

/** Faz o fluxo que veio com o preset virar o sistema de edição ativo. */
export function useWorkflow(id: string): void {
  const p = listPresets().find((x) => x.id === id)
  if (!p?.workflowDir) throw new Error('Este preset não traz um sistema de edição.')
  updateSettings({ aqcRoot: p.workflowDir })
}
