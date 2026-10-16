import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

/** Postgres: a value that cannot be read as its column's type — "abc" as a uuid. */
const BAD_TEXT = '22P02'

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } }
  const code = typeof e.code === 'string' ? e.code : e.cause?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * Every route's uncaught error, answered the same way.
 *
 * - Bad input (a body that fails its schema, an id in a link that is not an
 *   id at all) is the caller's: 400, not a 500 that reads as the server down.
 * - A real 500 says `internal_error` and nothing more. The database's own
 *   words stay in the log; they help nobody reading the app and tell an
 *   outsider which tables exist.
 */
export function handleError(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'invalid_input', issues: err.issues })
  }
  if (pgCode(err) === BAD_TEXT) {
    return reply.code(400).send({ error: 'invalid_input' })
  }
  const status = (err as FastifyError).statusCode ?? 500
  if (status >= 500) {
    req.log.error(err)
    return reply.code(status).send({ error: 'internal_error' })
  }
  return reply.code(status).send({ error: err.message || 'request_failed' })
}
