import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { decryptSecret, encryptSecret, maskKey, secretsConfigured } from '../secrets.ts'
import {
  AI_PROVIDERS,
  extractEvents,
  listOllamaModels,
  type AiConfig,
} from '../services/extract.ts'

const settingsInput = z.object({
  provider: z.enum(AI_PROVIDERS),
  /** Omitted leaves the stored key alone; empty string clears it. */
  apiKey: z.string().max(400).optional(),
  model: z.string().max(120).nullable().optional(),
  endpoint: z.string().url().max(400).nullable().optional(),
})

const extractInput = z.object({
  text: z.string().min(1).max(4000),
})

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /**
   * Whether this person may change settings that bill to the whole account.
   *
   * Read from the row rather than the token: a role put in the JWT stays true
   * for thirty days after it stops being true, and the one place that matters
   * is the one place it must not.
   */
  async function isOwner(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
    return row?.role === 'owner'
  }

  /** The guard itself, so every mutating route refuses the same way. */
  async function requireOwner(req: Parameters<typeof scope>[0], reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const { sub: userId } = scope(req)
    if (await isOwner(userId)) return true
    reply.code(403).send({
      error: 'owner_only',
      message: 'Only the account owner can change how sentences are understood.',
    })
    return false
  }

  async function orgRow(orgId: string) {
    const rows = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)).limit(1)
    return takeFirst(rows, 'org')
  }

  function toConfig(org: Awaited<ReturnType<typeof orgRow>>): AiConfig {
    return {
      provider: org.aiProvider as AiConfig['provider'],
      apiKey: org.aiApiKeyEncrypted ? decryptSecret(org.aiApiKeyEncrypted) : undefined,
      model: org.aiModel ?? undefined,
      endpoint: org.aiEndpoint ?? undefined,
    }
  }

  /** Never returns the key itself — only enough to recognise which one it is. */
  app.get('/ai/settings', async (req) => {
    const { orgId, sub: userId } = scope(req)
    const org = await orgRow(orgId)

    return {
      // Everyone can see whether it is on; only the owner can change it, and
      // the UI needs to know which of those to draw.
      canEdit: await isOwner(userId),
      provider: org.aiProvider,
      model: org.aiModel,
      endpoint: org.aiEndpoint,
      hasKey: Boolean(org.aiApiKeyEncrypted),
      keyHint: org.aiApiKeyEncrypted ? maskKey(decryptSecret(org.aiApiKeyEncrypted)) : null,
      encryptionAvailable: secretsConfigured(),
    }
  })

  app.patch('/ai/settings', async (req, reply) => {
    if (!(await requireOwner(req, reply))) return
    const { orgId } = scope(req)
    const body = settingsInput.parse(req.body)

    if (body.provider === 'anthropic' && body.apiKey && !secretsConfigured()) {
      // Refuse rather than fall back to storing it in plain text.
      return reply.code(500).send({ error: 'encryption_key_not_configured' })
    }
    const existing = await orgRow(orgId)

    /**
     * Switching to Ollama with nothing stored used to be refused, which was
     * unusable: the UI only shows the address field once the provider is set,
     * so rejecting the switch meant the field could never appear. Assume the
     * standard local address instead — it is what everyone runs — and let them
     * change it.
     */
    const endpoint =
      body.endpoint !== undefined
        ? body.endpoint || null
        : (existing.aiEndpoint ??
          (body.provider === 'ollama' ? 'http://127.0.0.1:11434' : null))

    await db
      .update(schema.orgs)
      .set({
        aiProvider: body.provider,
        ...(body.apiKey !== undefined
          ? { aiApiKeyEncrypted: body.apiKey ? encryptSecret(body.apiKey) : null }
          : {}),
        ...(body.model !== undefined ? { aiModel: body.model || null } : {}),
        aiEndpoint: endpoint,
      })
      .where(eq(schema.orgs.id, orgId))

    const org = await orgRow(orgId)
    return {
      provider: org.aiProvider,
      model: org.aiModel,
      endpoint: org.aiEndpoint,
      hasKey: Boolean(org.aiApiKeyEncrypted),
      keyHint: org.aiApiKeyEncrypted ? maskKey(decryptSecret(org.aiApiKeyEncrypted)) : null,
      encryptionAvailable: secretsConfigured(),
    }
  })

  /**
   * Asks an Ollama instance what it has pulled, so the model can be picked from
   * a list rather than typed from memory. Free — no inference happens.
   */
  app.post('/ai/ollama-models', async (req, reply) => {
    if (!(await requireOwner(req, reply))) return
    const { endpoint } = z
      .object({ endpoint: z.string().url().optional() })
      .parse(req.body ?? {})
    try {
      return { models: await listOllamaModels(endpoint) }
    } catch (err) {
      return reply.code(502).send({
        error: 'ollama_unreachable',
        detail: (err as Error).message.slice(0, 200),
      })
    }
  })

  /**
   * Runs one tiny real extraction through whatever is configured, so a broken
   * key, address or model name is caught here instead of the first time it
   * matters.
   */
  // Spends the account's own credit, so it is the owner's to spend.
  app.post('/ai/test', async (req, reply) => {
    if (!(await requireOwner(req, reply))) return
    const { orgId, sub: userId } = scope(req)
    const org = await orgRow(orgId)
    const config = toConfig(org)

    if (config.provider === 'none') {
      return reply.code(400).send({ error: 'ai_not_configured' })
    }

    const users = await db
      .select({ timezone: schema.users.timezone })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)

    try {
      const result = await extractEvents({
        text: 'team meeting tomorrow at 3pm for 30 minutes',
        config,
        now: new Date(),
        timezone: takeFirst(users, 'user').timezone,
      })
      return {
        ok: result.events.length > 0,
        provider: result.provider,
        model: config.model ?? null,
        sample: result.events[0] ?? null,
      }
    } catch (err) {
      return reply
        .code(502)
        .send({ error: 'test_failed', detail: (err as Error).message.slice(0, 400) })
    }
  })

  /**
   * Reads a dictated sentence and returns *proposals*. Writes nothing — the
   * client shows them and the user approves. A model that misreads a date
   * should cost a rejected suggestion, not a wrong entry in your calendar.
   */
  app.post('/ai/extract', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { text } = extractInput.parse(req.body)

    const org = await orgRow(orgId)
    const config = toConfig(org)
    if (config.provider === 'none') {
      return reply.code(400).send({ error: 'ai_not_configured' })
    }

    const users = await db
      .select({ timezone: schema.users.timezone })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)

    try {
      return await extractEvents({
        text,
        config,
        now: new Date(),
        timezone: takeFirst(users, 'user').timezone,
      })
    } catch (err) {
      req.log.warn({ err }, 'extraction failed')
      // Surfaced as a normal failure: the deterministic parser and the manual
      // form both still work, so this is never fatal.
      return reply
        .code(502)
        .send({ error: 'extraction_failed', detail: (err as Error).message.slice(0, 300) })
    }
  })
}
