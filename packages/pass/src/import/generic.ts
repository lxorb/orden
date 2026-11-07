import type { FieldKind } from '../types'
import { Collector, ImportError, dateOf, fieldsOf, itemOf, loginOf, noteOf, urlsIn } from './build'
import { csvRows } from './csv'
import type { Imported } from './types'

const ROLES = {
  title: [
    'title',
    'name',
    'account',
    'item',
    'entry',
    'service',
    'site',
    'item name',
    'account name',
  ],
  url: [
    'url',
    'urls',
    'website',
    'web site',
    'uri',
    'login_uri',
    'login url',
    'address',
    'web address',
    'website address',
    'link',
  ],
  username: [
    'username',
    'user name',
    'user',
    'login',
    'login name',
    'login_username',
    'userid',
    'user id',
  ],
  email: ['email', 'e-mail', 'email address', 'mail'],
  password: ['password', 'pass', 'pwd', 'passwd', 'login_password', 'secret'],
  totp: [
    'totp',
    'otp',
    'otpauth',
    'otp auth',
    '2fa',
    'login_totp',
    'one-time password',
    'otp secret',
    'mfa',
  ],
  note: ['note', 'notes', 'extra', 'comment', 'comments', 'description', 'memo'],
  folder: ['folder', 'group', 'grouping', 'category', 'collection', 'path', 'vault'],
  created: ['created', 'creation time', 'date created', 'created at', 'timecreated'],
  modified: [
    'modified',
    'last modified',
    'updated',
    'updated at',
    'date modified',
    'last modified time',
  ],
} as const

type Role = keyof typeof ROLES

const HIDDEN = /pass|secret|pin|cvv|cvc|security code|key|token/i

function normalized(name: string): string {
  return name.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ')
}

export function columnsOf(header: readonly string[]): Partial<Record<Role, number>> {
  const columns: Partial<Record<Role, number>> = {}
  const names = header.map(normalized)
  for (const role of Object.keys(ROLES) as Role[]) {
    for (const alias of ROLES[role]) {
      const at = names.indexOf(normalized(alias))
      if (at >= 0 && !Object.values(columns).includes(at)) {
        columns[role] = at
        break
      }
    }
  }
  return columns
}

export function csvLooksLike(header: readonly string[]): boolean {
  const columns = columnsOf(header)
  return (
    columns.password !== undefined || (columns.title !== undefined && columns.note !== undefined)
  )
}

export function parseCsv(text: string): Imported {
  const [head, ...rows] = csvRows(text)
  if (!head) return new Collector('Imported').result()
  const columns = columnsOf(head)
  if (!csvLooksLike(head)) {
    throw new ImportError('Orden could not tell which column holds the passwords.')
  }
  const used = new Set(Object.values(columns))
  const into = new Collector('Imported')
  for (const row of rows) {
    const cell = (role: Role): string => {
      const at = columns[role]
      return at === undefined ? '' : (row[at] ?? '')
    }
    const extra: { name: string; value: string; kind: FieldKind }[] = head.flatMap((name, at) =>
      used.has(at) || name.trim() === ''
        ? []
        : [
            {
              name: name.trim(),
              value: row[at] ?? '',
              kind: HIDDEN.test(name) ? 'hidden' : 'text',
            },
          ],
    )
    const fields = fieldsOf(extra)
    const title = cell('title')
    const note = cell('note')
    const password = cell('password')
    const username = cell('username')
    const email = cell('email')
    const url = cell('url')
    const totp = cell('totp')
    const content =
      password === '' && username === '' && email === '' && url === '' && totp === ''
        ? noteOf(title, note, fields)
        : loginOf({ title, note, password, username, email, totp, urls: urlsIn(url), fields })
    into.add(
      itemOf(content, {
        folder: cell('folder'),
        created: dateOf(cell('created')),
        modified: dateOf(cell('modified')),
      }),
    )
  }
  return into.result()
}
