import { useState } from 'react'
import { Library, Package, Stamp } from 'lucide-react'
import { cx } from '@/lib/format'
import { AssetsPanel } from '../AssetsPanel'
import { BrandManager } from './BrandManager'
import { PacksManager } from '../PacksManager'

/** Biblioteca de Assets: marcas (logos oficiais, paleta, fontes) e a biblioteca global de arquivos. */
export function AssetsPage() {
  const [tab, setTab] = useState<'marcas' | 'pacotes' | 'arquivos'>('marcas')
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-3">
        {([['marcas', 'Marcas', Stamp], ['pacotes', 'Pacotes (Asset Hub)', Package], ['arquivos', 'Arquivos (logos, músicas, fontes…)', Library]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={cx('flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', tab === id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg')}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'marcas' ? <BrandManager /> : tab === 'pacotes' ? <div className="h-full overflow-y-auto bg-panel"><PacksManager /></div> : <div className="h-full overflow-y-auto bg-panel"><AssetsPanel /></div>}
      </div>
    </div>
  )
}
