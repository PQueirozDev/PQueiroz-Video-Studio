import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { UpdateState } from '@shared/types'
import { api } from '@/lib/format'
import { Button } from './ui'

export function useUpdateState(): UpdateState {
  const [s, setS] = useState<UpdateState>({ state: 'idle' })
  useEffect(() => {
    api.app.updateState().then(setS).catch(() => {})
    return api.app.onUpdate(setS)
  }, [])
  return s
}

/** Barra de título: aparece só quando há atualização baixando ou pronta. */
export function UpdateBadge() {
  const s = useUpdateState()
  if (s.state === 'downloading') {
    return <span className="flex h-7 items-center gap-1.5 px-2 text-xs text-muted"><Download className="h-3.5 w-3.5 text-info" />v{s.version} {s.percent}%</span>
  }
  if (s.state !== 'ready') return null
  return (
    <Button size="sm" variant="secondary" onClick={() => api.app.installUpdate()} title="Fecha, instala e abre de novo">
      <RefreshCw className="h-3.5 w-3.5 text-ok" />Atualizar para v{s.version}
    </Button>
  )
}

const TEXT: Record<UpdateState['state'], string> = {
  idle: '',
  checking: 'Procurando atualizações...',
  available: 'Nova versão encontrada, baixando...',
  downloading: 'Baixando atualização...',
  ready: 'Atualização pronta para instalar.',
  none: 'Você está na versão mais recente.',
  error: 'Não foi possível verificar agora.'
}

/** Configurações › Geral › Sobre. */
export function AboutSection() {
  const s = useUpdateState()
  const [version, setVersion] = useState('')
  useEffect(() => {
    api.app.version().then(setVersion)
  }, [])
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">PQueiroz Video Studio <span className="font-mono text-xs text-muted">v{version}</span></p>
        <p className="text-[11px] text-faint">{TEXT[s.state] || 'Atualizações automáticas pelo GitHub Releases.'}{s.state === 'error' ? ` ${s.message}` : ''}</p>
      </div>
      {s.state === 'ready' ? (
        <Button size="sm" variant="primary" onClick={() => api.app.installUpdate()}>Reiniciar e atualizar</Button>
      ) : (
        <Button size="sm" disabled={s.state === 'checking' || s.state === 'downloading'} onClick={() => api.app.checkUpdate()}>Procurar atualizações</Button>
      )}
    </div>
  )
}
