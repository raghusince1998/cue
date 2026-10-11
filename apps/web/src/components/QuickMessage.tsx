import { useCallback, useEffect, useRef, useState } from 'react'
import { TEMPLATE_FIELDS, fillTemplate, shortName, type MessageTemplateDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { waNumber } from './PersonSheet.tsx'

export interface Recipient {
  name: string | null
  company?: string | null
  phone?: string | null
  email?: string | null
}

/**
 * A saved message, filled in for one person and sent in a tap.
 *
 * The most-sent ones come first; picking one fills in their name, their
 * clinic and yours, and the text stays editable before it goes. `suggest`
 * preselects the likely one: "Missed your call" after nobody answered.
 */
export function QuickMessage({
  to,
  suggest,
  preset,
  onDone,
}: {
  to: Recipient
  suggest?: RegExp
  /** A message for this moment — "Birthday wishes" — first and chosen, not saved as a template. */
  preset?: { title: string; body: string }
  onDone?: () => void
}) {
  const { me } = useAuth()
  const [templates, setTemplates] = useState<MessageTemplateDTO[] | null>(null)
  const [chosen, setChosen] = useState<MessageTemplateDTO | null>(null)
  const [text, setText] = useState('')
  const [managing, setManaging] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fill = useCallback(
    (t: MessageTemplateDTO) => fillTemplate(t.body, { name: to.name, company: to.company, me: me?.name }),
    [to.name, to.company, me?.name],
  )

  const choose = useCallback(
    (t: MessageTemplateDTO) => {
      setChosen(t)
      setText(fill(t))
      setCopied(false)
    },
    [fill],
  )

  const load = useCallback(async () => {
    const list = await api<MessageTemplateDTO[]>('/templates')
    setTemplates(list)
    return list
  }, [])

  const presetTemplate: MessageTemplateDTO | null = preset
    ? { id: 'preset', title: preset.title, body: preset.body, uses: 0 }
    : null

  useEffect(() => {
    void load().then((list) => {
      const pick = presetTemplate ?? ((suggest && list.find((t) => suggest.test(t.title))) || list[0])
      if (pick) choose(pick)
    })
    // Once, on opening: later reloads must not undo what was picked or typed.
  }, [])

  async function addStarters() {
    try {
      const list = await api<MessageTemplateDTO[]>('/templates/starters', { method: 'POST' })
      setTemplates(list)
      const pick = (suggest && list.find((t) => suggest.test(t.title))) || list[0]
      if (pick) choose(pick)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** Sent, or as good as: it moves up the list for next time. */
  function used() {
    if (chosen && chosen.id !== 'preset') {
      void api(`/templates/${chosen.id}/used`, { method: 'POST' }).catch(() => undefined)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      used()
    } catch {
      setError('Could not copy — select the message and copy it yourself.')
    }
  }

  if (managing) {
    return (
      <TemplateManager
        onClose={() => {
          setManaging(false)
          void load().then((list) => {
            const still = chosen && list.find((t) => t.id === chosen.id)
            if (still) choose(still)
            else if (list[0]) choose(list[0])
            else {
              setChosen(null)
              setText('')
            }
          })
        }}
      />
    )
  }

  if (templates === null) return <p className="muted small">Loading your messages…</p>

  if (templates.length === 0 && !presetTemplate) {
    return (
      <div className="stack tight">
        <p className="muted small">
          No quick messages yet. Start from five that cover most days (thanks for meeting, missed
          your call, sharing the details, a gentle reminder, running late) and change them to sound
          like you.
        </p>
        <div className="row">
          <button className="primary small-btn" onClick={() => void addStarters()}>
            Add the starter messages
          </button>
          <button className="ghost small-btn" onClick={() => setManaging(true)}>
            Write my own
          </button>
        </div>
        {error && <p className="error small">{error}</p>}
      </div>
    )
  }

  const first = to.name ? shortName(to.name) : null
  const encoded = encodeURIComponent(text)

  return (
    <div className="stack tight quick-message">
      <div className="chips">
        {[...(presetTemplate ? [presetTemplate] : []), ...templates].map((t) => (
          <button key={t.id} className={`chip${chosen?.id === t.id ? ' selected' : ''}`} onClick={() => choose(t)}>
            {t.title}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setCopied(false)
        }}
        rows={Math.min(10, Math.max(4, text.split('\n').length + 1))}
        aria-label="Message"
      />
      <button className="link small fit-btn" onClick={() => setManaging(true)}>
        Edit my messages
      </button>

      <div className="row nudge-send">
        <button
          className="primary small-btn"
          disabled={!text.trim()}
          onClick={() => {
            used()
            window.open(`https://wa.me/${to.phone ? waNumber(to.phone) : ''}?text=${encoded}`, '_blank', 'noopener')
            onDone?.()
          }}
        >
          {to.phone && first ? `WhatsApp ${first}` : 'WhatsApp'}
        </button>
        {to.phone && (
          <a
            className="ghost small-btn link-btn"
            href={`sms:${to.phone}?body=${encoded}`}
            onClick={() => {
              used()
              onDone?.()
            }}
          >
            Text
          </a>
        )}
        <button
          className="ghost small-btn"
          disabled={!text.trim()}
          onClick={() => {
            used()
            window.open(
              `mailto:${to.email ?? ''}?subject=${encodeURIComponent(chosen?.title ?? '')}&body=${encoded}`,
              '_blank',
              'noopener',
            )
            onDone?.()
          }}
        >
          Email
        </button>
        <button className="ghost small-btn" disabled={!text.trim()} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

/** Writing and changing quick messages, with their name, clinic and yours insertable. */
export function TemplateManager({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<MessageTemplateDTO[] | null>(null)
  /** The one open for editing: an id, 'new', or none. */
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => setTemplates(await api<MessageTemplateDTO[]>('/templates')), [])
  useEffect(() => {
    void load()
  }, [load])

  function open(t: MessageTemplateDTO | null) {
    setEditing(t ? t.id : 'new')
    setTitle(t?.title ?? '')
    setBody(t?.body ?? 'Hi {first}, \n\n{me}')
    setError(null)
  }

  /** Puts a field where the cursor is, not at the end. */
  function insert(token: string) {
    const el = bodyRef.current
    const at = el ? el.selectionStart : body.length
    const end = el ? el.selectionEnd : body.length
    const next = body.slice(0, at) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const payload = { title: title.trim(), body: body.trim() }
      if (editing === 'new') await api('/templates', { method: 'POST', body: payload })
      else await api(`/templates/${editing}`, { method: 'PATCH', body: payload })
      setEditing(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await api(`/templates/${id}`, { method: 'DELETE' })
      setConfirming(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="stack tight template-form">
        <label>
          Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Thanks for meeting" autoFocus />
        </label>
        <label>
          Message
          <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
        </label>
        <div className="chips">
          <span className="muted small">Insert</span>
          {TEMPLATE_FIELDS.map((f) => (
            <button key={f.token} className="chip" onClick={() => insert(f.token)}>
              {f.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          Filled in when you send it: &ldquo;{'{first}'}&rdquo; becomes Ravi, or Dr. Mehta for a
          doctor.
        </p>
        {error && <p className="error small">{error}</p>}
        <div className="row">
          <button className="primary small-btn" onClick={() => void save()} disabled={busy || !title.trim() || !body.trim()}>
            Save
          </button>
          <button className="ghost small-btn" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack tight template-list">
      {templates === null ? (
        <p className="muted small">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="muted small">No quick messages yet.</p>
      ) : (
        templates.map((t) => (
          <div className="your-day-line" key={t.id}>
            <span>
              <strong>{t.title}</strong>
              <span className="muted small"> · {t.body.split('\n')[0]!.slice(0, 70)}</span>
            </span>
            {confirming === t.id ? (
              <span className="row">
                <button className="danger-btn tiny-btn" onClick={() => void remove(t.id)} disabled={busy}>
                  Delete
                </button>
                <button className="ghost tiny-btn" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <span className="row">
                <button className="ghost tiny-btn" onClick={() => open(t)}>
                  Edit
                </button>
                <button className="ghost tiny-btn" onClick={() => setConfirming(t.id)} aria-label={`Delete ${t.title}`}>
                  &times;
                </button>
              </span>
            )}
          </div>
        ))
      )}
      <div className="row">
        <button className="ghost small-btn" onClick={() => open(null)}>
          + New message
        </button>
        <button className="primary small-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
