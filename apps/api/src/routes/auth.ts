import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { loginInput, registerInput } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = registerInput.parse(req.body)
    const email = body.email.toLowerCase().trim()

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)

    if (existing.length > 0) {
      return reply.code(409).send({ error: 'email_taken' })
    }

    const passwordHash = await bcrypt.hash(body.password, 10)

    // Registering creates the tenant too. Inviting teammates into an existing
    // org comes later; this keeps the multi-tenant shape correct from day one.
    const { org, user } = await db.transaction(async (tx) => {
      const org = takeFirst(
        await tx.insert(schema.orgs).values({ name: body.orgName }).returning(),
        'org',
      )
      const user = takeFirst(
        await tx
          .insert(schema.users)
          // Registering created the org, so this person owns it.
          .values({ orgId: org.id, name: body.name, email, passwordHash, role: 'owner' })
          .returning(),
        'user',
      )
      return { org, user }
    })

    const token = app.jwt.sign({ sub: user.id, orgId: org.id, email })
    return { token, user: { id: user.id, name: user.name, email }, org: { id: org.id, name: org.name } }
  })

  app.post('/auth/login', async (req, reply) => {
    const body = loginInput.parse(req.body)
    const email = body.email.toLowerCase().trim()

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)

    const user = rows[0]
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }

    const token = app.jwt.sign({ sub: user.id, orgId: user.orgId, email })
    return { token, user: { id: user.id, name: user.name, email } }
  })

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = scope(req)
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        orgId: schema.users.orgId,
        orgName: schema.orgs.name,
      })
      .from(schema.users)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.users.orgId))
      .where(eq(schema.users.id, sub))
      .limit(1)

    return takeFirst(rows, 'user')
  })
}
