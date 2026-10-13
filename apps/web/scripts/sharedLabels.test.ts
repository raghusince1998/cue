import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCOUNT_STAGE_LABELS,
  BOARDS,
  BOARD_HI,
  CALL_OUTCOME_LABELS,
  DELIVERY_STATUS_HI,
  DELIVERY_STATUS_LABEL,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_HI,
  GREETING_OCCASIONS,
  KEEP_IN_TOUCH_CHOICES,
  KIND_LABELS,
  OCCASION_MESSAGES,
  OUTCOME_OPTIONS,
  PRIORITY_LABELS,
  REPEATS,
  REPEAT_HI,
  SCHEDULE_TEMPLATES,
  SECTION_GROUPS,
  STRICTNESS_LABELS,
  TARGET_METRICS,
  TEMPLATE_FIELDS,
  TRACKER_STAGE_HI,
  USES,
  USE_GROUPS,
  WINDOW_LABELS,
} from '@cue/shared'
import { HI } from '../src/lib/hi/index.ts'

// Labels that live in @cue/shared's tables reach the screen as t(label), a
// variable the coverage check cannot see. Each table the web app shows is
// listed here, so a label added to one of them is not left in English.

const TABLES: Record<string, string[]> = {
  ACCOUNT_STAGE_LABELS: Object.values(ACCOUNT_STAGE_LABELS),
  BOARDS: Object.values(BOARDS).flatMap((b) => [
    b.label,
    b.titleLabel,
    b.titlePlaceholder,
    b.detailLabel,
    b.detailPlaceholder,
    ...(b.valueLabel ? [b.valueLabel] : []),
    ...b.stages.map((s) => s.label),
  ]),
  CALL_OUTCOME_LABELS: Object.values(CALL_OUTCOME_LABELS),
  DELIVERY_STATUS_LABEL: Object.values(DELIVERY_STATUS_LABEL),
  EXPENSE_CATEGORIES: EXPENSE_CATEGORIES.map((c) => c.label),
  GREETING_OCCASIONS: GREETING_OCCASIONS.flatMap((g) => [g.label, g.message]),
  OCCASION_MESSAGES: Object.values(OCCASION_MESSAGES),
  KEEP_IN_TOUCH_CHOICES: KEEP_IN_TOUCH_CHOICES.map((c) => c.label),
  KIND_LABELS: Object.values(KIND_LABELS),
  OUTCOME_OPTIONS: OUTCOME_OPTIONS.map((o) => (typeof o === 'string' ? o : o.label)),
  PRIORITY_LABELS: Object.values(PRIORITY_LABELS),
  REPEATS: REPEATS.map((r) => r.label),
  SCHEDULE_TEMPLATES: SCHEDULE_TEMPLATES.flatMap((s) => [s.label, s.title, s.startLabel, s.caution]),
  SECTION_GROUPS: SECTION_GROUPS.map((g) => g.label),
  STRICTNESS_LABELS: Object.values(STRICTNESS_LABELS),
  TARGET_METRICS: TARGET_METRICS.flatMap((m) => [m.label, m.hint]),
  TEMPLATE_FIELDS: TEMPLATE_FIELDS.map((f) => f.label),
  USES: USES.flatMap((u) => [u.label, u.hint]),
  USE_GROUPS: USE_GROUPS.map((g) => g.label),
  WINDOW_LABELS: Object.values(WINDOW_LABELS),
}

for (const [name, labels] of Object.entries(TABLES)) {
  test(`${name} has Hindi for every label`, () => {
    assert.deepEqual(
      labels.filter((label) => !HI[label]),
      [],
    )
  })
}

// Quick add and the server say these labels from @cue/shared's own Hindi
// tables; the screens say them from lib/hi. Both must use the same words.
test('the screens and the server name these the same way in Hindi', () => {
  const differ: string[] = []
  const same = (en: string, hi: string) => {
    if (HI[en] !== hi) differ.push(`${en}: screens say ${HI[en]}, server says ${hi}`)
  }
  for (const r of REPEATS) same(r.label, REPEAT_HI[r.key])
  for (const [key, label] of Object.entries(DELIVERY_STATUS_LABEL)) same(label, DELIVERY_STATUS_HI[key as keyof typeof DELIVERY_STATUS_HI])
  for (const c of EXPENSE_CATEGORIES) same(c.label, EXPENSE_CATEGORY_HI[c.key])
  for (const [key, board] of Object.entries(BOARDS)) {
    same(board.label, BOARD_HI[key as keyof typeof BOARD_HI])
    for (const s of board.stages) same(s.label, TRACKER_STAGE_HI[key as keyof typeof TRACKER_STAGE_HI][s.key]!)
  }
  assert.deepEqual(differ, [])
})
