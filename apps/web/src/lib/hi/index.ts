import { common } from './common.ts'
import { today } from './today.ts'
import { add } from './add.ts'
import { money } from './money.ts'
import { people } from './people.ts'
import { settings } from './settings.ts'
import { plans } from './plans.ts'
import { work } from './work.ts'
import { site } from './site.ts'

/**
 * Every area's Hindi, by the English it stands for. Split by area so each
 * stays readable; one line means the same in all of them, which the test
 * checks.
 */
export const AREAS: Record<string, Record<string, string>> = { common, today, add, money, people, settings, plans, work, site }

export const HI: Record<string, string> = Object.assign({}, ...Object.values(AREAS))
