import { useEffect, useState } from 'react'
import { FolderArchive, PackagePlus, Trash2 } from 'lucide-react'
import type { PackInfo, PackItemType } from '@shared/packs'
import { api } from '@/lib/format'
import { useStore } from '@/store'
import { Button } from '@/components/ui'
import { useHub } from '@/editor/hub'

// Pacotes do Asset Hub: o essencial (vem com o app) e os .pqs-pack instalados pelo usuário.

const LABEL: Record<PackItemType, string> = { font: 'fontes', sfx: 'sons', overlay: 'overlays', lut: 'LUTs', title: 'títulos', preset: 'presets' }
const message = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function PacksManager() {
  const { packs, load } = useHub()
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  useEffect(() => void load(true), [load])

  const run = async (fn: () => Promise<string | null>): Promise<void> => {
    setBusy(true)
    try {
      const msg = await fn()
      await load(true)
      if (msg) toast(msg, 'ok')
    } catch (err) {
      toast(message(err), 'bad')
    } finally {
      setBusy(false)
    }
  }
  const counts = (p: PackInfo): string => (Object.entries(p.counts) as [PackItemType, number][]).map(([k, n]) => `${n} ${LABEL[k]}`).join(' · ')

  return (
    <div className="mx-auto max-w-3xl p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold">Pacotes do Asset Hub</h2>
          <p className="text-[12px] text-faint">Títulos, sons, overlays, fontes, LUTs e presets usados no editor e pelo Claude.</p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void run(async () => { const r = await api.hub.install(); return r ? `Pacote "${r.name}" instalado.` : null })}>
          <PackagePlus className="h-3.5 w-3.5" />Instalar .pqs-pack
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} title="Gera um .pqs-pack a partir de uma pasta com pack.json"
          onClick={() => void run(async () => { const r = await api.hub.exportFolder(); return r ? `Pacote criado: ${r.items} itens (${(r.bytes / 1048576).toFixed(1)} MB).` : null })}>
          <FolderArchive className="h-3.5 w-3.5" />Criar pacote
        </Button>
      </div>
      <div className="space-y-2">
        {packs.map((p) => (
          <div key={p.id} className="rounded-lg border border-line bg-bg p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{p.name} <span className="font-mono text-[10.5px] text-faint">v{p.version}{p.builtIn ? ' · vem com o app' : ''}</span></p>
                {p.description && <p className="mt-0.5 text-[11.5px] text-muted">{p.description}</p>}
                <p className="mt-1 text-[11px] text-faint">{counts(p)}</p>
                <p className="mt-1 text-[10.5px] text-faint">Autor: {p.author} · Licença: {p.license}</p>
              </div>
              {!p.builtIn && (
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remover ${p.name}`} onClick={() => void run(async () => { await api.hub.remove(p.id); return `Pacote "${p.name}" removido.` })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!packs.length && <p className="text-[12px] text-faint">Nenhum pacote encontrado.</p>}
      </div>
      <p className="mt-4 text-[11px] text-faint">
        Formato .pqs-pack: um zip com <code>pack.json</code> na raiz (id, nome, versão, autor, licença e a lista de itens) e os arquivos citados.
        Só os arquivos listados no manifesto e as licenças são extraídos.
      </p>
    </div>
  )
}
