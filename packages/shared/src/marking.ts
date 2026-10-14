/**
 * How an exam's paper is marked, for working out a score from the answer
 * key: the questions, the marks for each right answer, and the marks taken
 * away for each wrong one. Only where the board's notification has set it
 * plainly for years; for any other exam, or a different paper, the person
 * types it in. Normalisation and sectional cut-offs are not modelled: the
 * score is what the answer key gives, a guide to where one stands.
 */

export interface Marking {
  questions: number
  right: number
  wrong: number
}

const third = 1 / 3

export const MARKING: Record<string, Record<string, Marking>> = {
  'rrb-ntpc': { cbt1: { questions: 100, right: 1, wrong: third }, cbt2: { questions: 120, right: 1, wrong: third } },
  'rrb-group-d': { cbt: { questions: 100, right: 1, wrong: third } },
  'rrb-alp': { cbt1: { questions: 75, right: 1, wrong: third } },
  'ssc-cgl': { tier1: { questions: 100, right: 2, wrong: 0.5 } },
  'ssc-chsl': { tier1: { questions: 100, right: 2, wrong: 0.5 } },
  'ssc-cpo': { paper1: { questions: 200, right: 1, wrong: 0.25 } },
  'upsc-cse': { prelims: { questions: 100, right: 2, wrong: 2 / 3 } },
  'ibps-po': { prelims: { questions: 100, right: 1, wrong: 0.25 } },
  'ibps-clerk': { prelims: { questions: 100, right: 1, wrong: 0.25 } },
  'sbi-po': { prelims: { questions: 100, right: 1, wrong: 0.25 } },
  'sbi-clerk': { prelims: { questions: 100, right: 1, wrong: 0.25 } },
  'neet-ug': { exam: { questions: 180, right: 4, wrong: 1 } },
  'jee-main': { session1: { questions: 75, right: 4, wrong: 1 }, session2: { questions: 75, right: 4, wrong: 1 } },
  ctet: { exam: { questions: 150, right: 1, wrong: 0 } },
  reet: { exam: { questions: 150, right: 1, wrong: 0 } },
}

/** The board's marking for this exam and round, if Cue knows it. */
export function markingFor(examKey: string | null | undefined, round: string | null | undefined): Marking | null {
  if (!examKey) return null
  const rounds = MARKING[examKey]
  if (!rounds) return null
  if (round) return rounds[round] ?? null
  // No round said: an exam of one paper has only the one marking.
  return Object.keys(rounds).length === 1 ? Object.values(rounds)[0]! : null
}

const two = (n: number) => Math.round(n * 100) / 100

/** The score the answer key gives: right answers' marks less wrong answers' penalty. */
export function expectedScore(right: number, wrong: number, marking: Marking): { score: number; outOf: number; unattempted: number } {
  return {
    score: two(right * marking.right - wrong * marking.wrong),
    outOf: two(marking.questions * marking.right),
    unattempted: Math.max(0, marking.questions - right - wrong),
  }
}
