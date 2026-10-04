import { CheckCircle2, Clock, FolderOpen, ListVideo, X, XCircle } from 'lucide-react'
import type { RenderJob } from '@shared/types'
import { api, fmtAgo } from '@/lib/format'
import { useStore } from '@/store'
import { Badge, Button, Dialog, Empty, IconButton, Progress } from './ui'

const QUALITY = { rapida: 'Rápida', equilibrada: 'Equilibrada', alta: 'Alta', maxima: 'Máxima' }

function StatusText({ job }: { job: RenderJob }) {
  switch (job.status) {
    case 'renderizando': return <span className="text-accent">Renderizando {Math.round(job.progress * 100)}%</span>
    case 'aguardando': return <span className="text-muted">Aguardando</span>
    case 'concluido': return <span className="text-ok">Concluído</span>
    case 'erro': return <span className="text-bad">Erro</span>
    case 'cancelado': return <span className="text-faint">Cancelado</span>
  }
}

export function RenderQueue() {
  const { dialog, setDialog, renders } = useStore()
  const open = dialog === 'queue'

  const clear = async (): Promise<void> => {
    await api.render.clearFinished()
    useStore.setState({ renders: await api.render.list() })
  }

  return (
    <Dialog
      open={open}
      onClose={() => setDialog(null)}
      title="Render Queue"
      subtitle="Os renders rodam em processos separados — pode continuar usando o estúdio."
      width={640}
      footer={<Button variant="ghost" onClick={clear} disabled={!renders.some((r) => ['concluido', 'erro', 'cancelado'].includes(r.status))}>Limpar finalizados</Button>}
    >
      {renders.length === 0 ? (
        <div className="h-40"><Empty icon={<ListVideo className="h-7 w-7" />} title="Fila vazia">Use "Renderizar" dentro de um projeto.</Empty></div>
      ) : (
        <div className="space-y-2">
          {renders.map((j) => (
            <div key={j.id} className="rounded-lg border border-line bg-panel-2 px-3 py-2.5">
              <div className="flex items-center gap-3">
                {j.status === 'concluido' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
                  : j.status === 'erro' ? <XCircle className="h-4 w-4 shrink-0 text-bad" />
                  : <Clock className="h-4 w-4 shrink-0 text-faint" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{j.projectName} · {j.label}</p>
                  <p className="truncate text-[11px] text-faint">
                    {j.settings.container.toUpperCase()} · {j.settings.resolution} · {j.settings.fps === 'original' ? 'FPS original' : `${j.settings.fps} fps`} · {QUALITY[j.settings.quality]}
                    {j.encoder ? ` · ${j.encoder === 'h264_nvenc' ? 'GPU (NVENC)' : 'CPU'}` : ''} · {fmtAgo(j.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 text-xs"><StatusText job={j} /></span>
                {(j.status === 'renderizando' || j.status === 'aguardando') && (
                  <IconButton title="Cancelar" onClick={() => api.render.cancel(j.id)}><X className="h-3.5 w-3.5" /></IconButton>
                )}
                {j.status === 'concluido' && (
                  <IconButton title="Mostrar na pasta" onClick={() => api.render.reveal(j.id)}><FolderOpen className="h-3.5 w-3.5" /></IconButton>
                )}
              </div>
              {j.status === 'renderizando' && <Progress value={j.progress} className="mt-2" />}
              {j.status === 'concluido' && <p className="selectable mt-1 truncate pl-7 font-mono text-[10.5px] text-faint">{j.output}</p>}
              {j.error && <pre className="selectable mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[10.5px] text-bad">{j.error}</pre>}
            </div>
          ))}
        </div>
      )}
      {renders.some((r) => r.status === 'renderizando') && <div className="mt-3"><Badge tone="info">A interface continua livre durante o render</Badge></div>}
    </Dialog>
  )
}
