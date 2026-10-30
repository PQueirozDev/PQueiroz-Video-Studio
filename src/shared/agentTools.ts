// Ferramentas estruturadas que o agente (Claude Code) usa para editar o projeto, via servidor MCP local.
// Cada uma vira uma chamada validada no processo principal: o agente nunca mexe nos arquivos internos.

export interface AgentTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })
const str = (description: string): Record<string, unknown> => ({ type: 'string', description })
const num = (description: string): Record<string, unknown> => ({ type: 'number', description })

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'estado_projeto',
    description: 'Mostra o projeto agora: mídias (id, tipo, duração), trilhas, clipes da timeline (id, trilha, tempos, efeitos, transições, títulos), marcadores e mixagem. Chame antes de editar.',
    inputSchema: obj({})
  },
  {
    name: 'catalogo',
    description: 'Lista o que existe para usar: transições, efeitos (com parâmetros e limites), LUTs, propriedades animáveis, modos de mesclagem e os itens do Asset Hub (títulos, sons, overlays, presets, fontes) com suas chaves.',
    inputSchema: obj({ tipo: { type: 'string', enum: ['tudo', 'transicoes', 'efeitos', 'luts', 'hub'], description: 'Filtra a lista (padrão: tudo).' } })
  },
  {
    name: 'editar_timeline',
    description: [
      'Aplica uma lista de comandos de edição numa etapa só (um Ctrl+Z desfaz tudo). Se um comando falhar, nada é aplicado.',
      'Num lote, "$N" num campo de id usa o id criado pelo comando N (0 = primeiro). Ex.: [{"type":"addClip","mediaId":"m1"},{"type":"addEffect","clipId":"$0","effect":"vignette"}].',
      'Tempos em segundos. Comandos: addTrack{kind,name?} · updateTrack{trackId,name?,muted?,hidden?,locked?,blend?} · removeTrack{trackId} ·',
      'addClip{mediaId,trackId?,start?,in?,out?} · moveClip{clipId,start,trackId?} · trimClip{clipId,in?,out?,ripple?} · splitClip{clipId,at} · removeClip{clipId,ripple?} ·',
      'slipClip{clipId,delta} · setClipProps{clipId,volume?,opacity?,fadeIn?,fadeOut?} · setTransition{clipId,transition:{type,duration?}|null} ·',
      'addEffect{clipId,effect,params?,asset?} · updateEffect{clipId,effectId,params?,enabled?} · removeEffect{clipId,effectId} ·',
      'setTransform{clipId,transform:{x,y,scale,rotation,zoom,anchorX,anchorY}} · setKeyframes{clipId,prop,keyframes:[{t,v,ease}]|null} (t relativo ao início do clipe; ease: linear|in|out|inOut|hold) ·',
      'addKeyframe{clipId,prop,t,v,ease?} · setSpeed{clipId,speed,ripple?} · speedRamp{clipId,from,to,speed,smooth?} (from/to na timeline) · freezeFrame{clipId,at,duration} ·',
      'addTitle{start?,duration?,trackId?,title:{text,font,size,color,x,y,align,outline,outlineColor,shadow,box,boxColor,lineSpacing,uppercase},keyframes?,fadeIn?,fadeOut?} · updateTitle{clipId,title} ·',
      'groupClips{clipIds} · ungroupClips{clipIds} · addMarker{time,label?} · removeMarker{markerId} · setMix{mix:{normalize,targetLufs,duck,duckAmount}} · clearTimeline{}.'
    ].join(' '),
    inputSchema: obj({ commands: { type: 'array', items: { type: 'object' }, minItems: 1, maxItems: 500, description: 'Comandos, na ordem.' } }, ['commands'])
  },
  { name: 'desfazer', description: 'Desfaz a última edição da timeline (a mesma do Ctrl+Z).', inputSchema: obj({}) },
  {
    name: 'analisar_midia',
    description: 'Analisa um arquivo (em cache depois da primeira vez): cenas, silêncios, transientes (tiros/impactos), volume e, com musica=true, BPM e batidas.',
    inputSchema: obj({ mediaId: str('Id da mídia.'), musica: { type: 'boolean', description: 'Detectar BPM e batidas.' } }, ['mediaId'])
  },
  {
    name: 'melhores_momentos',
    description: 'Encontra os melhores trechos dos vídeos (gameplay: tiros, impactos, som alto; geral: fala, movimento, cenas).',
    inputSchema: obj({ mediaIds: { type: 'array', items: { type: 'string' } }, duracao: num('Duração de cada trecho (s, 1–120).'), quantidade: num('Quantos trechos (1–100).'), modo: { type: 'string', enum: ['gameplay', 'geral'] } }, ['mediaIds', 'duracao', 'quantidade'])
  },
  {
    name: 'auto_studio',
    description: 'Monta uma edição completa sozinho (substitui a timeline, um Ctrl+Z desfaz). Estilos: gaming (cortes na batida, zoom punch, whoosh), shorts, vlog (corta silêncios), cinema.',
    inputSchema: obj({ estilo: { type: 'string', enum: ['gaming', 'shorts', 'vlog', 'cinema'] }, mediaIds: { type: 'array', items: { type: 'string' } }, musicaId: str('Id da música (opcional).'), duracao: num('Duração máxima (s).'), titulo: str('Título de abertura (opcional).'), estiloId: str('Estilo da Style Memory (padrão: o do projeto; "nenhum" para não usar).') }, ['estilo', 'mediaIds'])
  },
  {
    name: 'usar_asset',
    description: 'Usa um item do Asset Hub pela chave (veja catalogo): som ou overlay entra na timeline em `inicio`; template de título vira um título em `inicio` (texto opcional); preset é aplicado no clipe `clipId` a partir de `inicio`.',
    inputSchema: obj({ chave: str('Ex.: "pq-essentials/whoosh".'), inicio: num('Tempo na timeline (s).'), clipId: str('Clipe alvo (presets).'), texto: str('Texto do título (templates).') }, ['chave'])
  },
  {
    name: 'transcrever',
    description: 'Transcreve a fala de um vídeo localmente (whisper). Devolve as legendas com tempos do arquivo. Use legendas_na_timeline para pôr na edição.',
    inputSchema: obj({ mediaId: str('Vídeo do projeto.'), idioma: { type: 'string', enum: ['pt', 'en', 'auto'] }, modelo: str('Modelo instalado (padrão: o menor instalado).') }, ['mediaId'])
  },
  {
    name: 'legendas_na_timeline',
    description: 'Coloca as legendas transcritas de um vídeo como títulos na timeline, sincronizadas com os clipes desse vídeo (respeita cortes e velocidade). Usa um template de título do Asset Hub.',
    inputSchema: obj({ mediaId: str('Vídeo transcrito.'), template: str('Chave do template (padrão: pq-essentials/legenda-tiktok).') }, ['mediaId'])
  },
  {
    name: 'verificar_qualidade',
    description: 'Quality Check antes de entregar: na timeline (tela preta, piscadas, texto pequeno ou rápido, fora da área segura do destino, fonte/LUT ausente, mudo, sem normalizar) e, com arquivo=true, no último render (loudness, pico, pretos, silêncios, imagem congelada, proporção, tamanho e duração do destino). Itens com "correcao" podem ir direto para editar_timeline.',
    inputSchema: obj({ destino: { type: 'string', enum: ['youtube-1080', 'youtube-4k', 'shorts', 'instagram-feed', 'quadrado', 'whatsapp', 'master'], description: 'Preset de destino (limites e área segura).' }, arquivo: { type: 'boolean', description: 'Também analisar a versão renderizada mais recente.' } })
  },
  {
    name: 'estilos',
    description: 'Lista os estilos salvos (Style Memory) e mostra o cliente e o estilo deste projeto, com o resumo de cada estilo (ritmo, look, títulos, legendas, volumes) e as instruções do Pedro.',
    inputSchema: obj({})
  },
  {
    name: 'aprender_estilo',
    description: 'Aprende o estilo da edição atual da timeline (look, títulos, legendas, ritmo, transições, movimento, volumes) e salva com um nome. Use quando o Pedro aprovar uma edição e pedir para lembrar o jeito.',
    inputSchema: obj({ nome: str('Nome do estilo.'), observacoes: str('Instruções extras para lembrar (opcional).') }, ['nome'])
  },
  {
    name: 'aplicar_estilo',
    description: 'Aplica um estilo salvo na timeline atual (look nos clipes, cara dos títulos e legendas, volume da música e mixagem). Um Ctrl+Z desfaz.',
    inputSchema: obj({ estiloId: str('Id do estilo (veja estilos).') }, ['estiloId'])
  },
  {
    name: 'gerar_versao',
    description: 'Renderiza a timeline num arquivo de vídeo (nova versão do projeto, com NVENC quando houver). Demora; chame só quando a edição estiver pronta.',
    inputSchema: obj({})
  }
]
