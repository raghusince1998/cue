import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { rowsToText } from './layout.ts'

/**
 * The text of a PDF ticket, laid out as the readers read an email.
 *
 * Many tickets live only in their attachment: the e-ticket PDF an airline or
 * a travel site sends, the ERS from IRCTC. A PDF has no lines, only words
 * placed on a page, so lines are rebuilt from where each word sits; words far
 * apart on a line are separate cells; and a row of labels over a row of
 * values becomes "Label: value", as an email's table does (layout.ts).
 *
 * Null for what cannot be read — a PDF locked with a password, as bank
 * statements often are, or a scan that is a picture of text — and nothing is
 * kept: it is read in memory, like the email it came with.
 */
export async function pdfText(data: Uint8Array, maxPages = 4): Promise<string | null> {
  // A plain Uint8Array of its own: PDF.js refuses a Node Buffer.
  const task = getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch {
    await task.destroy()
    return null
  }
  try {
    const rows: string[][] = []
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const words = content.items.flatMap((i) =>
        'str' in i && i.str.trim() !== ''
          ? [{ text: i.str, x: i.transform[4] as number, y: i.transform[5] as number, w: i.width, size: Math.abs(i.transform[3] as number) || i.height || 10 }]
          : [],
      )
      // A line: words whose baselines sit within a few points of each other.
      const lines: { y: number; words: typeof words }[] = []
      for (const word of words.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const line = lines.find((l) => Math.abs(l.y - word.y) <= Math.max(2, word.size * 0.4))
        if (line) line.words.push(word)
        else lines.push({ y: word.y, words: [word] })
      }
      for (const line of lines.sort((a, b) => b.y - a.y)) {
        const cells: string[] = []
        let cell = ''
        let end = -Infinity
        for (const word of line.words.sort((a, b) => a.x - b.x)) {
          const gap = word.x - end
          // Far apart: another column. Near: another word in the same one.
          if (cell && gap > word.size * 1.5) {
            cells.push(cell.trim())
            cell = ''
          } else if (cell && gap > word.size * 0.15 && !cell.endsWith(' ') && !word.text.startsWith(' ')) {
            cell += ' '
          }
          cell += word.text
          end = word.x + word.w
        }
        if (cell.trim()) cells.push(cell.replace(/\s+/g, ' ').trim())
        rows.push(cells)
      }
      page.cleanup()
    }
    const text = rowsToText(rows).trim()
    return text || null
  } catch {
    return null
  } finally {
    await task.destroy()
  }
}
