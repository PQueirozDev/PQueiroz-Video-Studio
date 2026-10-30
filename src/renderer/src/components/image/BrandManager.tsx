import { useEffect, useState } from 'react'
import { FileUp, FolderOpen, Plus, Star, Trash2, X } from 'lucide-react'
import type { Brand, BrandLogo } from '@shared/image'
import { BUNDLED_FONTS, SYSTEM_FONTS } from '@shared/fonts'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { fontFiles, registerFonts } from '@/image/render'
import { Badge, Button, Empty, Field, IconButton, inputClass } from '../ui'

const errMsg = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const VARIANTS: { value: BrandLogo['variant']; label: string }[] = [
  { value: 'colorida', label: 'Colorida (fundo claro)' }, { value: 'branca', label: 'Branca (fundo escuro/laranja)' },
  { value: 'escura', label: 'Escura' }, { value: 'outra', label: 'Outra' }
]

function BrandEditor({ brand, onSaved }: { brand: Brand; onSaved(b: Brand): void }) {
  const toast = useStore((s) => s.toast)
  const [draft, setDraft] = useState(brand)
  const [fonts, setFonts] = useState<string[]>([])
  useEffect(() => setDraft(brand), [brand])
  useEffect(() => {
    registerFonts().then(() => setFonts([...new Set([...fontFiles.map((f) => f.family), ...BUNDLED_FONTS, ...SYSTEM_FONTS])].sort()))
  }, [])
  const dirty = JSON.stringify(draft) !== JSON.stringify(brand)

  const save = async (): Promise<void> => {
    try {
      const b = await api.brands.update(brand.id, {
        name: draft.name, slogan: draft.slogan, colors: draft.colors, fonts: draft.fonts, style: draft.style, preferences: draft.preferences,
        rules: draft.rules, logoMargin: draft.logoMargin, defaultLogoId: draft.defaultLogoId
      })
      onSaved(b)
      toast('Marca salva', 'ok')
    } catch (err) {
      toast(errMsg(err), 'bad')
    }
  }
  const importLogo = async (): Promise<void> => {
    try {
      const added = await api.brands.importLogo(brand.id)
      if (added.length) {
        toast(`${added.length} logo(s) importada(s) do arquivo original`, 'ok')
        onSaved((await api.brands.get(brand.id))!)
      }
    } catch (err) {
      toast(errMsg(err), 'bad')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <input className="w-full bg-transparent text-xl font-semibold outline-none" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={brand.folder}>{brand.folder}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => api.brands.openFolder(brand.id)}><FolderOpen className="h-3.5 w-3.5" />Pasta</Button>
          <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Salvar alterações</Button>
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Logos oficiais</h3>
          <Button size="sm" onClick={importLogo}><FileUp className="h-3.5 w-3.5" />Importar logo (PDF, PNG, JPG)</Button>
        </div>
        <p className="mb-3 text-[11.5px] text-faint">Do PDF são extraídas as imagens originais (sem redesenhar). A logo nunca é recolorida, distorcida ou gerada por IA.</p>
        {brand.logos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-warn/40 bg-warn/5 px-4 py-6 text-center text-xs text-warn">Nenhuma logo ainda. Importe o arquivo original da marca (ex.: <span className="font-mono">Logo aquecedores.pdf</span>).</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {brand.logos.map((l) => (
              <div key={l.id} className="overflow-hidden rounded-xl border border-line bg-panel-2">
                <div className={cx('flex h-28 items-center justify-center p-4', l.variant === 'branca' ? 'bg-[#cd6d1e]' : l.variant === 'escura' ? 'bg-[#f4f1ec]' : 'bg-white')}>
                  <img src={api.app.toMediaUrl(l.path)} className="max-h-full max-w-full object-contain" alt={l.name}
                    onLoad={(e) => {
                      if (!l.width || !l.height) {
                        const img = e.currentTarget
                        void api.brands.updateLogo(brand.id, l.id, { width: img.naturalWidth, height: img.naturalHeight }).then(onSaved)
                      }
                    }} />
                </div>
                <div className="space-y-1.5 p-2.5">
                  <div className="flex items-center gap-1">
                    <input className="h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-bg px-2 text-xs" defaultValue={l.name}
                      onBlur={(e) => e.target.value !== l.name && api.brands.updateLogo(brand.id, l.id, { name: e.target.value }).then(onSaved)} />
                    <IconButton title={draft.defaultLogoId === l.id ? 'Logo padrão' : 'Usar como padrão'} active={draft.defaultLogoId === l.id}
                      onClick={() => setDraft({ ...draft, defaultLogoId: l.id })}><Star className="h-3.5 w-3.5" /></IconButton>
                    <IconButton title="Remover da marca (o arquivo fica na pasta)" onClick={() => api.brands.removeLogo(brand.id, l.id).then(onSaved)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                  </div>
                  <select className="h-7 w-full rounded-md border border-line-2 bg-bg px-2 text-xs" value={l.variant}
                    onChange={(e) => api.brands.updateLogo(brand.id, l.id, { variant: e.target.value as BrandLogo['variant'] }).then(onSaved)}>
                    {VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                  </select>
                  <p className="text-[10.5px] text-faint">{l.width}×{l.height} px{l.source ? ` · de ${l.source.split(/[\\/]/).pop()}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <Field label={`Margem de segurança ao redor da logo: ${Math.round(draft.logoMargin * 100)}% do menor lado`}>
          <input type="range" min={0} max={0.12} step={0.005} value={draft.logoMargin} onChange={(e) => setDraft({ ...draft, logoMargin: Number(e.target.value) })} className="w-full max-w-sm" style={{ ['--fill' as string]: `${(draft.logoMargin / 0.12) * 100}%` }} />
        </Field>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold">Paleta de cores</h3>
          {draft.colors.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#000000'} onChange={(e) => setDraft({ ...draft, colors: draft.colors.map((x, k) => (k === i ? { ...x, hex: e.target.value } : x)) })} className="h-8 w-10 rounded border border-line-2 bg-bg p-0.5" />
              <input className={cx(inputClass, 'h-8')} value={c.name} onChange={(e) => setDraft({ ...draft, colors: draft.colors.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} />
              <input className={cx(inputClass, 'h-8 w-28 font-mono')} value={c.hex} onChange={(e) => setDraft({ ...draft, colors: draft.colors.map((x, k) => (k === i ? { ...x, hex: e.target.value } : x)) })} />
              <IconButton title="Remover cor" onClick={() => setDraft({ ...draft, colors: draft.colors.filter((_, k) => k !== i) })}><X className="h-3.5 w-3.5" /></IconButton>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, colors: [...draft.colors, { name: 'Nova cor', hex: '#888888' }] })}><Plus className="h-3.5 w-3.5" />Cor</Button>

          <h3 className="pt-2 text-[13px] font-semibold">Fontes</h3>
          {(['heading', 'body'] as const).map((k) => (
            <Field key={k} label={k === 'heading' ? 'Títulos' : 'Textos'}>
              <select className={inputClass} value={draft.fonts[k]} onChange={(e) => setDraft({ ...draft, fonts: { ...draft.fonts, [k]: e.target.value } })}>
                {!fonts.includes(draft.fonts[k]) && <option value={draft.fonts[k]}>{draft.fonts[k]}</option>}
                {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
          ))}
          <p className="text-[11px] text-faint">Para usar outra fonte, adicione o .ttf/.otf em Biblioteca › Fontes.</p>
        </div>
        <div className="space-y-3">
          <Field label="Slogan oficial" hint="Deixe vazio se a marca não tiver — o Claude nunca inventa slogan.">
            <input className={inputClass} value={draft.slogan} onChange={(e) => setDraft({ ...draft, slogan: e.target.value })} />
          </Field>
          <Field label="Estilo visual">
            <textarea className="w-full rounded-lg border border-line-2 bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent" rows={3} value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })} />
          </Field>
          <Field label="Preferências de design">
            <textarea className="w-full rounded-lg border border-line-2 bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent" rows={3} value={draft.preferences} onChange={(e) => setDraft({ ...draft, preferences: e.target.value })} />
          </Field>
          <Field label="Regras obrigatórias (uma por linha)">
            <textarea className="w-full rounded-lg border border-line-2 bg-bg px-3 py-2 text-[12px] outline-none focus:border-accent" rows={7} value={draft.rules.join('\n')} onChange={(e) => setDraft({ ...draft, rules: e.target.value.split('\n') })} />
          </Field>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Assets da marca</h3>
          <Button size="sm" variant="ghost" onClick={() => api.brands.addAssets(brand.id).then(onSaved)}><Plus className="h-3.5 w-3.5" />Adicionar imagens</Button>
        </div>
        {brand.assets.length === 0 ? <p className="text-xs text-faint">Fotos de produtos, mascote aprovado, texturas… ficam disponíveis para o Claude usar nas artes da marca.</p> : (
          <div className="flex flex-wrap gap-2">
            {brand.assets.map((a) => <img key={a} src={api.app.toMediaUrl(a)} title={a} className="h-20 w-20 rounded-lg border border-line object-cover" alt="" />)}
          </div>
        )}
      </section>
    </div>
  )
}

export function BrandManager() {
  const { toast } = useStore()
  const [brands, setBrands] = useState<Brand[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const load = async (): Promise<void> => {
    const list = await api.brands.list()
    setBrands(list)
    setSel((s) => s ?? list[0]?.id ?? null)
    void useImage.getState().loadBrands()
  }
  useEffect(() => {
    void load()
  }, [])
  const brand = brands.find((b) => b.id === sel)

  const create = async (): Promise<void> => {
    const b = await api.brands.create({ name: 'Nova marca' })
    await load()
    setSel(b.id)
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {brands.map((b) => (
            <button key={b.id} type="button" onClick={() => setSel(b.id)}
              className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left', sel === b.id ? 'bg-accent-soft' : 'hover:bg-raised')}>
              <div className="flex h-8 w-10 shrink-0 items-center justify-center rounded bg-white p-1">
                {b.logos[0] ? <img src={api.app.toMediaUrl((b.logos.find((l) => l.id === b.defaultLogoId) ?? b.logos[0]).path)} className="max-h-full max-w-full object-contain" alt="" /> : <span className="text-[9px] text-black/40">sem logo</span>}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium">{b.name}</p>
                <p className="text-[10.5px] text-faint">{b.logos.length} logo(s) · {b.colors.length} cor(es)</p>
              </div>
            </button>
          ))}
        </div>
        <div className="space-y-1 border-t border-line p-2">
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={create}><Plus className="h-3.5 w-3.5" />Nova marca</Button>
          {brand && brand.id !== 'aquecedores-fortes' && (
            <Button size="sm" variant="ghost" className="w-full justify-start text-bad" onClick={async () => {
              try {
                await api.brands.remove(brand.id)
                setSel(null)
                await load()
              } catch (err) {
                toast(errMsg(err), 'bad')
              }
            }}><Trash2 className="h-3.5 w-3.5" />Remover da lista</Button>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {brand ? (
          <>
            {brand.id === 'aquecedores-fortes' && <div className="mb-4"><Badge tone="accent">Marca padrão — aplicada automaticamente nas artes da Aquecedores Fortes</Badge></div>}
            <BrandEditor brand={brand} onSaved={(b) => {
              setBrands((list) => list.map((x) => (x.id === b.id ? b : x)))
              void useImage.getState().loadBrands()
            }} />
          </>
        ) : <Empty icon={<Star className="h-7 w-7" />} title="Nenhuma marca selecionada" />}
      </div>
    </div>
  )
}
