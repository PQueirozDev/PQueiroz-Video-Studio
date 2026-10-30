import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, ImagePlus, Lightbulb, Loader2 } from 'lucide-react'
import type { ImageLayer, Layer, ProviderId } from '@shared/image'
import { styleById } from '@shared/image'
import { analyzeDoc, imageLayer } from '@shared/imageDoc'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { fitInto, useImage } from '@/image/imageStore'
import { blobBytes, removeFlatBackground } from '@/image/render'
import { ChatPanel, type BlockRenderer } from '../ChatPanel'
import { Badge, Button } from '../ui'

const SUGGESTIONS = [
  'Crie uma arte profissional de Dia dos Professores para a Aquecedores Fortes, com um aquecedor animado usando beca e a logo oficial da empresa.',
  'Deixa o título maior.',
  'Troca a logo pela versão branca.',
  'Transforma essa imagem em Stories.',
  'Faz uma versão mais profissional.',
  'Cria três variações.',
  'Mantém tudo e troca somente o título.'
]

const QUICK = ['Deixa o mascote maior', 'Diminui o texto', 'Deixa o fundo mais escuro', 'Cria três variações', 'Faz uma versão mais profissional']

const errMsg = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface GenSpec { role: 'background' | 'subject'; prompt: string; negative: string }

function parseGen(text: string): GenSpec | null {
  try {
    const j = JSON.parse(text.trim()) as Record<string, unknown>
    const prompt = String(j.prompt ?? '').trim()
    if (!prompt) return null
    const role = String(j.papel ?? j.role ?? 'background').toLowerCase()
    return { role: /subject|elemento|mascote|personagem/.test(role) ? 'subject' : 'background', prompt, negative: String(j.negativo ?? j.negative ?? '') }
  } catch {
    return null
  }
}

/** Insere a imagem gerada no lugar certo: espaço reservado, fundo existente ou nova camada. */
async function placeGenerated(path: string, width: number, height: number, role: 'background' | 'subject'): Promise<void> {
  const s = useImage.getState()
  const doc = s.doc
  if (!doc || !s.projectId) return
  let src = path
  if (role === 'subject') {
    // Elementos vêm sobre fundo branco liso: recorta automaticamente (o original continua salvo).
    try {
      const cut = await removeFlatBackground(path)
      src = await api.image.saveAsset(s.projectId, await blobBytes(cut), 'elemento recortado')
    } catch {
      /* usa a imagem como veio */
    }
  }
  const name = role === 'background' ? 'Cenário gerado' : 'Elemento gerado'
  s.change((d) => {
    const layers = [...d.layers]
    const slotIdx = layers.findIndex((l) => l.role === role && ((l.type === 'shape' && /^Espaço/i.test(l.name)) || (role === 'background' && l.type === 'image')))
    if (role === 'background') {
      const layer = imageLayer(src, 0, 0, d.width, d.height, { role: 'background', fit: 'cover', name })
      if (slotIdx >= 0) layers[slotIdx] = { ...layer, id: layers[slotIdx].id }
      else layers.unshift(layer)
    } else {
      const aspect = width / height
      let w = d.width * 0.62, h = w / aspect
      if (h > d.height * 0.6) {
        h = d.height * 0.6
        w = h * aspect
      }
      const base = imageLayer(src, Math.round((d.width - w) / 2), Math.round(d.height - h - d.height * 0.06), Math.round(w), Math.round(h), { role: 'subject', fit: 'contain', name, shadow: { color: 'rgba(0,0,0,0.35)', blur: 40, x: 0, y: 18 } })
      // Mascote provisório montado com formas (composição gratuita): a imagem gerada ocupa o lugar
      // dele, e as formas ficam ocultas (não apagadas — dá para desfazer ou reexibir).
      const draft = layers.map((l, i) => ({ l, i })).filter(({ l }) => l.visible && l.role === 'subject' && l.type !== 'image' && !/^Espaço/i.test(l.name))
      if (slotIdx >= 0) layers[slotIdx] = fitInto(base, layers[slotIdx]) as ImageLayer
      else if (draft.length) {
        const x0 = Math.min(...draft.map(({ l }) => l.x)), y0 = Math.min(...draft.map(({ l }) => l.y))
        const x1 = Math.max(...draft.map(({ l }) => l.x + l.w)), y1 = Math.max(...draft.map(({ l }) => l.y + l.h))
        const pad = (x1 - x0) * 0.1
        const tol = (x1 - x0) * 0.04
        // Detalhes do mascote (olhos, bochechas…) costumam vir como decoração: some tudo que está dentro dele.
        const inside = (l: Layer): boolean => l.type === 'shape' && l.x >= x0 - tol && l.y >= y0 - tol && l.x + l.w <= x1 + tol && l.y + l.h <= y1 + tol
        layers.forEach((l, i) => {
          if (l.visible && (draft.some((x) => x.i === i) || (l.role === 'decor' && inside(l)))) layers[i] = { ...l, visible: false }
        })
        layers.splice(draft[0].i, 0, fitInto(base, { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }))
      } else {
        const firstText = layers.findIndex((l) => l.role === 'text' || l.role === 'logo')
        layers.splice(firstText < 0 ? layers.length : firstText, 0, base)
      }
    }
    return { ...d, layers: layers as Layer[] }
  })
}

function GenerateCard({ text, requestKey }: { text: string; requestKey: string }) {
  const spec = useMemo(() => parseGen(text), [text])
  const { projectId, info, providers, doc, saveVersion } = useImage()
  const { toast, setDialog } = useStore()
  const ready = providers.filter((p) => p.ready && p.id !== 'composition')
  const [provider, setProvider] = useState<ProviderId | ''>('')
  const [prompt, setPrompt] = useState(spec?.prompt ?? '')
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const preferred = ready.find((p) => p.id === info?.provider) ?? ready[0]
    if (!provider && preferred) setProvider(preferred.id)
  }, [ready.length, info?.provider])
  useEffect(() => {
    if (projectId) api.image.generation(projectId, requestKey).then(setDone)
  }, [projectId, requestKey])

  if (!spec) return <pre><code>{text}</code></pre>
  const p = providers.find((x) => x.id === provider)
  const style = styleById(info?.style)

  const run = async (att: number): Promise<void> => {
    if (!projectId || !doc || !p) return
    setAttempt(att)
    if (p.paid && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setBusy(true)
    try {
      const slot = doc.layers.find((l) => l.role === 'subject' && l.type === 'shape' && /^Espaço/i.test(l.name))
      const size = spec.role === 'background' ? { width: doc.width, height: doc.height } : slot ? { width: slot.w, height: slot.h } : { width: 1024, height: 1024 }
      const r = await api.image.generate({
        projectId, provider: p.id, prompt: prompt.trim(), negative: spec.negative || style.negative, role: spec.role, ...size,
        requestKey: att ? `${requestKey}#${att}` : requestKey
      })
      await placeGenerated(r.path, r.width, r.height, spec.role)
      await saveVersion(`Imagem gerada (${p.name})`, prompt.slice(0, 500))
      setDone(r.path)
      toast(spec.role === 'background' ? 'Cenário gerado e aplicado' : 'Elemento gerado, recortado e aplicado', 'ok')
    } catch (err) {
      toast(errMsg(err), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-accent/30 bg-accent/[0.06]">
      <div className="flex items-center gap-2 border-b border-accent/20 px-3 py-2 text-xs font-semibold text-accent">
        <ImagePlus className="h-3.5 w-3.5" />{spec.role === 'background' ? 'Gerar cenário' : 'Gerar elemento (mascote/objeto)'}
        {done && <span className="ml-auto flex items-center gap-1 text-[10.5px] font-normal text-ok"><CheckCircle2 className="h-3 w-3" />gerado</span>}
      </div>
      <div className="space-y-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] text-faint hover:text-muted">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Prompt visual
        </button>
        {open
          ? <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} className="w-full resize-y rounded-md border border-line-2 bg-bg px-2 py-1.5 font-mono text-[11px] outline-none focus:border-accent" />
          : <p className="line-clamp-2 text-[11px] text-muted">{prompt}</p>}
        {ready.length === 0 ? (
          <div className="rounded-md border border-warn/30 bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
            Nenhum provedor de geração configurado. A composição gratuita continua funcionando, mas cenários e mascotes 3D exigem um gerador (alguns pagos).
            <button type="button" className="ml-1 underline" onClick={() => (useStore.setState({ settingsTab: 'imagens' }), setDialog('settings'))}>Configurar</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)} className="h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-bg px-2 text-xs">
                {ready.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {p && (p.paid ? <Badge tone="warn">Pago</Badge> : <Badge tone="ok">Gratuito</Badge>)}
            </div>
            {p && <p className="text-[10.5px] leading-snug text-faint">{p.paid ? p.costNote : p.privacyNote}</p>}
            {confirming && p && (
              <p className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
                Confirma? Esta geração será cobrada na sua conta {p.name.split(' (')[0]}. {p.privacyNote}
              </p>
            )}
            <div className="flex gap-1.5">
              <Button size="sm" variant="primary" disabled={busy || !prompt.trim()} onClick={() => void run(done && !confirming ? attempt + 1 : attempt)}>
                {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Gerando… (pode levar 1 min)</> : confirming ? 'Confirmar e gerar' : done ? 'Gerar de novo' : spec.role === 'background' ? 'Gerar cenário' : 'Gerar elemento'}
              </Button>
              {confirming && <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BriefingCard({ text }: { text: string }) {
  const rows = text.split('\n').map((l) => /^\s*([^:]{2,30}):\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m))
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line-2 bg-panel-2">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] font-semibold text-muted"><ClipboardList className="h-3.5 w-3.5" />Briefing</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 text-[11.5px]">
        {rows.map((m, i) => (
          <div key={i} className="contents">
            <dt className="text-faint">{m[1].trim()}</dt>
            <dd className="text-fg">{m[2].trim()}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const renderBlock: BlockRenderer = (lang, text, key) => {
  if (lang === 'gerar-imagem' || lang === 'gerar_imagem') return <GenerateCard text={text} requestKey={key} />
  if (lang === 'briefing') return <BriefingCard text={text} />
  return null
}

function Improvements() {
  const { doc, brands, info } = useImage()
  const { sendChat, projectId, live } = useStore()
  const [open, setOpen] = useState(false)
  const running = projectId ? Boolean(live[projectId]?.running) : false
  const brand = brands.find((b) => b.id === info?.brandId)
  const issues = useMemo(() => (doc ? analyzeDoc(doc, brand) : []), [doc, brand])
  return (
    <div className="mb-2 space-y-1.5">
      {issues.length > 0 && (
        <div className="rounded-lg border border-line-2 bg-panel-2">
          <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted hover:text-fg">
            <Lightbulb className="h-3.5 w-3.5 text-warn" />{issues.length} sugest{issues.length > 1 ? 'ões' : 'ão'} de melhoria
            {open ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronRight className="ml-auto h-3 w-3" />}
          </button>
          {open && (
            <ul className="space-y-1 border-t border-line px-2.5 py-2">
              {issues.map((i, k) => (
                <li key={k} className="flex items-start gap-1.5 text-[11px]">
                  {i.level === 'aviso' ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" /> : <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-info" />}
                  <span className="min-w-0 flex-1 text-muted">{i.text}</span>
                  <button type="button" disabled={running} onClick={() => sendChat(i.fix)} className="shrink-0 text-accent hover:underline disabled:opacity-40">corrigir</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {QUICK.map((q) => (
          <button key={q} type="button" disabled={running} onClick={() => sendChat(q)}
            className={cx('h-6 shrink-0 rounded-full border border-line-2 px-2 text-[10.5px] text-muted hover:border-accent/50 hover:text-fg disabled:opacity-40')}>{q}</button>
        ))}
      </div>
    </div>
  )
}

export function ImageChat() {
  return (
    <ChatPanel
      title="Diretor de arte · Claude"
      suggestions={SUGGESTIONS}
      emptyTitle="Descreva a arte que você quer"
      emptyHint="O Claude monta o briefing, a composição em camadas e o prompt do cenário. Textos e logo são camadas reais e editáveis."
      placeholder="Ex.: arte de Dia das Crianças para a Aquecedores Fortes, feed, com mascote"
      renderBlock={renderBlock}
      footer={<Improvements />}
    />
  )
}
