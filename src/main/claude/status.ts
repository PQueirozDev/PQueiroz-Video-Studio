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
    case 'ToolSearch':
      return { status: 'Preparando as ferramentas...', activity: '' }
    default: {
      const studio = STUDIO_TOOLS[name.replace(/^mcp__pqstudio__/, '')]
      if (name.startsWith('mcp__pqstudio__') && studio) {
        const n = Array.isArray(input.commands) ? input.commands.length : 0
        return { status: studio[0], activity: name.endsWith('editar_timeline') && n ? `${studio[1]} (${n} ${n === 1 ? 'mudança' : 'mudanças'})` : studio[1] }
      }
      return { status: `Usando ${name}...`, activity: name }
    }
  }
}

/** Ferramentas do editor (servidor MCP do estúdio): [status enquanto roda, linha de atividade]. */
const STUDIO_TOOLS: Record<string, [string, string]> = {
  estado_projeto: ['Olhando a timeline...', 'Leu a timeline'],
  catalogo: ['Vendo efeitos e assets disponíveis...', 'Consultou o catálogo'],
  editar_timeline: ['Editando a timeline...', 'Editou a timeline'],
  desfazer: ['Desfazendo...', 'Desfez a última edição'],
  analisar_midia: ['Analisando a mídia...', 'Analisou a mídia'],
  melhores_momentos: ['Procurando os melhores momentos...', 'Encontrou os melhores momentos'],
  auto_studio: ['Montando a edição automática...', 'Montou a edição (Auto Studio)'],
  usar_asset: ['Aplicando asset do Asset Hub...', 'Usou um asset do Asset Hub'],
  transcrever: ['Transcrevendo a fala...', 'Transcreveu a fala'],
  legendas_na_timeline: ['Colocando legendas...', 'Pôs as legendas na timeline'],
  gerar_versao: ['Renderizando a versão...', 'Gerou uma nova versão'],
  estilos: ['Vendo os estilos salvos...', 'Consultou os estilos'],
  verificar_qualidade: ['Verificando a qualidade...', 'Fez o Quality Check'],
  aprender_estilo: ['Aprendendo o estilo da edição...', 'Salvou o estilo da edição'],
  aplicar_estilo: ['Aplicando o estilo...', 'Aplicou um estilo salvo']
}
