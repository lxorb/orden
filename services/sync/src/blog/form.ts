import { escape } from './head'

const MOST_FIELDS = 20
const LONGEST_ANSWER = 4000
const LONGEST_LABEL = 120

const FORMULA = /^[=+\-@\t\r]/

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

    if (!inFields) return null
  }

  return form.fields.length ? form : null
}

function nameOf(field: Field, at: number): string {
  const said = field.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return said || `field-${at + 1}`
}

const WRONG_ALL = new Map([
  ['busy', 'Too many just now. Try later.'],
  ['full', 'This form is full.'],
  ['empty', 'Nothing was filled in.'],
])
const WRONG_ONE = new Map([
  ['needed', 'is needed.'],
  ['address', 'does not look like an address.'],
  ['number', 'is a number.'],
  ['choice', 'is one of the choices.'],
])

function wrongsOf(form: Form): Map<string, string> {
  const wrongs = new Map(WRONG_ALL)
  for (const [at, one] of form.fields.entries()) {
    for (const [kind, words] of WRONG_ONE) wrongs.set(`${at}-${kind}`, `${one.label} ${words}`)
  }
  return wrongs
}

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

  const said = wrong === null ? undefined : wrongsOf(form).get(wrong)

  return `<form class="form" method="post" action="/form/${escape(noteId)}">
${form.title ? `<h3>${escape(form.title)}</h3>` : ''}
${said ? `<p class="wrong">${escape(said)}</p>` : ''}
${rows}
<button type="submit">${escape(form.send)}</button>
</form>`
}

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
      if (one.required) return { wrong: `${at}-needed` }
      continue
    }

    if (one.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return { wrong: `${at}-address` }
    }

    if (one.kind === 'number' && !Number.isFinite(Number(value))) {
      return { wrong: `${at}-number` }
    }

    if (one.kind === 'choice' && !one.choices.includes(value)) {
      return { wrong: `${at}-choice` }
    }

    answers[one.label] = value
  }

  if (!Object.keys(answers).length) return { wrong: 'empty' }

  return { answers }
}

export function asCsv(
  rows: readonly { at: number; path: string; answers: Record<string, string> }[],
): string {
  const asked = [...new Set(rows.flatMap((one) => Object.keys(one.answers)))]

  const cell = (said: string) => {
    const text = FORMULA.test(said) && !Number.isFinite(Number(said)) ? `'${said}` : said
    return `"${text.replace(/"/g, '""')}"`
  }
  const lines = [['when', 'page', ...asked].map(cell).join(',')]

  for (const row of rows) {
    lines.push(
      [
        new Date(row.at).toISOString(),
        row.path,
        ...asked.map((column) => row.answers[column] ?? ''),
      ]
        .map(cell)
        .join(','),
    )
  }

  return `${lines.join('\n')}\n`
}
