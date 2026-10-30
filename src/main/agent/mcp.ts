// Servidor MCP (stdio) das ferramentas do PQueiroz Studio. Roda como processo filho do Claude Code,
// com o próprio executável do app em modo Node (ELECTRON_RUN_AS_NODE). Não importa nada do Electron:
// cada chamada vira um POST na ponte local do app (PQ_BRIDGE_URL + PQ_BRIDGE_TOKEN).
import { createInterface } from 'node:readline'
import { AGENT_TOOLS } from '@shared/agentTools'

const URL_ = process.env.PQ_BRIDGE_URL ?? ''
const TOKEN = process.env.PQ_BRIDGE_TOKEN ?? ''

interface Rpc { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: Record<string, unknown> }

const send = (msg: unknown): void => {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
const result = (id: Rpc['id'], r: unknown): void => send({ jsonrpc: '2.0', id, result: r })
const error = (id: Rpc['id'], code: number, message: string): void => send({ jsonrpc: '2.0', id, error: { code, message } })

async function call(name: string, args: unknown): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ name, args: args ?? {} }) })
    const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string }
    if (!body.ok) return { content: [{ type: 'text', text: `Erro: ${body.error ?? res.status}` }], isError: true }
    return { content: [{ type: 'text', text: JSON.stringify(body.result) }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Erro ao falar com o PQueiroz Studio (o app está aberto?): ${(err as Error).message}` }], isError: true }
  }
}

async function handle(msg: Rpc): Promise<void> {
  const { id, method, params } = msg
  if (method === undefined) return
  const notification = id === undefined || id === null
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'pqstudio', version: '1.0.0' },
        instructions: 'Ferramentas do PQueiroz Studio: edite a timeline do projeto aberto com comandos validados. Comece por estado_projeto.'
      })
    case 'ping':
      return result(id, {})
    case 'tools/list':
      return result(id, { tools: AGENT_TOOLS })
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : ''
      if (!AGENT_TOOLS.some((t) => t.name === name)) return error(id, -32602, `Ferramenta desconhecida: ${name}`)
      return result(id, await call(name, params?.arguments))
    }
    default:
      if (!notification) error(id, -32601, `Método não suportado: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg: Rpc
  try {
    msg = JSON.parse(line)
  } catch {
    return error(null, -32700, 'JSON inválido')
  }
  void handle(msg)
})
rl.on('close', () => process.exit(0))
