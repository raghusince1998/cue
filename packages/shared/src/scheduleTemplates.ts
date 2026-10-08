import type { ScheduleStep } from './schedule.ts'

/**
 * Ready-made schedules, to start from rather than type out.
 *
 * Each is a starting point, not advice: every step stays editable before it is
 * booked, and the template says where it comes from and what to check it
 * against.
 */
export interface ScheduleTemplate {
  id: string
  label: string
  /** The schedule's name when the person has not typed one. */
  title: string
  /** What "Counting from" means for this template. */
  startLabel: string
  /** Shown with the template: its source, and what to check it against. */
  caution: string
  hour: number
  minute: number
  steps: ScheduleStep[]
}

/**
 * India's National Immunization Schedule for children, under the Universal
 * Immunization Programme (Ministry of Health and Family Welfare).
 *
 * Where the schedule gives a window ("9–12 months", "16–24 months",
 * "5–6 years"), the step is placed at the start of it — the earliest the dose
 * is due, which is when a reminder is useful. JE is given only in endemic
 * districts. Vitamin A continues every six months until age five after the
 * second dose; those are left to the health centre rather than guessed at.
 */
export const INDIA_UIP_CHILD: ScheduleTemplate = {
  id: 'india-uip-child',
  label: "India — government vaccination schedule (UIP)",
  title: 'Vaccinations',
  startLabel: "Child's date of birth",
  caution:
    "From India's National Immunization Schedule (Universal Immunization Programme). Dates are the earliest each dose is due. JE is given only in some districts. Always go by your child's MCP card and your health worker or doctor — remove or change any step to match.",
  hour: 10,
  minute: 0,
  steps: [
    { title: 'BCG, OPV-0, Hepatitis B birth dose', offset: { amount: 0, unit: 'days' } },
    { title: 'OPV-1, Pentavalent-1, Rotavirus-1, fIPV-1, PCV-1', offset: { amount: 6, unit: 'weeks' } },
    { title: 'OPV-2, Pentavalent-2, Rotavirus-2', offset: { amount: 10, unit: 'weeks' } },
    { title: 'OPV-3, Pentavalent-3, Rotavirus-3, fIPV-2, PCV-2', offset: { amount: 14, unit: 'weeks' } },
    {
      title: 'MR-1, PCV booster, fIPV-3, JE-1 (where given), Vitamin A dose 1',
      offset: { amount: 9, unit: 'months' },
    },
    {
      title: 'MR-2, DPT booster-1, OPV booster, JE-2 (where given), Vitamin A dose 2',
      offset: { amount: 16, unit: 'months' },
    },
    { title: 'DPT booster-2', offset: { amount: 5, unit: 'years' } },
    { title: 'Td', offset: { amount: 10, unit: 'years' } },
    { title: 'Td', offset: { amount: 16, unit: 'years' } },
  ],
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [INDIA_UIP_CHILD]
