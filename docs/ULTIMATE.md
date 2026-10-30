# PQueiroz Video Studio Ultimate — auditoria, plano e progresso

Branch de desenvolvimento: `dev/ultimate`. Backup do estado anterior: `E:\PQueiroz Studio\_backups\video-studio-pre-ultimate-2026-10-28.tgz`.

## Fase 0 — Auditoria (28/10/2026)

| Funcionalidade | Situação antes | Referência externa | Estratégia | Complexidade | Prioridade |
|---|---|---|---|---|---|
| Modelo de timeline | Parcial: os arquivos importados eram os clipes (ordem + corte) | FilmCraft `crates/project` | Documento de composição com trilhas, clipes, transições, efeitos e marcadores | Alta | P0 (Fase 1) ✅ |
| Render da edição | Concat simples em CPU | FilmCraft `render`/`export` (referência) | Compilador composição → `filter_complex` do FFmpeg, NVENC com volta para CPU | Alta | P0 (Fase 1) ✅ |
| Undo/redo | Só ordem e cortes | — | Pilhas de documentos (100 passos), lotes atômicos | Média | P0 (Fase 1) ✅ |
| Fila de render | Existe (H.264 CPU/NVENC, progresso, cancelar) | — | Mantida; parâmetros de qualidade compartilhados | — | — |
| Preview | Toca arquivos prontos (`<video>`) | — | Fase 3: preview da composição (proxies) + trecho renderizado exato | Alta | P1 |
| Legendas | Editor + SRT + ASS gravado; sem transcrição | FFmpeg 9 filtro `whisper` | Fase 2: transcrição local (modelo ggml baixado com consentimento) | Média | P1 |
| Análise de cenas/silêncio/batidas | Ausente | FFmpeg `scdet`, `blackdetect`, `silencedetect`, `ebur128` | Fase 2, com cache | Média | P1 |
| Keyframes | Ausente | FilmCraft `project/keyframe` | Fase 3 | Alta | P1 |
| Efeitos e transições | Ausente | FFmpeg `xfade` + filtros | Catálogo único em `src/shared/fx.ts` (23 transições, 10 efeitos já renderizam) | Média | P1 |
| Cor / LUTs | Ausente | FFmpeg `lut3d`, `eq`, `colortemperature`; LUTs dos packs do Pedro | Fase 3 | Média | P2 |
| Áudio (normalizar, ducking, ruído) | Ganho fixo da música | FFmpeg `loudnorm`, `sidechaincompress`, `afftdn` | Fase 3 | Média | P2 |
| Agente com ferramentas | Claude com shell livre + `montar.py` | — | Fase 5: comandos de composição validados (já existem) expostos ao Claude | Alta | P1 |
| Asset Hub, fontes, títulos, pacotes | Biblioteca de arquivos sem aplicação | Google Fonts (OFL), packs HL/VEP do Pedro | Fases 3–4 | Alta | P2 |
| Segurança | Sandbox desligado, categoria de asset sem validação, protocolo sem realpath | — | Corrigido na Fase 1 ✅ | Baixa | P0 |
| Testes | Backend com FFmpeg simulado | — | + testes de render com FFmpeg real + E2E no Electron | Média | P0 ✅ |

### Repositórios de referência

- **FilmCraft** (`storytold/filmcraft`): editor em Rust, MIT OR Apache-2.0 (as marcas ArtCraft em `docs/brand` não são abertas). Está em alpha (~56% "pronto para trabalho real" pelo próprio README). Decisão: **não** usar como motor (risco de formato instável e build Rust); serve de referência de algoritmos, com atribuição quando algo for portado.
- **chaojifeng-video-design** (`mileson/chaojifeng-video-design`): código MIT; metodologia de direção para vídeos de motion (Remotion/HyperFrames), 66 pacotes de estilo com paleta, fonte e ritmo. Galeria em CC BY 4.0. `assets/gallery/originals` contém músicas protegidas — nunca incluir.

### Licenças de assets

- Google Fonts (OFL): pode ir no instalador.
- Mixkit, Pexels, ProductionCrate: as licenças proíbem redistribuir os arquivos dentro de outro app/biblioteca. Ficam como importação manual pelo usuário; o app gera equivalentes originais (FFmpeg) ou usa material CC0.
- Packs do Pedro (`Desktop\Pedro\Packs de Edicao`): HL_PACK e VIDEO_EDITING_PACK são obra original (geradores em `_tools`), aproveitáveis; RTFX é de terceiros (.ffx do After Effects) e não é portável.

## Fase 1 — Fundação ✅

**Composição** (`src/shared/composition.ts`)
- Trilhas de vídeo/áudio (mudo, oculta, bloqueada), clipes com trecho do arquivo, posição, volume, opacidade, fades, transição de entrada e pilha de efeitos; marcadores.
- 15 comandos validados (`addClip`, `moveClip`, `trimClip` com ripple, `splitClip`, `removeClip` com ripple, `setTransition`, `addEffect`...). Todo comando devolve um documento novo e passa por `validateComposition` (sobreposição, tipo de trilha, fim do arquivo, efeito/transição inexistente, trilha bloqueada).
- Transições no modelo CapCut: o clipe recua e sobrepõe o anterior pela duração da transição.
- `migrateComposition` lê documentos antigos e recusa formatos mais novos.

**Render** (`src/main/render/compose.ts`, `encode.ts`)
- A composição vira um único comando FFmpeg; o grafo vai num arquivo (`-/filter_complex`) para não estourar o limite de linha de comando do Windows.
- Trilhas sobrepostas de baixo para cima com espaços transparentes; áudio de todas as trilhas posicionado e mixado; transições cruzam o áudio.
- "Montar timeline" usa esse motor, com NVENC e volta automática para CPU.

**Persistência e recuperação** (`src/main/composition/store.ts`)
- SQLite (tabela `compositions`) com desfazer/refazer de 100 passos; lotes de comandos atômicos (um passo de desfazer).
- Autosave atômico em `<projeto>/composition.json`; se o banco estiver corrompido ou perdido, a composição é recuperada desse arquivo.
- Projetos antigos continuam iguais: enquanto ninguém edita por comandos, a composição é derivada da timeline simples (`origin: 'legacy'`).

**Estabilidade e segurança**
- Log estruturado JSON em `<userData>/logs/studio-AAAA-MM-DD.log` (14 dias), incluindo erros de IPC e exceções não tratadas.
- `sandbox: true` no renderer; IPC só aceita chamadas da janela do app; categoria da biblioteca validada; protocolo de mídia confere o caminho real (atalhos/junções não escapam das pastas permitidas); navegação restrita.

**Testes**
- `npm test` = `verify-studio.mjs` (51 verificações, incluindo composição, undo, lote atômico e recuperação) + `verify-render.mjs` (14 verificações com FFmpeg real: cores e áudio conferidos quadro a quadro; as 23 transições e os 10 efeitos renderizam).
- E2E no Electron real (sandbox ligado): projeto → importação → edição via IPC → undo/redo → render 1080p (7 s em ~4 s).

### Ainda não existe (próximas fases)
- A interface da timeline continua a antiga (uma faixa); a nova composição é editada por IPC/agente até a Fase 3.
- Sem keyframes, preview da composição, transcrição, análise, Asset Hub.

## Fase 2 — Automação audiovisual ✅ (backend; a interface vem na Fase 3)

**Análise** (`src/main/analysis/analyze.ts`, tipos em `src/shared/analysis.ts`)
- Duas passadas leves do FFmpeg por arquivo: vídeo a 10 qps/160 px (cortes de cena, trechos pretos, curva de movimento) e áudio (silêncios, loudness EBU R128, pico real, risco de distorção) com PCM mono 11 kHz processado em streaming (energia e transientes).
- Cache por arquivo em `<projeto>/cache/analysis` (caminho + tamanho + data de modificação): nada é reprocessado.
- Cancelável (`analysis:cancel`), com progresso na barra de tarefas.

**Música** (`src/main/analysis/beats.ts`, `src/shared/music.ts`)
- BPM por autocorrelação do fluxo espectral (com peso na banda grave para não travar no contratempo), batidas por programação dinâmica (Ellis 2007), transientes e mudanças de intensidade. Em TypeScript puro, sem Python.
- Testado de 85 a 174 BPM: BPM correto e batidas a no máximo 18 ms do bumbo.
- `beatMontage`: cada clipe dura um número inteiro de batidas (padrão fixo ou sequência, ex. 4-4-2-2) e a música entra alinhada; devolve os tempos dos cortes para sincronizar transições e efeitos.

**Highlights** (`src/shared/highlights.ts`)
- Pontuação por janela de 0,5 s com som alto e repentino, movimento e cortes de cena (pesos diferentes para gameplay e geral), penalizando pretos e silêncio; devolve os N melhores trechos sem sobreposição, com o motivo de cada escolha.
- Limite honesto: não reconhece kills/eventos específicos de um jogo (isso exigiria OCR/modelos da interface de cada jogo). O resultado é uma lista para o usuário confirmar.
- `keepRanges` + `rangesToCommands`: corte automático de silêncios como comandos de composição (desfazíveis).

**Transcrição local** (`src/main/analysis/whisper.ts`)
- Filtro `whisper` do FFmpeg 9 (whisper.cpp). Modelos tiny/base/small/medium/large-v3-turbo baixados só por ação do usuário, com tamanho e SHA-256 conferidos contra o Hugging Face.
- Os tempos do whisper são grosseiros; `alignToSpeech` encosta início/fim de cada legenda na fala medida pelos silêncios.
- Limitação: o filtro do FFmpeg não entrega tempo por palavra de forma confiável (`max_len=1` devolve lixo); o karaokê usará tempo estimado por palavra dentro de cada legenda.
- O whisper.cpp não abre caminhos com acento no Windows: o FFmpeg roda na pasta dos modelos com nomes relativos ASCII.

**Testes**: `npm test` = 62 verificações de backend (inclui análise real com FFmpeg, BPM, highlights, corte de silêncio, montagem nas batidas, parser do whisper) + 21 de render. E2E no app: transcrição em português com o modelo `base` num projeto com acento no caminho.

## Fase 3 — Editor profissional (em andamento)

Feito e testado (`npm test`: 68 + 48 verificações; E2E da interface com Playwright):
- Timeline multitrilha (arrastar, aparar, dividir, snap, ripple, bloquear/ocultar/silenciar trilhas, menu de contexto, atalhos), inspetor com keyframes, navegador de transições/efeitos/LUTs com prévias em vídeo.
- Enquadramento animado (posição, escala, rotação, zoom com âncora), opacidade, desfoque e cor animados; LUTs (8 originais do pacote HL em `resources/luts` + pasta do usuário); efeitos de áudio; mixagem com ducking e normalização final.
- Velocidade (0,1× a 8×, som com `atempo`), speed ramp em degraus suaves e freeze frame; a animação acompanha o conteúdo em cortes, rampas, mudanças de velocidade e freeze.
- Preview em tempo real (aproximado, por CSS) e prévia exata (trecho renderizado pelo motor do export, em cache).
- Revisão do Codex: 13 achados; 11 corrigidos com testes. Pendentes (baixo impacto): o easing de um segmento cortado ao meio é reaproveitado inteiro (a curva muda um pouco depois de dividir); a prévia exata reinicia fades cortados pelas bordas do trecho (só a prévia; o export não é afetado).

Falta na Fase 3: slip edit, agrupar clipes (os degraus da rampa aparecem como clipes separados), editor de curvas, máscaras, medidores de áudio, color match automático, comparação antes/depois.

### Fase 3 — concluída (29/10)
Também entraram: slip (Alt+arrastar), agrupar (Ctrl+G; rampas nascem agrupadas), máscaras (elipse/retângulo, borda suave, inverter), curvas com editor gráfico, medidores de áudio L/R (WebAudio), correspondência de cor automática ("Igualar a…") e antes/depois (prévia exata dividida). Revisão Codex: 4 achados corrigidos.

## Fase 4 — Asset Hub ✅
- Pacotes `.pqs-pack` (zip + `pack.json`, formato em `src/shared/packs.ts`), leitor/escritor de zip próprio com limites (zip slip, zip bomb, tamanhos mentirosos), instalação atômica, remoção, exportar pasta → pacote. Página "Pacotes (Asset Hub)" na Biblioteca de Assets.
- Pacote essencial (`resources/packs/pq-essentials`, 19 MB, gerado por `scripts/build-essentials.mjs`): 15 famílias do Google Fonts (OFL, licenças junto), 20 SFX (12 originais HL + 8 gerados), 10 overlays (7 HL/VEP + 3 gerados), 8 LUTs VEP (as 8 HL continuam em `resources/luts`), 20 títulos, 25 presets (movimento portados do `hl_presets.py`: shakes, zooms, velocity, flash, glitch, combos Valorant; e looks).
- Catálogo: 33 transições e 27 efeitos de imagem (+5 de áudio). Novos: pixelizar, espelhar, negativo, matiz, esboço, posterizar, tremor de câmera, glitch, lente, barras de cinema, VHS, térmica, curvas, máscara.
- Títulos (texto gerado pelo motor com drawtext, sem arquivo) com inspetor próprio e prévia em CSS com a fonte real; modos de mesclagem por trilha (screen, adição, clarear, multiplicar, overlay, luz suave).
- Revisão Codex: 9 achados corrigidos (inclui 2 de segurança no zip).

## Fase 5 — Auto Studio + agente ✅
- Auto Studio (`src/shared/autoStudio.ts` + botão na timeline): gaming (cortes na batida, zoom punch, flash, whoosh, look Valorant), shorts (movimento alternado, gancho), vlog (corta silêncios, música baixa), cinema (dissolves, barras, look). Uma etapa de desfazer.
- Lotes de comandos com referências `"$N"` (id criado pelo comando N do lote).
- Agente: servidor MCP local (`out/main/mcp.js`, roda com o executável do app) + ponte 127.0.0.1 com token por turno do chat. 11 ferramentas: estado_projeto, catalogo, editar_timeline, desfazer, analisar_midia, melhores_momentos, auto_studio, usar_asset, transcrever, legendas_na_timeline, gerar_versao. Testado com o Claude Code real (pedido no chat → título na timeline em 8 s).
- Revisão Codex: 9 achados corrigidos (sessão cancelada não grava, limite de lote, dissolves que não cabem, música no vlog, ponte robusta).

## Fase 6 — Style Memory + clientes ✅
- `src/shared/style.ts`: aprende de uma edição pronta o look (pilha de efeitos mais comum), a cara dos títulos e das legendas, ritmo (corte mediano, cortes/min), transição preferida, movimento, volumes e mixagem; reaplica trocando o look e a cara dos títulos sem mexer em texto e posição.
- Cliente = Marca (as mesmas do Image Studio). Projeto tem cliente e estilo (herdar do cliente / nenhum / escolhido). Auto Studio, Claude (contexto + ferramentas estilos/aprender_estilo/aplicar_estilo) seguem o estilo.
- Revisão Codex: 7 achados corrigidos.

## Fase 7 — Quality Check + exportação ✅
- Quality Check da timeline (tela preta inclusive no fim, piscadas, texto pequeno/rápido/fora da área segura convertida pelo encaixe do destino, fonte/LUT ausente, mudo, sem normalizar, duração) com correções; "Corrigir tudo" aplica uma por vez verificando de novo. Novo comando `shiftTime` (fecha buracos levando títulos, áudio e marcadores, sem desfazer transições).
- Quality Check do arquivo: uma passada do FFmpeg (ebur128, blackdetect, silencedetect, freezedetect) lida em fluxo.
- Presets de exportação (YouTube 1080p/4K, Shorts/Reels/TikTok com fundo desfocado, Instagram 4:5, quadrado, WhatsApp ≤ 16 MB com bitrate calculado, master MOV); vários destinos de uma vez; Quality Check automático ao fim de cada render.
- Revisão Codex: 8 achados corrigidos.

## Fase 8 — Acabamento ✅
- Tour guiado do editor (7 passos, uma vez; reabre pela paleta), janela de atalhos (`?`), paleta com Auto Studio, Quality Check, tour e atalhos.
- App empacotado testado (`dist/win-unpacked`): servidor MCP roda com o Node do app fora do asar, Asset Hub (99 itens), 16 LUTs e render de título com fonte do pacote. Instalador NSIS gerado localmente em `dist/PQueiroz-Video-Studio-Setup.exe` (nada publicado).
- Testes: `npm test` = 79 + 63 verificações; E2E com Playwright para cada fase (scratchpad `pw/`).

### Pendências conhecidas
- O easing de um segmento dividido ao meio é reaproveitado inteiro (a curva muda um pouco depois de dividir).
- A prévia exata reinicia fades cortados pelas bordas do trecho (só a prévia).
- Máscara usa `geq` (~10 fps em 1080p no render): use em trechos curtos.
- Publicado como v0.3.0.
