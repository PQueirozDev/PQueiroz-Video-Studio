import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, RefreshCw, XCircle } from 'lucide-react'
import type { EnvCheck } from '@shared/types'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { Button, Logo, Spinner } from './ui'
import { startupChecks } from './Splash'

const LABELS: Record<EnvCheck['id'], string> = {
  claude: 'Claude', ffmpeg: 'FFmpeg', skills: 'Video Skills', aqc: 'E:\\aqc', python: 'Python', workspace: 'Workspace'
}
const ORDER: EnvCheck['id'][] = ['claude', 'ffmpeg', 'skills', 'aqc', 'python', 'workspace']

export function StateIcon({ state }: { state: EnvCheck['state'] }) {
  if (state === 'ok') return <CheckCircle2 className="h-4 w-4 text-ok" />
  if (state === 'aviso') return <AlertTriangle className="h-4 w-4 text-warn" />
  return <XCircle className="h-4 w-4 text-bad" />
}

export function EnvChecklist({ checks, onChange, ids = ORDER }: { checks: EnvCheck[]; onChange(c: EnvCheck[]): void; ids?: EnvCheck['id'][] }) {
  const { settings, saveSettings } = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [pyLog, setPyLog] = useState('')

  const recheck = async (which: EnvCheck['id'][] = ids): Promise<void> => {
    setBusy('recheck')
    const fresh = await Promise.all(which.map((id) => api.env.check(id)))
    onChange(ids.map((id) => fresh.find((f) => f.id === id) ?? checks.find((c) => c.id === id)!).filter(Boolean))
    setBusy(null)
  }

  const pickFolder = async (key: 'aqcRoot' | 'projectsRoot', id: EnvCheck['id']): Promise<void> => {
    const dir = await api.settings.pickFolder(key === 'aqcRoot' ? 'Pasta do sistema de edição (E:\\aqc)' : 'Pasta dos projetos', settings?.[key])
    if (!dir) return
    await saveSettings({ [key]: dir })
    await recheck(key === 'aqcRoot' ? ['aqc', 'skills'] : [id])
  }

  const setupPython = async (): Promise<void> => {
    setBusy('python')
    setPyLog('Preparando ambiente Python... isso pode levar alguns minutos.')
    const r = await api.env.setupPython()
    setPyLog(r.log)
    setBusy(null)
    await recheck(['python'])
  }

  return (
    <div className="space-y-1.5">
      {ids.map((id) => {
        const c = checks.find((x) => x.id === id)
        return (
          <div key={id} className="rounded-lg border border-line bg-panel-2 px-3 py-2.5">
            <div className="flex items-center gap-3">
              {c ? <StateIcon state={c.state} /> : <Spinner className="h-4 w-4 text-faint" />}
              <span className="w-24 shrink-0 text-[13px] font-medium">{LABELS[id]}</span>
              <span className="selectable min-w-0 flex-1 truncate text-xs text-muted" title={c?.detail}>{c?.detail ?? 'verificando...'}</span>
              {id === 'aqc' && <Button size="sm" variant="ghost" onClick={() => pickFolder('aqcRoot', 'aqc')}><FolderOpen className="h-3.5 w-3.5" />Alterar</Button>}
              {id === 'workspace' && <Button size="sm" variant="ghost" onClick={() => pickFolder('projectsRoot', 'workspace')}><FolderOpen className="h-3.5 w-3.5" />Alterar</Button>}
              {id === 'python' && c && c.state !== 'ok' && (
                <Button size="sm" variant="primary" disabled={busy === 'python'} onClick={setupPython}>
                  {busy === 'python' ? <Spinner className="h-3.5 w-3.5" /> : null}Preparar ambiente Python
                </Button>
              )}
            </div>
            {c?.hint && c.state !== 'ok' && <p className="selectable mt-1.5 pl-7 text-[11px] text-faint">{c.hint}</p>}
            {id === 'python' && pyLog && (
              <pre className="selectable mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 font-mono text-[10.5px] text-muted">{pyLog}</pre>
            )}
          </div>
        )
      })}
      <div className="pt-1">
        <Button size="sm" variant="ghost" disabled={busy === 'recheck'} onClick={() => recheck()}>
          <RefreshCw className={cx('h-3.5 w-3.5', busy === 'recheck' && 'animate-spin')} />Verificar novamente
        </Button>
      </div>
    </div>
  )
}

export function Onboarding() {
  const { saveSettings, setView } = useStore()
  const [checks, setChecks] = useState<EnvCheck[]>(startupChecks)
  const blocking = checks.filter((c) => c.state === 'erro' && (c.id === 'workspace'))
  const allOk = checks.every((c) => c.state === 'ok')

  const finish = async (): Promise<void> => {
    await saveSettings({ onboarded: true })
    setView('dashboard')
  }

  return (
    <div className="drag flex h-full items-center justify-center bg-bg">
      <div className="no-drag w-[620px] animate-pop">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">PQueiroz Video Studio</h1>
            <p className="text-xs text-muted">Preparando seu ambiente...</p>
          </div>
        </div>
        <EnvChecklist checks={checks} onChange={setChecks} />
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-muted">
            {allOk ? 'Tudo pronto.' : 'Itens com aviso podem ser resolvidos depois em Configurações.'}
          </p>
          <Button variant="primary" size="lg" disabled={blocking.length > 0} onClick={finish}>Começar</Button>
        </div>
      </div>
    </div>
  )
}
