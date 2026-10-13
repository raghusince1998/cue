/**
 * Rows of cells — from an email's table, or a PDF's lines — as text the
 * readers can follow: a value next to what it is.
 *
 * A row of labels over rows of values, how IRCTC lays out a ticket and a bank
 * a statement, becomes "Label: value" pairs; flattened, "PNR Train No./Name
 * Class" and "2345678901 12951/MUMBAI RAJDHANI 3A" came apart and read as
 * nothing. A key beside its value becomes "Key: value". Any other row keeps
 * its cells apart with a bar, so one value never runs into the next.
 */

/**
 * A row of labels: short, wordy cells such as "PNR | Train No./Name | Class".
 * Not a row of station or airport names: "MUMBAI CENTRAL (MMCT)" is a value.
 */
export function isLabelRow(cells: string[]): boolean {
  return (
    cells.length >= 2 &&
    cells.every(
      (c) => c.length > 0 && c.length <= 32 && !/\d{3,}/.test(c) && !/[₹$]/.test(c) && /^[A-Za-z#]/.test(c) && !/\([A-Z0-9]{2,5}\)/.test(c),
    )
  )
}

/** A value row that carries its own labels — "Start Date* 17-Oct-2026" — needs none from above. */
function labelsItself(cells: string[]): boolean {
  return cells.every((c) => /^[A-Za-z][A-Za-z ./]{1,25}[*:]\s*\S/.test(c))
}

const label = (s: string) => s.replace(/[:*\s]+$/, '')

export function rowsToText(rows: string[][]): string {
  const out: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!.filter((c) => c !== '')
    if (row.length === 0) continue
    const next = rows[i + 1]?.filter((c) => c !== '')
    if (next && isLabelRow(row) && next.length === row.length && !isLabelRow(next) && !labelsItself(next)) {
      // Every value row under the same labels: a passenger list has several.
      let j = i + 1
      for (; ; j++) {
        const values = rows[j]?.filter((c) => c !== '')
        if (!values || values.length !== row.length || isLabelRow(values) || labelsItself(values)) break
        out.push(row.map((l, k) => `${label(l)}: ${values[k]}`).join('\n'))
      }
      i = j - 1
      continue
    }
    // A key and its value side by side: "Credit Card ending | 1234".
    if (row.length === 2 && isLabelRow([row[0]!, 'x']) && !isLabelRow([row[1]!, 'x'])) {
      out.push(`${label(row[0]!)}: ${row[1]}`)
      continue
    }
    out.push(row.join(' | '))
  }
  return out.join('\n')
}
