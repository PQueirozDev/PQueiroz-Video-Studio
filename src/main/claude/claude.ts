import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { delimiter, dirname } from 'node:path'
import type { ChatMessage, ClaudeEvent, Version } from '@shared/types'
import { all, run } from '../db'
import { ensureDir } from '../files'
import { getProject, projectPath, requireProject, setClaudeSession, touchProject } from '../projects/projects'
import { getSettings } from '../settings'
import { claudePath, ffmpegPath, pythonPath } from '../tools'
import { killTree, now, ownGroup, uid } from '../util'
import { listVersions, restoreVersion, snapshotOutputs } from '../versions/versions'
import { prepareEditFolder } from '../skills/template'
import { buildContext } from './context'
import { describeTool } from './status'
import { applyRateLimitEvent } from './usage'

// Cada pedido do chat roda o Claude Code (claude) em modo não interativo, num processo
// separado, com a pasta do projeto como diretório de trabalho. A sessão é retomada a cada
// turno (--resume), então o Claude lembra de toda a conversa do projeto.

type Emit = (e: ClaudeEvent) => void

interface Running {
  child: ChildProcess
  cancelled: boolean
}

const running = new Map<string, Running>()

const ALLOWED_TOOLS = ['Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite']
const DENIED_TOOLS = [
  'Bash(rm -rf:*)', 'Bash(rm -r:*)', 'Bash(rmdir:*)', 'Bash(del:*)', 'Bash(rd:*)', 'Bash(format:*)', 'Bash(git push:*)',
  'PowerShell(Remove-Item:*)', 'PowerShell(rm:*)', 'PowerShell(del:*)', 'PowerShell(Format-Volume:*)'
]

interface MessageRow { id: string; project_id: string; role: string; content: string; activity: string; created_at: number }

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id, projectId: r.project_id, role: r.role as ChatMessage['role'], content: r.content,
  activity: JSON.parse(r.activity || '[]'), createdAt: r.created_at
})

export function chatHistory(projectId: string): ChatMessage[] {
  return all<MessageRow>('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at', projectId).map(toMessage)
}

function saveMessage(projectId: string, role: ChatMessage['role'], content: string, activity: string[] = []): ChatMessage {
  const m: ChatMessage = { id: uid(), projectId, role, content, activity, createdAt: now() }
  run('INSERT INTO messages(id, project_id, role, content, activity, created_at) VALUES(?, ?, ?, ?, ?, ?)',
    m.id, projectId, role, content, JSON.stringify(activity), m.createdAt)
  return m
}

export function isRunning(projectId: string): boolean {
  return running.has(projectId)
}

export function cancelChat(projectId: string): void {
  const r = running.get(projectId)
  if (!r) return
  r.cancelled = true
  killTree(r.child.pid)
}

export function resetSession(projectId: string): void {
  setClaudeSession(projectId, null)
  saveMessage(projectId, 'system', 'Nova conversa iniciada. O Claude não lembra das mensagens anteriores, mas continua vendo o projeto, as mídias e as versões.')
}

/** Ao abrir o app: pedidos que estavam rodando quando o app fechou/caiu. */
export function recoverInterruptedRuns(): void {
  for (const r of all<{ project_id: string; request: string }>('SELECT project_id, request FROM runs')) {
    if (getProject(r.project_id)) {
      saveMessage(r.project_id, 'system', `O estúdio foi fechado enquanto o Claude trabalhava em: "${r.request.slice(0, 200)}". Arquivos já gerados continuam na pasta do projeto — peça para continuar se precisar.`)
    }
  }
  run('DELETE FROM runs')
}

/** Executa ações pedidas pelo Claude em blocos ```acao```. */
function applyActions(projectId: string, text: string): string[] {
  const done: string[] = []
  for (const block of text.matchAll(/```acao\s*\n([\s\S]*?)```/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const m = /^\s*restaurar\s+(?:a\s+)?(?:vers[aã]o\s+)?V?(\d+)/i.exec(line)
      if (!m) continue
      const v = listVersions(projectId).find((x) => x.number === Number(m[1]))
      if (v) {
        restoreVersion(projectId, v.id)
        done.push(`Versão ${v.label} restaurada`)
      } else {
        done.push(`V${m[1]} não existe`)
      }
    }
  }
  return done
}

export async function sendChat(projectId: string, text: string, emit: Emit): Promise<void> {
  if (running.has(projectId)) throw new Error('O Claude ainda está trabalhando neste projeto.')
  const project = requireProject(projectId)
  const bin = await claudePath()
  if (!bin) throw new Error('Claude Code não encontrado. Veja Configurações › Claude.')

  saveMessage(projectId, 'user', text)
  touchProject(projectId)
  const startedAt = now()
  run('INSERT OR REPLACE INTO runs(project_id, started_at, request) VALUES(?, ?, ?)', projectId, startedAt, text)
  emit({ type: 'status', projectId, text: 'Claude está analisando o projeto...' })

  // Passo 4 do CLAUDE.md feito pelo estúdio: edit/ = cópia corrigida do Modelo edicao.
  const prepared = await prepareEditFolder(project).catch(() => ({ created: false, patches: [] as string[] }))
  if (prepared.created) emit({ type: 'activity', projectId, messageId: 'prep', text: 'Preparou edit/ a partir do Modelo edicao' })

  const ctxFile = projectPath(project, 'temp', 'claude-context.md')
  ensureDir(dirname(ctxFile))
  writeFileSync(ctxFile, await buildContext(project), 'utf8')

  const s = getSettings()
  let sessionId = project.claudeSessionId
  const resuming = Boolean(sessionId)
  if (!sessionId) {
    sessionId = uid()
    setClaudeSession(projectId, sessionId)
  }
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt-file', ctxFile,
    // Sem isso o CLI congela o prompt do 1º turno e o Claude não veria mídias/versões novas ao retomar.
    '--system-prompt-snapshot', 'off',
    '--add-dir', s.aqcRoot,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...ALLOWED_TOOLS,
    '--disallowedTools', ...DENIED_TOOLS,
    ...(resuming ? ['--resume', sessionId] : ['--session-id', sessionId]),
    ...(s.claudeModel ? ['--model', s.claudeModel] : [])
  ]

  // Python e FFmpeg no PATH do Claude, e UTF-8 para os helpers (exigência do CLAUDE.md no Windows).
  const extraPath = [await pythonPath(), await ffmpegPath()].filter(Boolean).map((p) => dirname(p!))
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PATH: [...extraPath, process.env.PATH].join(delimiter) }

  const child = spawn(bin, args, { cwd: project.path, env, windowsHide: true, shell: false, detached: ownGroup })
  const state: Running = { child, cancelled: false }
  running.set(projectId, state)

  const messageId = uid()
  let live = ''
  let finalText = ''
  let resultText = ''
  let costUsd: number | undefined
  let isError = false
  let stderr = ''
  let buf = ''
  const activity: string[] = []
  let lastEmit = 0

  const pushText = (force = false): void => {
    const t = now()
    if (force || t - lastEmit > 60) {
      lastEmit = t
      emit({ type: 'text', projectId, messageId, text: live })
    }
  }

  const handle = (msg: Record<string, any>): void => {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init' && msg.session_id && msg.session_id !== sessionId) {
          sessionId = msg.session_id
          setClaudeSession(projectId, sessionId)
        }
        break
      case 'stream_event': {
        const ev = msg.event ?? {}
        if (ev.type === 'message_start' && live && !live.endsWith('\n\n')) live += '\n\n'
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          live += ev.delta.text
          pushText()
        }
        break
      }
      case 'assistant': {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            finalText += (finalText ? '\n\n' : '') + block.text
          } else if (block.type === 'tool_use') {
            const d = describeTool(block.name, block.input ?? {})
            activity.push(d.activity)
            emit({ type: 'activity', projectId, messageId, text: d.activity })
            emit({ type: 'status', projectId, text: d.status })
          }
        }
        break
      }
      case 'rate_limit_event':
        applyRateLimitEvent(msg.rate_limit_info)
        break
      case 'result':
        resultText = typeof msg.result === 'string' ? msg.result : ''
        costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined
        isError = Boolean(msg.is_error)
        break
    }
  }

  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        handle(JSON.parse(line))
      } catch {
        /* linha que não é JSON (aviso do CLI) */
      }
    }
  })
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString('utf8')).slice(-4000)
  })
  child.stdin.end(text, 'utf8')

  child.on('close', async (code) => {
    running.delete(projectId)
    run('DELETE FROM runs WHERE project_id = ?', projectId)
    pushText(true)
    const content = (finalText || live || resultText).trim()

    // Sessão salva que o CLI não conhece mais (ex.: histórico apagado): recomeça uma nova.
    if (resuming && code !== 0 && /No conversation found|session.*not found/i.test(stderr + resultText)) {
      setClaudeSession(projectId, null)
      run("DELETE FROM messages WHERE id = (SELECT id FROM messages WHERE project_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1)", projectId)
      sendChat(projectId, text, emit).catch((err) => emit({ type: 'error', projectId, error: String(err.message ?? err) }))
      return
    }

    let versions: Version[] = []
    try {
      emit({ type: 'status', projectId, text: 'Finalizando...' })
      versions = await snapshotOutputs(projectId, startedAt, text, content.slice(0, 2000))
    } catch (err) {
      activity.push(`Falha ao registrar versão: ${(err as Error).message}`)
    }
    const actions = applyActions(projectId, content)
    activity.push(...actions)
    if (versions.length) activity.push(`Nova versão: ${versions.map((v) => v.label).join(', ')}`)

    let body = content
    if (state.cancelled) body = (content ? `${content}\n\n` : '') + '_Interrompido pelo usuário._'
    else if (code !== 0 && !content) body = `Não consegui concluir (código ${code}).\n\n\`\`\`\n${stderr.trim().slice(-1500) || 'sem detalhes'}\n\`\`\``
    else if (isError && !content) body = 'O Claude retornou um erro sem mensagem.'
    const message = saveMessage(projectId, 'assistant', body || '(sem resposta)', activity)
    touchProject(projectId)
    emit({ type: 'done', projectId, message, versions, costUsd })
  })

  child.on('error', (err) => {
    running.delete(projectId)
    run('DELETE FROM runs WHERE project_id = ?', projectId)
    emit({ type: 'error', projectId, error: `Falha ao iniciar o Claude: ${err.message}` })
  })
}
