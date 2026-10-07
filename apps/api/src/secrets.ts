import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { env } from './env.ts'

/**
 * Symmetric encryption for the one secret we are asked to hold: a customer's
 * own API key.
 *
 * They are trusting us with something that costs them money if it leaks, so it
 * never goes to disk in plain text. AES-256-GCM rather than CBC because it
 * authenticates as well as encrypts — a tampered ciphertext fails to decrypt
 * instead of quietly producing garbage.
 */

const ALGORITHM = 'aes-256-gcm'
/** Fixed salt: the passphrase is already high-entropy, and a per-value salt
 *  would mean re-deriving the key on every single call.
 *
 *  It still says `recall` because this salt is part of the key derivation:
 *  renaming it to match the app would silently make every stored provider key
 *  undecryptable, with no error until someone tried to use one. Left alone
 *  deliberately — the app's name is not worth a round of data loss. */
const SALT = 'recall.secrets.v1'

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey
  if (!env.encryptionKey) {
    throw new Error('ENCRYPTION_KEY is not set — cannot store provider keys safely.')
  }
  cachedKey = scryptSync(env.encryptionKey, SALT, 32)
  return cachedKey
}

export function secretsConfigured(): boolean {
  return Boolean(env.encryptionKey)
}

/** Returns `iv:tag:ciphertext`, all base64 — one self-describing column value. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(
    ':',
  )
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('stored secret is malformed')

  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** Never return a key to the client — only enough to confirm which one it is. */
export function maskKey(plain: string): string {
  if (plain.length <= 8) return '••••'
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`
}
