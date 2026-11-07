import type { Content, Field, FieldKind, IdentityKey, Section } from '../types'
import {
  Collector,
  ImportError,
  cardOf,
  dateOf,
  fieldOf,
  identityOf,
  itemOf,
  jsonOf,
  listOf,
  loginOf,
  noteOf,
  pick,
  recordOf,
  sectionOf,
  stringOf,
  textOf,
  urlsIn,
  type Files,
} from './build'
import { customOf, dayOf, folderPaths, sshOf, wifiOf } from './content'
import { csvRecords } from './csv'
import type { Imported } from './types'

const NAME = '1Password'

const SEPARATOR = /^\*\*\*[0-9a-f-]{36}\*\*\*$/i

type Category =
  | 'login'
  | 'card'
  | 'note'
  | 'identity'
  | 'password'
  | 'document'
  | 'wifi'
  | 'ssh'
  | 'custom'
  | 'unknown'

interface OneField {
  id: string
  title: string
  section: string
  kind: FieldKind
  value: string
  address: Record<string, string> | null
  privateKey: string
  publicKey: string
}

interface OneItem {
  category: Category
  template: string
  title: string
  note: string
  urls: string[]
  username: string
  password: string
  fields: OneField[]
  created: number | null
  modified: number | null
  trashed: boolean
  pinned: boolean
  folder: string | null
  attachment: boolean
  passkey: boolean
}

const CATEGORIES: Record<string, [Category, string]> = {
  '001': ['login', 'Login'],
  '002': ['card', 'Credit Card'],
  '003': ['note', 'Secure Note'],
  '004': ['identity', 'Identity'],
  '005': ['password', 'Password'],
  '006': ['document', 'Document'],
  '100': ['custom', 'Software License'],
  '101': ['custom', 'Bank Account'],
  '102': ['custom', 'Database'],
  '103': ['custom', 'Driver License'],
  '104': ['custom', 'Outdoor License'],
  '105': ['custom', 'Membership'],
  '106': ['custom', 'Passport'],
  '107': ['custom', 'Reward Program'],
  '108': ['custom', 'Social Security Number'],
  '109': ['wifi', 'Wireless Router'],
  '110': ['custom', 'Server'],
  '111': ['custom', 'Email Account'],
  '112': ['custom', 'API Credential'],
  '113': ['custom', 'Medical Record'],
  '114': ['ssh', 'SSH Key'],
  '115': ['custom', 'Crypto Wallet'],
}

const LEGACY: Record<string, [Category, string]> = {
  'webforms.WebForm': ['login', 'Login'],
  'wallet.financial.CreditCard': ['card', 'Credit Card'],
  'securenotes.SecureNote': ['note', 'Secure Note'],
  'identities.Identity': ['identity', 'Identity'],
  'passwords.Password': ['password', 'Password'],
  'wallet.computer.Router': ['wifi', 'Wireless Router'],
}

const IDENTITY: Record<string, IdentityKey> = {
  firstname: 'firstName',
  initial: 'middleName',
  lastname: 'lastName',
  sex: 'gender',
  gender: 'gender',
  birthdate: 'birthdate',
  occupation: 'jobTitle',
  jobtitle: 'jobTitle',
  company: 'company',
  defphone: 'phone',
  cellphone: 'secondPhone',
  busphone: 'workPhone',
  email: 'email',
  website: 'website',
  yahoo: 'yahoo',
}

const ADDRESS: Record<string, IdentityKey> = {
  street: 'street',
  city: 'city',
  state: 'state',
  zip: 'zip',
  country: 'country',
}

export function parseOnePassword(data: string | Files): Imported {
  if (typeof data !== 'string') return parse1pux(data)
  const text = data.charCodeAt(0) === 0xfeff ? data.slice(1) : data
  const head = text.trimStart()
  if (head.startsWith('{') && Array.isArray(recordOf(wholeJson(text)).accounts)) {
    return parseAccounts(text)
  }
  if (head.startsWith('{') || head.startsWith('***')) return parse1pif(text)
  return parseOnePasswordCsv(text)
}

function wholeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function parse1pux(files: Files): Imported {
  const name = Object.keys(files).find(
    (one) => one === 'export.data' || one.endsWith('/export.data'),
  )
  const bytes = name === undefined ? undefined : files[name]
  if (bytes === undefined) throw new ImportError('The 1PUX archive has no export.data.')
  return parseAccounts(textOf(bytes))
}

function blankItem(category: Category, template: string): OneItem {
  return {
    category,
    template,
    title: '',
    note: '',
    urls: [],
    username: '',
    password: '',
    fields: [],
    created: null,
    modified: null,
    trashed: false,
    pinned: false,
    folder: null,
    attachment: false,
    passkey: false,
  }
}

function oneField(
  id: string,
  title: string,
  section: string,
  kind: FieldKind,
  value: string,
): OneField {
  return { id, title, section, kind, value, address: null, privateKey: '', publicKey: '' }
}

function monthYearText(value: unknown): string {
  const digits = stringOf(value)
  return /^\d{6}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits
}

function addressOf(value: unknown): Record<string, string> {
  const address: Record<string, string> = {}
  for (const [key, one] of Object.entries(recordOf(value))) {
    const text = stringOf(one)
    if (text !== '') address[key] = text
  }
  return address
}

function addressText(address: Record<string, string>): string {
  return ['street', 'city', 'state', 'zip', 'country']
    .map((key) => address[key] ?? '')
    .filter((one) => one !== '')
    .join(', ')
}

function puxField(raw: unknown, section: string, item: OneItem): OneField | null {
  const field = recordOf(raw)
  const id = stringOf(field.id)
  const title = stringOf(field.title)
  const [key, value] = Object.entries(recordOf(field.value))[0] ?? ['', undefined]
  switch (key) {
    case 'concealed':
      return oneField(id, title, section, 'hidden', stringOf(value))
    case 'totp':
      return oneField(id, title, section, 'totp', stringOf(value))
    case 'date':
      return oneField(id, title, section, 'date', dayOf(dateOf(value)))
    case 'monthYear':
      return oneField(id, title, section, 'text', monthYearText(value))
    case 'email':
      return oneField(
        id,
        title,
        section,
        'text',
        typeof value === 'string' ? value : stringOf(recordOf(value).email_address),
      )
    case 'address': {
      const address = addressOf(value)
      return { ...oneField(id, title, section, 'text', addressText(address)), address }
    }
    case 'sshKey': {
      const ssh = recordOf(value)
      const meta = recordOf(ssh.metadata)
      return {
        ...oneField(id, title, section, 'hidden', ''),
        privateKey: stringOf(ssh.privateKey) || stringOf(meta.privateKey),
        publicKey: stringOf(meta.publicKey),
      }
    }
    case 'file':
      item.attachment = true
      return null
    case 'reference':
      return null
    case '':
      return null
    default:
      return oneField(id, title, section, 'text', stringOf(value))
  }
}

function parseAccounts(text: string): Imported {
  const root = recordOf(jsonOf(text))
  if (!Array.isArray(root.accounts)) throw new ImportError('This is not a 1Password export.')
  const into = new Collector(NAME)
  for (const account of listOf(root.accounts)) {
    for (const rawVault of listOf(recordOf(account).vaults)) {
      const vault = recordOf(rawVault)
      const name = stringOf(recordOf(vault.attrs).name) || NAME
      into.vault(name)
      for (const raw of listOf(vault.items)) add(into, puxItem(recordOf(raw)), name)
    }
  }
  return into.result()
}

function puxItem(raw: Record<string, unknown>): OneItem {
  const uuid = stringOf(raw.categoryUuid)
  const [category, template] = CATEGORIES[uuid] ?? ['unknown', uuid]
  const item = blankItem(category, template)
  const overview = recordOf(raw.overview)
  const details = recordOf(raw.details)
  item.title = stringOf(overview.title)
  item.note = stringOf(details.notesPlain)
  const urls = listOf(overview.urls).map((one) => stringOf(recordOf(one).url))
  item.urls = urls.length > 0 ? urls : [stringOf(overview.url)]
  item.created = dateOf(raw.createdAt)
  item.modified = dateOf(raw.updatedAt)
  const state = stringOf(raw.state)
  item.trashed = state === 'archived' || state === 'trashed'
  item.pinned = Number(raw.favIndex ?? 0) > 0
  const tags = listOf(overview.tags).map(stringOf)
  item.folder = tags[0] ?? null
  item.password = stringOf(details.password)
  item.passkey = Object.keys(recordOf(details.passkey)).length > 0
  item.attachment = recordOf(details.documentAttributes).fileName !== undefined
  for (const one of listOf(details.loginFields)) {
    const field = recordOf(one)
    const designation = stringOf(field.designation)
    if (designation === 'username') item.username = stringOf(field.value)
    if (designation === 'password') item.password = stringOf(field.value)
  }
  for (const one of listOf(details.sections)) {
    const section = recordOf(one)
    const title = stringOf(section.title)
    for (const field of listOf(section.fields)) {
      const parsed = puxField(field, title, item)
      if (parsed) item.fields.push(parsed)
    }
  }
  return item
}

function legacyField(raw: unknown, section: string): OneField | null {
  const field = recordOf(raw)
  const id = stringOf(field.n)
  const title = stringOf(field.t)
  const value = field.v
  const kind = stringOf(field.k)
  if (id.startsWith('TOTP')) return oneField(id, title, section, 'totp', stringOf(value))
  switch (kind) {
    case 'concealed':
      return oneField(id, title, section, 'hidden', stringOf(value))
    case 'date':
      return oneField(id, title, section, 'date', dayOf(dateOf(value)))
    case 'monthYear':
      return oneField(id, title, section, 'text', monthYearText(value))
    case 'address': {
      const address = addressOf(value)
      return { ...oneField(id, title, section, 'text', addressText(address)), address }
    }
    case 'reference':
    case 'file':
      return null
    default:
      return oneField(id, title, section, 'text', stringOf(value))
  }
}

function legacyCategory(typeName: string): [Category, string] {
  const known = LEGACY[typeName]
  if (known) return known
  if (typeName.startsWith('wallet.')) {
    const last = typeName.split('.').pop() ?? typeName
    return ['custom', last.replace(/([a-z])([A-Z])/g, '$1 $2')]
  }
  return ['unknown', typeName]
}

function parse1pif(text: string): Imported {
  const records: Record<string, unknown>[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || SEPARATOR.test(trimmed)) continue
    records.push(recordOf(jsonOf(trimmed)))
  }
  if (records.length === 0) throw new ImportError('This is not a 1Password 1PIF export.')
  const folders = folderPaths(
    records
      .filter((one) => stringOf(one.typeName) === 'system.folder.Regular')
      .map((one) => {
        const parent = stringOf(one.folderUuid)
        return {
          id: stringOf(one.uuid),
          name: stringOf(one.title),
          parent: parent === '' ? null : parent,
        }
      }),
  )
  const into = new Collector(NAME)
  for (const record of records) {
    const typeName = stringOf(record.typeName)
    if (typeName.startsWith('system.')) continue
    add(into, legacyItem(record, typeName, folders), '')
  }
  return into.result()
}

function legacyItem(
  raw: Record<string, unknown>,
  typeName: string,
  folders: Map<string, string>,
): OneItem {
  const [category, template] = legacyCategory(typeName)
  const item = blankItem(category, template)
  const secure = recordOf(raw.secureContents)
  item.title = stringOf(raw.title)
  item.note = stringOf(secure.notesPlain)
  const urls = listOf(secure.URLs).map((one) => stringOf(recordOf(one).url))
  item.urls = urls.length > 0 ? urls : [stringOf(raw.location)]
  item.created = dateOf(raw.createdAt)
  item.modified = dateOf(raw.updatedAt)
  item.trashed = raw.trashed === true
  item.pinned = raw.faveIndex !== undefined
  const tags = listOf(recordOf(raw.openContents).tags).map(stringOf)
  item.folder = folders.get(stringOf(raw.folderUuid)) ?? tags[0] ?? null
  item.password = stringOf(secure.password)
  for (const one of listOf(secure.fields)) {
    const field = recordOf(one)
    const designation = stringOf(field.designation)
    if (designation === 'username') item.username = stringOf(field.value)
    if (designation === 'password') item.password = stringOf(field.value)
  }
  for (const key of ['cardholder', 'ccnum', 'cvv', 'pin']) {
    const value = stringOf(secure[key])
    if (value !== '') item.fields.push(oneField(key, key, '', 'text', value))
  }
  const month = stringOf(secure.expiry_mm)
  const year = stringOf(secure.expiry_yy)
  if (month !== '' && year !== '') {
    item.fields.push(oneField('expiry', 'expiry', '', 'text', `${month}/${year}`))
  }
  const sections = [
    ...listOf(secure.sections),
    ...listOf(recordOf(secure.unknown_details).sections),
  ]
  for (const one of sections) {
    const section = recordOf(one)
    const title = stringOf(section.title)
    for (const field of listOf(section.fields)) {
      const parsed = legacyField(field, title)
      if (parsed) item.fields.push(parsed)
    }
  }
  return item
}

function take(item: OneItem, ...ids: string[]): string {
  for (const id of ids) {
    const at = item.fields.findIndex((one) => one.id === id && one.value !== '')
    if (at < 0) continue
    const [field] = item.fields.splice(at, 1)
    return field?.value ?? ''
  }
  return ''
}

function extraOf(fields: readonly OneField[]): Field[] {
  return fields
    .filter((one) => one.value !== '')
    .map((one) => fieldOf(one.title || one.id, one.value, one.kind))
}

function sectionsOf(fields: readonly OneField[]): Section[] {
  const named = new Map<string, OneField[]>()
  for (const field of fields) {
    if (field.value === '') continue
    const list = named.get(field.section)
    if (list) list.push(field)
    else named.set(field.section, [field])
  }
  return [...named].map(([name, list]) => sectionOf(name, extraOf(list)))
}

function loginContent(item: OneItem): Content {
  const totpAt = item.fields.findIndex((one) => one.kind === 'totp' && one.value !== '')
  const [totp] = totpAt < 0 ? [] : item.fields.splice(totpAt, 1)
  return loginOf({
    title: item.title,
    note: item.note,
    username: item.username,
    password: item.password,
    totp: totp?.value ?? '',
    urls: item.urls,
    fields: extraOf(item.fields),
  })
}

function identityContent(item: OneItem): Content {
  const values: Partial<Record<IdentityKey, string>> = {}
  const rest: OneField[] = []
  for (const field of item.fields) {
    const key = IDENTITY[field.id]
    if (field.address) {
      for (const [from, to] of Object.entries(ADDRESS)) {
        const value = field.address[from]
        if (value !== undefined && values[to] === undefined) values[to] = value
      }
    } else if (key !== undefined && values[key] === undefined && field.value !== '') {
      values[key] = field.value
    } else {
      rest.push(field)
    }
  }
  return identityOf({
    title: item.title,
    note: item.note,
    values,
    extra: rest.map((one) => ({ name: one.title || one.id, value: one.value, kind: one.kind })),
  })
}

function contentOf(item: OneItem): Content {
  switch (item.category) {
    case 'login':
    case 'password':
      return loginContent(item)
    case 'card':
      return cardOf({
        title: item.title,
        note: item.note,
        holder: take(item, 'cardholder'),
        number: take(item, 'ccnum'),
        code: take(item, 'cvv'),
        expiry: take(item, 'expiry'),
        pin: take(item, 'pin'),
        fields: extraOf(item.fields.filter((one) => one.id !== 'type')),
      })
    case 'identity':
      return identityContent(item)
    case 'wifi':
      return wifiOf({
        title: item.title,
        note: item.note,
        ssid: take(item, 'network_name'),
        password: take(item, 'wireless_password'),
        security: take(item, 'wireless_security'),
        sections: sectionsOf(item.fields),
      })
    case 'ssh': {
      const key = item.fields.find((one) => one.privateKey !== '')
      return sshOf({
        title: item.title,
        note: item.note,
        privateKey: key?.privateKey ?? '',
        publicKey: key?.publicKey ?? '',
        sections: sectionsOf(item.fields.filter((one) => one !== key)),
      })
    }
    case 'custom':
      return customOf({
        title: item.title,
        note: item.note,
        template: item.template,
        sections: sectionsOf(item.fields),
      })
    case 'note':
    case 'document':
    case 'unknown':
      return noteOf(item.title, item.note, extraOf(item.fields))
  }
}

function add(into: Collector, item: OneItem, vault: string): void {
  const content = contentOf(item)
  if (item.category === 'unknown') {
    into.skip(`Kept as a note: Orden has no kind for 1Password's "${item.template}".`, item.title)
  }
  if (item.attachment) into.skip('Its file was not imported.', item.title)
  if (item.passkey)
    into.skip('Its passkey stays in 1Password: 1Password does not export it.', item.title)
  into.add(
    itemOf(content, {
      created: item.created,
      modified: item.modified,
      pinned: item.pinned,
      trashed: item.trashed,
      folder: item.folder,
    }),
    vault,
  )
}

const CSV_KNOWN = new Set([
  'title',
  'name',
  'url',
  'urls',
  'website',
  'login_url',
  'username',
  'login_username',
  'password',
  'login_password',
  'otpauth',
  'one-time password',
  'favorite',
  'archived',
  'tags',
  'notes',
  'notesplain',
  'type',
])

function parseOnePasswordCsv(text: string): Imported {
  const rows = csvRecords(text)
  const first = rows[0]
  if (first && !Object.keys(first).some((key) => key.toLowerCase() === 'password')) {
    throw new ImportError('This is not a 1Password CSV export.')
  }
  const into = new Collector(NAME)
  for (const row of rows) {
    const fields = Object.entries(row)
      .filter(([key, value]) => !CSV_KNOWN.has(key.toLowerCase()) && value !== '')
      .map(([key, value]) => fieldOf(key, value))
    const content = loginOf({
      title: pick(row, 'Title', 'title', 'name'),
      note: pick(row, 'Notes', 'notes', 'notesPlain'),
      username: pick(row, 'Username', 'username', 'login_username'),
      password: pick(row, 'Password', 'password', 'login_password'),
      totp: pick(row, 'OTPAuth', 'otpauth', 'one-time password'),
      urls: urlsIn(pick(row, 'Url', 'URL', 'urls', 'website', 'login_url')),
      fields,
    })
    const flag = (value: string): boolean => ['true', '1', 'yes'].includes(value.toLowerCase())
    const tags = pick(row, 'Tags', 'tags')
    into.add(
      itemOf(content, {
        pinned: flag(pick(row, 'Favorite', 'favorite')),
        trashed: flag(pick(row, 'Archived', 'archived')),
        folder: tags.split(/[,;]/)[0] ?? null,
      }),
    )
  }
  return into.result()
}
