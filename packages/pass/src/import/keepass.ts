import type { Field } from '../types'
import { Collector, ImportError, dateOf, fieldOf, itemOf, loginOf, noteOf } from './build'
import type { Imported } from './types'
import type { XmlElement } from './xml'
import { childOf, childrenOf, parseXml, textAt } from './xml'

const STANDARD = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes'])
const TOTP_KEYS = new Set(['otp', 'totp', 'totp seed', 'timeotp-secret-base32'])
const IGNORED_KEYS = new Set([
  'totp settings',
  'timeotp-algorithm',
  'timeotp-length',
  'timeotp-period',
])
const URL_KEY = /^(kp2a_url|url)(_\d+)?$/i

interface Context {
  into: Collector
  recycleBin: string
}

interface EntryValue {
  value: string
  hidden: boolean
}

function stringsOf(entry: XmlElement, into: Collector): Map<string, EntryValue> {
  const title = childrenOf(entry, 'String').find((one) => textAt(one, 'Key') === 'Title')
  const strings = new Map<string, EntryValue>()
  for (const one of childrenOf(entry, 'String')) {
    const key = textAt(one, 'Key')
    const value = childOf(one, 'Value')
    if (key === '' || value === undefined) continue
    if (value.attributes.Protected === 'True') {
      into.skip(
        `"${key}" is still encrypted; export from KeePass as KeePass XML (2.x), not the database's inner XML.`,
        textAt(title, 'Value'),
      )
      continue
    }
    strings.set(key, { value: value.text, hidden: value.attributes.ProtectInMemory === 'True' })
  }
  return strings
}

function entryOf(entry: XmlElement, folder: string, trashed: boolean, context: Context): void {
  const strings = stringsOf(entry, context.into)
  const value = (key: string): string => strings.get(key)?.value ?? ''
  const fields: Field[] = []
  const urls = [value('URL')]
  let totp = ''
  for (const [key, { value: text, hidden }] of strings) {
    if (STANDARD.has(key) || text === '') continue
    const lower = key.toLowerCase()
    if (TOTP_KEYS.has(lower) && totp === '') totp = text
    else if (IGNORED_KEYS.has(lower)) continue
    else if (URL_KEY.test(key)) urls.push(text)
    else fields.push(fieldOf(key, text, hidden ? 'hidden' : 'text'))
  }
  const title = value('Title')
  const parts = {
    created: dateOf(textAt(entry, 'Times', 'CreationTime')),
    modified: dateOf(textAt(entry, 'Times', 'LastModificationTime')),
    trashed,
    folder,
  }
  const plainNote =
    value('UserName') === '' &&
    value('Password') === '' &&
    urls.every((u) => u === '') &&
    totp === ''
  const content = plainNote
    ? noteOf(title, value('Notes'), fields)
    : loginOf({
        title,
        username: value('UserName'),
        password: value('Password'),
        urls,
        note: value('Notes'),
        totp,
        fields,
      })
  context.into.add(itemOf(content, parts))
  if (childrenOf(entry, 'Binary').length > 0) {
    context.into.skip('Its attachments did not come in.', title)
  }
}

function groupOf(group: XmlElement, path: string[], trashed: boolean, context: Context): void {
  const folder = path.join('/')
  for (const entry of childrenOf(group, 'Entry')) entryOf(entry, folder, trashed, context)
  for (const child of childrenOf(group, 'Group')) {
    const inBin =
      trashed ||
      (context.recycleBin !== ''
        ? textAt(child, 'UUID') === context.recycleBin
        : textAt(child, 'Name') === 'Recycle Bin')
    groupOf(child, inBin ? [] : [...path, textAt(child, 'Name')], inBin, context)
  }
}

export function parseKeePass(text: string): Imported {
  const root = parseXml(text)
  if (root.name !== 'KeePassFile') throw new ImportError('This is not a KeePass XML export.')
  const meta = childOf(root, 'Meta')
  const recycleBin =
    textAt(meta, 'RecycleBinEnabled') === 'False' ? '-' : textAt(meta, 'RecycleBinUUID').trim()
  const context: Context = {
    into: new Collector(textAt(meta, 'DatabaseName').trim() || 'KeePass'),
    recycleBin: /^A+=*$/.test(recycleBin) ? '' : recycleBin,
  }
  const top = childOf(childOf(root, 'Root') ?? root, 'Group')
  if (top) groupOf(top, [], false, context)
  return context.into.result()
}
