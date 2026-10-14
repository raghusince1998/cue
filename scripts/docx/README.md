# The Word version of the developer guide

`docs/Cue-Developer-Guide.docx` is generated from `docs/DEVELOPER.md`.
Regenerate it whenever the guide changes, so the two never disagree.

It takes two steps, run from a scratch folder outside the repo (the `docx`
library is not one of Cue's dependencies):

```bash
mkdir -p /tmp/cue-docx && cd /tmp/cue-docx
npm init -y && npm install docx@9.5.1

# 1. The diagrams: serve a page that renders each Mermaid block to PNG in a
#    browser (Mermaid from its CDN) and posts the images back. Open
#    http://localhost:5577/ in a browser; the server exits when all are saved.
node <repo>/scripts/docx/render-server.cjs <repo>/docs/DEVELOPER.md ./diagrams

# 2. The document: headings, lists, tables, code and the diagrams.
NODE_PATH=./node_modules node <repo>/scripts/docx/build.cjs <repo>/docs/DEVELOPER.md ./diagrams <repo>/docs/Cue-Developer-Guide.docx
```

To check it, open it in Word (or save it as PDF and look through the pages).
A Mermaid message containing a semicolon breaks the diagram — on GitHub too.
