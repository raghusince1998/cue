import { useEffect, useState } from 'react'
import { useExamWords } from '../lib/examWords.ts'

/**
 * A photo or signature made to fit a form: the size in pixels and in KB
 * the notification asks for. Done on the phone, in the browser — nothing is
 * uploaded anywhere. A form that rejects a file for being 51 KB is a lost
 * evening; this is a minute.
 *
 * Presets are what these boards have long asked for; every notification
 * states its own, so they are starting points and every field stays open.
 */

interface Spec {
  width: number
  height: number
  minKb: number
  maxKb: number
  /** Cropped to fill (a face), or fitted inside on white (a signature, which must not lose an edge). */
  fill: boolean
}

const PRESETS: { key: string; en: string; hi: string; spec: Spec }[] = [
  { key: 'ibps-photo', en: 'IBPS / SBI — photo', hi: 'IBPS / SBI — फोटो', spec: { width: 200, height: 230, minKb: 20, maxKb: 50, fill: true } },
  { key: 'ibps-sign', en: 'IBPS / SBI — signature', hi: 'IBPS / SBI — हस्ताक्षर', spec: { width: 140, height: 60, minKb: 10, maxKb: 20, fill: false } },
  { key: 'ibps-thumb', en: 'IBPS / SBI — left thumb impression', hi: 'IBPS / SBI — बाएँ अंगूठे का निशान', spec: { width: 240, height: 240, minKb: 20, maxKb: 50, fill: false } },
  { key: 'upsc', en: 'UPSC — photo or signature', hi: 'UPSC — फोटो या हस्ताक्षर', spec: { width: 450, height: 550, minKb: 20, maxKb: 300, fill: true } },
  { key: 'custom', en: 'Another form: the sizes in its notification', hi: 'दूसरा फॉर्म: विज्ञप्ति में दिए माप', spec: { width: 200, height: 230, minKb: 20, maxKb: 50, fill: true } },
]

const T = {
  en: {
    how: 'Choose the photo or signature, and the sizes the form asks for. It is resized here, on your phone, and never uploaded.',
    check: 'Every notification gives its own sizes — check yours and change these to match.',
    form: 'For',
    width: 'Width (px)',
    height: 'Height (px)',
    minKb: 'At least (KB)',
    maxKb: 'At most (KB)',
    fill: 'Crop to fill (a photo)',
    fit: 'Fit inside, white around (a signature)',
    choose: 'Choose the image',
    working: 'Fitting…',
    ready: (w: number, h: number, kb: number) => `${w} × ${h} px · ${kb} KB — ready`,
    tooBig: 'Even at the lowest quality it is larger than allowed. Try a smaller width and height.',
    download: 'Download',
    unreadable: 'That image could not be opened. Try a JPG or PNG.',
  },
  hi: {
    how: 'फोटो या हस्ताक्षर चुनें, और फॉर्म में माँगे गए माप। इसका आकार यहीं, आपके फोन पर बदला जाता है — कहीं अपलोड नहीं होता।',
    check: 'हर विज्ञप्ति अपने माप देती है — अपनी विज्ञप्ति देखकर इन्हें मिला लें।',
    form: 'किसके लिए',
    width: 'चौड़ाई (px)',
    height: 'ऊँचाई (px)',
    minKb: 'कम से कम (KB)',
    maxKb: 'ज़्यादा से ज़्यादा (KB)',
    fill: 'काटकर भरें (फोटो)',
    fit: 'अंदर रखें, चारों ओर सफ़ेद (हस्ताक्षर)',
    choose: 'तस्वीर चुनें',
    working: 'बना रहे हैं…',
    ready: (w: number, h: number, kb: number) => `${w} × ${h} px · ${kb} KB — तैयार`,
    tooBig: 'सबसे कम गुणवत्ता पर भी फ़ाइल बड़ी है। चौड़ाई और ऊँचाई कम करके देखें।',
    download: 'डाउनलोड करें',
    unreadable: 'यह तस्वीर नहीं खुली। JPG या PNG आज़माएँ।',
  },
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality))

/**
 * A JPEG grown to at least `min` bytes with comment segments — valid JPEG,
 * the same picture — for forms that refuse a file for being too small.
 */
async function padTo(blob: Blob, min: number): Promise<Blob> {
  if (blob.size >= min) return blob
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const sizes: number[] = []
  for (let missing = min - bytes.length; missing > 0; ) {
    const body = Math.min(65_533, Math.max(1, missing - 4))
    sizes.push(body)
    missing -= body + 4
  }
  const out = new Uint8Array(new ArrayBuffer(bytes.length + sizes.reduce((s, b) => s + b + 4, 0)))
  // After the start-of-image marker, before everything else.
  out.set(bytes.subarray(0, 2), 0)
  let at = 2
  for (const body of sizes) {
    out[at] = 0xff
    out[at + 1] = 0xfe
    out[at + 2] = ((body + 2) >> 8) & 0xff
    out[at + 3] = (body + 2) & 0xff
    at += body + 4
  }
  out.set(bytes.subarray(2), at)
  return new Blob([out.buffer], { type: 'image/jpeg' })
}

/** The picture drawn to the size asked, then the quality found that lands it within the KB asked. */
async function fit(file: File, spec: Spec): Promise<Blob | 'too_big'> {
  const image = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = spec.width
  canvas.height = spec.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, spec.width, spec.height)
  const scale = spec.fill ? Math.max(spec.width / image.width, spec.height / image.height) : Math.min(spec.width / image.width, spec.height / image.height)
  const w = image.width * scale
  const h = image.height * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, (spec.width - w) / 2, (spec.height - h) / 2, w, h)

  const max = spec.maxKb * 1024
  const min = spec.minKb * 1024
  let lo = 0.05
  let hi = 0.95
  let best: Blob | null = null
  for (let i = 0; i < 8; i++) {
    const q = (lo + hi) / 2
    const b = await toBlob(canvas, q)
    if (b.size <= max) {
      best = b
      lo = q
    } else hi = q
  }
  if (!best) {
    const smallest = await toBlob(canvas, 0.05)
    if (smallest.size > max) return 'too_big'
    best = smallest
  }
  // Under the floor even at its best: the highest quality, then grown to it.
  if (best.size < min) best = await padTo(await toBlob(canvas, 1), min)
  return best.size <= max ? best : 'too_big'
}

export function PhotoFitter() {
  const w = useExamWords()
  const t = T[w.lang]
  const [preset, setPreset] = useState(PRESETS[0]!.key)
  const [spec, setSpec] = useState<Spec>(PRESETS[0]!.spec)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<{ url: string; size: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    setBusy(true)
    setError(null)
    fit(file, spec)
      .then((out) => {
        if (cancelled) return
        if (out === 'too_big') {
          setResult(null)
          setError(t.tooBig)
          return
        }
        setResult((old) => {
          if (old) URL.revokeObjectURL(old.url)
          return { url: URL.createObjectURL(out), size: out.size }
        })
      })
      .catch(() => !cancelled && setError(t.unreadable))
      .finally(() => !cancelled && setBusy(false))
    return () => {
      cancelled = true
    }
  }, [file, spec, t])

  const num = (k: 'width' | 'height' | 'minKb' | 'maxKb') => ({
    type: 'number' as const,
    min: 1,
    value: spec[k],
    onChange: (e: { target: { value: string } }) => setSpec((s) => ({ ...s, [k]: Math.max(1, Number(e.target.value) || 1) })),
  })

  return (
    <div className="stack tight photo-fitter" lang={w.lang}>
      <p className="muted small">{t.how}</p>
      <div className="tracker-fields">
        <label className="tracker-wide">
          {t.form}
          <select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value)
              setSpec(PRESETS.find((p) => p.key === e.target.value)!.spec)
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {w.lang === 'hi' ? p.hi : p.en}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.width}
          <input {...num('width')} />
        </label>
        <label>
          {t.height}
          <input {...num('height')} />
        </label>
        <label>
          {t.minKb}
          <input {...num('minKb')} />
        </label>
        <label>
          {t.maxKb}
          <input {...num('maxKb')} />
        </label>
      </div>
      <div className="chips" role="group">
        <button className={`chip${spec.fill ? ' selected' : ''}`} onClick={() => setSpec((s) => ({ ...s, fill: true }))}>
          {t.fill}
        </button>
        <button className={`chip${!spec.fill ? ' selected' : ''}`} onClick={() => setSpec((s) => ({ ...s, fill: false }))}>
          {t.fit}
        </button>
      </div>
      <p className="muted small">{t.check}</p>
      <label className="ghost exam-file">
        {t.choose}
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {busy && <p className="muted small">{t.working}</p>}
      {result && !busy && (
        <div className="photo-fitter-result">
          <img src={result.url} alt="" width={Math.min(spec.width, 240)} />
          <p className="small">{t.ready(spec.width, spec.height, Math.round(result.size / 102.4) / 10)}</p>
          <a className="primary small-btn link-btn" href={result.url} download={`${preset}-${spec.width}x${spec.height}.jpg`}>
            {t.download}
          </a>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
