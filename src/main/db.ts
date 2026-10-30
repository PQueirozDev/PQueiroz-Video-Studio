import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { app } from 'electron'

// SQLite guarda apenas metadados e caminhos — nunca os vídeos.
let db: DatabaseSync | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS timeline_history (project_id TEXT PRIMARY KEY, past TEXT NOT NULL DEFAULT '[]', future TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS compositions (project_id TEXT PRIMARY KEY, doc TEXT NOT NULL, past TEXT NOT NULL DEFAULT '[]', future TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subtitles (project_id TEXT NOT NULL, source TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(project_id, source));
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  resolution TEXT NOT NULL,
  fps TEXT NOT NULL,
  preset TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'novo',
  claude_session_id TEXT,
  current_version_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration REAL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  codec TEXT,
  has_audio INTEGER NOT NULL DEFAULT 0,
  thumbnail TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_project ON media(project_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  activity TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, created_at);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  source_path TEXT,
  request TEXT NOT NULL DEFAULT '',
  changes TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  duration REAL,
  thumbnail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_project ON versions(project_id, number);
CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  settings TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  encoder TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS runs (
  project_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  request TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS image_projects (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  brand_id TEXT,
  format_id TEXT NOT NULL,
  original_prompt TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'premium-3d',
  provider TEXT NOT NULL DEFAULT 'composition',
  last_export TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS image_generations (
  request_key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  path TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS styles (id TEXT PRIMARY KEY, name TEXT NOT NULL, brand_id TEXT, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`

// Colunas acrescentadas depois da primeira versão (bancos antigos recebem via ALTER TABLE).
const MIGRATIONS: [table: string, column: string, type: string][] = [
  ['media', 'trim_in', 'REAL'],
  ['media', 'trim_out', 'REAL'],
  ['media', 'in_timeline', 'INTEGER NOT NULL DEFAULT 1'],
  ['media', 'proxy', 'TEXT'],
  ['versions', 'favorite', 'INTEGER NOT NULL DEFAULT 0'],
  ['renders', 'remaining_seconds', 'REAL'],
  ['renders', 'estimated_bytes', 'REAL'],
  ['renders', 'notice', 'TEXT'],
  ['projects', 'kind', "TEXT NOT NULL DEFAULT 'video'"],
  ['projects', 'brand_id', 'TEXT'],
  ['projects', 'style_id', 'TEXT']
]

function migrate(d: DatabaseSync): void {
  for (const [table, column, type] of MIGRATIONS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(join(app.getPath('userData'), 'studio.db'))
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    db.exec(SCHEMA)
    migrate(db)
  }
  return db
}

export type Row = Record<string, unknown>

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[]
}

export function one<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined
}

export function run(sql: string, ...params: unknown[]): void {
  getDb().prepare(sql).run(...(params as never[]))
}
