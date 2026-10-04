import { useEffect, useState, type DragEvent } from 'react'
import { FileAudio, FolderOpen, Image as ImageIcon, Lock, Plus, Type, Film } from 'lucide-react'
import type { AssetCategory, AssetItem } from '@shared/types'
import { api, cx, fmtSize, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Empty, IconButton } from './ui'

const CATS: { id: AssetCategory; label: string }[] = [
  { id: 'logos', label: 'Logos' },
  { id: 'musicas', label: 'Músicas' },
  { id: 'fontes', label: 'Fontes' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'intros', label: 'Intros' },
  { id: 'finais', label: 'Finalizações' }
]

const ICON: Record<AssetCategory, typeof Film> = { logos: ImageIcon, musicas: FileAudio, fontes: Type, overlays: ImageIcon, intros: Film, finais: Film }

export function AssetsPanel() {
  const { projectId, refreshMedia, toast } = useStore()
  const [cat, setCat] = useState<AssetCategory>('logos')
  const [items, setItems] = useState<AssetItem[]>([])

  const load = (): void => {
    api.assets.list().then(setItems)
  }
  useEffect(load, [])

  const report = (r: { added: number; skipped: string[] }): void => {
    if (r.added) toast(`${r.added} arquivo(s) adicionado(s) à biblioteca`, 'ok')
    r.skipped.forEach((s) => toast(s, 'bad'))
    load()
  }

  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation() // não importa no projeto: vai para a biblioteca
    const paths = Array.from(e.dataTransfer.files).map((f) => api.media.pathForFile(f)).filter(Boolean)
    if (paths.length) report(await api.assets.add(cat, paths))
  }

  const use = async (a: AssetItem): Promise<void> => {
    if (!projectId) return
    try {
      toast(await api.assets.use(projectId, a.path), 'ok')
      await refreshMedia()
    } catch (err) {
      toast(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad')
    }
  }

  const list = items.filter((i) => i.category === cat)
  const Icon = ICON[cat]

  return (
    <div data-drop="assets" className="flex h-full flex-col" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="flex shrink-0 items-center gap-1 px-2.5 pt-2.5">
        {CATS.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)}
            className={cx('h-6 rounded-md px-2 text-[11.5px] transition-colors', cat === c.id ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg')}>
            {c.label} <span className="font-mono text-[10px] opacity-60">{items.filter((i) => i.category === c.id).length}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <IconButton title="Abrir pasta da biblioteca" onClick={() => api.assets.openFolder()}><FolderOpen className="h-3.5 w-3.5" /></IconButton>
          <Button size="sm" variant="ghost" onClick={async () => report(await api.assets.pickAndAdd(cat))}><Plus className="h-3.5 w-3.5" />Adicionar</Button>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty icon={<Icon className="h-7 w-7" />} title="Nada nesta categoria">Arraste arquivos para cá para guardar na biblioteca — eles ficam disponíveis em todos os projetos.</Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 p-2.5">
          {list.map((a) => (
            <div key={a.path} className="group overflow-hidden rounded-lg border border-line bg-panel-2">
              <div className="relative flex aspect-video items-center justify-center bg-[repeating-conic-gradient(#1b1b24_0%_25%,#15151c_0%_50%)] bg-[length:16px_16px]">
                {a.thumbnail ? <img src={mediaUrl(a.thumbnail)} className="max-h-full max-w-full object-contain" alt="" /> : <Icon className="h-6 w-6 text-faint" />}
                {a.readOnly && <span title="aqc — somente leitura" className="absolute left-1.5 top-1.5 rounded bg-black/70 p-1"><Lock className="h-3 w-3 text-muted" /></span>}
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="sm" variant="primary" disabled={!projectId} onClick={() => use(a)}>Usar no projeto</Button>
                </div>
              </div>
              <div className="px-2 py-1.5">
                <p className="truncate text-xs font-medium" title={a.path}>{a.name}</p>
                <p className="text-[10.5px] text-faint">{fmtSize(a.size)}{a.readOnly ? ' · aqc' : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
