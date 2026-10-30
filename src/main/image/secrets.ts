import { safeStorage } from 'electron'
import { one, run } from '../db'

// Chaves de API ficam criptografadas com o cofre do sistema (DPAPI no Windows, Keychain/libsecret
// no macOS/Linux), numa tabela separada das configurações. Nunca são enviadas ao renderer:
// a interface só recebe "tem chave" e os 4 últimos caracteres.

const ENV: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY']
}

export function setSecret(name: string, value: string | null): void {
  const key = `secret:${name}`
  if (!value) {
    run('DELETE FROM secrets WHERE key = ?', key)
    return
  }
  const v = value.trim()
  if (v.length < 8 || v.length > 400 || /\s/.test(v)) throw new Error('Chave de API inválida.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('O armazenamento seguro do sistema não está disponível. Defina a chave na variável de ambiente ' + (ENV[name]?.[0] ?? 'do provedor') + '.')
  }
  run('INSERT INTO secrets(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, safeStorage.encryptString(v).toString('base64'))
}

/** Somente para uso no processo principal (chamadas HTTP aos provedores). */
export function getSecret(name: string): string | null {
  const row = one<{ value: string }>('SELECT value FROM secrets WHERE key = ?', `secret:${name}`)
  if (row) {
    try {
      return safeStorage.decryptString(Buffer.from(row.value, 'base64'))
    } catch {
      return null
    }
  }
  for (const env of ENV[name] ?? []) if (process.env[env]) return process.env[env]!
  return null
}

export function secretHint(name: string): string | null {
  const s = getSecret(name)
  return s ? `…${s.slice(-4)}` : null
}
