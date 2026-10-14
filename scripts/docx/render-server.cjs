// Serves a page that renders the guide's Mermaid diagrams to PNG in the
// browser, and saves what the page posts back. Local only; one run.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const md = fs.readFileSync(process.argv[2], 'utf8')
const out = process.argv[3]
fs.mkdirSync(out, { recursive: true })
const diagrams = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1])

const page = `<!doctype html><html><head><meta charset="utf-8"><title>render</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;background:#fff;margin:0;padding:20px;width:1200px}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script></head><body>
<div id="log">starting</div><div id="stage"></div>
<script>
const diagrams = ${JSON.stringify(diagrams)};
const log = (t) => { document.getElementById('log').textContent = t };
mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', htmlLabels: false,
  themeVariables: { fontSize: '19px', lineColor: '#374151', primaryTextColor: '#111827', primaryBorderColor: '#6b7280' },
  flowchart: { htmlLabels: false, useMaxWidth: false, nodeSpacing: 28, rankSpacing: 44 },
  sequence: { useMaxWidth: false, mirrorActors: false, actorMargin: 24, width: 120, boxMargin: 6, messageMargin: 30, wrap: true,
    actorFontSize: 18, messageFontSize: 18, noteFontSize: 16 },
  er: { useMaxWidth: false, fontSize: 18, layoutDirection: 'TB' },
  state: { useMaxWidth: false }, fontFamily: 'Segoe UI, Arial, sans-serif' });
async function toPng(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const vb = (svg.getAttribute('viewBox') || '0 0 800 600').split(/\\s+/).map(Number);
  const w = Math.ceil(vb[2]), h = Math.ceil(vb[3]);
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  const scale = 2;
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.scale(scale, scale); g.drawImage(img, 0, 0, w, h);
  return { data: c.toDataURL('image/png'), w, h };
}
(async () => {
  const results = [];
  for (let i = 0; i < diagrams.length; i++) {
    try {
      const { svg } = await mermaid.render('d' + i, diagrams[i]);
      const png = await toPng(svg);
      await fetch('/save?i=' + i + '&w=' + png.w + '&h=' + png.h, { method: 'POST', body: png.data });
      results.push(i + ':ok');
    } catch (e) { results.push(i + ':' + (e && e.message || e)); }
    log(results.join(' | '));
  }
  await fetch('/done', { method: 'POST', body: results.join(' | ') });
})();
</script></body></html>`

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(page)
    }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        if (u.pathname === '/save') {
          const i = u.searchParams.get('i')
          fs.writeFileSync(path.join(out, `diagram-${i}.png`), Buffer.from(body.split(',')[1], 'base64'))
          fs.writeFileSync(path.join(out, `diagram-${i}.json`), JSON.stringify({ w: Number(u.searchParams.get('w')), h: Number(u.searchParams.get('h')) }))
        }
        if (u.pathname === '/done') {
          fs.writeFileSync(path.join(out, 'done.txt'), body)
          setTimeout(() => process.exit(0), 200)
        }
        res.writeHead(204)
        res.end()
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  .listen(5577, '127.0.0.1', () => console.log(`serving ${diagrams.length} diagrams on 5577`))
