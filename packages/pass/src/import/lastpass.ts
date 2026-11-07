import type { Content, Field, IdentityKey } from '../types'
import {
  Collector,
  ImportError,
  cardOf,
  expiryOf,
  fieldOf,
  identityOf,
  itemOf,
  loginOf,
  noteOf,
  recordOf,
  stringOf,
  urlsIn,
} from './build'
import { monthNumberOf, sshOf, wifiOf } from './content'
import { csvRecords, type CsvRecord } from './csv'
import type { Imported } from './types'

const NAME = 'LastPass'

const NOTE_URL = 'http://sn'

const IDENTITY: Record<string, IdentityKey> = {
  'First Name': 'firstName',
  'Middle Name': 'middleName',
  'Last Name': 'lastName',
  Gender: 'gender',
  Birthday: 'birthdate',
  Company: 'company',
  'City / Town': 'city',
  County: 'county',
  State: 'state',
  'Zip / Postal Code': 'zip',
  Country: 'country',
  'Email Address': 'email',
  Phone: 'phone',
  'Mobile Phone': 'secondPhone',
}

const STREET = ['Address 1', 'Address 2', 'Address 3']

const SKIPPED_KEYS = new Set(['Language', 'NoteType', 'Notes'])

const KEY = /^([A-Za-z][A-Za-z0-9 /'.#()&-]{0,48}):(.*)$/

interface NoteFields {
  type: string
  values: Map<string, string>
  notes: string
}

export function parseLastPass(text: string): Imported {
  const rows = csvRecords(text)
  const first = rows[0]
  if (first && !('url' in first && 'password' in first && 'extra' in first)) {
    throw new ImportError('This is not a LastPass CSV export.')
  }
  const into = new Collector(NAME)
  for (const row of rows) {
    const { content, kind } = contentOf(row)
    if (kind !== null) {
      into.skip(`Kept as a note: Orden has no kind for LastPass's "${kind}".`, content.title)
    }
    into.add(
      itemOf(content, {
        pinned: row.fav === '1',
        folder: folderOf(row.grouping ?? ''),
      }),
    )
  }
  return into.result()
}

function folderOf(grouping: string): string | null {
  const folder = grouping.trim().replace(/\\/g, '/')
  return folder === '' || folder === '(none)' ? null : folder
}

function noteFieldsOf(extra: string): NoteFields | null {
  const lines = extra.split(/\r?\n/)
  const head = KEY.exec(lines[0] ?? '')
  if (head?.[1] !== 'NoteType') return null
  const values = new Map<string, string>()
  let notes: string[] | null = null
  let last = ''
  for (const line of lines.slice(1)) {
    if (notes !== null) {
      notes.push(line)
      continue
    }
    const match = KEY.exec(line)
    if (match) {
      last = match[1] ?? ''
      if (last === 'Notes') notes = [match[2] ?? '']
      else values.set(last, match[2] ?? '')
    } else if (last !== '') {
      values.set(last, `${values.get(last) ?? ''}\n${line}`)
    }
  }
  return { type: (head[2] ?? '').trim(), values, notes: (notes ?? []).join('\n') }
}

function phoneOf(value: string): string {
  if (!value.trim().startsWith('{')) return value
  try {
    const phone = recordOf(JSON.parse(value) as unknown)
    return [stringOf(phone.num), stringOf(phone.ext)].filter((one) => one !== '').join(' ')
  } catch {
    return value
  }
}

function birthdayOf(value: string): string {
  const parts = value.split(',').map((one) => one.trim())
  if (parts.length !== 3) return value
  const [month, day, year] = parts
  const m = monthNumberOf(month ?? '')
  if (m === '' || !/^\d{1,2}$/.test(day ?? '') || !/^\d{4}$/.test(year ?? '')) return value
  return `${year ?? ''}-${m.padStart(2, '0')}-${(day ?? '').padStart(2, '0')}`
}

function lastPassExpiry(value: string): string {
  const [month, year] = value.split(',').map((one) => one.trim())
  const m = monthNumberOf(month ?? '')
  return m === '' || !year ? expiryOf(value) : expiryOf(m, year)
}

function rest(fields: NoteFields, used: readonly string[]): Field[] {
  return [...fields.values]
    .filter(([key, value]) => !used.includes(key) && !SKIPPED_KEYS.has(key) && value.trim() !== '')
    .map(([key, value]) =>
      fieldOf(key, value, /password|passphrase|pin|security code/i.test(key) ? 'hidden' : 'text'),
    )
}

function noteContent(title: string, fields: NoteFields): { content: Content; kind: string | null } {
  const get = (key: string): string => fields.values.get(key)?.trim() ?? ''
  switch (fields.type) {
    case 'Credit Card': {
      const used = ['Name on Card', 'Number', 'Security Code', 'Expiration Date', 'Type']
      return {
        kind: null,
        content: cardOf({
          title,
          note: fields.notes,
          holder: get('Name on Card'),
          number: get('Number'),
          code: get('Security Code'),
          expiry: lastPassExpiry(get('Expiration Date')),
          fields: rest(fields, used),
        }),
      }
    }
    case 'Address': {
      const values: Partial<Record<IdentityKey, string>> = {}
      for (const [from, to] of Object.entries(IDENTITY)) values[to] = get(from)
      values.phone = phoneOf(get('Phone'))
      values.secondPhone = phoneOf(get('Mobile Phone'))
      values.birthdate = birthdayOf(get('Birthday'))
      values.street = STREET.map(get)
        .filter((one) => one !== '')
        .join('\n')
      const extra = rest(fields, [...Object.keys(IDENTITY), ...STREET]).map((one) => ({
        name: one.name,
        value: one.name.includes('Phone') || one.name === 'Fax' ? phoneOf(one.value) : one.value,
        kind: one.kind,
      }))
      return { kind: null, content: identityOf({ title, note: fields.notes, values, extra }) }
    }
    case 'SSH Key':
      return {
        kind: null,
        content: sshOf({
          title,
          note: fields.notes,
          privateKey: fields.values.get('Private Key') ?? '',
          publicKey: get('Public Key'),
          fields: rest(fields, ['Private Key', 'Public Key']),
        }),
      }
    case 'Wi-Fi Password':
      return {
        kind: null,
        content: wifiOf({
          title,
          note: fields.notes,
          ssid: get('SSID'),
          password: get('Password'),
          security: get('Authentication'),
          fields: rest(fields, ['SSID', 'Password', 'Authentication']),
        }),
      }
    case 'Generic':
      return { kind: null, content: noteOf(title, fields.notes, rest(fields, [])) }
    default:
      return { kind: fields.type, content: noteOf(title, fields.notes, rest(fields, [])) }
  }
}

function contentOf(row: CsvRecord): { content: Content; kind: string | null } {
  const title = row.name ?? ''
  const extra = row.extra ?? ''
  const url = (row.url ?? '').trim()
  if (url === NOTE_URL) {
    const fields = noteFieldsOf(extra)
    if (fields) return noteContent(title, fields)
    return { kind: null, content: noteOf(title, extra) }
  }
  return {
    kind: null,
    content: loginOf({
      title,
      note: extra,
      username: row.username ?? '',
      password: row.password ?? '',
      totp: row.totp ?? '',
      urls: urlsIn(url),
    }),
  }
}
