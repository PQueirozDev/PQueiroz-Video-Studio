import { useEffect, useState } from 'react'
import type { EnvCheck } from '@shared/types'
import { api } from '@/lib/format'
import { useStore } from '@/store'
import { Logo, Progress } from './ui'

// Resultado das verificações da inicialização, reaproveitado pelo Onboarding.
export let startupChecks: EnvCheck[] = []

const STEPS: { id: EnvCheck['id']; text: string }[] = [
  { id: 'aqc', text: 'Verificando E:\\aqc...' },
  { id: 'skills', text: 'Carregando Skills...' },
  { id: 'ffmpeg', text: 'Verificando FFmpeg...' },
  { id: 'python', text: 'Verificando Python...' },
  { id: 'workspace', text: 'Carregando projetos...' },
  { id: 'claude', text: 'Inicializando Claude...' }
]

export function Splash() {
  const [step, setStep] = useState(0)
  const [text, setText] = useState('Iniciando...')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const store = useStore.getState()
      await store.loadSettings()
      const results: EnvCheck[] = []
      for (let i = 0; i < STEPS.length; i++) {
        if (!alive) return
        const s = STEPS[i]
        setStep(i)
        setText(s.id === 'aqc' ? `Verificando ${useStore.getState().settings?.aqcRoot}...` : s.text)
        results.push(await api.env.check(s.id))
        if (s.id === 'workspace') await store.loadProjects()
      }
      startupChecks = results
      if (!alive) return
      setStep(STEPS.length)
      const settings = useStore.getState().settings!
      if (!settings.onboarded) {
        store.setView('onboarding')
        return
      }
      // Recupera a sessão: reabre o último projeto aberto.
      const last = settings.lastProjectId && useStore.getState().projects.find((p) => p.id === settings.lastProjectId)
      if (last) await store.openProject(last.id)
      else store.setView('dashboard')
      const problems = results.filter((r) => r.state === 'erro')
      for (const p of problems) store.toast(`${p.label}: ${p.detail}`, 'bad')
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="drag flex h-full flex-col items-center justify-center gap-8 bg-bg">
      <div className="flex flex-col items-center gap-4 animate-pop">
        <Logo size={56} />
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">PQueiroz</h1>
          <p className="text-sm text-muted">Video Studio</p>
        </div>
      </div>
      <div className="w-72">
        <Progress value={step / STEPS.length} />
        <p className="mt-3 text-center text-xs text-muted">{text}</p>
      </div>
    </div>
  )
}
