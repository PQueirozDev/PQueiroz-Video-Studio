import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { log } from '../log'
import { callTool } from './tools'

// Ponte local entre o servidor MCP (processo filho do Claude Code) e o processo principal.
// Só escuta em 127.0.0.1; cada turno do chat recebe um token próprio, ligado a UM projeto e revogado no fim.

const MAX_BODY = 5 * 1024 * 1024
interface Session { projectId: string; ctrl: AbortController }
const tokens = new Map<string, Session>()
let starting: Promise<number> | null = null

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Uma inicialização só, compartilhada (duas sessões ao mesmo tempo não recebem porta 0). */
function ensureServer(): Promise<number> {
  starting ??= startServer().catch((err) => {
    starting = null
    throw err
  })
  return starting
}

async function startServer(): Promise<number> {
  const server: Server = createServer((req, res) => {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    const host = (req.headers.host ?? '').split(':')[0]
    if (req.method !== 'POST' || req.url !== '/tool' || (host !== '127.0.0.1' && host !== 'localhost') || req.headers.origin) return reply(404, { ok: false, error: 'not found' })
    const auth = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
    const find = (): Session | undefined => [...tokens].find(([t]) => sameToken(t, auth))?.[1]
    if (!find()) return reply(401, { ok: false, error: 'Sessão do agente expirada.' })
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      // A sessão pode ter sido encerrada enquanto o corpo chegava.
      const session = find()
      if (!session || session.ctrl.signal.aborted) return reply(401, { ok: false, error: 'Sessão do agente expirada.' })
      let body: { name?: unknown; args?: unknown }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(400, { ok: false, error: 'JSON inválido.' })
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { ok: false, error: 'Corpo inválido.' })
      const { projectId } = session
      const name = typeof body.name === 'string' ? body.name : ''
      const args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {}
      const t0 = Date.now()
      callTool(projectId, name, args, session.ctrl.signal)
        .then((result) => {
          log.info('agent.tool', { projectId, name, ms: Date.now() - t0 })
          reply(200, { ok: true, result })
        })
        .catch((err: Error) => {
          log.warn('agent.tool_failed', { projectId, name, error: err.message })
          reply(200, { ok: false, error: err.message })
        })
    })
  })
  // Ferramentas longas (render, transcrição) não podem cair por timeout do servidor.
  server.requestTimeout = 0
  server.headersTimeout = 30_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  // A ponte nunca segura o processo vivo sozinha (o app fecha normalmente).
  server.unref()
  return port
}

/** Abre uma sessão de ferramentas para um turno do chat. Devolve a URL e o token (revogue no fim). */
export async function openAgentSession(projectId: string): Promise<{ url: string; token: string; close(): void }> {
  const p = await ensureServer()
  const token = randomBytes(32).toString('hex')
  const ctrl = new AbortController()
  tokens.set(token, { projectId, ctrl })
  // Fechar a sessão também cancela ferramentas em andamento: nada é gravado depois disso.
  return { url: `http://127.0.0.1:${p}/tool`, token, close: () => { ctrl.abort(); tokens.delete(token) } }
}
