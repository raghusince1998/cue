import type { FastifyInstance } from 'fastify'
import { saveTargetsInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { saveTargets, weekTargets } from '../services/targets.ts'

export async function targetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** This week so far against each target, and last week beside it. */
  app.get('/targets/week', async (req) => weekTargets(scope(req).sub))

  app.put('/targets', async (req) => {
    const { sub } = scope(req)
    await saveTargets(sub, saveTargetsInput.parse(req.body).targets)
    return weekTargets(sub)
  })
}
