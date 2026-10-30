// Tipos compartilhados entre o processo principal (Node) e a interface (React).

export type AspectFormat = '9:16' | '16:9' | '1:1' | 'original'
export type Resolution = '1080p' | '1440p' | '4k'
export type FpsOption = 'original' | '24' | '30' | '60'
export type MediaKind = 'video' | 'audio' | 'image'
export type ProjectStatus = 'novo' | 'editando' | 'pronto' | 'renderizado'
/** video = Video Studio; image = Image Studio (artes com camadas). */
export type ProjectKind = 'video' | 'image'

export interface Settings {
  aqcRoot: string
  projectsRoot: string
  exportRoot: string
  ffmpegPath: string
  ffprobePath: string
  claudePath: string
  claudeModel: string
  pythonPath: string
  notifications: boolean
  animations: boolean
  uiScale: number
  hwAccel: boolean
  useProxies: boolean
  assetsRoot: string
  maxConcurrentRenders: number
  onboarded: boolean
  lastProjectId: string | null
}

export interface Project {
  id: string
  kind: ProjectKind
  brandId: string | null
  name: string
  path: string
  format: AspectFormat
  resolution: Resolution
  fps: FpsOption
  preset: string
  status: ProjectStatus
  claudeSessionId: string | null
  currentVersionId: string | null
  thumbnail: string | null
  duration: number | null
  createdAt: number
  updatedAt: number
}

export interface NewProjectInput {
  name: string
  format: AspectFormat
  resolution: Resolution
  fps: FpsOption
  preset: string
  kind?: ProjectKind
  brandId?: string | null
}

export interface MediaItem {
  id: string
  projectId: string
  kind: MediaKind
  name: string
  path: string
  size: number
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  hasAudio: boolean
  thumbnail: string | null
  sort: number
  addedAt: number
  /** Corte não destrutivo na timeline (segundos dentro do arquivo). */
  trimIn: number | null
  trimOut: number | null
  inTimeline: boolean
  /** Cópia leve (540p) usada pelo player quando os proxies estão ligados. */
  proxy: string | null
}

export interface ImportResult {
  imported: MediaItem[]
  skipped: { path: string; reason: string }[]
}

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  projectId: string
  role: ChatRole
  content: string
  /** Ferramentas usadas pelo Claude durante a resposta (resumo legível). */
  activity: string[]
  createdAt: number
}

export interface Version {
  favorite: boolean
  id: string
  projectId: string
  number: number
  label: string
  path: string
  sourcePath: string | null
  request: string
  changes: string
  parentId: string | null
  duration: number | null
  thumbnail: string | null
  createdAt: number
}

export type ClaudeEvent =
  | { type: 'status'; projectId: string; text: string }
  | { type: 'text'; projectId: string; messageId: string; text: string }
  | { type: 'activity'; projectId: string; messageId: string; text: string }
  | { type: 'done'; projectId: string; message: ChatMessage; versions: Version[]; costUsd?: number; designChanged?: boolean }
  | { type: 'error'; projectId: string; error: string }

export type RenderQuality = 'rapida' | 'equilibrada' | 'alta' | 'maxima'

export interface RenderSettings {
  /** Preset de exportação (src/shared/exportPresets.ts): define proporção, tamanho, encaixe e limite de arquivo. */
  presetId?: string
  subtitles?: SubtitleDocument
  container: 'mp4' | 'mov'
  resolution: Resolution
  fps: 'original' | '30' | '60'
  quality: RenderQuality
}

export type RenderStatus = 'aguardando' | 'renderizando' | 'concluido' | 'erro' | 'cancelado'

export interface RenderJob {
  remainingSeconds?: number | null
  estimatedBytes?: number | null
  notice?: string | null
  id: string
  projectId: string
  projectName: string
  label: string
  input: string
  output: string
  settings: RenderSettings
  status: RenderStatus
  progress: number
  encoder: string | null
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export type CheckState = 'ok' | 'aviso' | 'erro'

export interface EnvCheck {
  id: 'aqc' | 'skills' | 'ffmpeg' | 'claude' | 'python' | 'workspace'
  label: string
  state: CheckState
  detail: string
  hint?: string
}

export interface SkillInfo {
  name: string
  kind: 'skill' | 'workflow' | 'script' | 'context'
  path: string
  description: string
  found: boolean
}

export interface AqcInfo {
  /** Vazio quando nenhum sistema de edição foi configurado neste computador. */
  root: string
  exists: boolean
  workflow: SkillInfo[]
  musicCount: number
  doneVideos: string[]
  pendingJobs: string[]
  templateDir: string | null
  stalePaths: string[]
}

export interface Preset {
  id: string
  name: string
  builtin: boolean
  format: AspectFormat
  description: string
  /** Instrução adicionada ao contexto do Claude quando o preset está ativo. */
  prompt: string
  /** Quem criou (presets importados de outras pessoas). */
  author: string
  /** Pasta do sistema de edição que veio junto com o preset (CLAUDE.md, Modelo edicao, skills). */
  workflowDir: string | null
}

/** Arquivo dentro de um pacote de preset (caminho relativo à raiz do sistema de edição). */
export interface PresetPackFile {
  path: string
  encoding: 'utf8' | 'base64'
  content: string
}

/**
 * Pacote compartilhável (.pqpreset = JSON compactado com gzip; JSON puro também é aceito).
 * `workflow` é opcional: com ele, quem importa recebe o sistema de edição completo.
 */
export interface PresetPack {
  kind: 'pqueiroz-preset'
  version: 1
  name: string
  author: string
  format: AspectFormat
  description: string
  prompt: string
  createdAt: number
  workflow?: { files: PresetPackFile[] }
}

export interface PresetExportOptions {
  /** Inclui CLAUDE.md, Modelo edicao e as skills de vídeo do Claude. */
  includeWorkflow: boolean
  /** Inclui a pasta Recursos (músicas, logos) — o arquivo fica bem maior. */
  includeResources: boolean
}

export interface PresetImportResult {
  preset: Preset
  /** Arquivos do sistema de edição instalados (0 se o pacote só tinha instruções). */
  workflowFiles: number
  /** Skills copiadas para ~/.claude/skills (as que já existiam não são sobrescritas). */
  skillsInstalled: string[]
  /** true se o fluxo do preset virou o sistema de edição ativo. */
  activated: boolean
}

/** Item do catálogo de presets da comunidade (presets/index.json no GitHub). */
export interface CommunityPreset {
  id: string
  name: string
  author: string
  format: AspectFormat
  description: string
  /** Caminho relativo a presets/ ou URL https completa. */
  file: string
  hasWorkflow: boolean
}

export interface EditTimeline {
  cuts: number[]
  segments: string[]
  duration: number
}

export interface TimelineState {
  undo: boolean
  redo: boolean
}
export interface SubtitleCue { id: string; start: number; end: number; text: string }
export interface SubtitleDocument {
  cues: SubtitleCue[]
  style: { size: number; color: string; position: 'bottom' | 'center' | 'top' }
}

export type AssetCategory = 'logos' | 'musicas' | 'fontes' | 'overlays' | 'intros' | 'finais'

export interface AssetItem {
  category: AssetCategory
  name: string
  path: string
  size: number
  /** true para os arquivos de <sistema de edição>/Recursos (somente leitura). */
  readOnly: boolean
  thumbnail: string | null
}

export interface PresetInput {
  name: string
  format: AspectFormat
  description: string
  prompt: string
  author?: string
}

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'none' }
  | { state: 'error'; message: string }

export interface UsageWindow {
  kind: 'session' | 'week' | 'model'
  label: string | null
  usedPercent: number
  resetsAt: string | null
}

export interface ClaudeUsage {
  available: boolean
  account: string | null
  plan: string | null
  windows: UsageWindow[]
  error: string | null
  fetchedAt: string
  /** 'usage' = lido pelo /usage; 'live' = atualizado por um rate_limit_event do chat. */
  source: 'usage' | 'live'
}
