import type { FastifyInstance } from 'fastify'
import { scope } from '../auth.ts'
import { markReviewed, sendReviewTo, weekReview } from '../services/weeklyReview.ts'

/** The weekly review. See services/weeklyReview.ts. */
export async function reviewRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/review/week', async (req) => {
    const { sub: userId } = scope(req)
    return weekReview(userId)
  })

  /** "Finish review": the week has been looked at. */
  app.post('/review/week/done', async (req) => {
    const { sub: userId } = scope(req)
    await markReviewed(userId)
    return { ok: true }
  })

  /** This week's Friday notification, now, to see what it says. */
  app.post('/review/week/test', async (req) => {
    const { sub: userId } = scope(req)
    return (await sendReviewTo(userId)) ?? { delivered: 0, title: null, body: null, empty: true }
  })
}
