import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { addNoticeInput, reviewNoticeInput } from '@cue/shared'
import { scope } from '../auth.ts'
import {
  addNotice,
  approveNotice,
  dismissNotice,
  isAdmin,
  listNotices,
  noticeCounts,
  runNoticeWatch,
  sourceStatus,
  uploadList,
} from '../services/noticeWatch.ts'

/** A result list can run to hundreds of pages. */
const MAX_LIST_BYTES = 40 * 1024 * 1024

const idParam = z.object({ id: z.string().uuid() })
const statusQuery = z.object({ status: z.enum(['pending', 'unmatched', 'approved', 'dismissed']).default('pending') })

/**
 * Reviewing official exam notices: only for the accounts in ADMIN_EMAILS.
 * Everyone else is told the routes are not there.
 */
export async function noticeRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: MAX_LIST_BYTES }, (_req, body, done) => done(null, body))
  app.addHook('onRequest', app.authenticate)
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAdmin(scope(req).email)) return reply.code(404).send({ error: 'not_found' })
  })

  app.get('/admin/notices', async (req) => {
    const { status } = statusQuery.parse(req.query)
    return { notices: await listNotices(status), counts: await noticeCounts(), sources: await sourceStatus() }
  })

  /** Read the watched pages now, rather than at the next half-day. */
  app.post('/admin/notices/check', async () => ({ runs: await runNoticeWatch() }))

  /** A notice from a page no robot reads, added by hand. */
  app.post('/admin/notices', async (req, reply) => reply.code(201).send(await addNotice(addNoticeInput.parse(req.body))))

  app.post('/admin/notices/:id/approve', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const { proposals } = reviewNoticeInput.parse(req.body)
    const done = await approveNotice(id, scope(req).sub, proposals)
    if (done === 'not_found') return reply.code(404).send({ error: 'not_found' })
    if (done === 'already') return reply.code(409).send({ error: 'already_reviewed' })
    return done
  })

  /**
   * A result list's PDF, handed over by the reviewer — for a board whose
   * site no robot may read. Its roll numbers are kept with the notice; its
   * cut-offs are read for the reviewer to check.
   */
  app.post('/admin/notices/:id/list', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'pdf_expected' })
    const read = await uploadList(id, new Uint8Array(req.body))
    return read ?? reply.code(422).send({ problem: 'No roll numbers could be read from it. A scanned list cannot be read.' })
  })

  app.post('/admin/notices/:id/dismiss', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await dismissNotice(id, scope(req).sub)) ? { ok: true } : reply.code(409).send({ error: 'already_reviewed' })
  })
}
