import { useCallback, useEffect, useState } from 'react'
import { BrainCircuit, Paintbrush, Trash2 } from 'lucide-react'
import type { StyleProfile } from '@shared/style'
import { describeStyle } from '@shared/style'
import type { Brand } from '@shared/image'
import { api } from '@/lib/format'
import { useStore } from '@/store'
import { Button, IconButton } from '@/components/ui'
import { Section } from './controls'
import { errorMessage } from './editorStore'

// Cliente (Marca) e estilo do projeto (Style Memory): aprender o estilo da edição atual, aplicar um salvo,
// e escrever instruções que o Claude e o Auto Studio passam a seguir.

const selectClass = 'h-7 w-full rounded-md border border-line-2 bg-bg px-2 text-xs'

export function StylePanel() {
  const projectId = useStore((s) => s.projectId)
  const toast = useStore((s) => s.toast)
  const [brands, setBrands] = useState<Brand[]>([])
  const [styles, setStyles] = useState<StyleProfile[]>([])
  const [cur, setCur] = useState<{ brandId: string | null; styleId: string | null; style: StyleProfile | null; choice: string } | null>(null)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (!projectId) return
    const [b, s, c] = await Promise.all([api.brands.list(), api.styles.list(), api.styles.project(projectId)])
    setBrands(b); setStyles(s); setCur(c); setNotes(c.style?.notes ?? '')
  }, [projectId])
  useEffect(() => void reload().catch(() => {}), [reload])

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await reload()
      if (ok) toast(ok, 'ok')
    } catch (err) {
      toast(errorMessage(err), 'bad')
    } finally {
      setBusy(false)
    }
  }
  if (!projectId || !cur) return null
  const style = cur.style
  const forBrand = styles.filter((s) => !s.brandId || s.brandId === cur.brandId)

  return (
    <Section title="Cliente e estilo">
      <label className="mb-1.5 block text-[11px] text-muted">Cliente
        <select aria-label="Cliente do projeto" value={cur.brandId ?? ''} disabled={busy} className={selectClass}
          onChange={(e) => void run(() => api.styles.setProject(projectId, { brandId: e.target.value || null }))}>
          <option value="">Sem cliente</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="mb-1.5 block text-[11px] text-muted">Estilo de edição
        <select aria-label="Estilo do projeto" value={cur.choice} disabled={busy} className={selectClass}
          onChange={(e) => void run(() => api.styles.setProject(projectId, { styleId: e.target.value || null }))}>
          <option value="">{cur.brandId ? 'Padrão do cliente' : 'Automático'}{!cur.choice && cur.style ? ` (${cur.style.name})` : ''}</option>
          <option value="none">Nenhum</option>
          {forBrand.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {style && (
        <div className="mb-2 rounded-md border border-line bg-bg p-2">
          <p className="text-[11px] leading-snug text-muted">{describeStyle(style)}</p>
          <p className="mt-1 text-[10px] text-faint">Aprendido de “{style.source}”.</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} aria-label="Instruções do estilo"
            placeholder="Instruções para o Claude (ex.: legenda sempre amarela, nada de transição chamativa)"
            onBlur={() => { if (notes !== style.notes) void run(() => api.styles.update(style.id, { notes })) }}
            className="mt-1.5 w-full resize-y rounded border border-line-2 bg-panel px-2 py-1 text-[11px] outline-none focus:border-accent" />
          <div className="mt-1.5 flex gap-1">
            <Button size="sm" className="flex-1" disabled={busy} onClick={() => void run(() => api.styles.apply(projectId, style.id), 'Estilo aplicado (Ctrl+Z desfaz).')}>
              <Paintbrush className="h-3.5 w-3.5" />Aplicar na timeline
            </Button>
            <IconButton title="Excluir estilo" disabled={busy} onClick={() => void run(() => api.styles.remove(style.id), 'Estilo excluído.')}><Trash2 className="h-3.5 w-3.5" /></IconButton>
          </div>
        </div>
      )}
      <p className="mb-1 mt-2 text-[11px] font-medium text-muted">Aprender com esta edição</p>
      <div className="flex gap-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do estilo" maxLength={80} aria-label="Nome do novo estilo"
          className="h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-bg px-2 text-xs outline-none focus:border-accent" />
        <Button size="sm" disabled={busy || !name.trim()} title="Guarda look, títulos, legendas, ritmo, transições e volumes desta timeline"
          onClick={() => void run(async () => {
            const s = await api.styles.learn(projectId, { name: name.trim(), brandId: cur.brandId })
            await api.styles.setProject(projectId, { styleId: s.id })
            setName('')
          }, 'Estilo salvo. O Claude e o Auto Studio vão seguir este estilo neste projeto.')}>
          <BrainCircuit className="h-3.5 w-3.5" />Aprender
        </Button>
      </div>
    </Section>
  )
}
