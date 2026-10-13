import { notify } from './notify.ts'
import { capture } from './capture.ts'

/** Every area's Hindi, by the English it stands for. */
export const AREAS: Record<string, Record<string, string>> = { notify, capture }

export const HI: Record<string, string> = Object.assign({}, ...Object.values(AREAS))
