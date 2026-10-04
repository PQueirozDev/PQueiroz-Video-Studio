import { basename } from 'node:path'

// Traduz o uso de ferramentas do Claude em mensagens de status legíveis para o painel.

export interface ToolDescription {
  status: string
  activity: string
}

const short = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function describeCommand(cmd: string): string {
  const c = cmd.toLowerCase()
  if (/montar\.py[^\n]*--preview/.test(c)) return 'Renderizando prévia...'
  if (/montar\.py/.test(c)) return 'Renderizando...'
  if (/ffprobe|volumedetect|-count_frames/.test(c)) return 'Claude está analisando os vídeos...'
  if (/loudnorm|afade|volume=|amix|aresample/.test(c)) return 'Processando áudio...'
  if (/xfade|concat/.test(c)) return 'Aplicando transições...'
  if (/ffmpeg[^\n]*(-ss|-to |trim|-t )/.test(c)) return 'Aplicando cortes...'
  if (/ffmpeg/.test(c)) return 'Renderizando...'
  if (/copytree|cp -r|robocopy|copy-item|xcopy/.test(c)) return 'Preparando edição...'
  if (/pip install/.test(c)) return 'Instalando dependências...'
  return 'Executando comando...'
}

export function describeTool(name: string, input: Record<string, unknown>): ToolDescription {
  const file = typeof input.file_path === 'string' ? basename(input.file_path) : ''
  switch (name) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = String(input.command ?? '')
      const desc = typeof input.description === 'string' && input.description ? input.description : short(cmd)
      return { status: describeCommand(cmd), activity: `▸ ${desc}` }
    }
    case 'Read':
      return { status: /\.(png|jpe?g|webp)$/i.test(file) ? 'Olhando os quadros...' : `Lendo ${file}...`, activity: `Leu ${file}` }
    case 'Write':
      return { status: 'Preparando edição...', activity: `Criou ${file}` }
    case 'Edit':
    case 'MultiEdit':
      return { status: 'Preparando edição...', activity: `Editou ${file}` }
    case 'Glob':
    case 'Grep':
      return { status: 'Procurando arquivos...', activity: `Buscou ${short(String(input.pattern ?? ''), 50)}` }
    case 'TodoWrite':
      return { status: 'Planejando a edição...', activity: 'Atualizou o plano' }
    default:
      return { status: `Usando ${name}...`, activity: name }
  }
}
