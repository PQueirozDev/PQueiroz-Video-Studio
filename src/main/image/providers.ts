import { existsSync, readFileSync } from 'node:fs'
import type { GenerateRequest, GenerateResult, ProviderConfigInput, ProviderId, ProviderInfo } from '@shared/image'
import { one, run } from '../db'
import { writeUnique } from '../files'
import { projectPath, requireProject } from '../projects/projects'
import { now } from '../util'
import { decodePng } from './png'
import { getSecret, secretHint, setSecret } from './secrets'

// Arquitetura de provedores de geração de imagem. O Image Studio só conhece esta interface:
// para trocar ou acrescentar um serviço basta registrar um novo Provider aqui.
//
// O Claude Code NÃO gera imagens: ele é o diretor de arte (escreve o prompt e monta as camadas).
// Quem desenha o cenário é o provedor escolhido pelo Pedro — cada um com o custo informado.

interface ProviderConfig { model: string; endpoint: string; enabled: boolean }

interface Provider {
  id: ProviderId
  name: string
  kind: ProviderInfo['kind']
  paid: boolean
  costNote: string
  privacyNote: string
  needsKey: boolean
  defaults: ProviderConfig
  setupHint: string
  generate?(req: GenerateRequest, cfg: ProviderConfig, key: string | null, signal: AbortSignal): Promise<Buffer>
}

/** Tamanho pedido ao provedor: mesma proporção da arte, dentro dos limites de cada serviço. */
function fitSize(w: number, h: number, maxSide: number, multiple = 8): { width: number; height: number } {
  const s = Math.min(1, maxSide / Math.max(w, h))
  const r = (v: number): number => Math.max(multiple, Math.round((v * s) / multiple) * multiple)
  return { width: r(w), height: r(h) }
}

const MAX_RESPONSE = 40 * 1024 * 1024

/** Lê o corpo com limite de tamanho (uma resposta enorme não derruba o app). */
async function readLimited(res: Response, provider: string): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_RESPONSE) throw new Error(`${provider} devolveu um arquivo grande demais.`)
  const reader = res.body?.getReader()
  if (!reader) return Buffer.from(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_RESPONSE) {
      await reader.cancel()
      throw new Error(`${provider} devolveu um arquivo grande demais.`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Stable Diffusion "local" só pode apontar para este computador ou para a rede local. */
function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '::1' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local')
}

async function ensureOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    const j = (await res.json()) as { error?: { message?: string } | string; detail?: string }
    detail = typeof j.error === 'string' ? j.error : j.error?.message ?? j.detail ?? ''
  } catch {
    detail = await res.text().catch(() => '')
  }
  const hint = res.status === 401 || res.status === 403 ? ' Verifique a chave de API.'
    : res.status === 402 || res.status === 429 ? ' Sem créditos ou limite de uso atingido na conta do provedor.' : ''
  throw new Error(`${provider} respondeu ${res.status}: ${detail.slice(0, 300) || res.statusText}.${hint}`)
}

const PROVIDERS: Provider[] = [
  {
    id: 'composition', name: 'Composição local (gratuito)', kind: 'composicao', paid: false, needsKey: false,
    costNote: 'Gratuito. Não gera imagens: monta a arte com formas, gradientes, efeitos, fotos e logos que você já tem.',
    privacyNote: 'Nada sai do computador.',
    defaults: { model: '', endpoint: '', enabled: true },
    setupHint: 'Sempre disponível. O resultado não se compara a um modelo generativo (sem mascotes 3D ou cenários realistas).'
  },
  {
    id: 'openai', name: 'OpenAI (GPT Image)', kind: 'api', paid: true, needsKey: true,
    costNote: 'PAGO: cada imagem é cobrada na sua conta da OpenAI (API), separada da assinatura do ChatGPT e do Claude. Veja os preços em platform.openai.com/pricing.',
    privacyNote: 'O prompt de texto é enviado à OpenAI. Logos e fotos NÃO são enviados.',
    defaults: { model: 'gpt-image-2', endpoint: 'https://api.openai.com/v1/images/generations', enabled: true },
    setupHint: 'Crie uma chave em platform.openai.com/api-keys e adicione créditos (billing) à conta.',
    async generate(req, cfg, key, signal) {
      const ratio = req.width / req.height
      const size = ratio > 1.15 ? '1536x1024' : ratio < 0.87 ? '1024x1536' : '1024x1024'
      const res = await fetch(cfg.endpoint, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: cfg.model, prompt: req.prompt, size, n: 1, quality: 'high' })
      })
      await ensureOk(res, 'OpenAI')
      const j = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
      const item = j.data?.[0]
      if (item?.b64_json) return Buffer.from(item.b64_json, 'base64')
      if (item?.url) {
        const img = await fetch(item.url, { signal })
        await ensureOk(img, 'OpenAI')
        return readLimited(img, 'OpenAI')
      }
      throw new Error('A OpenAI não devolveu imagem.')
    }
  },
  {
    id: 'gemini', name: 'Google Gemini (Nano Banana)', kind: 'api', paid: true, needsKey: true,
    costNote: 'PAGO (pode ter cota gratuita limitada): cobrado por imagem na sua conta do Google AI Studio / Cloud. Veja ai.google.dev/pricing.',
    privacyNote: 'O prompt de texto é enviado ao Google. Logos e fotos NÃO são enviados.',
    defaults: { model: 'gemini-2.5-flash-image', endpoint: 'https://generativelanguage.googleapis.com/v1beta', enabled: true },
    setupHint: 'Crie uma chave em aistudio.google.com/apikey (com faturamento ativo para uso acima da cota gratuita).',
    async generate(req, cfg, key, signal) {
      const ratios: [string, number][] = [['1:1', 1], ['4:5', 0.8], ['3:4', 0.75], ['2:3', 0.667], ['9:16', 0.5625], ['5:4', 1.25], ['4:3', 1.333], ['3:2', 1.5], ['16:9', 1.778]]
      const r = req.width / req.height
      const aspect = ratios.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0]
      const url = `${cfg.endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(cfg.model)}:generateContent`
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key ?? '' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: req.prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } }
        })
      })
      await ensureOk(res, 'Gemini')
      const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] } }[] }
      for (const part of j.candidates?.[0]?.content?.parts ?? []) {
        const data = part.inlineData?.data ?? part.inline_data?.data
        if (data) return Buffer.from(data, 'base64')
      }
      throw new Error('O Gemini não devolveu imagem (o pedido pode ter sido bloqueado pelo filtro de segurança).')
    }
  },
  {
    id: 'sd-local', name: 'Stable Diffusion local (AUTOMATIC1111 / Forge)', kind: 'local', paid: false, needsKey: false,
    costNote: 'Gratuito: roda na sua placa de vídeo. Exige o AUTOMATIC1111 ou Forge instalado e aberto com --api.',
    privacyNote: 'Nada sai do computador (ou da sua rede local, se o webui estiver em outra máquina dela).',
    defaults: { model: '', endpoint: 'http://127.0.0.1:7860', enabled: false },
    setupHint: 'Ative aqui depois de instalar. Inicie o webui com o argumento --api; a qualidade depende do modelo (checkpoint) carregado nele.',
    async generate(req, cfg, _key, signal) {
      const size = fitSize(req.width, req.height, 1024, 64)
      const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/sdapi/v1/txt2img`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: req.prompt, negative_prompt: req.negative ?? '', width: size.width, height: size.height, steps: 30, cfg_scale: 6, sampler_name: 'DPM++ 2M' })
      })
      await ensureOk(res, 'Stable Diffusion')
      const j = (await res.json()) as { images?: string[] }
      if (!j.images?.[0]) throw new Error('O Stable Diffusion não devolveu imagem.')
      return Buffer.from(j.images[0].replace(/^data:image\/\w+;base64,/, ''), 'base64')
    }
  },
  {
    id: 'pollinations', name: 'Pollinations (gratuito, externo)', kind: 'externo-gratuito', paid: false, needsKey: false,
    costNote: 'Gratuito e sem chave, mas é um serviço público de terceiros: pode ficar lento, mudar ou sair do ar, e a qualidade é inferior aos pagos.',
    privacyNote: 'O prompt de texto é enviado a pollinations.ai (serviço público). Logos e fotos NÃO são enviados.',
    defaults: { model: 'flux', endpoint: 'https://image.pollinations.ai/prompt', enabled: false },
    setupHint: 'Desativado até você ativar — o prompt sai do computador para um serviço público.',
    async generate(req, cfg, _key, signal) {
      const size = fitSize(req.width, req.height, 1280, 8)
      const q = new URLSearchParams({ width: String(size.width), height: String(size.height), nologo: 'true', seed: String(Math.floor(Math.random() * 1e6)), model: cfg.model || 'flux' })
      if (req.negative) q.set('negative_prompt', req.negative)
      const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/${encodeURIComponent(req.prompt.slice(0, 1800))}?${q}`, { signal })
      await ensureOk(res, 'Pollinations')
      return readLimited(res, 'Pollinations')
    }
  }
]

const byId = (id: string): Provider => {
  const p = PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error('Provedor de imagem desconhecido')
  return p
}

function configs(): Record<string, Partial<ProviderConfig>> {
  try {
    return JSON.parse(one<{ value: string }>("SELECT value FROM settings WHERE key = 'imageProviders'")?.value ?? '{}')
  } catch {
    return {}
  }
}

function configOf(p: Provider): ProviderConfig {
  return { ...p.defaults, ...(configs()[p.id] ?? {}) }
}

function info(p: Provider): ProviderInfo {
  const cfg = configOf(p)
  const hasKey = p.needsKey ? Boolean(getSecret(p.id)) : false
  return {
    id: p.id, name: p.name, kind: p.kind, paid: p.paid, costNote: p.costNote, privacyNote: p.privacyNote,
    needsKey: p.needsKey, hasKey, keyHint: p.needsKey ? secretHint(p.id) : null,
    model: cfg.model, endpoint: cfg.endpoint, enabled: cfg.enabled,
    ready: cfg.enabled && (!p.needsKey || hasKey), setupHint: p.setupHint
  }
}

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map(info)
}

export function providerInfo(id: ProviderId): ProviderInfo {
  return info(byId(id))
}

export function configureProvider(id: ProviderId, input: ProviderConfigInput): ProviderInfo {
  const p = byId(id)
  const all = configs()
  const cur = configOf(p)
  const next: ProviderConfig = {
    model: typeof input.model === 'string' ? input.model.trim().slice(0, 120) : cur.model,
    endpoint: cur.endpoint,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : cur.enabled
  }
  if (typeof input.endpoint === 'string' && input.endpoint.trim()) {
    const url = new URL(input.endpoint.trim())
    if (!/^https?:$/.test(url.protocol)) throw new Error('Endereço inválido')
    // Serviços pagos só por HTTPS (a chave viaja no cabeçalho).
    if (p.needsKey && url.protocol !== 'https:') throw new Error('Use um endereço https:// para não expor a chave.')
    if (p.kind === 'local' && !isLocalHost(url.hostname)) throw new Error('O Stable Diffusion local precisa estar neste computador ou na rede local.')
    if (p.kind === 'externo-gratuito' && url.protocol !== 'https:') throw new Error('Use um endereço https://.')
    next.endpoint = url.toString().replace(/\/$/, '')
  }
  all[id] = next
  run("INSERT INTO settings(key, value) VALUES('imageProviders', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(all))
  return info(p)
}

export function setProviderKey(id: ProviderId, key: string | null): ProviderInfo {
  const p = byId(id)
  if (!p.needsKey) throw new Error('Este provedor não usa chave.')
  setSecret(p.id, key)
  return info(p)
}

/** Dimensões de PNG, JPEG ou WebP direto do cabeçalho. */
export function imageSize(buf: Buffer): { width: number; height: number; ext: 'png' | 'jpg' | 'webp' } {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), ext: 'png' }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), ext: 'webp' }
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, ext: 'webp' }
    }
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, ext: 'webp' }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), ext: 'jpg' }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  throw new Error('O provedor devolveu um arquivo que não é imagem.')
}

const SUBJECT_SUFFIX = ', single isolated subject centered, full body fully visible with margin around it, on a plain solid pure white background, no floor, no props, no text'
const running = new Set<string>()

export async function generateImage(req: GenerateRequest): Promise<GenerateResult> {
  const project = requireProject(req.projectId)
  if (project.kind !== 'image') throw new Error('Geração de imagem só existe em projetos do Image Studio.')
  const p = byId(req.provider)
  const meta = info(p)
  if (!p.generate) throw new Error('A composição local não gera imagens: escolha um provedor de geração ou monte a arte com camadas.')
  if (!meta.enabled) throw new Error(`${p.name} está desativado em Configurações › Geração de imagens.`)
  if (p.needsKey && !meta.hasKey) throw new Error(`${p.name} precisa de uma chave de API. ${p.setupHint}`)
  const prompt = String(req.prompt ?? '').trim()
  if (prompt.length < 3 || prompt.length > 4000) throw new Error('Prompt vazio ou longo demais.')
  const width = Math.round(Number(req.width))
  const height = Math.round(Number(req.height))
  if (!(width >= 64 && width <= 4096 && height >= 64 && height <= 4096)) throw new Error('Tamanho inválido.')
  const role = req.role === 'subject' ? 'subject' : 'background'
  const requestKey = typeof req.requestKey === 'string' ? req.requestKey.slice(0, 200) : null

  if (requestKey) {
    const done = one<{ path: string | null; provider: string }>('SELECT path, provider FROM image_generations WHERE request_key = ? AND project_id = ?', requestKey, project.id)
    if (done?.path && existsSync(done.path)) {
      const size = imageSize(readFileSync(done.path))
      return { path: done.path, width: size.width, height: size.height, provider: done.provider as ProviderId, prompt }
    }
    if (running.has(requestKey)) throw new Error('Esta imagem já está sendo gerada.')
    running.add(requestKey)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 240_000)
  try {
    const finalPrompt = role === 'subject' ? prompt + SUBJECT_SUFFIX : prompt
    const buf = await p.generate({ ...req, prompt: finalPrompt, width, height, role }, configOf(p), getSecret(p.id), controller.signal)
    const size = imageSize(buf)
    if (size.ext === 'png') decodePng(buf) // confere que o PNG é legível antes de gravar
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const path = writeUnique(projectPath(project, 'assets', 'gerado'), `${role === 'subject' ? 'elemento' : 'cenario'}-${p.id}-${stamp}.${size.ext}`, buf)
    if (requestKey) run('INSERT OR REPLACE INTO image_generations(request_key, project_id, provider, path, created_at) VALUES(?, ?, ?, ?, ?)', requestKey, project.id, p.id, path, now())
    return { path, width: size.width, height: size.height, provider: p.id, prompt }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`${p.name} não respondeu em 4 minutos.`)
    throw err
  } finally {
    clearTimeout(timer)
    if (requestKey) running.delete(requestKey)
  }
}

export function generationFor(projectId: string, requestKey: string): string | null {
  const r = one<{ path: string | null }>('SELECT path FROM image_generations WHERE request_key = ? AND project_id = ?', requestKey, projectId)
  return r?.path && existsSync(r.path) ? r.path : null
}
