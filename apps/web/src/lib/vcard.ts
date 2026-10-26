/**
 * A person as a contact card (vCard 3.0) — the file every phone's contacts
 * app opens with "Add to contacts". How someone on a deal gets from Cue's
 * People into the phone's own address book: a web page cannot write there,
 * but it can hand the phone this.
 */

export interface CardPerson {
  name: string
  phone?: string | null
  email?: string | null
  organization?: string | null
}

/** Commas, semicolons, backslashes and line breaks mean something in a vCard. */
function esc(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

/** A number a phone can dial from anywhere: an Indian mobile gains +91. */
function dialable(raw: string | null | undefined): string {
  const kept = (raw ?? '').replace(/[^\d+]/g, '')
  if (kept.startsWith('+')) return kept
  const digits = kept.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return digits
}

export function vcard(person: CardPerson): string {
  const name = person.name.trim().replace(/\s+/g, ' ')
  const words = name.split(' ')
  const family = words.length > 1 ? words.at(-1)! : ''
  const given = words.length > 1 ? words.slice(0, -1).join(' ') : name
  const phone = dialable(person.phone)
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(name)}`,
    `N:${esc(family)};${esc(given)};;;`,
    phone ? `TEL;TYPE=CELL:${phone}` : null,
    person.email?.trim() ? `EMAIL:${esc(person.email.trim())}` : null,
    person.organization?.trim() ? `ORG:${esc(person.organization.trim())}` : null,
    'END:VCARD',
  ]
  return lines.filter(Boolean).join('\r\n') + '\r\n'
}

/** Hand the phone the card: it offers to add the person to its contacts. */
export function saveToPhone(person: CardPerson): void {
  const blob = new Blob([vcard(person)], { type: 'text/vcard' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${person.name.trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60) || 'contact'}.vcf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
