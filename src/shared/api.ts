import type {
  AqcInfo, AssetCategory, AssetItem, ChatMessage, ClaudeUsage, UpdateState, ClaudeEvent, EditTimeline, EnvCheck, ImportResult, MediaItem,
  CommunityPreset, NewProjectInput, Preset, PresetExportOptions, PresetImportResult, PresetInput, Project, RenderJob, RenderSettings, Settings, Version
} from './types'

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
    list(projectId: string): Promise<Version[]>
    restore(projectId: string, versionId: string): Promise<Project>
    duplicate(projectId: string, versionId: string): Promise<Version>
    reveal(versionId: string): Promise<void>
  }
  render: {
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
    /** Salva o preset num arquivo .pqpreset escolhido pelo usuário. null = cancelado. */
    exportToFile(id: string, options: PresetExportOptions): Promise<string | null>
    /** Abre um .pqpreset do disco. null = cancelado. */
    importFromFile(): Promise<PresetImportResult | null>
    importFromUrl(url: string): Promise<PresetImportResult>
    community(): Promise<CommunityPreset[]>
    installCommunity(item: CommunityPreset): Promise<PresetImportResult>
    /** Usa a pasta do fluxo que veio com o preset como sistema de edição. */
    useWorkflow(id: string): Promise<Settings>
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
