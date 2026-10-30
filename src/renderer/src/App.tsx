import { useEffect } from 'react'
import { api, cx } from './lib/format'
import { useStore } from './store'
import { Splash } from './components/Splash'
import { Onboarding } from './components/Onboarding'
import { Dashboard } from './components/Dashboard'
import { Workspace } from './components/Workspace'
import { TitleBar } from './components/TitleBar'
import { NewProjectDialog } from './components/NewProjectDialog'
import { RenderDialog } from './components/RenderDialog'
import { RenderQueue } from './components/RenderQueue'
import { SettingsDialog } from './components/SettingsDialog'
import { CommandPalette } from './components/CommandPalette'
import { Toasts } from './components/ui'
import { ImageStudio } from './components/image/ImageStudio'
import { AssetsPage } from './components/image/AssetsPage'

export function App() {
  const { view, settings, onClaudeEvent, onRender, setPalette } = useStore()

  useEffect(() => {
    const offClaude = api.chat.onEvent(onClaudeEvent)
    const offRender = api.render.onUpdate(onRender)
    const offMedia = api.media.onChanged((pid) => {
      if (useStore.getState().projectId === pid) useStore.getState().refreshMedia()
    })
    const offTask = api.media.onTask((t) => {
      useStore.setState((s) => ({ task: { ...s.task, [t.projectId]: t.done ? undefined : { text: t.text, progress: t.progress } } }))
      if (t.error) useStore.getState().toast(`Tarefa falhou: ${t.error}`, 'bad')
    })
    api.render.list().then((renders) => useStore.setState({ renders }))
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(!useStore.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offClaude()
      offRender()
      offMedia()
      offTask()
      window.removeEventListener('keydown', onKey)
    }
  }, [onClaudeEvent, onRender, setPalette])

  // Evita que soltar um arquivo fora da área de importação abra o arquivo na janela.
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return (
    <div
      className={cx('flex h-full flex-col', settings && !settings.animations && 'reduce-motion')}
      style={{ zoom: settings?.uiScale ?? 1 }}
    >
      {view === 'splash' ? (
        <Splash />
      ) : view === 'onboarding' ? (
        <Onboarding />
      ) : (
        <>
          <TitleBar />
          <div className="min-h-0 flex-1">
            {view === 'dashboard' ? <Dashboard /> : view === 'image' ? <ImageStudio /> : view === 'assets' ? <AssetsPage /> : <Workspace />}
          </div>
        </>
      )}
      <NewProjectDialog />
      <RenderDialog />
      <RenderQueue />
      <SettingsDialog />
      <CommandPalette />
      <Toasts />
    </div>
  )
}
