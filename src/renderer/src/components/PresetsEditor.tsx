import { useState } from 'react'
import { Copy, Download, FolderInput, Globe, Link2, Lock, Package, Plus, Trash2, Upload, Users } from 'lucide-react'
import type { AspectFormat, CommunityPreset, Preset, PresetImportResult, PresetInput } from '@shared/types'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { Badge, Button, Field, inputClass, Segmented, Spinner, Toggle } from './ui'

const empty: PresetInput = { name: '', format: '9:16', description: '', prompt: '', author: '' }

const errText = (err: unknown): string => String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

async function reloadPresets(): Promise<Preset[]> {
  const list = await api.presets.list()
  useStore.setState({ presets: list })
  return list
}

/** Recarrega presets/configurações depois de uma importação e avisa o que foi instalado. */
export async function afterImport(r: PresetImportResult): Promise<void> {
  const { toast, loadSettings } = useStore.getState()
  await Promise.all([reloadPresets(), loadSettings()])
  const extras = [
    r.workflowFiles ? `${r.workflowFiles} arquivo(s) do fluxo` : '',
    r.skillsInstalled.length ? `skills: ${r.skillsInstalled.join(', ')}` : ''
  ].filter(Boolean)
  toast(`Preset "${r.preset.name}" importado${extras.length ? ` — ${extras.join(' · ')}` : ''}`, 'ok')
  if (r.activated) toast('O fluxo do preset agora é o sistema de edição deste computador.', 'ok')
}

/** Abre um .pqpreset e instala. Usado aqui e no onboarding. */
export async function importPresetFromFile(): Promise<PresetImportResult | null> {
  try {
    const r = await api.presets.importFromFile()
    if (r) await afterImport(r)
    return r
  } catch (err) {
    useStore.getState().toast(errText(err), 'bad')
    return null
  }
}

type Panel = 'edit' | 'link' | 'community'

/** Presets embutidos (somente leitura, podem ser duplicados), personalizados e importados. */
export function PresetsEditor() {
  const { presets, toast, settings, loadSettings } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<PresetInput>(empty)
  const [panel, setPanel] = useState<Panel>('edit')
  const [busy, setBusy] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [community, setCommunity] = useState<CommunityPreset[] | null>(null)
  const [communityError, setCommunityError] = useState('')
  const [includeWorkflow, setIncludeWorkflow] = useState(true)
  const [includeResources, setIncludeResources] = useState(false)
  const current = presets.find((p) => p.id === selected)
  const editable = !current || !current.builtin

  const pick = (p: Preset | null): void => {
    setPanel('edit')
    setSelected(p?.id ?? null)
    setForm(p ? { name: p.name, format: p.format, description: p.description, prompt: p.prompt, author: p.author } : empty)
  }

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key)
    try {
      await fn()
    } catch (err) {
      toast(errText(err), 'bad')
    } finally {
      setBusy(null)
    }
  }

  const save = (): Promise<void> => run('save', async () => {
    const p = await api.presets.save(current && !current.builtin ? current.id : null, form)
    await reloadPresets()
    pick(p)
    toast(`Preset "${p.name}" salvo`, 'ok')
  })

  const duplicate = (): void => {
    if (!current) return
    setSelected(null)
    setForm({ name: `${current.name} (cópia)`, format: current.format, description: current.description, prompt: current.prompt, author: '' })
  }

  const remove = (): Promise<void> => run('remove', async () => {
    if (!current || current.builtin) return
    if (current.workflowDir && !confirm(`Excluir "${current.name}" e o sistema de edição que veio com ele?`)) return
    await api.presets.remove(current.id)
    await Promise.all([reloadPresets(), loadSettings()])
    pick(null)
    toast('Preset removido', 'info')
  })

  const exportPreset = (): Promise<void> => run('export', async () => {
    if (!current) return
    const file = await api.presets.exportToFile(current.id, { includeWorkflow, includeResources: includeWorkflow && includeResources })
    if (file) toast(`Preset exportado: ${file.split(/[\\/]/).pop()}`, 'ok')
  })

  const importFile = (): Promise<void> => run('file', async () => {
    const r = await importPresetFromFile()
    if (r) pick(r.preset)
  })

  const importLink = (): Promise<void> => run('link', async () => {
    const r = await api.presets.importFromUrl(link)
    await afterImport(r)
    setLink('')
    pick(r.preset)
  })

  const openCommunity = async (): Promise<void> => {
    setPanel('community')
    setSelected(null)
    if (community) return
    setCommunityError('')
    try {
      setCommunity(await api.presets.community())
    } catch (err) {
      setCommunityError(errText(err))
    }
  }

  const installCommunity = (item: CommunityPreset): Promise<void> => run(`c:${item.id}`, async () => {
    const r = await api.presets.installCommunity(item)
    await afterImport(r)
    pick(r.preset)
  })

  const useWorkflow = (): Promise<void> => run('use', async () => {
    if (!current) return
    await api.presets.useWorkflow(current.id)
    await loadSettings()
    toast(`"${current.name}" agora é o sistema de edição deste computador`, 'ok')
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={importFile} disabled={busy === 'file'}>
          {busy === 'file' ? <Spinner className="h-3.5 w-3.5" /> : <FolderInput className="h-3.5 w-3.5" />}Importar arquivo
        </Button>
        <Button size="sm" variant={panel === 'link' ? 'primary' : 'secondary'} onClick={() => { setPanel('link'); setSelected(null) }}>
          <Link2 className="h-3.5 w-3.5" />Importar de link
        </Button>
        <Button size="sm" variant={panel === 'community' ? 'primary' : 'secondary'} onClick={openCommunity}>
          <Users className="h-3.5 w-3.5" />Presets da comunidade
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="w-48 shrink-0 space-y-0.5">
          {presets.map((p) => (
            <button key={p.id} onClick={() => pick(p)}
              className={cx('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] transition-colors',
                selected === p.id && panel === 'edit' ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg')}>
              <span className="flex-1 truncate">{p.name}</span>
              {p.workflowDir && <span title="Inclui sistema de edição"><Package className="h-3 w-3 text-accent" /></span>}
              {p.builtin && <Lock className="h-3 w-3 text-faint" />}
            </button>
          ))}
          <button onClick={() => pick(null)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-accent hover:bg-raised/60">
            <Plus className="h-3.5 w-3.5" />Novo preset
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {panel === 'link' && (
            <>
              <Field label="Link do preset" hint="Cole o link de um arquivo .pqpreset (GitHub, Google Drive com download direto, Dropbox…). Só https.">
                <input className={inputClass} value={link} placeholder="https://github.com/usuario/repo/blob/main/meu-preset.pqpreset"
                  onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && link.trim() && importLink()} />
              </Field>
              <Button variant="primary" onClick={importLink} disabled={!link.trim() || busy === 'link'}>
                {busy === 'link' ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}Importar
              </Button>
            </>
          )}

          {panel === 'community' && (
            <div className="space-y-2">
              <p className="text-[11px] text-faint">
                Presets compartilhados por outras pessoas no repositório do estúdio. Para publicar o seu, exporte e envie o arquivo para a pasta <span className="font-mono">presets/</span> do GitHub.
              </p>
              {communityError && <p className="selectable text-xs text-bad">{communityError}</p>}
              {!community && !communityError && <div className="flex items-center gap-2 text-xs text-muted"><Spinner className="h-3.5 w-3.5" />Carregando...</div>}
              {community?.length === 0 && <p className="text-xs text-muted">Nenhum preset publicado ainda.</p>}
              {community?.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
                  <Globe className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{c.name}</span>
                      <Badge>{c.format}</Badge>
                      {c.hasWorkflow && <Badge tone="accent">com fluxo</Badge>}
                    </div>
                    <p className="text-[11px] text-faint">{c.description}{c.author ? ` · por ${c.author}` : ''}</p>
                  </div>
                  <Button size="sm" onClick={() => installCommunity(c)} disabled={busy === `c:${c.id}`}>
                    {busy === `c:${c.id}` ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}Instalar
                  </Button>
                </div>
              ))}
            </div>
          )}

          {panel === 'edit' && (
            <>
              {current?.builtin && <p className="text-[11px] text-faint">Preset embutido — duplique para criar uma versão sua.</p>}
              {current?.workflowDir && (
                <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2">
                  <Package className="h-4 w-4 shrink-0 text-accent" />
                  <p className="min-w-0 flex-1 text-[11.5px] text-muted">
                    Inclui um sistema de edição (CLAUDE.md, modelo e skills).
                    {settings?.aqcRoot === current.workflowDir ? ' Em uso neste computador.' : ''}
                  </p>
                  {settings?.aqcRoot !== current.workflowDir && (
                    <Button size="sm" onClick={useWorkflow} disabled={busy === 'use'}>Usar este fluxo</Button>
                  )}
                </div>
              )}
              <Field label="Nome">
                <input className={inputClass} disabled={!editable} value={form.name} placeholder="Ex.: Reel de obra pronta"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Formato">
                <Segmented<AspectFormat> value={form.format} onChange={(v) => editable && setForm({ ...form, format: v })}
                  options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }, { value: '1:1', label: '1:1' }, { value: 'original', label: 'Original' }]} />
              </Field>
              <Field label="Descrição">
                <input className={inputClass} disabled={!editable} value={form.description} placeholder="Aparece ao escolher o preset"
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <Field label="Autor" hint="Aparece para quem importar o seu preset.">
                <input className={inputClass} disabled={!editable} value={form.author ?? ''} placeholder="Seu nome"
                  onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </Field>
              <Field label="Instruções para o Claude" hint="Entram no contexto de todo pedido feito em projetos com este preset.">
                <textarea disabled={!editable} value={form.prompt} rows={6}
                  placeholder="Ex.: 1080×1920, 20–30 s, cortes nas batidas, logo no canto superior esquerdo, terminar com o cartão final."
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                  className={cx(inputClass, 'h-auto resize-y py-2 leading-relaxed')} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {editable && <Button variant="primary" onClick={save} disabled={!form.name.trim() || busy === 'save'}>Salvar preset</Button>}
                {current && <Button onClick={duplicate}><Copy className="h-3.5 w-3.5" />Duplicar</Button>}
                {current && !current.builtin && <Button variant="danger" onClick={remove}><Trash2 className="h-3.5 w-3.5" />Excluir</Button>}
              </div>

              {current && (
                <div className="space-y-1 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
                  <p className="text-[12.5px] font-medium">Exportar / compartilhar</p>
                  <p className="text-[11px] text-faint">
                    Gera um arquivo .pqpreset para levar a outro computador ou mandar para outra pessoa.
                  </p>
                  <Toggle checked={includeWorkflow} onChange={setIncludeWorkflow} label="Incluir meu sistema de edição"
                    hint="CLAUDE.md, Modelo edicao (montar.py, fontes) e as skills de vídeo do Claude deste computador." />
                  {includeWorkflow && (
                    <Toggle checked={includeResources} onChange={setIncludeResources} label="Incluir músicas e recursos"
                      hint="Pasta Recursos (músicas, logos). O arquivo fica bem maior (limite de 400 MB)." />
                  )}
                  <Button onClick={exportPreset} disabled={busy === 'export'}>
                    {busy === 'export' ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}Exportar preset
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
