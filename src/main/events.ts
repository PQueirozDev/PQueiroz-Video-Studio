import { EventEmitter } from 'node:events'

// Eventos de fundo (proxies, montagem da timeline) repassados à interface pelo ipc.ts.
export const bus = new EventEmitter()

export interface MediaChanged { projectId: string }
export interface TaskProgress { projectId: string; task: 'montagem'; text: string; progress: number | null; done?: boolean; error?: string }
