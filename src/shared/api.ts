import type { HubItem, PackInfo } from './packs'
import type { AutoStyle } from './autoStudio'
import type { StyleProfile } from './style'
import type { QcItem, RenderMeasures } from './qc'
export interface AutoStudioRequest { style: AutoStyle; mediaIds: string[]; musicId?: string | null; targetDuration: number; title?: string; styleId?: string | null }
import type {
  AqcInfo, AssetCategory, AssetItem, ChatMessage, ClaudeUsage, UpdateState, ClaudeEvent, EditTimeline, EnvCheck, ImportResult, MediaItem,
  NewProjectInput, Preset, PresetInput, Project, RenderJob, RenderSettings, Settings, Version, TimelineState, SubtitleDocument
} from './types'
import type {
  Brand, BrandInput, BrandLogo, ExportFormat, GenerateRequest, GenerateResult, ImageDoc, ImageProjectInfo, NewImageProjectInput,
  PendingRender, ProviderConfigInput, ProviderId, ProviderInfo
} from './image'
import type { FontFile } from './fonts'
import type { Command, Composition } from './composition'
import type { EffectDef, TransitionDef } from './fx'
import type { Highlight, HighlightOptions, MediaAnalysis, TimeRange } from './analysis'
import type { BeatMontage, BeatMontageOptions } from './music'

export interface WhisperModelInfo { id: string; label: string; bytes: number }

export interface CompositionState { doc: Composition; undo: boolean; redo: boolean }
export interface CompositionEdit extends CompositionState { createdIds: (string | undefined)[] }
export interface FxCatalog { transitions: Omit<TransitionDef, 'xfade'>[]; effects: Omit<EffectDef, 'filter'>[] }

export interface ImportedImage { path: string; width: number; height: number }

export interface ToVideoOptions {
  background: Uint8Array
  subject: Uint8Array | null
  foreground: Uint8Array | null
  duration: number
  motion: 'zoom-in' | 'zoom-out' | 'none'
  subjectMotion: 'float' | 'none'
  textIn: 'fade' | 'slide' | 'none'
  music: string | null
  targetProjectId: string | null
}

/** Superfície exposta pelo preload em `window.studio`. */
export interface StudioApi {
  env: {
    check(id: EnvCheck['id']): Promise<EnvCheck>
    aqcInfo(): Promise<AqcInfo>
    setupPython(): Promise<{ ok: boolean; log: string }>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    pickFolder(title: string, defaultPath?: string): Promise<string | null>
    pickFile(title: string): Promise<string | null>
  }
  projects: {
    list(): Promise<Project[]>
    get(id: string): Promise<Project | null>
    create(input: NewProjectInput): Promise<Project>
    rename(id: string, name: string): Promise<Project>
    update(id: string, patch: Partial<Pick<Project, 'format' | 'resolution' | 'fps' | 'preset' | 'status' | 'currentVersionId'>>): Promise<Project>
    openFolder(id: string, sub?: string): Promise<void>
    openExisting(): Promise<Project | null>
    archive(id: string): Promise<void>
  }
  media: {
    history(projectId: string): Promise<TimelineState>
    undo(projectId: string): Promise<TimelineState>
    redo(projectId: string): Promise<TimelineState>
    waveform(projectId: string, id: string): Promise<number[]>
    list(projectId: string): Promise<MediaItem[]>
    import(projectId: string, paths: string[]): Promise<ImportResult>
    pickAndImport(projectId: string): Promise<ImportResult>
    pickFiles(): Promise<string[]>
    reorder(projectId: string, ids: string[]): Promise<void>
    remove(projectId: string, id: string): Promise<void>
    pathForFile(file: File): string
    timeline(projectId: string): Promise<EditTimeline | null>
    setTrim(projectId: string, id: string, trimIn: number | null, trimOut: number | null): Promise<void>
    setInTimeline(projectId: string, id: string, on: boolean): Promise<void>
    assemble(projectId: string): Promise<Version[]>
    onChanged(cb: (projectId: string) => void): () => void
    onTask(cb: (t: { projectId: string; text: string; progress: number | null; done?: boolean; error?: string }) => void): () => void
  }
  composition: {
    get(projectId: string): Promise<CompositionState>
    /** Aplica os comandos de forma atômica (um único passo de desfazer). */
    edit(projectId: string, commands: Command[]): Promise<CompositionEdit>
    undo(projectId: string): Promise<CompositionState>
    redo(projectId: string): Promise<CompositionState>
    reset(projectId: string): Promise<CompositionState>
    catalog(): Promise<FxCatalog>
    luts(): Promise<{ id: string; name: string; builtIn: boolean }[]>
    /** Renderiza um trecho em 540p com o mesmo motor do export (prévia exata). */
    renderPreview(projectId: string, start: number, seconds: number, bypassEffects?: boolean): Promise<{ path: string; start: number; duration: number }>
    /** Ganhos/desvios do efeito "Correspondência de cor" para o clipe ficar com a cor do clipe de referência. */
    colorMatch(projectId: string, clipId: string, refClipId: string): Promise<Record<string, number>>
    /** Vídeo curto de demonstração de uma transição, efeito ou LUT. */
    fxPreview(kind: 'transition' | 'effect' | 'lut', id: string): Promise<string>
    onChanged(cb: (projectId: string) => void): () => void
  }
  analysis: {
    cached(projectId: string, mediaId: string): Promise<MediaAnalysis | null>
    run(projectId: string, mediaId: string, music?: boolean): Promise<MediaAnalysis>
    cancel(projectId: string): Promise<void>
    highlights(projectId: string, mediaIds: string[], opts: HighlightOptions): Promise<Highlight[]>
    silencePlan(projectId: string, mediaId: string, minSilence?: number, padding?: number): Promise<{ ranges: TimeRange[]; removedSeconds: number; commands: Command[] }>
    beatMontage(projectId: string, highlights: Highlight[], musicId: string, opts: BeatMontageOptions): Promise<BeatMontage>
  }
  transcription: {
    models(): Promise<{ models: WhisperModelInfo[]; installed: string[] }>
    /** Baixa um modelo whisper.cpp (só por ação do usuário). */
    download(id: string): Promise<string[]>
    run(projectId: string, source: string, opts: { model: string; language: 'pt' | 'en' | 'auto' }): Promise<SubtitleDocument>
  }
  /** Style Memory: estilos aprendidos de edições e cliente/estilo de cada projeto. */
  styles: {
    list(): Promise<StyleProfile[]>
    learn(projectId: string, input: { name: string; brandId?: string | null; notes?: string; replaceId?: string }): Promise<StyleProfile>
    update(id: string, patch: { name?: string; brandId?: string | null; notes?: string }): Promise<StyleProfile>
    remove(id: string): Promise<void>
    /** choice: '' = herda do cliente, 'none' = sem estilo, ou o id escolhido. */
    project(projectId: string): Promise<{ brandId: string | null; styleId: string | null; style: StyleProfile | null; choice: string }>
    setProject(projectId: string, patch: { brandId?: string | null; styleId?: string | null }): Promise<{ brandId: string | null; styleId: string | null; style: StyleProfile | null; choice: string }>
    apply(projectId: string, styleId: string): Promise<{ commands: number }>
  }
  /** Quality Check: timeline (instantâneo, com correções) e arquivo renderizado. */
  qc: {
    project(projectId: string, presetId?: string): Promise<QcItem[]>
    render(projectId: string, opts?: { path?: string; presetId?: string }): Promise<{ path: string; items: QcItem[]; measures: RenderMeasures }>
  }
  /** Edição automática completa (uma etapa de desfazer). */
  auto: {
    run(projectId: string, req: AutoStudioRequest): Promise<{ duration: number; clips: number; notes: string[] }>
  }
  /** Asset Hub: pacotes instalados (.pqs-pack) e seus itens. */
  hub: {
    packs(): Promise<PackInfo[]>
    items(): Promise<HubItem[]>
    /** Importa um SFX/overlay para o projeto (reaproveita se já estiver lá) e devolve a mídia. */
    use(projectId: string, key: string): Promise<MediaItem>
    /** Abre o seletor e instala um .pqs-pack; null se cancelado. */
    install(): Promise<PackInfo | null>
    remove(id: string): Promise<void>
    /** Escolhe uma pasta com pack.json e gera o .pqs-pack. */
    exportFolder(): Promise<{ path: string; items: number; bytes: number } | null>
  }
  assets: {
    list(): Promise<AssetItem[]>
    pickAndAdd(category: AssetCategory): Promise<{ added: number; skipped: string[] }>
    add(category: AssetCategory, paths: string[]): Promise<{ added: number; skipped: string[] }>
    use(projectId: string, path: string): Promise<string>
    openFolder(): Promise<void>
  }
  chat: {
    history(projectId: string): Promise<ChatMessage[]>
    send(projectId: string, text: string): Promise<void>
    cancel(projectId: string): Promise<void>
    running(projectId: string): Promise<boolean>
    resetSession(projectId: string): Promise<void>
    onEvent(cb: (e: ClaudeEvent) => void): () => void
    usage(force?: boolean): Promise<ClaudeUsage>
    onUsage(cb: (u: ClaudeUsage) => void): () => void
  }
  versions: {
    favorite(projectId: string, id: string, on: boolean): Promise<void>
    list(projectId: string): Promise<Version[]>
    restore(projectId: string, versionId: string): Promise<Project>
    duplicate(projectId: string, versionId: string): Promise<Version>
    reveal(versionId: string): Promise<void>
  }
  render: {
    retry(id: string): Promise<RenderJob>
    enqueue(projectId: string, input: { path: string; label: string }, settings: RenderSettings): Promise<RenderJob>
    list(): Promise<RenderJob[]>
    cancel(id: string): Promise<void>
    reveal(id: string): Promise<void>
    clearFinished(): Promise<void>
    onUpdate(cb: (job: RenderJob) => void): () => void
  }
  presets: {
    list(): Promise<Preset[]>
    save(id: string | null, input: PresetInput): Promise<Preset>
    remove(id: string): Promise<void>
  }
  subtitles: {
    load(projectId: string, source: string): Promise<SubtitleDocument>
    save(projectId: string, source: string, doc: SubtitleDocument): Promise<SubtitleDocument>
    generated(projectId: string, source: string): Promise<SubtitleDocument>
    target(projectId: string, source: string): Promise<string>
    import(projectId: string, source: string): Promise<SubtitleDocument | null>
    export(doc: SubtitleDocument): Promise<boolean>
  }
  image: {
    create(input: NewImageProjectInput): Promise<{ project: Project; info: ImageProjectInfo; doc: ImageDoc }>
    open(projectId: string): Promise<{ info: ImageProjectInfo; doc: ImageDoc }>
    updateInfo(projectId: string, patch: Partial<Pick<ImageProjectInfo, 'brandId' | 'formatId' | 'style' | 'provider' | 'originalPrompt'>>): Promise<ImageProjectInfo>
    saveDesign(projectId: string, doc: ImageDoc): Promise<number>
    createVersion(projectId: string, doc: ImageDoc, request: string, changes: string): Promise<Version>
    attachRender(projectId: string, versionId: string, png: Uint8Array): Promise<Version>
    pendingRenders(projectId: string): Promise<PendingRender[]>
    versionDoc(projectId: string, versionId: string): Promise<ImageDoc>
    restoreVersion(projectId: string, versionId: string): Promise<{ doc: ImageDoc; revision: number }>
    export(projectId: string, bytes: Uint8Array, ext: ExportFormat, name?: string): Promise<string>
    exportAs(projectId: string, bytes: Uint8Array, ext: ExportFormat, name?: string): Promise<string>
    savePreview(projectId: string, png: Uint8Array): Promise<string>
    saveAsset(projectId: string, png: Uint8Array, name: string): Promise<string>
    importImages(projectId: string, paths: string[]): Promise<ImportedImage[]>
    pickImages(projectId: string): Promise<ImportedImage[]>
    generate(req: GenerateRequest): Promise<GenerateResult>
    generation(projectId: string, requestKey: string): Promise<string | null>
    toVideo(projectId: string, options: ToVideoOptions): Promise<{ projectId: string; mediaId: string }>
    fonts(): Promise<FontFile[]>
    styleGuide(): Promise<{ text: string; path: string | null }>
    reveal(projectId: string, path: string): Promise<void>
  }
  brands: {
    list(): Promise<Brand[]>
    get(id: string): Promise<Brand | null>
    create(input: BrandInput): Promise<Brand>
    update(id: string, input: BrandInput): Promise<Brand>
    remove(id: string): Promise<void>
    importLogo(id: string): Promise<BrandLogo[]>
    importLogoFile(id: string, path: string): Promise<BrandLogo[]>
    updateLogo(id: string, logoId: string, patch: Partial<Pick<BrandLogo, 'name' | 'variant' | 'width' | 'height'>>): Promise<Brand>
    removeLogo(id: string, logoId: string): Promise<Brand>
    addAssets(id: string): Promise<Brand>
    openFolder(id: string): Promise<void>
  }
  providers: {
    list(): Promise<ProviderInfo[]>
    configure(id: ProviderId, input: ProviderConfigInput): Promise<ProviderInfo>
    /** A chave vai direto ao processo principal e é criptografada; nunca é devolvida. */
    setKey(id: ProviderId, key: string | null): Promise<ProviderInfo>
  }
  app: {
    toMediaUrl(path: string): string
    memory(): Promise<number>
    version(): Promise<string>
    updateState(): Promise<UpdateState>
    checkUpdate(): Promise<UpdateState>
    installUpdate(): Promise<void>
    onUpdate(cb: (s: UpdateState) => void): () => void
    onCommand(cb: (cmd: string) => void): () => void
  }
}

declare global {
  interface Window {
    studio: StudioApi
  }
}
