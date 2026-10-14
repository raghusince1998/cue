// Builds the Word version of docs/DEVELOPER.md: the same content, laid out
// for reading and printing — a title page, the contents, each main section
// on a new page, tables, code, and the diagrams as images.
const fs = require('node:fs')
const path = require('node:path')
const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require('docx')

const [, , mdPath, diagramsDir, outPath] = process.argv
const md = fs.readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n')
const lines = md.split('\n')

const FONT = 'Calibri'
const MONO = 'Consolas'
const ACCENT = '4338CA'
const MUTED = '5D6675'
const PAGE_W = 11906 // A4, twentieths of a point
const MARGIN = 1134 // 2 cm
const CONTENT_W = PAGE_W - 2 * MARGIN // 9638
const IMG_MAX_PX = 640 // at 96 dpi, about 6.7 inches

// ── Inline: **bold**, *italic*, `code`, [text](link) ─────────────────────
function inline(text, base = {}) {
  const runs = []
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*([^*]+)\*)/g
  let last = 0
  let m
  const plain = (t, extra = {}) => t && runs.push(new TextRun({ text: t, font: FONT, ...base, ...extra }))
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index))
    if (m[1]) runs.push(...inline(m[2], { ...base, bold: true }))
    else if (m[3]) runs.push(new TextRun({ text: m[4], font: MONO, size: 19, color: '1F2937', ...pick(base, ['bold']) }))
    else if (m[5]) {
      const label = m[6]
      const href = m[7]
      if (/^https?:\/\//.test(href)) {
        runs.push(new ExternalHyperlink({ link: href, children: inline(label, { ...base, color: ACCENT, underline: {} }) }))
      } else {
        // Anchors and repo paths: the words, as written.
        runs.push(...inline(label, base))
      }
    } else if (m[8]) runs.push(...inline(m[9], { ...base, italics: true }))
    last = re.lastIndex
  }
  plain(text.slice(last))
  return runs
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))

// ── Tables ────────────────────────────────────────────────────────────────
function splitRow(line) {
  const cells = []
  let cur = ''
  let tick = false
  for (const ch of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (ch === '`') tick = !tick
    if (ch === '|' && !tick) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'D5DAE3' }
const borders = { top: border, bottom: border, left: border, right: border }

function table(rows) {
  const n = rows[0].length
  // Wider columns for longer text, none too narrow.
  const weight = Array.from({ length: n }, (_, i) => Math.sqrt(Math.max(...rows.map((r) => (r[i] ?? '').length), 6)))
  const total = weight.reduce((a, b) => a + b, 0)
  let widths = weight.map((w) => Math.max(1300, Math.round((w / total) * CONTENT_W)))
  const scale = CONTENT_W / widths.reduce((a, b) => a + b, 0)
  widths = widths.map((w) => Math.floor(w * scale))
  widths[n - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0)
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map(
      (r, ri) =>
        new TableRow({
          tableHeader: ri === 0,
          children: widths.map(
            (w, ci) =>
              new TableCell({
                width: { size: w, type: WidthType.DXA },
                borders,
                shading: ri === 0 ? { fill: 'EEF0FF', type: ShadingType.CLEAR, color: 'auto' } : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: (r[ci] ?? '').split(/<br\s*\/?>/).map(
                  (part) => new Paragraph({ spacing: { after: 0 }, children: inline(part, ri === 0 ? { bold: true, size: 19 } : { size: 19 }) }),
                ),
              }),
          ),
        }),
    ),
  })
}

// ── Blocks ───────────────────────────────────────────────────────────────
const out = []
let numberInstance = 0
let diagram = 0
let inContents = false

const para = (children, opts = {}) => new Paragraph({ spacing: { after: 120, line: 276 }, children, ...opts })

function codeBlock(codeLines, indent = 0) {
  codeLines.forEach((l, i) =>
    out.push(
      new Paragraph({
        indent: { left: indent },
        shading: { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' },
        spacing: { after: i === codeLines.length - 1 ? 160 : 0, line: 240 },
        children: [new TextRun({ text: l.length ? l : ' ', font: MONO, size: 17, color: '111827' })],
      }),
    ),
  )
}

function image() {
  const png = path.join(diagramsDir, `diagram-${diagram}.png`)
  const size = JSON.parse(fs.readFileSync(path.join(diagramsDir, `diagram-${diagram}.json`), 'utf8'))
  diagram += 1
  const w = Math.min(IMG_MAX_PX, size.w)
  const h = Math.round((size.h * w) / size.w)
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 200 },
      children: [new ImageRun({ type: 'png', data: fs.readFileSync(png), transformation: { width: w, height: h }, altText: { title: 'Diagram', description: 'Diagram', name: `diagram-${diagram}` } })],
    }),
  )
}

const indentOf = (l) => l.match(/^ */)[0].length
const listMarker = /^(\s*)(-|\d+\.)\s+(.*)$/

let i = 0
let firstH2 = true
while (i < lines.length) {
  const line = lines[i]
  const trimmed = line.trim()

  // The document title becomes the title page.
  if (line.startsWith('# ')) {
    out.push(new Paragraph({ spacing: { before: 2600, after: 200 }, children: [new TextRun({ text: 'Cue', font: FONT, size: 72, bold: true, color: ACCENT })] }))
    out.push(new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: 'Developer guide', font: FONT, size: 44, color: '0F1620' })] }))
    out.push(
      para([
        new TextRun({ text: 'Every feature and how it flows, the architecture, data model, background jobs, the exams module, testing and deploy.', font: FONT, size: 24, color: MUTED }),
      ]),
    )
    out.push(new Paragraph({ spacing: { before: 600, after: 60 }, children: [new TextRun({ text: 'As of 14 October 2026 · exams phases E1–E15 · migration 0058', font: FONT, size: 20, color: MUTED })] }))
    out.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Source: docs/DEVELOPER.md in the repository (this file is generated from it)', font: FONT, size: 20, color: MUTED })] }))
    out.push(new Paragraph({ children: [new PageBreak()] }))
    i += 1
    continue
  }

  if (trimmed === '---') {
    i += 1
    continue
  }

  // The contents box at the top.
  if (line.startsWith('>')) {
    const body = line.replace(/^>\s?/, '')
    if (/\*\*Contents\*\*/.test(body)) {
      inContents = true
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Contents', font: FONT })] }))
    } else if (inContents && body.trim()) {
      const m = body.match(/^\d+\.\s+\[([^\]]+)\]/)
      if (m) out.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 240 }, children: [new TextRun({ text: body.match(/^\d+/)[0] + '.  ', font: FONT, color: MUTED }), new TextRun({ text: m[1].replace(/^\d+\.\s*/, ''), font: FONT })] }))
    } else if (!inContents && body.trim()) {
      out.push(para(inline(body), { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } } }))
    }
    i += 1
    continue
  }
  if (inContents && !line.startsWith('>')) {
    inContents = false
    out.push(new Paragraph({ children: [new PageBreak()] }))
  }

  if (line.startsWith('## ')) {
    if (!firstH2) out.push(new Paragraph({ children: [new PageBreak()] }))
    firstH2 = false
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: line.slice(3), font: FONT })] }))
    i += 1
    continue
  }
  if (line.startsWith('### ')) {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: line.slice(4), font: FONT })] }))
    i += 1
    continue
  }

  // Code, or a diagram.
  if (trimmed.startsWith('```')) {
    const lang = trimmed.slice(3).trim()
    const ind = indentOf(line)
    const body = []
    i += 1
    while (i < lines.length && !lines[i].trim().startsWith('```')) {
      body.push(lines[i].slice(Math.min(ind, indentOf(lines[i]))))
      i += 1
    }
    i += 1
    if (lang === 'mermaid') image()
    else codeBlock(body, ind > 0 ? 720 : 0)
    continue
  }

  // A table.
  if (trimmed.startsWith('|')) {
    const rows = []
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      const cells = splitRow(lines[i])
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
      i += 1
    }
    out.push(table(rows))
    out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
    continue
  }

  // A list: items, nested by indentation, continuation lines joined.
  if (listMarker.test(line)) {
    numberInstance += 1
    const instance = numberInstance
    while (i < lines.length) {
      const m = lines[i].match(listMarker)
      if (!m) break
      const level = Math.min(2, Math.floor(m[1].length / 2))
      const numbered = /\d+\./.test(m[2])
      let text = m[3]
      i += 1
      while (i < lines.length && lines[i].trim() && !listMarker.test(lines[i]) && !lines[i].trim().startsWith('```') && indentOf(lines[i]) > 0 && !lines[i].trim().startsWith('|')) {
        text += ' ' + lines[i].trim()
        i += 1
      }
      out.push(
        new Paragraph({
          numbering: numbered ? { reference: 'numbers', level, instance: instance * 10 + level } : { reference: 'bullets', level },
          spacing: { after: 60, line: 264 },
          children: inline(text),
        }),
      )
      // A code block inside an item.
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        const ind = indentOf(lines[i])
        const lang = lines[i].trim().slice(3).trim()
        const body = []
        i += 1
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          body.push(lines[i].slice(Math.min(ind, indentOf(lines[i]))))
          i += 1
        }
        i += 1
        if (lang === 'mermaid') image()
        else codeBlock(body, 720)
      }
      // A blank line between items of the same list is allowed.
      if (i < lines.length && !lines[i].trim() && i + 1 < lines.length && listMarker.test(lines[i + 1]) && indentOf(lines[i + 1]) > 0) i += 1
    }
    out.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
    continue
  }

  if (!trimmed) {
    i += 1
    continue
  }

  // A paragraph: lines until a blank or another block.
  let text = trimmed
  i += 1
  while (i < lines.length && lines[i].trim() && !/^(#|\||>|```|-\s|\d+\.\s)/.test(lines[i].trim())) {
    text += ' ' + lines[i].trim()
    i += 1
  }
  out.push(para(inline(text)))
}

const level = (n, format, text) => ({
  level: n,
  format,
  text,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 360 + n * 360, hanging: 300 } } },
})

const doc = new Document({
  creator: 'Cue',
  title: 'Cue — Developer guide',
  description: 'Every feature and how it flows, and how Cue is built and shipped.',
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: ACCENT, font: FONT }, paragraph: { spacing: { before: 120, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '1F2937', font: FONT }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1, keepNext: true } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [level(0, LevelFormat.BULLET, '•'), level(1, LevelFormat.BULLET, '◦'), level(2, LevelFormat.BULLET, '▪')] },
      { reference: 'numbers', levels: [level(0, LevelFormat.DECIMAL, '%1.'), level(1, LevelFormat.DECIMAL, '%2.'), level(2, LevelFormat.LOWER_LETTER, '%3.')] },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      headers: {
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Cue — Developer guide', font: FONT, size: 16, color: MUTED })] })] }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: MUTED })],
            }),
          ],
        }),
      },
      children: out,
    },
  ],
})

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf)
  console.log(`wrote ${outPath} (${Math.round(buf.length / 1024)} KB, ${diagram} diagrams)`)
})
