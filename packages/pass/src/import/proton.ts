import type {
  Content,
  Field,
  FieldKind,
  IdentityKey,
  MatchRule,
  Passkey,
  Section,
  Website,
} from '../types'
import { blank } from '../envelope'
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
  recordOf,
  sectionOf,
  stringOf,
  textOf,
  websitesOf,
  type Files,
} from './build'
import { customOf, dayOf, folderPaths, passkeyOf, sshOf, wifiOf } from './content'
import { csvRecords, type CsvRecord } from './csv'
import type { Imported } from './types'

const NAME = 'Proton Pass'

const ENCRYPTED =
  'The export is encrypted with a passphrase: export it again from Proton Pass without one.'

const MODES: Record<number, MatchRule> = {
  0: 'domain',
  1: 'exact',
  2: 'never',
  3: 'prefix',
  6: 'exact',
}

const WIFI: Record<number, string> = { 0: 'none', 1: 'wpa', 2: 'wpa2', 3: 'wpa3', 4: 'wep' }

const IDENTITY: Record<string, IdentityKey> = {
  fullName: 'fullName',
  email: 'email',
  phoneNumber: 'phone',
  firstName: 'firstName',
  middleName: 'middleName',
  lastName: 'lastName',
  birthdate: 'birthdate',
  gender: 'gender',
  organization: 'organization',
  streetAddress: 'street',
  floor: 'floor',
  zipOrPostalCode: 'zip',
  city: 'city',
  stateOrProvince: 'state',
  countryOrRegion: 'country',
  county: 'county',
  socialSecurityNumber: 'ssn',
  passportNumber: 'passport',
  licenseNumber: 'license',
  website: 'website',
  xHandle: 'x',
  secondPhoneNumber: 'secondPhone',
  linkedin: 'linkedin',
  reddit: 'reddit',
  facebook: 'facebook',
  yahoo: 'yahoo',
  instagram: 'instagram',
  company: 'company',
  jobTitle: 'jobTitle',
  personalWebsite: 'personalWebsite',
  workPhoneNumber: 'workPhone',
  workEmail: 'workEmail',
}

const IDENTITY_EXTRA = [
  'extraPersonalDetails',
  'extraAddressDetails',
  'extraContactDetails',
  'extraWorkDetails',
]

export function parseProton(data: string | Files): Imported {
  if (typeof data !== 'string') return parseProtonZip(data)
  const text = data.charCodeAt(0) === 0xfeff ? data.slice(1) : data
  const head = text.trimStart()
  if (head.startsWith('-----BEGIN PGP')) return encrypted()
  if (head.startsWith('{')) return parseProtonJson(text)
  return parseProtonCsv(text)
}

function encrypted(): Imported {
  const into = new Collector(NAME)
  into.skip(ENCRYPTED, NAME)
  return into.result()
}

function parseProtonZip(files: Files): Imported {
  const names = Object.keys(files)
  if (names.some((name) => name.endsWith('data.pgp'))) return encrypted()
  const json = names.find((name) => name.endsWith('data.json'))
  const bytes = json === undefined ? undefined : files[json]
  if (bytes === undefined) throw new ImportError('The archive has no Proton Pass data.json.')
  return parseProtonJson(textOf(bytes))
}

function timestampText(value: unknown): string {
  const seconds = recordOf(value).seconds
  if (seconds !== undefined) return dayOf(dateOf(Number(stringOf(seconds))))
  const raw = stringOf(value)
  if (raw === '') return ''
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : dayOf(dateOf(raw))
}

function extraFieldOf(raw: unknown): Field | null {
  const field = recordOf(raw)
  const name = stringOf(field.fieldName)
  const data = recordOf(field.data)
  const type = stringOf(field.type)
  let kind: FieldKind = 'text'
  let value = stringOf(data.content)
  if (type === 'hidden') kind = 'hidden'
  else if (type === 'totp') {
    kind = 'totp'
    value = stringOf(data.totpUri)
  } else if (type === 'timestamp') {
    kind = 'date'
    value = timestampText(data.timestamp)
  }
  return value === '' && name === '' ? null : fieldOf(name, value, kind)
}

function extraFieldsOf(raw: unknown): Field[] {
  return listOf(raw)
    .map(extraFieldOf)
    .filter((one): one is Field => one !== null)
}

function sectionsOf(raw: unknown): Section[] {
  return listOf(raw).map((one) => {
    const section = recordOf(one)
    return sectionOf(stringOf(section.sectionName), extraFieldsOf(section.sectionFields))
  })
}

function websitesWithModes(content: Record<string, unknown>): Website[] {
  const autofill = listOf(content.autofillUrls)
  if (autofill.length === 0) return websitesOf(listOf(content.urls).map(stringOf))
  const websites: Website[] = []
  for (const raw of autofill) {
    const entry = recordOf(raw)
    const [website] = websitesOf([stringOf(entry.url)])
    if (!website || websites.some((one) => one.url === website.url)) continue
    websites.push({ ...website, match: MODES[Number(entry.mode ?? 0)] ?? 'domain' })
  }
  return websites
}

function passkeysOf(raw: unknown): Passkey[] {
  return listOf(raw).map((one) => {
    const key = recordOf(one)
    return passkeyOf({
      rpId: stringOf(key.rpId) || stringOf(key.domain),
      rpName: stringOf(key.rpName),
      userName: stringOf(key.userName),
      userDisplayName: stringOf(key.userDisplayName),
      userHandle: stringOf(key.userHandle),
      credentialId: stringOf(key.credentialId),
      privateKey: stringOf(key.content),
      created: dateOf(key.createTime),
      note: stringOf(key.note),
    })
  })
}

interface ProtonContent {
  content: Content
  kind: string
}

function contentOf(item: Record<string, unknown>, aliasEmail: string): ProtonContent {
  const data = recordOf(item.data)
  const meta = recordOf(data.metadata)
  const title = stringOf(meta.name)
  const note = stringOf(meta.note)
  const fields = extraFieldsOf(data.extraFields)
  const content = recordOf(data.content)
  const kind = stringOf(data.type)
  switch (kind) {
    case 'login': {
      const legacy = typeof content.username === 'string' && content.itemEmail === undefined
      const login = loginOf({
        title,
        note,
        email: legacy ? stringOf(content.username) : stringOf(content.itemEmail),
        username: legacy ? '' : stringOf(content.itemUsername),
        password: stringOf(content.password),
        totp: stringOf(content.totpUri),
        fields,
        passkeys: passkeysOf(content.passkeys),
      })
      return { kind, content: { ...login, websites: websitesWithModes(content) } }
    }
    case 'note':
      return { kind, content: noteOf(title, note, fields) }
    case 'alias':
      return {
        kind,
        content: {
          ...blank('alias'),
          title: title.trim(),
          note,
          fields,
          address: aliasEmail,
          provider: 'manual',
          enabled: true,
        },
      }
    case 'creditCard':
      return {
        kind,
        content: cardOf({
          title,
          note,
          fields,
          holder: stringOf(content.cardholderName),
          number: stringOf(content.number),
          expiry: stringOf(content.expirationDate),
          code: stringOf(content.verificationNumber),
          pin: stringOf(content.pin),
        }),
      }
    case 'identity': {
      const values: Partial<Record<IdentityKey, string>> = {}
      for (const [from, to] of Object.entries(IDENTITY)) values[to] = stringOf(content[from])
      const identity = identityOf({
        title,
        note,
        fields,
        values,
        extra: IDENTITY_EXTRA.flatMap((key) => extraFieldsOf(content[key])),
      })
      return {
        kind,
        content: {
          ...identity,
          sections: [
            ...identity.sections,
            ...sectionsOf(content.extraSections).filter((one) => one.fields.length > 0),
          ],
        },
      }
    }
    case 'sshKey':
      return {
        kind,
        content: sshOf({
          title,
          note,
          fields,
          privateKey: stringOf(content.privateKey),
          publicKey: stringOf(content.publicKey),
          sections: sectionsOf(content.sections),
        }),
      }
    case 'wifi':
      return {
        kind,
        content: wifiOf({
          title,
          note,
          fields,
          ssid: stringOf(content.ssid),
          password: stringOf(content.password),
          security: WIFI[Number(content.security ?? 0)] ?? '',
          sections: sectionsOf(content.sections),
        }),
      }
    case 'custom':
      return {
        kind,
        content: customOf({ title, note, fields, sections: sectionsOf(content.sections) }),
      }
    default:
      return { kind, content: noteOf(title, note, fields) }
  }
}

function parseProtonJson(text: string): Imported {
  const root = recordOf(jsonOf(text))
  if (root.encrypted === true) return encrypted()
  if (root.vaults === undefined) throw new ImportError('This is not a Proton Pass export.')
  const into = new Collector(NAME)
  for (const rawVault of Object.values(recordOf(root.vaults))) {
    const vault = recordOf(rawVault)
    const name = stringOf(vault.name) || NAME
    into.vault(name)
    const paths = folderPaths(
      listOf(vault.folders).map((one) => {
        const folder = recordOf(one)
        const parent = stringOf(folder.parentFolderId)
        return {
          id: stringOf(folder.folderId),
          name: stringOf(folder.name),
          parent: parent === '' ? null : parent,
        }
      }),
    )
    for (const rawItem of listOf(vault.items)) {
      const item = recordOf(rawItem)
      const { content, kind } = contentOf(item, stringOf(item.aliasEmail))
      const title = content.title
      if (!isKnownKind(kind)) {
        into.skip(`Kept as a note: Orden has no kind for "${kind}".`, title)
      }
      if (listOf(item.files).length > 0) {
        into.skip('Its attachments were not imported.', title)
      }
      into.add(
        itemOf(content, {
          created: dateOf(item.createTime),
          modified: dateOf(item.modifyTime),
          pinned: item.pinned === true,
          trashed: Number(item.state) === 2,
          folder: paths.get(stringOf(item.folderId)) ?? null,
        }),
        name,
      )
    }
  }
  return into.result()
}

function isKnownKind(kind: string): boolean {
  return ['login', 'note', 'alias', 'creditCard', 'identity', 'sshKey', 'wifi', 'custom'].includes(
    kind,
  )
}

function jsonRecord(text: string): Record<string, unknown> {
  try {
    return recordOf(JSON.parse(text) as unknown)
  } catch {
    return {}
  }
}

function csvWebsites(row: CsvRecord): Website[] {
  const autofill = jsonRecordList(row.autofillUrls ?? '')
  if (autofill.length > 0) return websitesWithModes({ autofillUrls: autofill })
  return websitesOf((row.url ?? '').split(/,\s*|\r?\n/))
}

function jsonRecordList(text: string): unknown[] {
  if (text.trim() === '') return []
  try {
    return listOf(JSON.parse(text) as unknown)
  } catch {
    return []
  }
}

function csvContentOf(row: CsvRecord, hasEmail: boolean): Content | null {
  const title = row.name ?? ''
  const note = row.note ?? ''
  switch (row.type ?? '') {
    case '':
    case 'login': {
      const login = loginOf({
        title,
        note,
        email: hasEmail ? (row.email ?? '') : (row.username ?? ''),
        username: hasEmail ? (row.username ?? '') : '',
        password: row.password ?? '',
        totp: row.totp ?? '',
      })
      return { ...login, websites: csvWebsites(row) }
    }
    case 'creditCard': {
      const card = jsonRecord(note)
      return cardOf({
        title,
        note: stringOf(card.note),
        holder: stringOf(card.cardholderName),
        number: stringOf(card.number),
        expiry: stringOf(card.expirationDate),
        code: stringOf(card.verificationNumber),
        pin: stringOf(card.pin),
      })
    }
    case 'identity': {
      const raw = jsonRecord(note)
      const values: Partial<Record<IdentityKey, string>> = {}
      for (const [from, to] of Object.entries(IDENTITY)) values[to] = stringOf(raw[from])
      return identityOf({ title, note: stringOf(raw.note), values })
    }
    case 'alias': {
      const address = [row.email, row.username].find((one) => one !== undefined && one !== '') ?? ''
      if (address === '') return null
      return { ...blank('alias'), title, note, address, provider: 'manual', enabled: true }
    }
    default:
      return noteOf(title, note)
  }
}

function parseProtonCsv(text: string): Imported {
  const rows = csvRecords(text)
  const first = rows[0]
  if (first && !('name' in first && 'password' in first)) {
    throw new ImportError('This is not a Proton Pass CSV export.')
  }
  const hasEmail = first !== undefined && 'email' in first
  const into = new Collector(NAME)
  for (const row of rows) {
    const content = csvContentOf(row, hasEmail)
    const type = row.type ?? ''
    if (content === null) continue
    if (!['', 'login', 'note', 'creditCard', 'identity', 'alias'].includes(type)) {
      into.skip(
        `Kept as a note: a Proton Pass CSV holds only the note of a "${type}".`,
        content.title,
      )
    }
    into.add(
      itemOf(content, {
        created: dateOf(row.createTime ?? ''),
        modified: dateOf(row.modifyTime ?? ''),
      }),
      row.vault ?? '',
    )
  }
  return into.result()
}
