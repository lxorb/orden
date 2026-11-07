import type { Content, Field, FieldKind, MatchRule, Passkey, Website } from '../types'
import {
  Collector,
  ImportError,
  cardOf,
  dateOf,
  expiryOf,
  fieldOf,
  identityOf,
  itemOf,
  jsonOf,
  listOf,
  loginOf,
  noteOf,
  recordOf,
  stringOf,
  websitesOf,
} from './build'
import { passkeyOf, sshOf } from './content'
import { csvRecords, type CsvRecord } from './csv'
import type { Imported } from './types'

const NAME = 'Bitwarden'

const ENCRYPTED =
  'The export is encrypted: export it again from Bitwarden as "JSON" or "CSV", not "JSON (Encrypted)".'

const MATCH: Record<number, MatchRule> = {
  0: 'domain',
  1: 'host',
  2: 'prefix',
  3: 'exact',
  4: 'domain',
  5: 'never',
}

const FIELD_KINDS: Record<number, FieldKind> = { 0: 'text', 1: 'hidden', 2: 'text' }

export function parseBitwarden(text: string): Imported {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return body.trimStart().startsWith('{') ? parseBitwardenJson(body) : parseBitwardenCsv(body)
}

function fieldsOf(raw: unknown): Field[] {
  const fields: Field[] = []
  for (const one of listOf(raw)) {
    const field = recordOf(one)
    const kind = FIELD_KINDS[Number(field.type ?? 0)]
    const value = stringOf(field.value)
    const name = stringOf(field.name)
    if (kind === undefined || (value === '' && name === '')) continue
    fields.push(fieldOf(name, value, kind))
  }
  return fields
}

function websitesWithMatch(raw: unknown): Website[] {
  const websites: Website[] = []
  for (const one of listOf(raw)) {
    const entry = recordOf(one)
    const [website] = websitesOf([stringOf(entry.uri)])
    if (!website || websites.some((known) => known.url === website.url)) continue
    const match = entry.match === null || entry.match === undefined ? 0 : Number(entry.match)
    websites.push({ ...website, match: MATCH[match] ?? 'domain' })
  }
  return websites
}

function passkeysOf(raw: unknown): Passkey[] {
  return listOf(raw).map((one) => {
    const key = recordOf(one)
    return passkeyOf({
      rpId: stringOf(key.rpId),
      rpName: stringOf(key.rpName),
      userName: stringOf(key.userName),
      userDisplayName: stringOf(key.userDisplayName),
      userHandle: stringOf(key.userHandle),
      credentialId: stringOf(key.credentialId),
      privateKey: stringOf(key.keyValue),
      counter: Number(stringOf(key.counter)) || 0,
      created: dateOf(key.creationDate),
    })
  })
}

function contentOf(item: Record<string, unknown>): { content: Content; known: boolean } {
  const title = stringOf(item.name)
  const note = stringOf(item.notes)
  const fields = fieldsOf(item.fields)
  switch (Number(item.type)) {
    case 1: {
      const login = recordOf(item.login)
      const content = loginOf({
        title,
        note,
        fields,
        username: stringOf(login.username),
        password: stringOf(login.password),
        totp: stringOf(login.totp),
        passkeys: passkeysOf(login.fido2Credentials),
      })
      return { known: true, content: { ...content, websites: websitesWithMatch(login.uris) } }
    }
    case 2:
      return { known: true, content: noteOf(title, note, fields) }
    case 3: {
      const card = recordOf(item.card)
      return {
        known: true,
        content: cardOf({
          title,
          note,
          fields,
          holder: stringOf(card.cardholderName),
          number: stringOf(card.number),
          expiry: expiryOf(stringOf(card.expMonth), stringOf(card.expYear)),
          code: stringOf(card.code),
        }),
      }
    }
    case 4: {
      const id = recordOf(item.identity)
      const street = ['address1', 'address2', 'address3']
        .map((key) => stringOf(id[key]).trim())
        .filter((line) => line !== '')
        .join('\n')
      return {
        known: true,
        content: identityOf({
          title,
          note,
          fields,
          values: {
            firstName: stringOf(id.firstName),
            middleName: stringOf(id.middleName),
            lastName: stringOf(id.lastName),
            email: stringOf(id.email),
            phone: stringOf(id.phone),
            street,
            city: stringOf(id.city),
            state: stringOf(id.state),
            zip: stringOf(id.postalCode),
            country: stringOf(id.country),
            company: stringOf(id.company),
            ssn: stringOf(id.ssn),
            passport: stringOf(id.passportNumber),
            license: stringOf(id.licenseNumber),
          },
          extra: [
            { name: 'Title', value: stringOf(id.title) },
            { name: 'Username', value: stringOf(id.username) },
          ],
        }),
      }
    }
    case 5: {
      const ssh = recordOf(item.sshKey)
      const fingerprint = stringOf(ssh.keyFingerprint)
      return {
        known: true,
        content: sshOf({
          title,
          note,
          fields: fingerprint === '' ? fields : [...fields, fieldOf('Fingerprint', fingerprint)],
          privateKey: stringOf(ssh.privateKey),
          publicKey: stringOf(ssh.publicKey),
        }),
      }
    }
    default:
      return { known: false, content: noteOf(title, note, fields) }
  }
}

function parseBitwardenJson(text: string): Imported {
  const root = recordOf(jsonOf(text))
  if (root.encrypted === true) {
    const into = new Collector(NAME)
    into.skip(ENCRYPTED, NAME)
    return into.result()
  }
  if (!Array.isArray(root.items)) throw new ImportError('This is not a Bitwarden export.')
  const folders = new Map(
    listOf(root.folders).map((one) => {
      const folder = recordOf(one)
      return [stringOf(folder.id), stringOf(folder.name)] as const
    }),
  )
  const collections = new Map(
    listOf(root.collections).map((one) => {
      const collection = recordOf(one)
      return [stringOf(collection.id), stringOf(collection.name)] as const
    }),
  )
  const into = new Collector(NAME)
  for (const raw of listOf(root.items)) {
    const item = recordOf(raw)
    const { content, known } = contentOf(item)
    const kind = stringOf(item.type)
    if (!known)
      into.skip(`Kept as a note: Orden has no kind for Bitwarden's type ${kind}.`, content.title)
    const collection = listOf(item.collectionIds)
      .map((id) => collections.get(stringOf(id)))
      .find((name) => name !== undefined)
    into.add(
      itemOf(content, {
        created: dateOf(item.creationDate),
        modified: dateOf(item.revisionDate),
        pinned: item.favorite === true,
        trashed: dateOf(item.deletedDate) !== null,
        folder: folders.get(stringOf(item.folderId)) ?? null,
      }),
      collection ?? '',
    )
  }
  return into.result()
}

function csvFieldsOf(text: string): Field[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const at = line.indexOf(': ')
      return at < 0 ? fieldOf('', line) : fieldOf(line.slice(0, at), line.slice(at + 2))
    })
}

function csvContentOf(row: CsvRecord): Content {
  const title = row.name ?? ''
  const note = row.notes ?? ''
  const fields = csvFieldsOf(row.fields ?? '')
  if ((row.type ?? 'login') === 'note') return noteOf(title, note, fields)
  return loginOf({
    title,
    note,
    fields,
    username: row.login_username ?? '',
    password: row.login_password ?? '',
    totp: row.login_totp ?? '',
    urls: (row.login_uri ?? '').split(/,|\r?\n/),
  })
}

function parseBitwardenCsv(text: string): Imported {
  const rows = csvRecords(text)
  const first = rows[0]
  if (first && !('login_password' in first))
    throw new ImportError('This is not a Bitwarden CSV export.')
  const into = new Collector(NAME)
  for (const row of rows) {
    const type = row.type ?? 'login'
    const content = csvContentOf(row)
    if (type !== 'login' && type !== 'note' && type !== '') {
      into.skip(`Kept as a login: Bitwarden's CSV has no type "${type}".`, content.title)
    }
    const collection = (row.collections ?? '').split(',')[0] ?? ''
    into.add(
      itemOf(content, {
        pinned: row.favorite === '1',
        folder: row.folder ?? null,
      }),
      collection,
    )
  }
  return into.result()
}
