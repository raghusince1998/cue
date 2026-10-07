import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { env } from './env.ts'

export interface AuthClaims {
  sub: string
  orgId: string
  email: string
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthClaims
    user: AuthClaims
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: env.jwtSecret,
    sign: { expiresIn: '30d' },
  })

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })
}

/**
 * Every authenticated handler pulls its tenant from here rather than from any
 * client-supplied field, so a caller can never read across orgs by guessing an
 * id.
 */
export function scope(req: FastifyRequest): AuthClaims {
  return req.user
}
