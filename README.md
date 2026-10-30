<div align="center">

<img src="build/icon.png" width="128" alt="Ícone do PQueiroz Video Studio: um quadro de filme com play, em roxo">

# PQueiroz Video Studio

**Edição de vídeo conversando com o Claude.**<br>
Importe os clipes, peça a edição em português e acompanhe cada versão, do preview ao render.

[![Versão](https://img.shields.io/github/v/release/PQueirozDev/PQueiroz-Video-Studio?label=vers%C3%A3o&color=8b5cf6&style=flat-square)](https://github.com/PQueirozDev/PQueiroz-Video-Studio/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/PQueirozDev/PQueiroz-Video-Studio/total?label=downloads&color=60a5fa&style=flat-square)](https://github.com/PQueirozDev/PQueiroz-Video-Studio/releases)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4?style=flat-square&logo=windows)](https://github.com/PQueirozDev/PQueiroz-Video-Studio/releases/latest/download/PQueiroz-Video-Studio-Setup.exe)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-6b7280?style=flat-square)](LICENSE)

[**⬇ Baixar para Windows**](https://github.com/PQueirozDev/PQueiroz-Video-Studio/releases/latest/download/PQueiroz-Video-Studio-Setup.exe) ·
[**⬇ Linux (.AppImage)**](https://github.com/PQueirozDev/PQueiroz-Video-Studio/releases/latest/download/PQueiroz-Video-Studio.AppImage) ·
[Linux (.deb)](https://github.com/PQueirozDev/PQueiroz-Video-Studio/releases/latest/download/PQueiroz-Video-Studio.deb) ·
[Site](https://pqueirozdev.github.io/PQueiroz-Video-Studio) ·
[Novidades](https://github.com/PQueirozDev/PQueiroz-Video-Studio/releases)

<br>

<img src="docs/screenshots/workspace.png" alt="Tela do projeto: lista de projetos, preview da versão V2, chat com o Claude mostrando um plano de edição e a biblioteca de mídia" width="100%">

</div>

<br>

O Video Studio é a interface gráfica de um fluxo de edição que já funciona no terminal: o
**Claude Code** lê as regras do seu `CLAUDE.md`, usa os seus scripts (FFmpeg, Python) e entrega o vídeo.
O app organiza projetos, mostra o que o Claude está fazendo, guarda cada resultado como uma versão
e renderiza o final. Tudo roda no seu PC, com a sua assinatura do Claude e sem API key.

## Telas

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/timeline.png" alt="Timeline"><p align="center"><b>Timeline</b> · aparar com I/O, reordenar e montar uma versão</p></td>
    <td width="50%"><img src="docs/screenshots/versoes.png" alt="Versões"><p align="center"><b>Versões</b> · V1, V2… com o pedido de cada uma; o original nunca muda</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/uso-claude.png" alt="Uso do Claude"><p align="center"><b>Uso do Claude</b> · janelas de 5 h e da semana, ao vivo</p></td>
    <td><img src="docs/screenshots/fila-render.png" alt="Fila de render"><p align="center"><b>Render</b> · fila com progresso real, GPU com fallback para CPU</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/dashboard.png" alt="Dashboard"><p align="center"><b>Projetos</b> · miniatura, duração, status e última modificação</p></td>
    <td><img src="docs/screenshots/comandos.png" alt="Command Center"><p align="center"><b>Ctrl K</b> · comandos, projetos e versões pelo teclado</p></td>
  </tr>
</table>

## Como funciona

```
Você ──► chat do Video Studio ──► Claude Code (sua assinatura)
                                     │  lê CLAUDE.md, instruções e skills do seu fluxo
                                     ▼
                          scripts do fluxo (montar.py, FFmpeg)
                                     ▼
            output/ ──► nova versão (V1, V2…) ──► preview ──► render
```

- **Chat com plano de edição.** Para pedidos grandes o Claude propõe um plano; o botão *Executar edição* aprova.
- **Status ao vivo.** "Analisando os vídeos...", "Processando áudio...", "Renderizando prévia..." a partir das ferramentas que o Claude usa.
- **Versões automáticas.** Todo vídeo novo em `output/` vira uma versão imutável, com o pedido e o resumo do Claude. Visualizar, restaurar e duplicar.
- **Uso do Claude na barra de título**, como no [Qyrex](https://github.com/PQueirozDev/Qyrex): lido com `claude -p /usage` (não gasta uso) e atualizado pelos eventos de limite do próprio chat.
- **Timeline** com cortes não destrutivos (I/O), trilha de áudio e *Montar timeline*.
- **Presets** (Reel rápido, Reel profissional, Story, YouTube, Antes e Depois…) e presets próprios com instruções para o Claude.
- **Compartilhar presets:** exporte um `.pqpreset` com o seu sistema de edição (CLAUDE.md, Modelo edicao, skills de vídeo do Claude e, se quiser, as músicas) e importe em outro computador — por arquivo, por link ou pela galeria de [presets da comunidade](presets/).
- **Biblioteca de assets** compartilhada: logos, músicas, fontes, overlays, intros e finalizações.
- **Proxies** 540p automáticos para vídeos 4K, HEVC ou pesados (só no preview).
- **Render** em MP4/MOV, 1080p a 4K, NVENC com fallback para CPU, fila sem travar a interface.
- **Atualização automática** pelo GitHub Releases.

## Ferramentas de edição e revisão

- **Histórico da timeline:** desfazer com Ctrl+Z e refazer com Ctrl+Shift+Z ou Ctrl+Y. Cortes, ordem e retirada de clipes têm histórico salvo por projeto; importar ou excluir mídia inicia um novo histórico.
- **Trechos no chat:** marque início e fim no player e clique em *Pedir alteração*. O pedido inclui o vídeo escolhido e os tempos no arquivo de origem. Use *Limpar seleção* para voltar a pedidos gerais.
- **Timeline visual:** régua de tempo, zoom e formas de onda do áudio, analisadas em segundo plano com cache e no máximo dois processos simultâneos.
- **Comparação:** escolha os vídeos A e B, incluindo quaisquer duas versões. A reprodução segue o mesmo tempo e termina no limite do vídeo mais curto; apenas A reproduz áudio. Marque versões favoritas com a estrela.
- **Legendas:** na aba *Legendas*, gere com Claude, importe SRT ou escreva manualmente. Revise texto, tempos, tamanho, cor e posição; salve para manter as alterações. A geração depende de uma ferramenta de transcrição disponível no ambiente do Claude; o app não instala transcritores automaticamente. SRTs gerados são carregados ao término do pedido e também pelo botão *Carregar geradas*.
- **Exportação:** marque *Gravar as legendas salvas no vídeo* para incluir as legendas da origem escolhida. A fila informa tempo restante e tamanho estimados durante o render, mostra quando a GPU falha e permite tentar novamente após erro ou cancelamento. A gravação de legendas requer FFmpeg com o filtro ASS/libass.

## Editor profissional (Ultimate)

A aba *Timeline* é um editor completo; tudo nele é não destrutivo, passa por comandos validados (com desfazer) e é renderizado por um único grafo do FFmpeg com NVENC.

- **Timeline multitrilha:** arrastar, aparar, dividir (S), slip (Alt+arrastar), agrupar (Ctrl+G), ripple, snap, trilhas ocultas/mudas/bloqueadas e modos de mesclagem (tela, adição, multiplicar…).
- **Inspetor:** enquadramento e zoom com keyframes, velocidade (0,1× a 8×), speed ramp, freeze frame, transições, efeitos, curvas (editor gráfico), máscaras, correspondência de cor automática e títulos.
- **Prévias:** prévia rápida em tempo real, prévia exata (motor do export) e comparação antes/depois; medidores de áudio L/R.
- **Asset Hub:** pacotes `.pqs-pack` com 15 fontes do Google Fonts (OFL), 20 títulos, 20 sons, 10 overlays, LUTs e 25 presets de movimento e cor (portados do HL_PACK). 33 transições e 27 efeitos de imagem.
- **Auto Studio:** escolha vídeos, música e estilo (gaming, shorts, vlog, cinema) e o app monta a edição sozinho, com cortes na batida.
- **Style Memory:** aprende o jeito de uma edição (look, títulos, legendas, ritmo, volumes) e aplica em outros projetos; cada projeto tem cliente (Marca) e estilo, seguidos pelo Auto Studio e pelo Claude.
- **Claude com ferramentas do estúdio:** o chat edita esta mesma timeline por um servidor MCP local (estado, edição em lote, Asset Hub, Auto Studio, transcrição e legendas, estilos, Quality Check, gerar versão).
- **Quality Check:** tela preta, piscadas, texto pequeno, rápido ou fora da área segura do destino, fontes/LUTs ausentes, volume; com *Corrigir*. No arquivo: loudness, pico, pretos, silêncios, imagem parada, proporção, tamanho e duração.
- **Exportação por destino:** YouTube 1080p/4K, Shorts/Reels/TikTok (fundo desfocado para vídeo horizontal), Instagram 4:5, quadrado, WhatsApp (cabe em 16 MB) e master MOV; vários destinos de uma vez, com Quality Check automático ao terminar.
- **Tour e atalhos:** tour guiado na primeira abertura (de novo pela paleta, Ctrl+K) e `?` para a lista de atalhos.

Detalhes, decisões e licenças: [`docs/ULTIMATE.md`](docs/ULTIMATE.md).

## Image Studio

Aba para artes publicitárias (posts, Stories, capas, miniaturas), com o Claude como **diretor de arte**.

- **Pedido em linguagem natural** ("Crie uma arte de Dia dos Professores para a Aquecedores Fortes, com um aquecedor animado usando beca…"): o Claude monta o briefing (marca, objetivo, público, formato, estilo), compõe a arte em camadas no `design.json` do projeto e escreve o prompt visual do cenário.
- **Motor híbrido:** o cenário/mascote vem de um gerador de imagens; textos são camadas com fontes reais e a logo é o **arquivo original** da marca, por cima. Nada de letras tortas ou logo inventada.
- **O Claude Code não gera imagens.** A geração usa um provedor configurado em *Configurações › Geração de imagens*: OpenAI (GPT Image) e Google Gemini são **pagos na conta do provedor** (a assinatura do Claude não inclui imagens); Stable Diffusion local (AUTOMATIC1111/Forge) e Pollinations (serviço público, desativado por padrão) são gratuitos. Cada geração mostra o custo e só acontece no clique; só o prompt de texto sai do computador.
- **Composição gratuita:** sem gerador, a arte é montada com gradientes, formas, efeitos (raios de luz, bokeh, confete, brilhos, vinheta) e as suas imagens — não equivale a um modelo generativo.
- **Editor:** arrastar, redimensionar e girar com encaixe magnético e guias da área segura de cada rede; camadas; texto com fonte, peso, cor/gradiente, contorno, sombra e faixa; recorte inteligente (foco) e remoção de fundo liso; alinhamento; desfazer/refazer; salvamento automático.
- **Marcas:** gerenciador com logos (importadas de PDF, PNG ou JPG — do PDF são extraídas as imagens originais, sem redesenhar), paleta, fontes, estilo, slogan, regras e margem da logo. A **Aquecedores Fortes** vem cadastrada com as regras da identidade.
- **Formatos:** Feed 1080×1350, Stories e TikTok 1080×1920, Quadrado 1080×1080, YouTube 1280×720, Full HD e personalizado; exporta PNG, JPG e WebP em 1× ou 2×. Trocar de formato reposiciona tudo dentro da área segura.
- **Templates** (datas comemorativas, promoções, descontos, serviços, anúncios, Stories, capas de Reels, miniaturas, antes e depois, comunicados) com textos editáveis, para qualquer marca e formato.
- **Versões** V1, V2, V3… (composição + PNG) a cada pedido, geração, exportação ou *Salvar versão* (Ctrl+S); comparar lado a lado e restaurar sem perder nada.
- **Enviar para Video Studio:** a arte vira um clipe MP4 animado (zoom no fundo, mascote flutuando, textos entrando, trilha da biblioteca) dentro de um projeto de vídeo.
- **Direção de arte permanente** em [`IMAGE_STUDIO_STYLE.md`](IMAGE_STUDIO_STYLE.md). Para personalizar sem recompilar, salve uma cópia editada na raiz da biblioteca de assets.

## Segurança

- As chaves de API do Image Studio ficam criptografadas pelo sistema (`safeStorage`), só no processo principal; a interface nunca as recebe. No Image Studio o Claude só tem ferramentas de arquivo (sem shell), e todo `design.json` que ele escreve é validado (caminhos de imagem só das pastas do estúdio).
- Os arquivos originais nunca são alterados: a importação copia, e nada é sobrescrito (nomes repetidos ganham ` (2)`).
- A pasta do fluxo original é somente leitura. Correções necessárias (caminhos antigos, FFmpeg 9) são aplicadas **na cópia** de cada projeto.
- Processos rodam com `spawn`, argumentos em lista e sem shell. Comandos destrutivos (`rm -rf`, `del`, `Remove-Item`…) ficam bloqueados para o Claude.
- `contextIsolation`, CSP restritiva e um protocolo de mídia que só serve arquivos das pastas do estúdio.

## Requisitos

- Windows 10/11 (x64) ou Linux x64 (AppImage ou .deb para Ubuntu/Debian)
- [Claude Code](https://docs.claude.com/claude-code) instalado e logado (`claude`)
- [FFmpeg](https://www.gyan.dev/ffmpeg/builds/) no PATH (Windows: `winget install Gyan.FFmpeg` · Linux: `sudo apt install ffmpeg`)
- Opcional: Python com librosa, numpy e Pillow para fluxos baseados em script — o onboarding verifica tudo e mostra o que falta.

## Desenvolvimento

```powershell
git clone https://github.com/PQueirozDev/PQueiroz-Video-Studio
cd PQueiroz-Video-Studio
npm install
npm run dev        # Vite + Electron com hot reload
npm run typecheck
npm test           # histórico, legendas e fila: SQLite real, Electron/FFmpeg simulados
npm run dist       # instalador em dist/
```

Electron · React 19 · TypeScript · Vite · Tailwind CSS 4 · Zustand · SQLite (`node:sqlite`) · FFmpeg · Claude Code

```
src/
  shared/     tipos e contrato da API (main ⇄ interface)
  main/       Electron: projetos, mídia, Claude, versões, render, assets, banco
  preload/    ponte segura com contextIsolation
  renderer/   React: dashboard, player, chat, timeline, configurações
site/         site do projeto (Vercel)
```

## Licença

[MIT](LICENSE) © 2026 Pedro Queiroz
