/**
 * Picking someone from the phone's own contacts — Chrome on Android offers
 * this (the Contact Picker): the person chooses one contact, and only that
 * one's name, number and email come back. Nothing is read without the tap.
 * Elsewhere it is simply not offered.
 */

interface PickedContact {
  name?: string[]
  tel?: string[]
  email?: string[]
}

interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<PickedContact[]>
}

export interface PhoneContact {
  name: string
  phone: string
  email: string
}

export function canPickFromPhone(): boolean {
  return typeof navigator !== 'undefined' && 'contacts' in navigator && typeof window !== 'undefined' && 'ContactsManager' in window
}

/** One contact the person chose, or null if they backed out. */
export async function pickFromPhone(): Promise<PhoneContact | null> {
  const manager = (navigator as Navigator & { contacts: ContactsManager }).contacts
  const [picked] = await manager.select(['name', 'tel', 'email'], { multiple: false })
  if (!picked) return null
  const name = picked.name?.find((n) => n.trim())?.trim() ?? ''
  const phone = picked.tel?.find((n) => n.trim())?.trim() ?? ''
  const email = picked.email?.find((n) => n.trim())?.trim() ?? ''
  return name || phone ? { name: name || phone, phone, email } : null
}
