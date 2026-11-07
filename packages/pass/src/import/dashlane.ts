import type { IdentityKey } from '../types'
import type { Files } from './build'
import {
  Collector,
  cardOf,
  expiryOf,
  fieldOf,
  fieldsOf,
  identityOf,
  itemOf,
  loginOf,
  noteOf,
  pick,
  textOf,
} from './build'
import type { CsvRecord } from './csv'
import { csvHeader, csvRecords } from './csv'
import type { Imported } from './types'

type Kind = 'credentials' | 'securenotes' | 'payments' | 'ids' | 'personalInfo'

function kindOfHeader(header: readonly string[]): Kind | null {
  const has = (name: string): boolean => header.includes(name)
  if (has('username') && has('password') && has('url')) return 'credentials'
  if (has('cc_number') || has('account_holder')) return 'payments'
  if (has('place_of_issue') || (has('number') && has('issue_date'))) return 'ids'
  if (has('first_name') || has('address_recipient') || has('phone_number')) return 'personalInfo'
  if (has('title') && has('note')) return 'securenotes'
  return null
}

function credential(into: Collector, row: CsvRecord): void {
  const usernames = [pick(row, 'username'), pick(row, 'username2'), pick(row, 'username3')]
  const [first = '', ...others] = usernames.filter((one) => one !== '')
  into.add(
    itemOf(
      loginOf({
        title: pick(row, 'title'),
        username: first,
        password: pick(row, 'password'),
        urls: [pick(row, 'url')],
        note: pick(row, 'note'),
        totp: pick(row, 'otpUrl', 'otpSecret'),
        fields: others.map((one, i) => fieldOf(`Username ${String(i + 2)}`, one)),
      }),
      { folder: pick(row, 'category') },
    ),
  )
}

function secureNote(into: Collector, row: CsvRecord): void {
  into.add(itemOf(noteOf(pick(row, 'title'), pick(row, 'note')), { folder: pick(row, 'category') }))
}

function payment(into: Collector, row: CsvRecord): void {
  const title = pick(row, 'account_name')
  if (pick(row, 'cc_number') !== '' || pick(row, 'type') === 'payment_card') {
    into.add(
      itemOf(
        cardOf({
          title,
          holder: pick(row, 'account_holder'),
          number: pick(row, 'cc_number'),
          code: pick(row, 'code'),
          expiry: expiryOf(pick(row, 'expiration_month'), pick(row, 'expiration_year')),
          note: pick(row, 'note'),
          fields: fieldsOf([
            { name: 'Issuing bank', value: pick(row, 'issuing_bank') },
            { name: 'Country', value: pick(row, 'country') },
          ]),
        }),
      ),
    )
    return
  }
  into.add(
    itemOf(
      noteOf(
        title,
        pick(row, 'note'),
        fieldsOf([
          { name: 'Account holder', value: pick(row, 'account_holder') },
          { name: 'Account number', value: pick(row, 'account_number'), kind: 'hidden' },
          { name: 'Routing number', value: pick(row, 'routing_number') },
          { name: 'Bank', value: pick(row, 'issuing_bank') },
          { name: 'Country', value: pick(row, 'country') },
        ]),
      ),
    ),
  )
}

const ID_KEYS: Record<string, IdentityKey> = {
  passport: 'passport',
  license: 'license',
  driver_license: 'license',
  social_security: 'ssn',
}

function idDocument(into: Collector, row: CsvRecord): void {
  const type = pick(row, 'type')
  const key = ID_KEYS[type]
  const number = pick(row, 'number')
  const label = type.replace(/_/g, ' ') || 'ID'
  into.add(
    itemOf(
      identityOf({
        title: `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}${pick(row, 'name') ? ` (${pick(row, 'name')})` : ''}`,
        values: { fullName: pick(row, 'name'), ...(key ? { [key]: number } : {}) },
        extra: [
          ...(key ? [] : [{ name: `${label} number`, value: number }]),
          { name: 'Issued', value: pick(row, 'issue_date'), kind: 'date' as const },
          { name: 'Expires', value: pick(row, 'expiration_date'), kind: 'date' as const },
          { name: 'Place of issue', value: pick(row, 'place_of_issue') },
          { name: 'State', value: pick(row, 'state') },
        ],
      }),
    ),
  )
}

function personal(into: Collector, row: CsvRecord): void {
  const street = [
    pick(row, 'address'),
    pick(row, 'address_building'),
    pick(row, 'address_apartment'),
  ]
    .filter((one) => one !== '')
    .join(', ')
  into.add(
    itemOf(
      identityOf({
        title: pick(row, 'item_name'),
        values: {
          firstName: pick(row, 'first_name'),
          middleName: pick(row, 'middle_name'),
          lastName: pick(row, 'last_name'),
          birthdate: pick(row, 'date_of_birth'),
          email: pick(row, 'email'),
          phone: pick(row, 'phone_number'),
          street,
          floor: pick(row, 'address_floor'),
          zip: pick(row, 'zip'),
          city: pick(row, 'city'),
          state: pick(row, 'state'),
          country: pick(row, 'country'),
          jobTitle: pick(row, 'job_title'),
          website: pick(row, 'url'),
        },
        extra: [
          { name: 'Title', value: pick(row, 'title') },
          { name: 'Login', value: pick(row, 'login') },
          { name: 'Place of birth', value: pick(row, 'place_of_birth') },
          { name: 'Recipient', value: pick(row, 'address_recipient') },
          { name: 'Door code', value: pick(row, 'address_door_code'), kind: 'hidden' },
        ],
      }),
    ),
  )
}

const READERS: Record<Kind, (into: Collector, row: CsvRecord) => void> = {
  credentials: credential,
  securenotes: secureNote,
  payments: payment,
  ids: idDocument,
  personalInfo: personal,
}

function readCsv(into: Collector, text: string, name: string): void {
  const kind = kindOfHeader(csvHeader(text))
  if (kind === null) {
    into.skip('Orden does not know this Dashlane file.', name)
    return
  }
  for (const row of csvRecords(text)) READERS[kind](into, row)
}

export function parseDashlane(data: string | Files): Imported {
  const into = new Collector('Dashlane')
  if (typeof data === 'string') {
    readCsv(into, data, 'Dashlane')
    return into.result()
  }
  for (const [path, bytes] of Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) {
    const name = path.split('/').pop() ?? path
    if (!name.toLowerCase().endsWith('.csv')) continue
    readCsv(into, textOf(bytes), name)
  }
  return into.result()
}
