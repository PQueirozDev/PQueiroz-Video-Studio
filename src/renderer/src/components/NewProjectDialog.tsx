import { useEffect, useState } from 'react'
import type { AspectFormat, FpsOption, NewProjectInput, Resolution } from '@shared/types'
import { api } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Dialog, Field, inputClass, Segmented, Select } from './ui'

const initial: NewProjectInput = { name: '', format: '9:16', resolution: '1080p', fps: 'original', preset: 'aquecedores-fortes' }

export function NewProjectDialog() {
  const { dialog, setDialog, presets, openProject, toast } = useStore()
  const [form, setForm] = useState<NewProjectInput>(initial)
  const [busy, setBusy] = useState(false)
  const open = dialog === 'newProject'

  useEffect(() => {
    if (open) setForm(initial)
  }, [open])

  const set = <K extends keyof NewProjectInput>(k: K, v: NewProjectInput[K]): void => setForm((f) => ({ ...f, [k]: v }))

  const choosePreset = (id: string): void => {
    const p = presets.find((x) => x.id === id)
    setForm((f) => ({ ...f, preset: id, format: p && p.format !== 'original' ? p.format : f.format }))
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const p = await api.projects.create({ ...form, name: form.name.trim() || 'Novo projeto' })
      setDialog(null)
      await openProject(p.id)
    } catch (err) {
      toast(String((err as Error).message), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => setDialog(null)}
      title="Novo projeto"
      subtitle="Uma pasta com input, assets, temp, output e versions será criada no workspace."
      footer={<>
        <Button variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button>
        <Button variant="primary" disabled={busy} onClick={create}>Criar projeto</Button>
      </>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create() }}>
        <Field label="Nome">
          <input autoFocus className={inputClass} placeholder="Ex.: Rua Basílio 177 — Boiler" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Preset" hint={presets.find((p) => p.id === form.preset)?.description}>
          <Select value={form.preset} onChange={choosePreset} options={presets.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Formato">
          <Segmented<AspectFormat> value={form.format} onChange={(v) => set('format', v)}
            options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }, { value: '1:1', label: '1:1' }, { value: 'original', label: 'Original' }]} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Resolução">
            <Segmented<Resolution> value={form.resolution} onChange={(v) => set('resolution', v)}
              options={[{ value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p' }, { value: '4k', label: '4K' }]} />
          </Field>
          <Field label="FPS">
            <Segmented<FpsOption> value={form.fps} onChange={(v) => set('fps', v)}
              options={[{ value: 'original', label: 'Orig.' }, { value: '24', label: '24' }, { value: '30', label: '30' }, { value: '60', label: '60' }]} />
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
