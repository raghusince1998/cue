/**
 * What to pack, for this trip.
 *
 * Not a generic list: how many nights decides how many changes of clothes, a
 * flight adds what a flight asks of you, a work trip adds the laptop and the
 * office ID, a trip abroad the passport and the adapter. Short enough to go
 * through in a few minutes, and every item one tap to tick.
 */

export type TripPurpose = 'work' | 'leisure'
export type TravelMode = 'flight' | 'train' | 'bus' | 'road'

export interface PackingInput {
  nights: number
  purpose: TripPurpose
  /** How they get there and back: what each journey asks for. */
  modes: TravelMode[]
  /** Leaving the country: passport, visa, money and plugs. */
  international?: boolean
}

export interface PackingSection {
  title: string
  items: string[]
}

export function packingList(input: PackingInput): PackingSection[] {
  const nights = Math.max(0, Math.round(input.nights))
  // A change a day, and a spare; past a week, the hotel laundry does the rest.
  const changes = Math.min(nights + 1, 7)
  const sections: PackingSection[] = []

  const essentials = ['Phone and charger', 'Power bank', 'Wallet, cards and some cash', 'ID (Aadhaar or driving licence)', 'Tickets and booking references']
  if (input.international) essentials.unshift('Passport and visa')
  sections.push({ title: 'Essentials', items: essentials })

  const clothes =
    nights === 0
      ? ['A spare top, in case']
      : [`${changes} sets of clothes`, `${changes} sets of underwear and socks`, 'Something to sleep in', 'Comfortable shoes']
  if (input.purpose === 'work' && nights > 0) clothes.unshift('Work clothes for each day')
  if (nights >= 3) clothes.push('A light jacket or layer')
  sections.push({ title: 'Clothes', items: clothes })

  if (nights > 0) {
    sections.push({
      title: 'Toiletries',
      items: ['Toothbrush and toothpaste', 'Deodorant', 'Comb or brush', 'Any medicines you take', 'Sunscreen'],
    })
  }

  if (input.purpose === 'work') {
    sections.push({
      title: 'Work',
      items: ['Laptop and charger', 'Office ID card', 'Notebook and pen', 'Visiting cards', 'Presentation or documents, offline'],
    })
  }

  const journey: string[] = []
  if (input.modes.includes('flight')) {
    journey.push('Liquids under 100 ml, in one clear bag', 'Web check-in done, boarding pass on the phone')
  }
  if (input.modes.includes('train') || input.modes.includes('bus')) {
    journey.push('Water bottle and snacks', 'A shawl or light blanket for the night')
  }
  if (input.modes.includes('road')) journey.push('Driving licence, RC and PUC', 'FASTag balance checked')
  if (input.international) journey.push('Travel adapter', 'Some local currency or a forex card', 'Travel insurance details')
  if (journey.length > 0) sections.push({ title: 'For the journey', items: journey })

  return sections
}

/** The list flattened, section by section, as a checklist reads it. */
export function packingItems(input: PackingInput): string[] {
  return packingList(input).flatMap((s) => s.items)
}
