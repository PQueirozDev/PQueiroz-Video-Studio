import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import type { ProviderInfo } from '@shared/image'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { Badge, Button, inputClass, Toggle } from '../ui'

const errMsg = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ProviderCard({ p, onChange }: { p: ProviderInfo; onChange(p: ProviderInfo): void }) {
  const toast = useStore((s) => s.toast)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(p.model)
  const [endpoint, setEndpoint] = useState(p.endpoint)
  useEffect(() => {
    setModel(p.model)
    setEndpoint(p.endpoint)
  }, [p.model, p.endpoint])
  const run = async (fn: () => Promise<ProviderInfo>, ok?: string): Promise<void> => {
    try {
      onChange(await fn())
      if (ok) toast(ok, 'ok')
    } catch (err) {
      toast(errMsg(err), 'bad')
    }
  }
  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold">{p.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {p.paid ? <Badge tone="warn">Pago</Badge> : <Badge tone="ok">Gratuito</Badge>}
            {p.kind === 'local' && <Badge tone="info">Local</Badge>}
            {p.kind === 'externo-gratuito' && <Badge tone="neutral">Serviço público</Badge>}
            {p.ready ? <Badge tone="ok">Pronto</Badge> : p.id !== 'composition' ? <Badge tone="bad">Não configurado</Badge> : null}
          </div>
        </div>
        {p.id !== 'composition' && <div className="w-36"><Toggle checked={p.enabled} onChange={(v) => run(() => api.providers.configure(p.id, { enabled: v }))} label={p.enabled ? 'Ativado' : 'Desativado'} /></div>}
      </div>
      <p className="text-xs leading-relaxed text-muted">{p.costNote}</p>
      <p className="flex items-start gap-1.5 text-[11.5px] text-faint"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{p.privacyNote}</p>
      <p className="text-[11.5px] text-faint">{p.setupHint}</p>
      {p.needsKey && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs text-muted"><KeyRound className="h-3.5 w-3.5" />Chave de API {p.hasKey ? <span className="font-mono text-ok">{p.keyHint}</span> : <span className="text-faint">não cadastrada</span>}</p>
          <div className="flex gap-1.5">
            <input type="password" autoComplete="off" spellCheck={false} className={cx(inputClass, 'h-8 font-mono')} placeholder={p.hasKey ? 'Nova chave (substitui a atual)' : 'Cole a chave aqui'} value={key} onChange={(e) => setKey(e.target.value)} />
            <Button size="sm" variant="primary" disabled={!key.trim()} onClick={() => run(async () => {
              const r = await api.providers.setKey(p.id, key.trim())
              setKey('')
              return r
            }, 'Chave salva com criptografia do sistema')}>Salvar</Button>
            {p.hasKey && <Button size="sm" variant="danger" onClick={() => run(() => api.providers.setKey(p.id, null), 'Chave removida')}>Remover</Button>}
          </div>
          <p className="text-[10.5px] text-faint">A chave é criptografada pelo sistema operacional e fica só no processo principal — a interface nunca a recebe de volta.</p>
        </div>
      )}
      {p.id !== 'composition' && (
        <div className="grid grid-cols-2 gap-2">
          {p.id !== 'sd-local' && (
            <label className="block"><span className="mb-1 block text-[11px] text-faint">Modelo</span>
              <input className={cx(inputClass, 'h-8 font-mono')} value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => model !== p.model && run(() => api.providers.configure(p.id, { model }))} />
            </label>
          )}
          <label className={cx('block', p.id === 'sd-local' && 'col-span-2')}><span className="mb-1 block text-[11px] text-faint">Endereço</span>
            <input className={cx(inputClass, 'h-8 font-mono')} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} onBlur={() => endpoint !== p.endpoint && run(() => api.providers.configure(p.id, { endpoint }))} />
          </label>
        </div>
      )}
    </div>
  )
}

export function ProvidersSettings() {
  const [list, setList] = useState<ProviderInfo[]>([])
  useEffect(() => {
    api.providers.list().then(setList)
  }, [])
  const update = (p: ProviderInfo): void => {
    setList((l) => l.map((x) => (x.id === p.id ? p : x)))
    void useImage.getState().loadProviders()
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-xs leading-relaxed text-info">
        O Claude Code não gera imagens: ele dirige a arte, escreve o prompt e monta as camadas. A imagem do cenário/mascote vem de um destes provedores.
        A assinatura do Claude <strong>não</strong> inclui geração de imagens; serviços pagos cobram na conta do próprio provedor. Nada é enviado sem você clicar em "Gerar".
      </div>
      {list.map((p) => <ProviderCard key={p.id} p={p} onChange={update} />)}
    </div>
  )
}
