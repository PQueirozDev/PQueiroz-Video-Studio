import { useEffect, useState, type ReactNode } from 'react'
import { Bot, Cpu, Film, FolderOpen, Palette, Settings2, SlidersHorizontal } from 'lucide-react'
import type { AqcInfo, EnvCheck, Settings } from '@shared/types'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { Badge, Button, Dialog, Field, inputClass, Segmented, Toggle } from './ui'
import { EnvChecklist, StateIcon } from './Onboarding'
import { PresetsEditor } from './PresetsEditor'
import { AboutSection } from './UpdateBadge'
import { SettingsUsage } from './ClaudeUsage'

type Tab = 'geral' | 'aparencia' | 'claude' | 'presets' | 'ffmpeg' | 'performance'

const TABS: { id: Tab; label: string; icon: typeof Bot }[] = [
  { id: 'geral', label: 'Geral', icon: Settings2 },
  { id: 'aparencia', label: 'Aparência', icon: Palette },
  { id: 'claude', label: 'Claude', icon: Bot },
  { id: 'ffmpeg', label: 'FFmpeg', icon: Film },
  { id: 'presets', label: 'Presets', icon: SlidersHorizontal },
  { id: 'performance', label: 'Performance', icon: Cpu }
]

function FolderField({ label, k, hint }: { label: string; k: 'projectsRoot' | 'exportRoot' | 'aqcRoot' | 'assetsRoot'; hint?: string }) {
  const { settings, saveSettings } = useStore()
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <span className="selectable min-w-0 flex-1 truncate rounded-lg border border-line-2 bg-bg px-3 py-2 font-mono text-[11.5px] text-muted">{settings?.[k]}</span>
        <Button size="sm" onClick={async () => {
          const dir = await api.settings.pickFolder(label, settings?.[k])
          if (dir) await saveSettings({ [k]: dir })
        }}><FolderOpen className="h-3.5 w-3.5" />Alterar</Button>
      </div>
    </Field>
  )
}

function PathField({ label, k, placeholder }: { label: string; k: 'ffmpegPath' | 'ffprobePath' | 'claudePath' | 'pythonPath'; placeholder: string }) {
  const { settings, saveSettings } = useStore()
  return (
    <Field label={label} hint="Deixe vazio para detectar automaticamente.">
      <div className="flex items-center gap-2">
        <input className={cx(inputClass, 'font-mono text-[11.5px]')} placeholder={placeholder} value={settings?.[k] ?? ''}
          onChange={(e) => saveSettings({ [k]: e.target.value })} />
        <Button size="sm" onClick={async () => {
          const f = await api.settings.pickFile(label)
          if (f) await saveSettings({ [k]: f })
        }}>Procurar</Button>
      </div>
    </Field>
  )
}

function CheckRow({ id }: { id: EnvCheck['id'] }) {
  const [c, setC] = useState<EnvCheck | null>(null)
  useEffect(() => {
    api.env.check(id).then(setC)
  }, [id])
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
      {c ? <StateIcon state={c.state} /> : <span className="h-4 w-4" />}
      <div className="min-w-0 flex-1">
        <p className="selectable break-all text-xs text-muted">{c?.detail ?? 'verificando...'}</p>
        {c?.hint && c.state !== 'ok' && <p className="selectable mt-1 text-[11px] text-faint">{c.hint}</p>}
      </div>
      <Button size="sm" variant="ghost" onClick={() => { setC(null); api.env.check(id).then(setC) }}>Verificar</Button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</h3>
      {children}
    </div>
  )
}

export function SettingsDialog() {
  const { dialog, setDialog, settings, saveSettings } = useStore()
  const [tab, setTab] = useState<Tab>('geral')
  const [aqc, setAqc] = useState<AqcInfo | null>(null)
  const [checks, setChecks] = useState<EnvCheck[]>([])
  const open = dialog === 'settings'

  useEffect(() => {
    if (!open) return
    api.env.aqcInfo().then(setAqc)
    api.presets.list().then((presets) => useStore.setState({ presets }))
  }, [open, settings?.aqcRoot])

  useEffect(() => {
    if (open && tab === 'performance') Promise.all((['python'] as const).map((id) => api.env.check(id))).then(setChecks)
  }, [open, tab])

  if (!settings) return null
  const set = (patch: Partial<Settings>): void => {
    saveSettings(patch)
  }

  return (
    <Dialog open={open} onClose={() => setDialog(null)} title="Configurações" width={780}>
      <div className="flex min-h-[440px] gap-5">
        <nav className="w-40 shrink-0 space-y-0.5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cx('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors',
                tab === t.id ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg')}>
              <t.icon className="h-4 w-4" />{t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {tab === 'geral' && (
            <>
              <Section title="Pastas">
                <FolderField label="Sistema de edição (aqc)" k="aqcRoot" hint="Somente leitura: o estúdio nunca altera os arquivos desta pasta." />
                <FolderField label="Pasta dos projetos" k="projectsRoot" />
                <FolderField label="Pasta de exportação" k="exportRoot" hint="Por padrão, a mesma pasta 'Videos feitos' do fluxo atual." />
                <FolderField label="Biblioteca de assets" k="assetsRoot" hint="Logos, músicas, fontes, overlays e intros reutilizáveis entre projetos." />
              </Section>
              <Section title="Sobre"><AboutSection /></Section>
              <Section title="Notificações">
                <Toggle checked={settings.notifications} onChange={(v) => set({ notifications: v })} label="Notificar quando o Claude ou um render terminar" hint="Só aparece com a janela em segundo plano." />
              </Section>
            </>
          )}

          {tab === 'aparencia' && (
            <Section title="Aparência">
              <Field label="Tema" hint="O estúdio usa o tema escuro (grafite com roxo).">
                <Segmented value="escuro" onChange={() => {}} options={[{ value: 'escuro', label: 'Escuro' }]} />
              </Field>
              <Field label="Escala da interface">
                <Segmented value={String(settings.uiScale)} onChange={(v) => set({ uiScale: Number(v) })}
                  options={[{ value: '0.9', label: '90%' }, { value: '1', label: '100%' }, { value: '1.1', label: '110%' }, { value: '1.25', label: '125%' }]} />
              </Field>
              <Toggle checked={settings.animations} onChange={(v) => set({ animations: v })} label="Animações" />
            </Section>
          )}

          {tab === 'claude' && (
            <>
              <Section title="Status"><CheckRow id="claude" /></Section>
              <Section title="Uso da assinatura"><SettingsUsage /></Section>
              <Section title="Integração">
                <Field label="Modelo" hint="Vazio usa o padrão do Claude Code. Ex.: opus, sonnet.">
                  <input className={inputClass} placeholder="padrão do Claude Code" value={settings.claudeModel} onChange={(e) => set({ claudeModel: e.target.value })} />
                </Field>
                <PathField label="Caminho do Claude Code" k="claudePath" placeholder="detectado automaticamente" />
              </Section>
              <Section title="Skills e fluxo detectados">
                <div className="space-y-1.5">
                  {aqc?.workflow.map((w) => (
                    <div key={w.path} className="flex items-start gap-2.5 rounded-lg border border-line bg-panel-2 px-3 py-2">
                      <StateIcon state={w.found ? 'ok' : 'aviso'} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="text-[13px] font-medium">{w.name}</span><Badge>{w.kind}</Badge></div>
                        <p className="selectable truncate text-[11px] text-faint" title={w.path}>{w.description || w.path}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {tab === 'ffmpeg' && (
            <>
              <Section title="Status"><CheckRow id="ffmpeg" /></Section>
              <Section title="Caminhos">
                <PathField label="ffmpeg" k="ffmpegPath" placeholder="detectado no PATH" />
                <PathField label="ffprobe" k="ffprobePath" placeholder="detectado no PATH" />
              </Section>
            </>
          )}

          {tab === 'presets' && <PresetsEditor />}

          {tab === 'performance' && (
            <>
              <Section title="Renderização">
                <Toggle checked={settings.hwAccel} onChange={(v) => set({ hwAccel: v })} label="Aceleração por hardware (NVENC)" hint="Se a GPU falhar, o render é refeito automaticamente na CPU." />
                <Field label="Renders simultâneos">
                  <Segmented value={String(settings.maxConcurrentRenders)} onChange={(v) => set({ maxConcurrentRenders: Number(v) })}
                    options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
                </Field>
                <Toggle checked={settings.useProxies} onChange={(v) => set({ useProxies: v })} label="Proxies para vídeos pesados"
                  hint="Vídeos 4K, HEVC ou com bitrate alto ganham uma cópia 540p só para o preview. Edições e renders sempre usam o original." />
              </Section>
              <Section title="Ambiente Python (montar.py)">
                <PathField label="Python" k="pythonPath" placeholder="ambiente do estúdio ou Python do sistema" />
                {checks.length > 0 && <EnvChecklist ids={['python']} checks={checks} onChange={setChecks} />}
              </Section>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}
