/**
 * Reading contacts off the phone, with the Contacts Picker.
 *
 * What this genuinely is: a one-shot picker, not a sync. Tapping it opens
 * Android's own contact chooser, and the browser hands back only the people
 * tapped and only the fields asked for. There is no background access, no
 * standing permission, and no way to read the address book without the person
 * seeing exactly what they are sharing — which is the right design, and worth
 * saying out loud in the UI rather than implying a sync that cannot exist.
 *
 * Availability is narrow and worth checking rather than assuming:
 *   - Chrome and Edge on Android. Not desktop, not iOS, not Firefox.
 *   - A secure context: https, or localhost while developing.
 *   - The top-level page, not an iframe.
 *   - A real user gesture; calling it from a timer silently fails.
 */

import { t } from './i18n.tsx'

export interface PickedContact {
  name: string
  phone: string | null
  email: string | null
}

interface ContactsManager {
  select: (
    properties: string[],
    options?: { multiple?: boolean },
  ) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>
  getProperties: () => Promise<string[]>
}

function manager(): ContactsManager | null {
  const nav = navigator as Navigator & { contacts?: ContactsManager }
  // ContactsManager also needs ContactAddress to be present; checking both is
  // how the spec suggests detecting real support rather than a partial shim.
  if (!nav.contacts || !('ContactsManager' in window)) return null
  return nav.contacts
}

export function deviceContactsAvailable(): boolean {
  return manager() !== null
}

/** Why it is not available, in words worth showing someone. */
export function deviceContactsReason(): string {
  if (deviceContactsAvailable()) return ''
  if (!window.isSecureContext) {
    return t('Reading your contacts needs a secure connection — it will work once this is on https.')
  }
  return t('Your phone’s contact picker is only offered by Chrome on Android. On this device you can add people by hand.')
}

/**
 * Opens the native picker. Must be called straight from a tap.
 *
 * Returns an empty array when the person cancels, which is not an error and is
 * deliberately indistinguishable from picking nobody.
 */
export async function pickDeviceContacts(): Promise<PickedContact[]> {
  const contacts = manager()
  if (!contacts) throw new Error(deviceContactsReason())

  // Ask only for what is actually used. A picker that requests addresses and
  // photos to store a phone number is asking for trust it has not earned.
  const supported = await contacts.getProperties()
  const wanted = ['name', 'tel', 'email'].filter((p) => supported.includes(p))
  if (wanted.length === 0) throw new Error(t('This phone does not share any contact details.'))

  const picked = await contacts.select(wanted, { multiple: true })

  return picked
    .map((c) => ({
      name: (c.name?.[0] ?? '').trim(),
      phone: c.tel?.[0]?.trim() ?? null,
      email: c.email?.[0]?.trim() ?? null,
    }))
    .filter((c) => c.name.length > 0)
}
