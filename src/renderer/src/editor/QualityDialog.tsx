import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, ShieldCheck, Wrench, XCircle } from 'lucide-react'
import { EXPORT_PRESETS } from '@shared/exportPresets'
import type { QcItem, RenderMeasures } from '@shared/qc'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Dialog, Field, Select } from '@/components/ui'
import { errorMessage, useEditor } from './editorStore'

// Quality Check: verifica a timeline para um destino (com "Corrigir") e o último arquivo renderizado.

const ICON = { erro: XCircle, aviso: AlertTriangle, info: Info } as const
const TONE = { erro: 'text-bad', aviso: 'text-warn', info: 'text-info' } as const

function Items({ items, onFix, onSeek }: { items: QcItem[]; onFix?(i: QcItem): void; onSeek?(t: number): void }) {
  if (!items.length) return <p className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 p-3 text-[12.5px]"><CheckCircle2 className="h-4 w-4 text-ok" />Tudo certo.</p>
  return (
    <ul className="space-y-1.5">
      {items.map((i, n) => {
        const Icon = ICON[i.level]
        return (
          <li key={n} className="flex items-start gap-2 rounded-lg border border-line bg-bg p-2 text-[12px]">
            <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', TONE[i.level])} />
            <button type="button" disabled={i.time === undefined || !onSeek} onClick={() => i.time !== undefined && onSeek?.(i.time)} className="min-w-0 flex-1 text-left leading-snug enabled:hover:underline">{i.message}</button>
            {i.fix && onFix && <Button size="sm" variant="ghost" onClick={() => onFix(i)}><Wrench className="h-3 w-3" />{i.fixLabel ?? 'Corrigir'}</Button>}
          </li>
        )
      })}
    </ul>
  )
}

export function QualityDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const projectId = useStore((s) => s.projectId)
  const toast = useStore((s) => s.toast)
  const doc = useEditor((s) => s.doc)
  const [preset, setPreset] = useState('youtube-1080')
  const [items, setItems] = useState<QcItem[] | null>(null)
  const [render, setRender] = useState<{ path: string; items: QcItem[]; measures: RenderMeasures } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) return
    try {
      setItems(await api.qc.project(projectId, preset))
    } catch (err) {
      toast(errorMessage(err), 'bad')
    }
  }, [projectId, preset, toast])
  // A lista acompanha cada edição (as correções aplicadas somem da lista).
  useEffect(() => { if (open) void refresh() }, [open, refresh, doc])

  const fix = async (list: QcItem[]): Promise<void> => {
    const cmds = list.flatMap((i) => i.fix ?? [])
    if (cmds.length) await useEditor.getState().edit(cmds)
  }
  /** Uma correção por vez, verificando de novo: correções de tempo (buracos) dependem das anteriores. */
  const fixAll = async (): Promise<void> => {
    if (!projectId) return
    for (let i = 0; i < 40; i++) {
      const next = (await api.qc.project(projectId, preset)).find((x) => x.fix)
      if (!next || !(await useEditor.getState().edit(next.fix!))) break
    }
    await refresh()
  }
  const checkFile = async (): Promise<void> => {
    if (!projectId) return
    setBusy(true)
    try {
      setRender(await api.qc.render(projectId, { presetId: preset }))
    } catch (err) {
      toast(errorMessage(err), 'bad')
    } finally {
      setBusy(false)
    }
  }
  const fixable = (items ?? []).filter((i) => i.fix)
  const m = render?.measures

  return (
    <Dialog open={open} onClose={onClose} title="Quality Check" subtitle="Problemas que estragam a entrega, antes e depois de exportar." width={640}
      footer={<>
        {fixable.length > 1 && <Button variant="ghost" onClick={() => void fixAll()}><Wrench className="h-3.5 w-3.5" />Corrigir tudo ({fixable.length})</Button>}
        <Button variant="primary" onClick={onClose}>Fechar</Button>
      </>}>
      <Field label="Destino" hint="Define a área segura dos textos, a duração máxima e o tamanho do arquivo.">
        <Select value={preset} onChange={(v) => { setPreset(v); setRender(null) }} options={EXPORT_PRESETS.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">Timeline</p>
      {items ? <Items items={items} onFix={(i) => void fix([i])} onSeek={(t) => useEditor.getState().setPlayhead(t)} /> : <p className="text-[12px] text-faint">Verificando...</p>}
      <div className="mb-2 mt-5 flex items-center gap-2">
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Arquivo renderizado</p>
        <Button size="sm" disabled={busy} onClick={() => void checkFile()}><ShieldCheck className="h-3.5 w-3.5" />{busy ? 'Analisando...' : 'Verificar a última versão'}</Button>
      </div>
      {render && m && (
        <>
          <p className="mb-2 font-mono text-[10.5px] text-faint">
            {m.width}x{m.height} · {m.duration.toFixed(1)} s · {(m.bytes / 1048576).toFixed(1)} MB{m.integrated != null ? ` · ${m.integrated.toFixed(1)} LUFS` : ''}{m.truePeak != null && Number.isFinite(m.truePeak) ? ` · pico ${m.truePeak.toFixed(1)} dBTP` : ''}
          </p>
          <Items items={render.items} />
        </>
      )}
    </Dialog>
  )
}
