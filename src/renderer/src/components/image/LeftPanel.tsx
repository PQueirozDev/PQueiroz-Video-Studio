import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Image as ImageIcon, Layers, LayoutTemplate, Lock, Palette, Shapes, Sparkles, Type, Wand2 } from 'lucide-react'
import type { ImageFormatId, Layer } from '@shared/image'
import { IMAGE_FORMATS, STYLE_PRESETS } from '@shared/image'
import { imageLayer, placeLogo } from '@shared/imageDoc'
import { buildTemplate, TEMPLATE_CATEGORIES, TEMPLATES, type Template } from '@shared/templates'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { renderThumb } from '@/image/render'
import { Badge, Button, IconButton } from '../ui'
import { FillEditor, Section, smallInput } from './controls'
import { Inspector } from './Inspector'

type Tab = 'arte' | 'camadas' | 'templates'

const TYPE_ICON: Record<Layer['type'], typeof Type> = { text: Type, image: ImageIcon, shape: Shapes, effect: Sparkles }

function ArtTab() {
  const { doc, info, brands, providers, setInfo, changeFormat, mutate, addLayer } = useImage()
  const { setDialog, setView, toast } = useStore()
  const [custom, setCustom] = useState({ w: doc?.width ?? 1080, h: doc?.height ?? 1080 })
  if (!doc || !info) return null
  const brand = brands.find((b) => b.id === info.brandId)
  const provider = providers.find((p) => p.id === info.provider)

  const insertLogo = (logoId: string): void => {
    const logo = brand?.logos.find((l) => l.id === logoId)
    if (!brand || !logo?.width || !logo.height) return
    const existing = doc.layers.find((l) => l.role === 'logo')
    if (existing) {
      // Troca de versão mantendo altura e centro (a proporção vem do arquivo).
      const w = (existing.h * logo.width) / logo.height
      useImage.getState().updateLayer(existing.id, { src: logo.path, logoId: logo.id, name: logo.name, w: Math.round(w), x: Math.round(existing.x + existing.w / 2 - w / 2) } as Partial<Layer>)
      toast(`Logo trocada: ${logo.name}`, 'ok')
      return
    }
    const box = placeLogo(doc, logo, brand.logoMargin)
    addLayer(imageLayer(logo.path, box.x, box.y, box.w, box.h, { role: 'logo', name: logo.name, logoId: logo.id }))
  }

  return (
    <div className="text-xs">
      <Section title="Marca">
        <select className={smallInput} value={info.brandId ?? ''} onChange={(e) => setInfo({ brandId: e.target.value || null })}>
          <option value="">Sem marca</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {brand && (
          <>
            <div className="flex flex-wrap gap-1">
              {brand.colors.map((c) => <span key={c.hex + c.name} title={`${c.name} ${c.hex}`} className="h-5 w-5 rounded border border-line-2" style={{ background: c.hex }} />)}
            </div>
            {brand.logos.length ? (
              <div className="grid grid-cols-2 gap-1.5">
                {brand.logos.map((l) => (
                  <button key={l.id} type="button" onClick={() => insertLogo(l.id)} title={`Usar ${l.name}`}
                    className={cx('flex h-12 items-center justify-center rounded-md border border-line-2 p-1.5 hover:border-accent', l.variant === 'branca' ? 'bg-[#cd6d1e]' : 'bg-white')}>
                    <img src={api.app.toMediaUrl(l.path)} className="max-h-full max-w-full object-contain" alt={l.name} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-warn/30 bg-warn/10 px-2 py-1.5 text-[11px] text-warn">Esta marca ainda não tem logo. Importe a logo original na Biblioteca › Marcas.</p>
            )}
          </>
        )}
        <button type="button" onClick={() => setView('assets')} className="text-[11px] text-accent hover:underline">Gerenciar marcas e logos</button>
      </Section>

      <Section title="Formato">
        <select className={smallInput} value={doc.formatId} onChange={(e) => {
          const id = e.target.value as ImageFormatId
          if (id === 'custom') changeFormat('custom', custom.w, custom.h)
          else changeFormat(id)
        }}>
          {IMAGE_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}{f.id !== 'custom' ? ` — ${f.width}×${f.height}` : ''}</option>)}
        </select>
        {doc.formatId === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="number" className={smallInput} value={custom.w} min={64} max={4096} onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })} />
            <span className="text-faint">×</span>
            <input type="number" className={smallInput} value={custom.h} min={64} max={4096} onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })} />
            <Button size="sm" onClick={() => changeFormat('custom', Math.min(4096, Math.max(64, custom.w)), Math.min(4096, Math.max(64, custom.h)))}>Aplicar</Button>
          </div>
        )}
        <p className="text-[10.5px] leading-snug text-faint">Trocar o formato reposiciona tudo e mantém textos e logo na área segura. Um cenário gerado por IA é recortado — para um enquadramento novo, gere de novo.</p>
      </Section>

      <Section title="Estilo">
        <div className="space-y-1">
          {STYLE_PRESETS.map((s) => (
            <button key={s.id} type="button" onClick={() => setInfo({ style: s.id })}
              className={cx('w-full rounded-md border px-2 py-1.5 text-left', info.style === s.id ? 'border-accent bg-accent-soft' : 'border-line-2 hover:bg-raised')}>
              <p className="text-[12px] font-medium">{s.name}</p>
              <p className="text-[10.5px] leading-snug text-faint">{s.description}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Geração de imagens">
        <select className={smallInput} value={info.provider} onChange={(e) => setInfo({ provider: e.target.value as typeof info.provider })}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id !== 'composition' && !p.ready ? ' (não configurado)' : ''}</option>)}
        </select>
        {provider && (
          <div className="space-y-1 rounded-md border border-line-2 bg-bg px-2 py-1.5">
            <div className="flex flex-wrap gap-1">
              {provider.paid ? <Badge tone="warn">Pago</Badge> : <Badge tone="ok">Gratuito</Badge>}
              {provider.ready ? <Badge tone="ok">Pronto</Badge> : <Badge tone="bad">Não configurado</Badge>}
            </div>
            <p className="text-[10.5px] leading-snug text-muted">{provider.costNote}</p>
            <p className="text-[10.5px] leading-snug text-faint">{provider.privacyNote}</p>
          </div>
        )}
        <button type="button" onClick={() => (useStore.setState({ settingsTab: 'imagens' }), setDialog('settings'))} className="text-[11px] text-accent hover:underline">Configurar provedores e chaves</button>
      </Section>

      <Section title="Fundo da arte">
        <FillEditor fill={doc.background} palette={brand?.colors.map((c) => c.hex)} onChange={(background) => {
          mutate((d) => ({ ...d, background }))
        }} />
      </Section>
    </div>
  )
}

function LayersTab() {
  const { doc, selectedId, select, updateLayer, moveLayer } = useImage()
  if (!doc) return null
  const list = [...doc.layers].reverse()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-line p-1.5">
        {list.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-faint">Nenhuma camada. Use a barra acima da arte ou peça ao Claude.</p>}
        {list.map((l) => {
          const Icon = TYPE_ICON[l.type]
          return (
            <div key={l.id} onClick={() => select(l.id)}
              className={cx('group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2', l.id === selectedId ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-raised')}>
              <Icon className={cx('h-3.5 w-3.5 shrink-0', l.role === 'logo' ? 'text-warn' : 'text-faint')} />
              <span className={cx('min-w-0 flex-1 truncate text-[12px]', !l.visible && 'opacity-40')}>{l.name || l.type}</span>
              {l.locked && <Lock className="h-3 w-3 text-faint" />}
              <span className="hidden items-center group-hover:flex">
                <IconButton title="Subir" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 'up') }} className="h-6 w-6"><ArrowUp className="h-3 w-3" /></IconButton>
                <IconButton title="Descer" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 'down') }} className="h-6 w-6"><ArrowDown className="h-3 w-3" /></IconButton>
              </span>
              <IconButton title={l.visible ? 'Ocultar' : 'Mostrar'} className="h-6 w-6" onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { visible: !l.visible }) }}>
                {l.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </IconButton>
            </div>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedId ? <Inspector /> : <p className="p-4 text-center text-[11px] text-faint">Selecione uma camada na arte ou na lista para editar texto, fonte, cores, sombra, borda e posição.</p>}
      </div>
    </div>
  )
}

function TemplateCard({ tpl, active, onPick }: { tpl: Template; active: boolean; onPick(): void }) {
  const { doc, info, brands } = useImage()
  const [thumb, setThumb] = useState<string | null>(null)
  const brand = brands.find((b) => b.id === info?.brandId) ?? null
  const logo = brand?.logos.find((l) => l.id === brand.defaultLogoId) ?? brand?.logos[0] ?? null
  useEffect(() => {
    if (!doc) return
    let alive = true
    let url: string | null = null
    renderThumb(buildTemplate(tpl, doc.formatId, { brand, logo }, { width: doc.width, height: doc.height }), 240).then((u) => {
      url = u
      if (alive) setThumb(u)
      else URL.revokeObjectURL(u)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [tpl, doc?.formatId, doc?.width, doc?.height, brand?.id, logo?.id])
  return (
    <button type="button" onClick={onPick} className={cx('overflow-hidden rounded-lg border text-left transition-colors', active ? 'border-accent' : 'border-line-2 hover:border-line-2 hover:bg-raised')}>
      <div className="flex aspect-square items-center justify-center bg-bg">
        {thumb ? <img src={thumb} className="max-h-full max-w-full object-contain" alt="" /> : <LayoutTemplate className="h-5 w-5 text-faint" />}
      </div>
      <p className="truncate px-1.5 py-1 text-[11px] font-medium">{tpl.name}</p>
    </button>
  )
}

function TemplatesTab() {
  const applyTemplate = useImage((s) => s.applyTemplate)
  const [picked, setPicked] = useState<Template | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const groups = useMemo(() => TEMPLATE_CATEGORIES.map((c) => ({ ...c, items: TEMPLATES.filter((t) => t.category === c.id) })).filter((g) => g.items.length), [])
  return (
    <div className="space-y-3 p-2.5">
      <p className="text-[11px] leading-snug text-faint">Os templates usam a marca e o formato atuais. Imagens já geradas ocupam os espaços reservados.</p>
      {picked && (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent-soft p-2.5">
          <p className="text-[12px] font-medium">{picked.name}</p>
          {picked.fields.map((f) => (
            <label key={f.id} className="block">
              <span className="mb-0.5 block text-[10.5px] text-faint">{f.label}</span>
              <input className={smallInput} value={texts[f.id] ?? f.value} onChange={(e) => setTexts({ ...texts, [f.id]: e.target.value })} />
            </label>
          ))}
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => {
              applyTemplate(picked.id, Object.fromEntries(picked.fields.map((f) => [f.id, texts[f.id] ?? f.value])))
              setPicked(null)
            }}><Wand2 className="h-3.5 w-3.5" />Aplicar template</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Cancelar</Button>
          </div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.id}>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{g.label}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map((t) => <TemplateCard key={t.id} tpl={t} active={picked?.id === t.id} onPick={() => { setPicked(t); setTexts({}) }} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('arte')
  const selectedId = useImage((s) => s.selectedId)
  // Selecionar uma camada na arte abre o inspetor.
  useEffect(() => {
    if (selectedId) setTab('camadas')
  }, [selectedId])
  const tabs: { id: Tab; label: string; icon: typeof Palette }[] = [
    { id: 'arte', label: 'Arte', icon: Palette }, { id: 'camadas', label: 'Camadas', icon: Layers }, { id: 'templates', label: 'Templates', icon: LayoutTemplate }
  ]
  return (
    <aside className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-1.5">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={cx('flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md text-[11.5px] font-medium', tab === t.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg')}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </div>
      <div className={cx('min-h-0 flex-1', tab === 'camadas' ? 'overflow-hidden' : 'overflow-y-auto')}>
        {tab === 'arte' ? <ArtTab /> : tab === 'camadas' ? <LayersTab /> : <TemplatesTab />}
      </div>
    </aside>
  )
}
