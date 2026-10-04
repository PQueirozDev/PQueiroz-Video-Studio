import { useState } from 'react'
import { Copy, Lock, Plus, Trash2 } from 'lucide-react'
import type { AspectFormat, Preset, PresetInput } from '@shared/types'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Field, inputClass, Segmented } from './ui'

const empty: PresetInput = { name: '', format: '9:16', description: '', prompt: '' }

/** Presets embutidos (somente leitura, podem ser duplicados) e personalizados (editáveis). */
export function PresetsEditor() {
  const { presets, toast } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<PresetInput>(empty)
  const current = presets.find((p) => p.id === selected)
  const editable = !current || !current.builtin

  const reload = async (): Promise<Preset[]> => {
    const list = await api.presets.list()
    useStore.setState({ presets: list })
    return list
  }

  const pick = (p: Preset | null): void => {
    setSelected(p?.id ?? null)
    setForm(p ? { name: p.name, format: p.format, description: p.description, prompt: p.prompt } : empty)
  }

  const save = async (): Promise<void> => {
    try {
      const p = await api.presets.save(current && !current.builtin ? current.id : null, form)
      await reload()
      pick(p)
      toast(`Preset "${p.name}" salvo`, 'ok')
    } catch (err) {
      toast(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad')
    }
  }

  const duplicate = (): void => {
    if (!current) return
    setSelected(null)
    setForm({ name: `${current.name} (cópia)`, format: current.format, description: current.description, prompt: current.prompt })
  }

  const remove = async (): Promise<void> => {
    if (!current || current.builtin) return
    await api.presets.remove(current.id)
    await reload()
    pick(null)
    toast('Preset removido', 'info')
  }

  return (
    <div className="flex gap-4">
      <div className="w-48 shrink-0 space-y-0.5">
        {presets.map((p) => (
          <button key={p.id} onClick={() => pick(p)}
            className={cx('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] transition-colors',
              selected === p.id ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg')}>
            <span className="flex-1 truncate">{p.name}</span>
            {p.builtin && <Lock className="h-3 w-3 text-faint" />}
          </button>
        ))}
        <button onClick={() => pick(null)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-accent hover:bg-raised/60">
          <Plus className="h-3.5 w-3.5" />Novo preset
        </button>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        {current?.builtin && <p className="text-[11px] text-faint">Preset embutido — duplique para criar uma versão sua.</p>}
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
        <Field label="Instruções para o Claude" hint="Entram no contexto de todo pedido feito em projetos com este preset.">
          <textarea disabled={!editable} value={form.prompt} rows={6}
            placeholder="Ex.: 1080×1920, 20–30 s, cortes nas batidas, logo no canto superior esquerdo, terminar com o cartão final."
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            className={cx(inputClass, 'h-auto resize-y py-2 leading-relaxed')} />
        </Field>
        <div className="flex gap-2">
          {editable && <Button variant="primary" onClick={save} disabled={!form.name.trim()}>Salvar preset</Button>}
          {current && <Button onClick={duplicate}><Copy className="h-3.5 w-3.5" />Duplicar</Button>}
          {current && !current.builtin && <Button variant="danger" onClick={remove}><Trash2 className="h-3.5 w-3.5" />Excluir</Button>}
        </div>
      </div>
    </div>
  )
}
