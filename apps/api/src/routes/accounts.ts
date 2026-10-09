import type { FastifyInstance } from 'fastify'
import { ACCOUNT_STAGES, renameAccountInput, saveAccountInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { listAccounts, renameAccount, saveAccount } from '../services/accounts.ts'

/** The clinics and companies people work at. The detail lives with the commitment routes. */
export async function accountRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/accounts', async (req) => {
    const { orgId, sub: userId } = scope(req)
    const list = await listAccounts(orgId, userId)
    const stages = Object.fromEntries(ACCOUNT_STAGES.map((s) => [s, list.filter((a) => a.stage === s).length]))
    return {
      stages,
      accounts: list.map((a) => ({
        key: a.key,
        name: a.name,
        stage: a.stage,
        stageChangedAt: a.stageChangedAt?.toISOString() ?? null,
        people: a.people.length,
        peopleNames: a.people.slice(0, 3).map((p) => p.name),
        waiting: a.waiting.length,
        waitingDue: a.waitingDue,
        owe: a.owe.length,
        hasNext: a.nextMeetings.length > 0,
        lastContact: a.lastContact?.toISOString() ?? null,
        reachOut: a.reachOut,
        quiet: a.quiet,
      })),
    }
  })

  /** Stage or notes; the account's own row is made the first time either is set. */
  app.put('/accounts', async (req) => {
    const { orgId } = scope(req)
    await saveAccount(orgId, saveAccountInput.parse(req.body))
    return { ok: true }
  })

  app.post('/accounts/rename', async (req) => {
    const { orgId } = scope(req)
    const { from, to } = renameAccountInput.parse(req.body)
    await renameAccount(orgId, from, to)
    return { ok: true }
  })
}
