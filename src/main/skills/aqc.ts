import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { AqcInfo, SkillInfo } from '@shared/types'
import { EXTENSIONS } from '../files'
import { getSettings } from '../settings'

// Descobre o fluxo de edição existente em E:\aqc sem alterar nada lá (somente leitura).

const VIDEO_HINT = /v[ií]deo|video|edi[çc][aã]o|edit|ffmpeg|reel|montag/i

function safeRead(p: string, max = 200_000): string {
  try {
    return readFileSync(p, 'utf8').slice(0, max)
  } catch {
    return ''
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Lê `description:` do frontmatter de um SKILL.md. */
function skillDescription(file: string): string {
  const text = safeRead(file, 4000)
  const m = /^---[\s\S]*?description:\s*(.+?)\r?\n[\s\S]*?---/m.exec(text)
  return (m?.[1] ?? text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('---')) ?? '').replace(/^["']|["']$/g, '').slice(0, 240)
}

function skillDirs(aqc: string): string[] {
  return [join(homedir(), '.claude', 'skills'), join(aqc, '.claude', 'skills')]
}

function scanSkills(aqc: string): SkillInfo[] {
  const out: SkillInfo[] = []
  for (const dir of skillDirs(aqc)) {
    for (const name of list(dir)) {
      const file = join(dir, name, 'SKILL.md')
      if (!existsSync(file)) continue
      const description = skillDescription(file)
      if (VIDEO_HINT.test(name) || VIDEO_HINT.test(description)) {
        out.push({ name, kind: 'skill', path: file, description, found: true })
      }
    }
  }
  return out
}

/** Skills citadas no CLAUDE.md (ex.: "Skill `video-use`") que precisam existir no disco. */
function referencedSkills(claudeMd: string, aqc: string): SkillInfo[] {
  const names = new Set<string>()
  for (const m of claudeMd.matchAll(/[Ss]kill\s+`([\w.-]+)`/g)) names.add(m[1])
  return [...names].map((name) => {
    const path = skillDirs(aqc).map((d) => join(d, name, 'SKILL.md')).find(existsSync)
    return {
      name,
      kind: 'skill' as const,
      path: path ?? join(homedir(), '.claude', 'skills', name, 'SKILL.md'),
      description: path ? skillDescription(path) : 'Citada no CLAUDE.md, mas não encontrada no disco.',
      found: Boolean(path)
    }
  })
}

export function templateDir(aqc = getSettings().aqcRoot): string | null {
  const dir = join(aqc, 'Modelo edicao')
  return existsSync(join(dir, 'montar.py')) ? dir : null
}

export function aqcInfo(): AqcInfo {
  const root = getSettings().aqcRoot
  const exists = isDir(root)
  const info: AqcInfo = { root, exists, workflow: [], musicCount: 0, doneVideos: [], pendingJobs: [], templateDir: null, stalePaths: [] }
  if (!exists) return info

  const claudeMdPath = join(root, 'CLAUDE.md')
  const claudeMd = safeRead(claudeMdPath)
  if (claudeMd) {
    info.workflow.push({ name: 'CLAUDE.md', kind: 'workflow', path: claudeMdPath, description: claudeMd.split(/\r?\n/)[0].replace(/^#\s*/, ''), found: true })
  }
  for (const f of list(root)) {
    const p = join(root, f)
    if (f !== 'CLAUDE.md' && ['.md', '.txt'].includes(extname(f).toLowerCase()) && !isDir(p)) {
      info.workflow.push({ name: f, kind: 'context', path: p, description: safeRead(p, 300).split(/\r?\n/).find((l) => l.trim()) ?? '', found: true })
    }
  }

  const seen = new Set<string>()
  for (const s of [...referencedSkills(claudeMd, root), ...scanSkills(root)]) {
    if (seen.has(s.name)) continue
    seen.add(s.name)
    info.workflow.push(s)
  }

  info.templateDir = templateDir(root)
  if (info.templateDir) {
    for (const f of list(info.templateDir).filter((f) => f.endsWith('.py'))) {
      const p = join(info.templateDir, f)
      const firstDoc = /"""([\s\S]*?)(?:\r?\n\r?\n|""")/.exec(safeRead(p, 2000))?.[1]?.trim().split(/\r?\n/)[0] ?? ''
      info.workflow.push({ name: `Modelo edicao/${f}`, kind: 'script', path: p, description: firstDoc, found: true })
    }
  }

  const music = (dir: string): number =>
    list(dir).reduce((n, f) => {
      const p = join(dir, f)
      return n + (isDir(p) ? music(p) : EXTENSIONS.audio.includes(extname(f).toLowerCase()) ? 1 : 0)
    }, 0)
  info.musicCount = music(join(root, 'Recursos'))
  info.doneVideos = list(join(root, 'Videos feitos')).filter((f) => EXTENSIONS.video.includes(extname(f).toLowerCase()))
  info.pendingJobs = list(join(root, 'A fazer'))

  // Os scripts e o CLAUDE.md foram escritos quando a pasta ficava em C:\aqc.
  if (root.toLowerCase() !== 'c:\\aqc') {
    for (const p of [claudeMdPath, ...(info.templateDir ? ['montar.py', 'build.py'].map((f) => join(info.templateDir!, f)) : [])]) {
      if (/C:\\\\?aqc/i.test(safeRead(p))) info.stalePaths.push(basename(p))
    }
  }
  return info
}

/** Texto completo dos arquivos de fluxo, para o contexto do Claude. */
export function workflowTexts(): { name: string; path: string; text: string }[] {
  const info = aqcInfo()
  return info.workflow
    .filter((w) => w.found && (w.kind === 'workflow' || w.kind === 'context' || w.kind === 'skill'))
    .map((w) => ({ name: w.name, path: w.path, text: safeRead(w.path, 40_000) }))
}
