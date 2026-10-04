import { accessSync, constants, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { EnvCheck } from '@shared/types'
import { ensureDir } from './files'
import { ffmpegVersion } from './media/ffmpeg'
import { getSettings, updateSettings } from './settings'
import { aqcInfo } from './skills/aqc'
import { claudePath, clearToolCache, ffmpegPath, ffprobePath, pythonPath, studioVenvPython, systemPython } from './tools'
import { exec } from './util'

const PY_DEPS = ['librosa', 'numpy', 'PIL']
const IS_WIN = process.platform === 'win32'

export async function checkEnv(id: EnvCheck['id']): Promise<EnvCheck> {
  switch (id) {
    case 'aqc': {
      const info = aqcInfo()
      if (!info.exists) {
        return { id, label: 'E:\\aqc', state: 'erro', detail: `Pasta não encontrada: ${info.root}`, hint: 'Ajuste o caminho em Configurações › Geral.' }
      }
      if (!info.templateDir) {
        return { id, label: info.root, state: 'aviso', detail: 'Pasta encontrada, mas sem "Modelo edicao/montar.py".' }
      }
      // Os originais citam C:\aqc, mas isso é corrigido automaticamente na cópia de cada projeto (skills/template.ts).
      const stale = info.stalePaths.length ? ` Caminhos C:\\aqc corrigidos automaticamente nas cópias.` : ''
      return {
        id, label: info.root, state: 'ok',
        detail: `Modelo de edição, ${info.musicCount} músicas, ${info.doneVideos.length} vídeo(s) feito(s).${stale}`
      }
    }
    case 'skills': {
      const info = aqcInfo()
      const missing = info.workflow.filter((w) => !w.found)
      const hasWorkflow = info.workflow.some((w) => w.kind === 'workflow')
      if (!hasWorkflow) {
        return { id, label: 'Video Skills', state: 'erro', detail: 'CLAUDE.md não encontrado em E:\\aqc — o Claude não terá as regras de edição.' }
      }
      const found = info.workflow.filter((w) => w.found).map((w) => w.name)
      if (missing.length) {
        return {
          id, label: 'Video Skills', state: 'aviso',
          detail: `${found.length} itens do fluxo carregados. Não encontrada(s): ${missing.map((m) => m.name).join(', ')}.`,
          hint: `Copie a skill para ${dirname(dirname(missing[0].path))}. Sem ela o Claude segue o CLAUDE.md e o montar.py, que já descrevem o fluxo completo.`
        }
      }
      return { id, label: 'Video Skills', state: 'ok', detail: found.join(', ') }
    }
    case 'ffmpeg': {
      clearToolCache()
      const [ff, fp] = await Promise.all([ffmpegPath(), ffprobePath()])
      if (!ff || !fp) {
        return { id, label: 'FFmpeg', state: 'erro', detail: `${!ff ? 'ffmpeg' : 'ffprobe'} não encontrado no PATH.`, hint: IS_WIN ? 'winget install Gyan.FFmpeg, ou informe o caminho em Configurações › FFmpeg.' : 'sudo apt install ffmpeg (ou o gerenciador da sua distro), ou informe o caminho em Configurações › FFmpeg.' }
      }
      return { id, label: 'FFmpeg', state: 'ok', detail: `v${(await ffmpegVersion()) ?? '?'} — ${ff}` }
    }
    case 'claude': {
      const bin = await claudePath()
      if (!bin) {
        return { id, label: 'Claude', state: 'erro', detail: `Claude Code (${IS_WIN ? 'claude.exe' : 'claude'}) não encontrado.`, hint: 'npm install -g @anthropic-ai/claude-code e faça login com "claude".' }
      }
      const r = await exec(bin, ['--version'], { timeoutMs: 20000 })
      if (r.code !== 0) return { id, label: 'Claude', state: 'erro', detail: `claude --version falhou: ${r.stderr.trim().slice(0, 200)}` }
      return { id, label: 'Claude', state: 'ok', detail: `${r.stdout.trim()} — ${bin}` }
    }
    case 'python': {
      const py = await pythonPath()
      if (!py) {
        return {
          id, label: 'Python', state: 'aviso',
          detail: 'Python não está instalado. O montar.py (motor do modelo de edição) precisa de Python com librosa, numpy e Pillow.',
          hint: IS_WIN ? 'Use "Preparar ambiente Python" (instala via winget e cria um ambiente só do estúdio).' : 'Instale com: sudo apt install python3 python3-venv — depois use "Preparar ambiente Python".'
        }
      }
      const r = await exec(py, ['-c', `import ${PY_DEPS.join(', ')}; print('ok')`], { timeoutMs: 60000 })
      if (r.code !== 0) {
        return { id, label: 'Python', state: 'aviso', detail: `Python encontrado (${py}), mas faltam librosa/numpy/Pillow.`, hint: 'Use "Preparar ambiente Python".' }
      }
      return { id, label: 'Python', state: 'ok', detail: `librosa, numpy e Pillow OK — ${py}` }
    }
    case 'workspace': {
      const root = getSettings().projectsRoot
      try {
        ensureDir(root)
        accessSync(root, constants.W_OK)
        return { id, label: 'Workspace', state: 'ok', detail: root }
      } catch (err) {
        return { id, label: 'Workspace', state: 'erro', detail: `Sem acesso a ${root}: ${String(err)}` }
      }
    }
  }
}

/**
 * Cria um venv do estúdio com as dependências do montar.py.
 * Se não houver Python, instala via winget (escopo do usuário).
 */
export async function setupPython(): Promise<{ ok: boolean; log: string }> {
  const log: string[] = []
  let py = await systemPython()
  if (!py && !IS_WIN) {
    log.push('Python não encontrado. Instale pelo terminal (sudo apt install python3 python3-venv, ou o equivalente da sua distro) e tente de novo.')
    return { ok: false, log: log.join('\n') }
  }
  if (!py) {
    log.push('Python não encontrado. Instalando Python 3.12 via winget…')
    const r = await exec('winget', ['install', '-e', '--id', 'Python.Python.3.12', '--scope', 'user', '--silent',
      '--accept-package-agreements', '--accept-source-agreements'], { timeoutMs: 15 * 60_000 })
    log.push(r.stdout.slice(-1500), r.stderr.slice(-1500))
    clearToolCache()
    py = await systemPython()
    if (!py) {
      log.push('A instalação terminou, mas o Python ainda não foi encontrado. Reinicie o estúdio ou instale manualmente em python.org.')
      return { ok: false, log: log.join('\n') }
    }
  }
  log.push(`Python base: ${py}`)
  const venvDir = join(app.getPath('userData'), 'pyenv')
  if (!existsSync(studioVenvPython())) {
    const r = await exec(py, ['-m', 'venv', venvDir], { timeoutMs: 120_000 })
    log.push(r.stderr.trim())
    if (r.code !== 0) {
      // Debian/Ubuntu separam o módulo venv do python3.
      if (!IS_WIN) log.push('Falha ao criar o ambiente. No Debian/Ubuntu instale: sudo apt install python3-venv')
      return { ok: false, log: log.join('\n') }
    }
  }
  log.push('Instalando librosa, numpy e Pillow (pode levar alguns minutos)…')
  const pip = await exec(studioVenvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', 'librosa', 'numpy', 'pillow'], { timeoutMs: 20 * 60_000 })
  log.push(pip.stdout.split(/\r?\n/).slice(-6).join('\n'), pip.stderr.slice(-1500))
  if (pip.code !== 0) return { ok: false, log: log.join('\n') }
  updateSettings({ pythonPath: studioVenvPython() })
  clearToolCache()
  log.push('Ambiente pronto.')
  return { ok: true, log: log.filter(Boolean).join('\n') }
}
