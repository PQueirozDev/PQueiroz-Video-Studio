import { useEffect, useMemo, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { AlertTriangle, ArrowLeft, ImagePlus, Sparkles, Wand2 } from 'lucide-react'
import type { ImageFormatId } from '@shared/image'
import { IMAGE_FORMATS, STYLE_PRESETS } from '@shared/image'
import { buildTemplate, TEMPLATES } from '@shared/templates'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { Button, Field, inputClass, Spinner } from '../ui'
import { ProjectCard } from '../Dashboard'
import { LeftPanel } from './LeftPanel'
import { CenterPanel } from './CenterPanel'
import { ImageChat } from './ImageChat'
import { ExportDialog, ToVideoDialog } from './Dialogs'

const errMsg = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** "Crie uma arte profissional de Dia dos Professores para a X, com…" → "Dia dos Professores". */
function titleFromPrompt(prompt: string): string {
  const first = prompt.trim().split(/[.,;\n]/)[0]
  const t = first
    .replace(/^(por favor,?\s*)?(crie|cria|criar|faça|faz|fazer|gere|gera|gerar|monte|monta|quero|preciso de)\s+/i, '')
    .replace(/^(uma?|o|a)\s+/i, '')
    .replace(/^(arte|post|postagem|imagem|story|stories|banner|capa|thumbnail|miniatura|anúncio|criativo)s?\s+/i, '')
    .replace(/^(profissional|bonit[ao]|premium|moderna?)\s+/i, '')
    .replace(/^(de|do|da|dos|das|para|sobre)\s+/i, '')
    .split(/\s+(?:para|pra|com)\s+/i)[0]
    .trim()
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 60)
}

function FormatPicker({ value, onChange }: { value: ImageFormatId; onChange(v: ImageFormatId): void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {IMAGE_FORMATS.filter((f) => f.id !== 'custom').map((f) => {
        const s = 34 / Math.max(f.width, f.height)
        return (
          <button key={f.id} type="button" onClick={() => onChange(f.id)} aria-pressed={value === f.id}
            className={cx('flex flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2', value === f.id ? 'border-accent bg-accent-soft' : 'border-line-2 hover:bg-raised')}>
            <span className="flex h-9 items-center"><span className="rounded-[3px] border border-current text-muted" style={{ width: f.width * s, height: f.height * s }} /></span>
            <span className="text-center text-[10.5px] leading-tight">{f.label}<br /><span className="text-faint">{f.width}×{f.height}</span></span>
          </button>
        )
      })}
    </div>
  )
}

function ImageHome() {
  const { projects, openProject, sendChat, toast, setView, loadProjects } = useStore()
  const { brands, loadBrands, loadProviders, providers } = useImage()
  const [name, setName] = useState('')
  const [brandId, setBrandId] = useState('aquecedores-fortes')
  const [formatId, setFormatId] = useState<ImageFormatId>('ig-feed')
  const [style, setStyle] = useState(STYLE_PRESETS[0].id)
  const [templateId, setTemplateId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void loadBrands()
    void loadProviders()
    void loadProjects()
  }, [loadBrands, loadProviders, loadProjects])
  const imageProjects = projects.filter((p) => p.kind === 'image')
  const brand = brands.find((b) => b.id === brandId) ?? null
  const generators = providers.filter((p) => p.ready && p.id !== 'composition')
  const tpl = useMemo(() => TEMPLATES.find((t) => t.id === templateId), [templateId])

  const create = async (withClaude: boolean): Promise<void> => {
    setBusy(true)
    try {
      const logo = brand?.logos.find((l) => l.id === brand.defaultLogoId) ?? brand?.logos[0] ?? null
      const doc = tpl ? buildTemplate(tpl, formatId, { brand, logo }) : undefined
      const title = name.trim() || titleFromPrompt(prompt) || (tpl ? tpl.name : 'Nova arte')
      const r = await api.image.create({ name: title, brandId: brand?.id ?? null, formatId, prompt: prompt.trim(), style, doc })
      await openProject(r.project.id)
      if (withClaude && prompt.trim()) await sendChat(prompt.trim())
    } catch (err) {
      toast(errMsg(err), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Image Studio</h1>
          <p className="mt-1 text-[13px] text-muted">Artes publicitárias com direção de arte do Claude, textos e logo em camadas reais e versões automáticas.</p>
        </div>

        <div className="mb-10 grid gap-5 rounded-xl border border-line bg-panel p-5 lg:grid-cols-[1.25fr_1fr]">
          <div className="space-y-4">
            <Field label="O que você quer criar?" hint="O Claude interpreta o pedido, monta o briefing, a composição e o prompt do cenário.">
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="Ex.: Crie uma arte profissional de Dia dos Professores para a Aquecedores Fortes, com um aquecedor animado usando beca e a logo oficial da empresa."
                className="w-full resize-none rounded-lg border border-line-2 bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent" />
            </Field>
            <div role="group" aria-label="Formato">
              <span className="mb-1.5 block text-xs font-medium text-muted">Formato</span>
              <FormatPicker value={formatId} onChange={setFormatId} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" disabled={busy || !prompt.trim()} onClick={() => create(true)}>{busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}Criar com o Claude</Button>
              <Button size="lg" disabled={busy} onClick={() => create(false)}><ImagePlus className="h-4 w-4" />Começar em branco{tpl ? ' (template)' : ''}</Button>
            </div>
          </div>
          <div className="space-y-3">
            <Field label="Nome do projeto"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Automático a partir do pedido" /></Field>
            <Field label="Marca">
              <select className={inputClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">Sem marca</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            {brand && !brand.logos.length && (
              <p className="flex items-start gap-1.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{brand.name} ainda não tem a logo oficial. <button type="button" className="underline" onClick={() => setView('assets')}>Importar a logo (PDF/PNG)</button></span>
              </p>
            )}
            <Field label="Estilo">
              <select className={inputClass} value={style} onChange={(e) => setStyle(e.target.value)}>
                {STYLE_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Template (opcional)">
              <select className={inputClass} value={templateId} onChange={(e) => {
                setTemplateId(e.target.value)
                const t = TEMPLATES.find((x) => x.id === e.target.value)
                if (t) setFormatId(t.formatId)
              }}>
                <option value="">Nenhum — o Claude compõe do zero</option>
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <p className={cx('rounded-lg border px-3 py-2 text-[11.5px] leading-snug', generators.length ? 'border-ok/25 bg-ok/10 text-ok' : 'border-line-2 bg-bg text-muted')}>
              {generators.length
                ? `Geração de imagens pronta: ${generators.map((g) => `${g.name}${g.paid ? ' (pago)' : ''}`).join(', ')}.`
                : 'Sem gerador de imagens configurado: a arte será montada no modo de composição gratuita (formas, gradientes, efeitos e suas imagens). Mascotes 3D e cenários exigem um provedor — veja Configurações › Geração de imagens.'}
            </p>
          </div>
        </div>

        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-faint">Artes</h2>
        {imageProjects.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-2 py-12 text-center">
            <Wand2 className="h-7 w-7 text-faint" />
            <p className="text-[13px] text-muted">Nenhuma arte ainda. Descreva a primeira acima.</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {imageProjects.map((p) => <ProjectCard key={p.id} p={p} onOpen={() => openProject(p.id)} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function ImageEditor() {
  const doc = useImage((s) => s.doc)
  const [dialog, setDialog] = useState<null | 'export' | 'video'>(null)
  if (!doc) return <div className="flex h-full items-center justify-center"><Spinner className="h-5 w-5 text-accent" /></div>
  return (
    <>
      <Group orientation="horizontal" id="pq-image" className="h-full">
        <Panel id="image-left" defaultSize="21%" minSize="250px" maxSize="34%">
          <LeftPanel />
        </Panel>
        <Separator className="w-px" />
        <Panel id="image-center" minSize="30%" defaultSize="51%">
          <CenterPanel onExport={() => setDialog('export')} onVideo={() => setDialog('video')} />
        </Panel>
        <Separator className="w-px" />
        <Panel id="image-chat" defaultSize="28%" minSize="290px" maxSize="45%">
          <ImageChat />
        </Panel>
      </Group>
      <ExportDialog open={dialog === 'export'} onClose={() => setDialog(null)} />
      <ToVideoDialog open={dialog === 'video'} onClose={() => setDialog(null)} />
    </>
  )
}

export function ImageStudio() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const projectId = useStore((s) => s.projectId)
  const imageId = useImage((s) => s.projectId)
  const isImage = project?.kind === 'image'

  useEffect(() => {
    if (isImage && projectId && imageId !== projectId) void useImage.getState().open(projectId)
  }, [isImage, projectId, imageId])

  if (!isImage) return <ImageHome />
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-bg px-2 text-xs">
        <button type="button" onClick={() => {
          useImage.getState().close()
          useStore.setState({ projectId: null, messages: [], versions: [], media: [] })
          useStore.getState().saveSettings({ lastProjectId: null })
        }} className="flex h-6 items-center gap-1 rounded-md px-1.5 text-muted hover:bg-raised hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" />Artes
        </button>
        <span className="text-faint">/</span>
        <span className="truncate font-medium">{project?.name}</span>
      </div>
      <div className="min-h-0 flex-1"><ImageEditor /></div>
    </div>
  )
}
