import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@shared/types'
import { formatById, safeAreaFor, styleById } from '@shared/image'
import { describeDoc } from '@shared/imageDoc'
import { BUNDLED_FONTS, fontFromFile, SYSTEM_FONTS } from '@shared/fonts'
import BUNDLED_STYLE from '../../../IMAGE_STUDIO_STYLE.md?raw'
import { listAssets } from '../assets/library'
import { projectPath } from '../projects/projects'
import { getSettings } from '../settings'
import { listVersions } from '../versions/versions'
import { getBrand } from './brands'
import { imageInfo, readDesign } from './imageProjects'
import { listProviders } from './providers'

/** O Pedro pode personalizar a direção de arte salvando um IMAGE_STUDIO_STYLE.md na biblioteca. */
export function styleGuide(): { text: string; path: string | null } {
  const custom = join(getSettings().assetsRoot, 'IMAGE_STUDIO_STYLE.md')
  if (existsSync(custom)) {
    try {
      return { text: readFileSync(custom, 'utf8'), path: custom }
    } catch {
      /* usa o padrão */
    }
  }
  return { text: BUNDLED_STYLE, path: null }
}

export function availableFonts(): { family: string; weights: number[] }[] {
  const map = new Map<string, Set<number>>()
  for (const a of listAssets().filter((x) => x.category === 'fontes')) {
    const f = fontFromFile(a.path)
    map.set(f.family, (map.get(f.family) ?? new Set()).add(f.weight))
  }
  for (const s of BUNDLED_FONTS) if (!map.has(s)) map.set(s, new Set([400]))
  for (const s of SYSTEM_FONTS) if (!map.has(s)) map.set(s, new Set([400, 700]))
  return [...map].map(([family, w]) => ({ family, weights: [...w].sort() }))
}

const SCHEMA = `## Formato do design.json

\`\`\`ts
{
  version: 1, width: number, height: number, formatId: "ig-feed"|"ig-story"|"ig-square"|"tiktok"|"yt-thumb"|"full-hd"|"custom",
  background: Fill,
  layers: Layer[],            // ordem = da mais ao fundo para a mais à frente
  meta: { brandId, templateId, style, title }
}
Fill = { type: "solid", color: "#RRGGBB" }
     | { type: "linear", angle: graus (0 = de baixo p/ cima, 90 = esq→dir, 180 = de cima p/ baixo), stops: [{ offset: 0..1, color }] }
     | { type: "radial", cx: 0..1, cy: 0..1, r: 0..1.5 (relativo ao maior lado), stops: [...] }
Comum a toda camada: id (único), name, role: "background"|"subject"|"logo"|"text"|"decor",
  x, y, w, h (px, canto superior esquerdo), rotation (graus), opacity 0..1, visible, locked,
  shadow: { color: "rgba(0,0,0,0.45)", blur, x, y } | null, blend: "normal"|"multiply"|"screen"|"overlay"|"soft-light"|"lighter"
image:  { type: "image", src: caminho absoluto, fit: "cover"|"contain"|"fill", focusX/focusY 0..1 (recorte inteligente do cover),
          radius, stroke: { color, width } | null, flipX, brightness/contrast/saturation (1 = original), logoId }
text:   { type: "text", text ("\\n" quebra linha), font (família), weight 100..900, italic, size (px), fill: Fill,
          align: "left"|"center"|"right", vAlign: "top"|"middle"|"bottom", lineHeight (ex.: 1.05), letterSpacing (px),
          uppercase, stroke: { color, width } | null, autoFit (reduz a fonte até caber na caixa),
          background: { fill, padding, radius } | null  (faixa/pílula atrás do texto) }
shape:  { type: "shape", shape: "rect"|"ellipse"|"burst"|"triangle"|"line"|"blob", fill, stroke, radius (cantos do rect),
          points (pontas do burst), innerRatio (0..1, profundidade das pontas) }
effect: { type: "effect", effect: "rays"|"bokeh"|"confetti"|"sparkles"|"vignette"|"grain"|"glow", colors: [cores], seed, density 0..1 }
\`\`\`

- Camadas \`role: "logo"\` são SEMPRE \`type: "image"\` apontando para um arquivo de logo da marca, com \`fit: "contain"\` e **w/h na proporção exata do arquivo** (largura ÷ altura informadas abaixo).
- Fundo gerado por IA: camada image \`role: "background"\`, \`x: 0, y: 0, w: width, h: height, fit: "cover"\`.
- Textos legíveis: em fundos movimentados use \`shadow\` (ex.: blur 24, y 6, rgba(0,0,0,0.5)), \`stroke\` ou \`background\`.
- O editor do Pedro mostra exatamente o que está no arquivo (Canvas), então coordenadas importam: confira que nada essencial sai da área segura.`

export async function buildImageContext(project: Project): Promise<string> {
  const info = imageInfo(project.id)
  const doc = readDesign(project.id)
  const brand = getBrand(info.brandId)
  const format = formatById(doc.formatId)
  const safe = safeAreaFor(doc)
  const style = styleById(info.style)
  const providers = listProviders()
  const active = providers.find((p) => p.id === info.provider) ?? providers[0]
  const ready = providers.filter((p) => p.ready && p.id !== 'composition')
  const versions = listVersions(project.id)
  const generatedDir = projectPath(project, 'assets', 'gerado')
  const generated = existsSync(generatedDir) ? readdirSync(generatedDir).map((f) => join(generatedDir, f)) : []
  const preview = projectPath(project, 'temp', 'preview.png')
  const guide = styleGuide()

  const parts: string[] = []
  parts.push(`# PQueiroz Video Studio — Image Studio

Você está no **Image Studio** do PQueiroz Video Studio, criando artes publicitárias com o Pedro. A resposta aparece num painel de chat estreito: seja curto e direto (máximo ~8 linhas de texto fora dos blocos).

**Você não gera imagens.** Você é o diretor de arte: interpreta o pedido, escreve o prompt visual, e monta/edita a composição em camadas no \`design.json\`. Quem desenha cenários e mascotes é o provedor de geração configurado pelo Pedro (quando houver). Textos e logo são sempre camadas reais por cima — nunca parte da imagem gerada.`)

  parts.push(`## Arquivos

- Composição de trabalho (edite este arquivo com Read/Edit/Write): \`${projectPath(project, 'design.json')}\`
- Prévia renderizada da arte atual (abra com Read para VER a arte antes de opinar ou ajustar): \`${preview}\`${existsSync(preview) ? '' : ' (ainda não existe)'}
- Variações: para "crie N variações", grave cada uma como documento completo em \`${projectPath(project, 'variacoes')}\\<nome>.json\` (ex.: \`variacao-1.json\`) — cada arquivo vira uma versão (V…) automaticamente, sem mexer no design.json.
- Imagens geradas: \`${generatedDir}\`${generated.length ? `\n${generated.map((g) => `  - \`${g}\``).join('\n')}` : ' (nenhuma ainda)'}
- **Não** altere \`versions/\`, \`input/\`, \`assets/\` nem arquivos fora do projeto. Não apague nada. Não use shell: você só tem ferramentas de arquivo.
- Ao terminar, o estúdio valida o design.json (JSON inválido é descartado e a composição anterior volta), renderiza e salva uma nova versão automaticamente.
- **Preserve o resto:** em pedidos pontuais ("diminui o texto", "troca só o título") edite só as propriedades pedidas com Edit, mantendo ids, posições e demais camadas.`)

  parts.push(`## Projeto

- Nome: ${project.name}
- Formato: ${format.label} — ${doc.width}x${doc.height} px. Área segura (não pôr texto/logo fora): topo ${safe.top}px, direita ${safe.right}px, base ${safe.bottom}px, esquerda ${safe.left}px.${format.note ? ` ${format.note}` : ''}
- Estilo escolhido: **${style.name}** — ${style.description}
- Pedido original: ${info.originalPrompt ? `"${info.originalPrompt}"` : '(nenhum)'}

### Composição atual
${describeDoc(doc)}`)

  if (brand) {
    const logos = brand.logos.map((l) => `- ${l.name} [${l.variant}${l.id === brand.defaultLogoId ? ', padrão' : ''}] id=${l.id} — \`${l.path}\` — ${l.width}x${l.height} (proporção ${(l.width / Math.max(1, l.height)).toFixed(4)})`)
    parts.push(`## Marca: ${brand.name}

- Paleta: ${brand.colors.map((c) => `${c.name} ${c.hex}`).join(' · ') || '(não cadastrada)'}
- Fontes: título ${brand.fonts.heading}, texto ${brand.fonts.body}
- Slogan oficial: ${brand.slogan ? `"${brand.slogan}"` : 'NENHUM cadastrado — não invente slogan.'}
- Estilo: ${brand.style || '—'}
- Preferências: ${brand.preferences || '—'}
- Margem livre ao redor da logo: ${Math.round(brand.logoMargin * Math.min(doc.width, doc.height))} px nesta arte.

**Regras obrigatórias da marca:**
${brand.rules.map((r) => `- ${r}`).join('\n') || '- (nenhuma)'}

**Logos oficiais (únicos arquivos permitidos para a logo):**
${logos.join('\n') || '- NENHUMA LOGO IMPORTADA. Não crie logo: avise o Pedro para importar a logo em Biblioteca › Marcas e deixe o espaço reservado.'}
${brand.assets.length ? `\nAssets da marca:\n${brand.assets.map((a) => `- \`${a}\``).join('\n')}` : ''}`)
  } else {
    parts.push('## Marca\n\nNenhuma marca associada. Não invente nome, logo ou slogan de empresa.')
  }

  parts.push(`## Geração de imagens

- Provedor escolhido pelo Pedro: **${active.name}** — ${active.ready ? 'pronto' : `NÃO configurado (${active.setupHint})`}. ${active.costNote}
- Provedores prontos para gerar: ${ready.length ? ready.map((p) => `${p.name}${p.paid ? ' (pago)' : ''}`).join(', ') : 'nenhum'}.
${(active.id === 'composition' || !active.ready) && ready.length
    ? `- O projeto está em composição gratuita, mas há gerador pronto (${ready.map((p) => p.name).join(', ')}). Monte a composição e proponha o bloco abaixo para o cenário ou o mascote: o cartão deixa o Pedro escolher o provedor e mostra se é pago.`
    : active.id === 'composition' || !active.ready
    ? `- **Modo composição gratuita:** monte a arte só com gradientes, formas, efeitos, fotos/imagens já existentes e a logo. Diga ao Pedro, uma vez e de forma curta, que mascotes 3D e cenários realistas exigem um provedor de geração (configurável em Configurações › Geração de imagens, alguns pagos). Mesmo assim você pode propor o bloco gerar-imagem abaixo para quando ele configurar.`
    : '- Para pedir um cenário ou mascote, inclua o bloco abaixo. O estúdio mostra um cartão com o custo e o Pedro clica para gerar (nunca é automático). Depois de gerada, a imagem entra como camada e você poderá ajustá-la no próximo pedido.'}

\`\`\`gerar-imagem
{"papel": "background", "prompt": "prompt visual detalhado em inglês ... ${style.prompt.slice(0, 80)}..., no text, no letters, no logos, no watermark", "negativo": "${style.negative.slice(0, 80)}..."}
\`\`\`

- \`papel\`: "background" (cenário que cobre a arte inteira, deixe espaço livre onde ficarão título e logo) ou "subject" (mascote/objeto isolado em fundo branco — o estúdio pode remover o fundo).
- Base de estilo do preset escolhido (inclua no prompt): ${style.prompt}
- Negativo do preset: ${style.negative}
- **Quando uma mudança exigir regenerar a imagem** (ex.: mudar a pose do mascote, trocar o cenário, mudar elementos desenhados na imagem), diga isso claramente ao Pedro e proponha o bloco — não finja que editou a imagem.`)

  parts.push(`## Blocos que o estúdio entende

Comece pedidos de criação com um briefing curto:

\`\`\`briefing
Marca: Aquecedores Fortes
Objetivo: homenagem ao Dia dos Professores
Público: clientes e seguidores locais
Formato: Instagram Feed 1080x1350
Estilo: Premium Advertising 3D
\`\`\`

Para voltar a uma versão anterior (o estúdio restaura o design.json daquela versão):

\`\`\`acao
restaurar V2
\`\`\``)

  parts.push(`## Fontes disponíveis
${availableFonts().map((f) => `- ${f.family} (${f.weights.join(', ')})`).join('\n')}

Use apenas estas famílias e pesos existentes (ex.: Poppins 900 = Poppins Black).`)

  parts.push(SCHEMA)

  if (versions.length) {
    parts.push(`## Versões\n\n${versions.map((v) => `- ${v.label}${v.id === project.currentVersionId ? ' (atual)' : ''}: ${v.request ? `"${v.request.slice(0, 120)}"` : ''}`).join('\n')}`)
  }

  parts.push(`---\n\n${guide.text}`)
  return parts.join('\n\n')
}
