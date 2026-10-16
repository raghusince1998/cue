import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { announceChange } from '../lib/changes.ts'
import { t } from '../lib/i18n.tsx'
import { useOpenings, type Opening } from '../lib/open.ts'
import { AccountSheet } from './AccountSheet.tsx'
import { CommitmentSheet } from './CommitmentSheet.tsx'
import { ContactEditor } from './ContactEditor.tsx'
import { Modal } from './Modal.tsx'
import { PersonSheet } from './PersonSheet.tsx'
import { TripDetail } from './TripDetail.tsx'

/** What can be on the stack: what was asked for, and the editors reached from it. */
type Entry = Opening | { kind: 'edit-person'; id: string } | { kind: 'add-person'; organization: string }

const keyOf = (e: Entry): string =>
  e.kind === 'account' ? `account:${e.name}` : e.kind === 'add-person' ? `add:${e.organization}` : `${e.kind}:${e.id}`

/** Deep enough for plan → person → their plan → back; past that, the oldest goes. */
const MAX_DEPTH = 6

/**
 * Whatever openPlan / openPerson / openTrip / openAccount asked for, as a
 * stack of sheets over the screen. A plan opened from a person's page closes
 * back to that person; a person opened from a plan closes back to the plan.
 */
export function Opener() {
  const [stack, setStack] = useState<Entry[]>([])
  const location = useLocation()

  useOpenings((opening) =>
    setStack((s) => {
      // Asking again for what is already on top changes nothing.
      if (s.length > 0 && keyOf(s[s.length - 1]!) === keyOf(opening)) return s
      return [...s, opening].slice(-MAX_DEPTH)
    }),
  )

  // A link inside a sheet ("See the series") has gone somewhere else: what
  // was open over the old screen goes with it.
  useEffect(() => setStack([]), [location.pathname])

  /** Close this one, and anything opened from it. */
  const closeAt = (i: number) => setStack((s) => s.slice(0, i))
  /** Swap this one for another, in place: a colleague, the editor, back from it. */
  const swapAt = (i: number, entry: Entry) => setStack((s) => [...s.slice(0, i), entry])

  return (
    <>
      {stack.map((entry, i) => {
        const key = `${i}:${keyOf(entry)}`
        switch (entry.kind) {
          case 'plan':
            return (
              <CommitmentSheet
                key={key}
                commitmentId={entry.id}
                onClose={() => closeAt(i)}
                onChanged={announceChange}
                onOpenOther={(id) => swapAt(i, { kind: 'plan', id })}
              />
            )
          case 'person':
            return (
              <Modal key={key} title={t('Person')} onClose={() => closeAt(i)}>
                <PersonSheet
                  contactId={entry.id}
                  onEdit={() => swapAt(i, { kind: 'edit-person', id: entry.id })}
                  onChanged={announceChange}
                  onOpenPerson={(id) => swapAt(i, { kind: 'person', id })}
                  onOpenAccount={(name) => swapAt(i, { kind: 'account', name })}
                />
              </Modal>
            )
          case 'edit-person':
            return (
              <Modal key={key} title={t('Edit person')} onClose={() => swapAt(i, { kind: 'person', id: entry.id })}>
                <ContactEditor
                  contactId={entry.id}
                  onClose={() => swapAt(i, { kind: 'person', id: entry.id })}
                  onSaved={() => {
                    announceChange()
                    swapAt(i, { kind: 'person', id: entry.id })
                  }}
                />
              </Modal>
            )
          case 'add-person':
            return (
              <Modal key={key} title={t('Add person')} onClose={() => closeAt(i)}>
                <ContactEditor
                  contactId={null}
                  initialOrganization={entry.organization}
                  onClose={() => closeAt(i)}
                  onSaved={() => {
                    announceChange()
                    closeAt(i)
                  }}
                />
              </Modal>
            )
          case 'trip':
            return (
              <Modal key={key} title={t('Trip')} onClose={() => closeAt(i)}>
                <TripDetail tripId={entry.id} onClose={() => closeAt(i)} onChanged={announceChange} />
              </Modal>
            )
          case 'account':
            return (
              <Modal key={key} title={t('Account')} onClose={() => closeAt(i)}>
                <AccountSheet
                  name={entry.name}
                  onOpenPerson={(id) => swapAt(i, { kind: 'person', id })}
                  onAddPerson={(organization) => swapAt(i, { kind: 'add-person', organization })}
                  onRenamed={(to) => {
                    announceChange()
                    swapAt(i, { kind: 'account', name: to })
                  }}
                  onChanged={announceChange}
                />
              </Modal>
            )
        }
      })}
    </>
  )
}
