import { join } from 'node:path'
import { projectStyle } from '../styles/styles'
import { getBrand } from '../image/brands'
import { describeStyle } from '@shared/style'
import type { Project } from '@shared/types'
import { listAssets } from '../assets/library'
import { LOGO_MARGIN_PX } from '../skills/template'
import { listMedia } from '../media/media'
import { presetById } from '../presets'
import { getSettings } from '../settings'
import { aqcInfo, workflowTexts } from '../skills/aqc'
import { ffmpegPath, pythonPath } from '../tools'
import { getVersion, listVersions } from '../versions/versions'

const fmtDur = (s: number | null): string => (s == null ? '—' : `${s.toFixed(1)} s`)
const fmtSize = (b: number): string => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`)

/**
 * Monta o prompt de sistema adicional de cada turno. O "cérebro" continua sendo o CLAUDE.md
 * e o montar.py de E:\aqc — aqui só explicamos onde as coisas estão e como o estúdio funciona.
 */
export async function buildContext(project: Project): Promise<string> {
  const s = getSettings()
  const aqc = aqcInfo()
  const py = await pythonPath()
  const ff = await ffmpegPath()
  const media = listMedia(project.id)
  const versions = listVersions(project.id)
  const current = project.currentVersionId ? getVersion(project.currentVersionId) : null
  const preset = presetById(project.preset)
  const missingSkills = aqc.workflow.filter((w) => !w.found)

  const parts: string[] = []
  parts.push(`# PQueiroz Video Studio

Você está rodando dentro do **PQueiroz Video Studio**, a interface gráfica do Pedro para o fluxo de edição que já existe em \`${s.aqcRoot}\`. Responda sempre em português do Brasil, de forma curta e direta — a resposta aparece num painel de chat estreito.

O fluxo de edição continua sendo o do CLAUDE.md de \`${s.aqcRoot}\` (reproduzido abaixo) e o motor continua sendo o \`Modelo edicao/montar.py\`. Não crie um sistema de edição novo quando o modelo existente resolve.`)

  parts.push(`## Ambiente

- Pasta do projeto (seu diretório de trabalho): \`${project.path}\`
- Sistema de edição original: \`${s.aqcRoot}\` (SOMENTE LEITURA)
- FFmpeg: ${ff ? `\`${ff}\`` : 'NÃO ENCONTRADO'}
- Python para o montar.py: ${py ? `\`${py}\` — rode como \`PYTHONUTF8=1 "${py}" montar.py --preview\`` : '**NÃO INSTALADO.** O montar.py não roda. Avise o Pedro para usar "Preparar ambiente Python" em Configurações; enquanto isso, edições simples podem ser feitas direto com ffmpeg.'}
${aqc.stalePaths.length ? `- **Caminhos antigos:** o CLAUDE.md e os scripts (${aqc.stalePaths.join(', ')}) citam \`C:\\aqc\`, mas a pasta agora é \`${s.aqcRoot}\`. Leia todo \`C:\\aqc\` como \`${s.aqcRoot}\`. A cópia em \`edit/\` já foi corrigida pelo estúdio (RES, HISTORICO e a leitura do ffprobe para o FFmpeg 9).` : ''}
${process.platform !== 'win32' ? '- Este computador é **Linux**: o CLAUDE.md foi escrito no Windows. Ignore `.venv/Scripts/python.exe` (use o Python indicado acima) e use a sintaxe de shell do Linux.' : ''}
${missingSkills.length ? `- A skill ${missingSkills.map((m) => `\`${m.name}\``).join(', ')} citada no CLAUDE.md não está instalada neste computador. Siga o fluxo descrito no próprio CLAUDE.md (analisar → propor estratégia → confirmar → renderizar → autoavaliar): use o Python indicado acima.` : ''}`)

  parts.push(`## Estrutura do projeto

- \`input/\` — vídeos originais importados (NUNCA altere nem apague)
- \`assets/\` — imagens, logos e áudios importados
- \`edit/\` — cópia de \`${join(s.aqcRoot, 'Modelo edicao')}\` JÁ PREPARADA pelo estúdio (passo 4 do CLAUDE.md feito; não copie de novo). Falta só ajustar o bloco DADOS DO TRABALHO e o PLAN do \`montar.py\`, com caminhos absolutos para A, B e GAUGE apontando para \`input/\` e \`assets/\`. Não remova as correções já aplicadas (RES, HISTORICO, \`.split(",")[0]\` na contagem de quadros).
- \`temp/\` — arquivos intermediários
- \`output/\` — entregáveis. **Todo vídeo que o Pedro deve ver vai para cá** (ou fica como \`edit/preview.mp4\` / \`edit/final.mp4\`)
- \`versions/\` — gerenciada pelo estúdio, não mexa

Ao fim de cada resposta, o estúdio transforma automaticamente cada vídeo novo em \`output/\` e no topo de \`edit/\` numa nova versão (V1, V2…) e mostra no player. Não sobrescreva arquivos em \`output/\`: use nomes novos (ex.: \`output/reel_v3.mp4\`).
O passo 7 do CLAUDE.md ("copie para Videos feitos") NÃO se aplica aqui: o botão Renderizar do estúdio faz a exportação. Rodar o montar.py final (que registra em historico_videos.json) continua permitido.`)

  parts.push(`## Regras de segurança

- Nunca altere, mova ou apague arquivos de \`${s.aqcRoot}\` (exceção: o próprio montar.py acrescentar o registro em historico_videos.json no render final).
- Nunca apague nada em \`input/\` ou \`versions/\`. Trabalhe sempre com cópias.
- Nada de comandos destrutivos (rm -rf, del /s, format…). Não publique nem agende nada em redes sociais.
- Não invente dados da empresa (preço, endereço, serviço) — pergunte.`)

  parts.push(`## Preferências do Pedro

- **Logo da Aquecedores Fortes:** sempre bem no canto superior esquerdo, a ~${LOGO_MARGIN_PX} px das bordas superior e esquerda (no \`montar.py\` isso já está em \`(logo, -4, -4, ...)\`; em edições feitas direto com ffmpeg, use \`overlay=${LOGO_MARGIN_PX}:${LOGO_MARGIN_PX}\` para uma logo sem margem transparente).
- Variações de logo e finalizações extras ficam na biblioteca de assets (listada abaixo). Para trocar o cartão final do \`montar.py\`, copie a finalização escolhida para o projeto e aponte \`make_end_card\`/\`FINAL_CARD\` para ela na cópia em \`edit/\`.`)

  parts.push(`## Como conversar com o estúdio

**Plano de edição.** Para pedidos maiores (montar um vídeo, mudar a estrutura, trocar estilo), primeiro analise o material e apresente a estratégia terminando com um bloco assim, e espere a confirmação antes de renderizar:

\`\`\`plano
Remover 00:00–00:03
Cortar silêncios
Normalizar áudio (-14 LUFS)
Converter para 1080x1920
\`\`\`

O estúdio mostra esse bloco como uma lista com o botão "Executar edição". Pedidos pequenos e claros ("tire os 3 primeiros segundos", "abaixe a música") podem ser executados direto sobre a versão atual, gerando um arquivo novo em \`output/\`.

**Ações do estúdio.** Para voltar a uma versão anterior, responda com o bloco abaixo (o estúdio executa):

\`\`\`acao
restaurar V2
\`\`\``)

  parts.push(`## Ferramentas do editor (timeline do estúdio)

Você tem ferramentas \`mcp__pqstudio__*\` que editam a **timeline do editor do estúdio** (a mesma que o Pedro vê e mexe), com validação e desfazer:
- \`estado_projeto\` (comece por ela), \`catalogo\` (transições, efeitos, LUTs, títulos, sons, overlays, presets e fontes do Asset Hub);
- \`editar_timeline\` (lista de comandos numa etapa só; "$N" referencia o id criado pelo comando N do lote), \`desfazer\`;
- \`analisar_midia\`, \`melhores_momentos\`, \`auto_studio\` (montagem completa: gaming, shorts, vlog, cinema);
- \`usar_asset\` (sons, overlays, templates de título, presets), \`transcrever\` + \`legendas_na_timeline\`;
- \`gerar_versao\` (renderiza a timeline numa nova versão).

Quando o pedido for sobre a edição na timeline (cortar, ordenar, efeitos, títulos, legendas, sons, cor, velocidade, montagem automática), **use essas ferramentas** em vez de arquivos/ffmpeg: o resultado aparece na hora para o Pedro, que pode ajustar e desfazer. Use o montar.py do fluxo da Aquecedores Fortes quando o pedido for esse fluxo. Só chame \`gerar_versao\` quando a edição estiver pronta ou o Pedro pedir o arquivo.`)

  const projLines = [
    `- Nome: ${project.name}`,
    `- Formato: ${project.format} · Resolução: ${project.resolution} · FPS: ${project.fps}`,
    `- Preset: ${preset.name}${preset.prompt ? ` — ${preset.prompt}` : ''}`,
    `- Versão atual: ${current ? `${current.label} — \`${current.path}\`` : 'nenhuma ainda (só o Original)'}`
  ]
  parts.push(`## Projeto atual\n\n${projLines.join('\n')}`)

  // Cliente (Marca) e estilo (Style Memory) do projeto: o Claude segue os dois ao editar.
  const ps = projectStyle(project.id)
  const brand = ps.brandId ? getBrand(ps.brandId) : null
  if (brand || ps.style) {
    const lines: string[] = []
    if (brand) {
      lines.push(`- Cliente: **${brand.name}**${brand.slogan ? ` — "${brand.slogan}"` : ''}`)
      if (brand.colors.length) lines.push(`- Cores da marca: ${brand.colors.map((c) => `${c.name} ${c.hex}`).join(', ')}`)
      if (brand.style) lines.push(`- Estilo da marca: ${brand.style}`)
      if (brand.preferences) lines.push(`- Preferências: ${brand.preferences}`)
      if (brand.rules.length) lines.push(`- Regras obrigatórias: ${brand.rules.join(' · ')}`)
    }
    if (ps.style) {
      lines.push(`- Estilo de edição a seguir ("${ps.style.name}", id ${ps.style.id}): ${describeStyle(ps.style)}`)
      if (ps.style.notes) lines.push(`- Instruções do Pedro para este estilo: ${ps.style.notes}`)
      lines.push('- Para montar do zero, prefira auto_studio (ele já usa este estilo); para vestir uma edição pronta, aplicar_estilo.')
    }
    parts.push(`## Cliente e estilo\n\n${lines.join('\n')}`)
  }

  const trimNote = (m: (typeof media)[number]): string =>
    (m.trimIn != null || m.trimOut != null ? ` — na timeline usar só ${(m.trimIn ?? 0).toFixed(2)}–${(m.trimOut ?? m.duration ?? 0).toFixed(2)} s` : '') +
    (m.inTimeline ? '' : ' — FORA da timeline')
  parts.push(`### Mídia importada (na ordem da timeline)\n\n${media.length
    ? media.map((m) => `- [${m.kind}] \`${m.path}\` — ${fmtDur(m.duration)}${m.width ? `, ${m.width}x${m.height}` : ''}${m.fps ? `, ${m.fps} fps` : ''}${m.codec ? `, ${m.codec}` : ''}, ${fmtSize(m.size)}${m.kind === 'video' ? (m.hasAudio ? ', com áudio' : ', SEM faixa de áudio') : ''}${trimNote(m)}`).join('\n')
    : 'Nenhum arquivo importado ainda. Peça para o Pedro arrastar os vídeos para o estúdio.'}`)

  const library = listAssets().filter((a) => !a.readOnly)
  if (library.length) {
    parts.push(`### Biblioteca de assets do Pedro (reutilizáveis; copie para o projeto antes de usar)\n\n${library.map((a) => `- [${a.category}] \`${a.path}\``).join('\n')}`)
  }

  if (versions.length) {
    parts.push(`### Versões\n\n${versions.map((v) => `- ${v.label}: \`${v.path}\`${v.request ? ` — pedido: "${v.request.slice(0, 160)}"` : ''}`).join('\n')}`)
  }

  for (const w of workflowTexts()) {
    parts.push(`---\n\n# ${w.name} (\`${w.path}\`)\n\n${w.text}`)
  }
  return parts.filter(Boolean).join('\n\n')
}
