import type { FieldKind, IdentityKey } from '../types'
import {
  Collector,
  cardOf,
  dateOf,
  expiryOf,
  fieldKindOf,
  fieldsOf,
  identityOf,
  itemOf,
  jsonOf,
  listOf,
  loginOf,
  noteOf,
  recordOf,
  stringOf,
  unknownKind,
} from './build'
import { dayOf, sshOf, wifiOf } from './content'
import { csvRows } from './csv'
import type { Imported } from './types'

interface Extra {
  name: string
  value: string
  kind?: FieldKind
}

interface Custom {
  type: string
  label: string
  value: unknown
}

const IDENTITY_TYPES = new Set([
  'address',
  'contact',
  'passport',
  'driverLicense',
  'ssnCard',
  'birthCertificate',
  'healthInsurance',
  'membership',
])

const HIDDEN_TYPES = new Set(['secret', 'pinCode', 'password', 'accountNumber', 'licenseNumber'])
const DATE_TYPES = new Set(['date', 'birthDate', 'expirationDate'])

export function keeperFolderOf(path: string): string {
  return path
    .split(/(?<!\\)\\(?!\\)/)
    .map((part) => part.replace(/\\\\/g, '\\').trim())
    .filter((part) => part !== '')
    .join('/')
}

function customsOf(fields: unknown): Custom[] {
  return Object.entries(recordOf(fields)).map(([key, value]) => {
    const match = /^\$([A-Za-z]+)(?::(.*?))?(?::\d+)?$/.exec(key)
    return match
      ? { type: match[1] ?? '', label: match[2] ?? '', value }
      : { type: 'text', label: key, value }
  })
}

function labelOf(custom: Custom): string {
  if (custom.label !== '') return custom.label
  const words = custom.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}`
}

function textOfValue(type: string, value: unknown): string {
  if (DATE_TYPES.has(type) && typeof value === 'number') return dayOf(dateOf(value))
  if (Array.isArray(value))
    return value
      .map((one) => textOfValue(type, one))
      .filter(Boolean)
      .join(', ')
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((one) => stringOf(one))
      .filter((one) => one !== '')
      .join(' ')
  }
  return stringOf(value)
}

function extraOf(custom: Custom): Extra {
  const kind: FieldKind = HIDDEN_TYPES.has(custom.type)
    ? 'hidden'
    : DATE_TYPES.has(custom.type)
      ? 'date'
      : custom.type === 'oneTimeCode'
        ? 'totp'
        : fieldKindOf(custom.type)
  return { name: labelOf(custom), value: textOfValue(custom.type, custom.value), kind }
}

function identityValues(
  customs: readonly Custom[],
  type: string,
): {
  values: Partial<Record<IdentityKey, string>>
  rest: Custom[]
} {
  const values: Partial<Record<IdentityKey, string>> = {}
  const rest: Custom[] = []
  const set = (key: IdentityKey, value: string): void => {
    if (value !== '' && values[key] === undefined) values[key] = value
  }
  for (const custom of customs) {
    const one = recordOf(custom.value)
    switch (custom.type) {
      case 'name':
        set('firstName', stringOf(one.first))
        set('middleName', stringOf(one.middle))
        set('lastName', stringOf(one.last))
        break
      case 'address':
        set('street', [stringOf(one.street1), stringOf(one.street2)].filter(Boolean).join(', '))
        set('city', stringOf(one.city))
        set('state', stringOf(one.state))
        set('zip', stringOf(one.zip))
        set('country', stringOf(one.country))
        break
      case 'phone':
        set('phone', stringOf(one.number) || stringOf(custom.value))
        break
      case 'email':
        set('email', textOfValue('email', custom.value))
        break
      case 'birthDate':
        set('birthdate', textOfValue('birthDate', custom.value))
        break
      case 'accountNumber':
        if (type === 'passport') set('passport', stringOf(custom.value))
        else if (type === 'driverLicense') set('license', stringOf(custom.value))
        else if (type === 'ssnCard') set('ssn', stringOf(custom.value))
        else rest.push(custom)
        break
      default:
        if (custom.type === 'text' && custom.label.toLowerCase() === 'company') {
          set('company', stringOf(custom.value))
        } else {
          rest.push(custom)
        }
    }
  }
  return { values, rest }
}

function recordInto(into: Collector, raw: unknown, sharedFolders: Map<string, string>): void {
  const record = recordOf(raw)
  const type = stringOf(record.$type) || 'login'
  const title = stringOf(record.title)
  const note = stringOf(record.notes)
  const login = stringOf(record.login)
  const password = stringOf(record.password)
  const url = stringOf(record.login_url)
  const customs = customsOf(record.custom_fields)
  const placeOf = listOf(record.folders).map(recordOf)[0] ?? {}
  const folderPath = stringOf(placeOf.folder)
  const shared = stringOf(placeOf.shared_folder)
  const parts = {
    modified: dateOf(record.last_modified),
    folder: keeperFolderOf(folderPath),
  }
  const vault = shared === '' ? '' : (sharedFolders.get(shared) ?? keeperFolderOf(shared))
  const take = (wanted: string): Custom | undefined => {
    const at = customs.findIndex((one) => one.type === wanted)
    return at < 0 ? undefined : customs.splice(at, 1)[0]
  }
  const add = (content: Parameters<typeof itemOf>[0]): void => {
    into.add(itemOf(content, parts), vault)
  }
  if (type === 'bankCard') {
    const card = recordOf(take('paymentCard')?.value)
    const holderAt = customs.findIndex((one) => one.label.toLowerCase() === 'cardholdername')
    const holder = holderAt < 0 ? '' : stringOf(customs.splice(holderAt, 1)[0]?.value)
    add(
      cardOf({
        title,
        note,
        holder,
        number: stringOf(card.cardNumber),
        expiry: expiryOf(stringOf(card.cardExpirationDate)),
        code: stringOf(card.cardSecurityCode),
        pin: stringOf(take('pinCode')?.value),
        fields: fieldsOf([...(url ? [{ name: 'URL', value: url }] : []), ...customs.map(extraOf)]),
      }),
    )
    return
  }
  if (IDENTITY_TYPES.has(type)) {
    const { values, rest } = identityValues(customs, type)
    add(identityOf({ title, note, values, extra: rest.map(extraOf) }))
    return
  }
  if (type === 'sshKeys') {
    const pair = recordOf(take('keyPair')?.value)
    add(
      sshOf({
        title,
        note,
        privateKey: stringOf(pair.privateKey),
        publicKey: stringOf(pair.publicKey),
        fields: fieldsOf([
          { name: 'Username', value: login },
          { name: 'Passphrase', value: password, kind: 'hidden' },
          ...customs.map(extraOf),
        ]),
      }),
    )
    return
  }
  if (type === 'wifiCredentials') {
    const ssidAt = customs.findIndex((one) => one.label.toLowerCase() === 'ssid')
    const ssid = ssidAt < 0 ? '' : stringOf(customs.splice(ssidAt, 1)[0]?.value)
    add(
      wifiOf({ title, note, ssid, password, security: '', fields: fieldsOf(customs.map(extraOf)) }),
    )
    return
  }
  if (type === 'encryptedNotes') {
    const body = take('note')
    const text = [note, textOfValue('note', body?.value)].filter(Boolean).join('\n\n')
    add(noteOf(title, text, fieldsOf(customs.map(extraOf))))
    return
  }
  if (type === 'login' || login !== '' || password !== '') {
    const urls = [url]
    let totp = textOfValue('oneTimeCode', take('oneTimeCode')?.value)
    const extra: Extra[] = []
    for (const custom of customs) {
      if (custom.type === 'url' && custom.label === '')
        urls.push(...(Array.isArray(custom.value) ? custom.value : [custom.value]).map(stringOf))
      else if (custom.label === 'TFC:Keeper' && totp === '') totp = stringOf(custom.value)
      else extra.push(extraOf(custom))
    }
    add(loginOf({ title, note, username: login, password, totp, urls, fields: fieldsOf(extra) }))
    if (type !== 'login')
      into.skip(`Kept as a login: Orden has no kind for Keeper's "${type}".`, title)
    return
  }
  unknownKind(into, type, title, note, customs.map(extraOf), parts, vault)
}

function parseKeeperJson(text: string): Imported {
  const root = recordOf(jsonOf(text))
  const into = new Collector('Keeper')
  const shared = new Map<string, string>()
  for (const one of listOf(root.shared_folders)) {
    const folder = recordOf(one)
    const uid = stringOf(folder.uid)
    const path = keeperFolderOf(stringOf(folder.path))
    if (uid !== '') shared.set(uid, path)
    if (path !== '') shared.set(stringOf(folder.path), path)
  }
  for (const record of listOf(root.records)) recordInto(into, record, shared)
  return into.result()
}

function parseKeeperCsv(text: string): Imported {
  const into = new Collector('Keeper')
  for (const row of csvRows(text)) {
    if (row.length < 6) continue
    const [folder = '', title = '', login = '', password = '', url = '', note = '', shared = ''] =
      row
    let totp = ''
    const extra: Extra[] = []
    for (let at = 7; at + 1 < row.length; at += 2) {
      const name = row[at] ?? ''
      const value = row[at + 1] ?? ''
      if (name === 'TFC:Keeper' || name === '$oneTimeCode') totp = value
      else extra.push({ name, value })
    }
    into.add(
      itemOf(
        loginOf({
          title,
          username: login,
          password,
          urls: [url],
          note,
          totp,
          fields: fieldsOf(extra),
        }),
        { folder: keeperFolderOf(folder) },
      ),
      keeperFolderOf(shared),
    )
  }
  return into.result()
}

export function parseKeeper(text: string): Imported {
  return text.trimStart().startsWith('{') ? parseKeeperJson(text) : parseKeeperCsv(text)
}
