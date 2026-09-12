/** A form on a published page, and the answers it collects.
 *
 *  What it is for: the one thing a blog cannot do without leaving somebody
 *  else's script on the page. A note asking "what did you think" or "tell me
 *  when you are free" is a form, and every way of having one today is a third
 *  party who then holds the answers and watches the reader.
 *
 *  So: a fence in the note, a real form on the page, and the answers on the
 *  account beside the note that asked. No script - it posts and the page comes
 *  back - no third party, and nothing about the reader kept beyond what they
 *  typed.
 *
 *  Obsidian has no form block, so there is no key to borrow and this is nib's
 *  own. It is written to read as a note rather than as a config file: a title, a
 *  word on the button, and one line per field.
 *
 *      ```form
 *      title: Say hello
 *      send: Send it
 *      fields:
 *        - Your name
 *        - Your email: email
 *        - What you want to say: lines
 *        - * Which day: choice Monday | Tuesday
 *      ```
 *
 *  A field is its label, and after the colon what kind it is: `text` (the
 *  default), `email`, `lines` for a paragraph, `number`, or `choice` with the
 *  choices after it. A `*` in front means it must be answered. That is the whole
 *  grammar, and a fence that says something else is shown as the fence it is
 *  rather than guessed at. */

import { escape } from './head'

/** How many fields one form may have, and how long one answer is kept. Both are
 *  bounds on what a page can be used for: a form is a question, not a file
 *  upload. */
const MOST_FIELDS = 20
const LONGEST_ANSWER = 4000
const LONGEST_LABEL = 120

type FieldKind = 'text' | 'email' | 'lines' | 'number' | 'choice'

interface Field {
  label: string
  kind: FieldKind
  required: boolean
  choices: string[]
}

export interface Form {
  title: string
  send: string
  fields: Field[]
}

/** One field from one line of the fence. */
function field(line: string): Field | null {
  const said = line.replace(/^[-*]\s+/, '').trim()
  if (!said) return null

  const required = /^\*\s*/.test(said)
  const rest = said.replace(/^\*\s*/, '')

  const at = rest.lastIndexOf(':')
  const label = (at === -1 ? rest : rest.slice(0, at)).trim().slice(0, LONGEST_LABEL)
  if (!label) return null

  const written = at === -1 ? '' : rest.slice(at + 1).trim()
  const [word = '', ...after] = written.split(/\s+/)
  const kind = word.toLowerCase()

  if (kind === 'choice') {
    const choices = after
      .join(' ')
      .split('|')
      .map((one) => one.trim())
      .filter(Boolean)

    return { label, kind: 'choice', required, choices: choices.slice(0, MOST_FIELDS) }
  }

  const known: FieldKind[] = ['text', 'email', 'lines', 'number']
  const found = known.find((one) => one === kind)

  return { label, kind: found ?? 'text', required, choices: [] }
}

/** The fence, as the form it describes, or null for one that is not a form: a
 *  fence nobody can read is a fence, and a page shows it as one. */
export function formOf(code: string): Form | null {
  const form: Form = { title: '', send: 'Send', fields: [] }
  let inFields = false

  for (const line of code.split(/\r?\n/)) {
    const said = line.trim()
    if (!said) continue

    if (/^fields:/i.test(said)) {
      inFields = true
      continue
    }

    if (inFields && /^[-*]/.test(said)) {
      const one = field(said)
      if (one && form.fields.length < MOST_FIELDS) form.fields.push(one)
      continue
    }

    const title = /^title:\s*(.+)$/i.exec(said)
    if (title?.[1]) {
      form.title = title[1].trim().slice(0, LONGEST_LABEL)
      continue
    }

    const send = /^send:\s*(.+)$/i.exec(said)
    if (send?.[1]) {
      form.send = send[1].trim().slice(0, 40)
      continue
    }

    // A line that is none of those, outside the field list, is a fence that is
    // not a form.
    if (!inFields) return null
  }

  return form.fields.length ? form : null
}

/** The name a field's answer arrives under. The label, folded, so the answers
 *  read as the question rather than as `field-3`. */
function nameOf(field: Field, at: number): string {
  const said = field.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return said || `field-${at + 1}`
}

/** The form, as the page draws it.
 *
 *  A real form: it posts, the page comes back, and a reader with scripting off is
 *  not told to enable anything. `sent` is what the page says after a successful
 *  post, which is the address the redirect came back on.
 *
 *  `noteId` is where the answers go and is in the form as a hidden field, because
 *  a page's address can be a permalink, an alias or an old path and the note is
 *  the one name that does not move. */
export function formHtml(form: Form, noteId: string, sent: boolean, wrong: string | null): string {
  if (sent) {
    return `<div class="form sent"><p>Thank you.</p></div>`
  }

  const rows = form.fields
    .map((one, at) => {
      const name = escape(nameOf(one, at))
      const label = escape(one.label)
      const need = one.required ? ' required' : ''

      const input =
        one.kind === 'lines'
          ? `<textarea name="${name}" rows="4"${need}></textarea>`
          : one.kind === 'choice'
            ? `<select name="${name}"${need}>${one.choices
                .map((choice) => `<option>${escape(choice)}</option>`)
                .join('')}</select>`
            : `<input type="${one.kind === 'email' ? 'email' : one.kind === 'number' ? 'number' : 'text'}" name="${name}"${need}>`

      return `<label><span>${label}${one.required ? ' *' : ''}</span>${input}</label>`
    })
    .join('')

  return `<form class="form" method="post" action="/form/${escape(noteId)}">
${form.title ? `<h3>${escape(form.title)}</h3>` : ''}
${wrong ? `<p class="wrong">${escape(wrong)}</p>` : ''}
${rows}
<button type="submit">${escape(form.send)}</button>
</form>`
}

/** What a reader sent, as the answers to this form's questions.
 *
 *  Read against the form rather than taken as it arrives: a field the form does
 *  not have is dropped, a required one that is empty is a refusal, and every
 *  answer is bounded. What comes back is what goes in the row. */
export function answersFrom(
  form: Form,
  sent: FormData,
): { answers: Record<string, string> } | { wrong: string } {
  const answers: Record<string, string> = {}

  for (const [at, one] of form.fields.entries()) {
    const name = nameOf(one, at)
    const said = sent.get(name)
    const value = typeof said === 'string' ? said.trim().slice(0, LONGEST_ANSWER) : ''

    if (!value) {
      if (one.required) return { wrong: `${one.label} is needed.` }
      continue
    }

    if (one.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return { wrong: `${one.label} does not look like an address.` }
    }

    if (one.kind === 'number' && !Number.isFinite(Number(value))) {
      return { wrong: `${one.label} is a number.` }
    }

    if (one.kind === 'choice' && !one.choices.includes(value)) {
      return { wrong: `${one.label} is one of the choices.` }
    }

    answers[one.label] = value
  }

  if (!Object.keys(answers).length) return { wrong: 'Nothing was filled in.' }

  return { answers }
}

/** The answers as a spreadsheet, for the pane in the app: one column per
 *  question, in the order the form asks them, and a row per answer.
 *
 *  Written here rather than in the app because the shape of an answer is decided
 *  here, and a second writer of the same file is a second answer to what a
 *  column is called. */
export function asCsv(rows: readonly { at: number; answers: Record<string, string> }[]): string {
  const columns = ['when', ...new Set(rows.flatMap((one) => Object.keys(one.answers)))]

  const cell = (said: string) => `"${said.replace(/"/g, '""')}"`
  const lines = [columns.map(cell).join(',')]

  for (const row of rows) {
    lines.push(
      [
        new Date(row.at).toISOString(),
        ...columns.slice(1).map((column) => row.answers[column] ?? ''),
      ]
        .map(cell)
        .join(','),
    )
  }

  return `${lines.join('\n')}\n`
}
