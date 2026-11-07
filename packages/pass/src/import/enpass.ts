import type { FieldKind, IdentityKey } from '../types'
import {
  Collector,
  cardOf,
  dateOf,
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
import { folderPaths } from './content'
import type { Imported } from './types'

interface EnpassField {
  label: string
  type: string
  value: string
  sensitive: boolean
}

interface Extra {
  name: string
  value: string
  kind?: FieldKind
}

const IDENTITY_LABELS: Record<string, IdentityKey> = {
  'full name': 'fullName',
  name: 'fullName',
  'first name': 'firstName',
  'middle name': 'middleName',
  'last name': 'lastName',
  birthday: 'birthdate',
  'date of birth': 'birthdate',
  gender: 'gender',
  email: 'email',
  phone: 'phone',
  mobile: 'phone',
  street: 'street',
  address: 'street',
  city: 'city',
  state: 'state',
  zip: 'zip',
  'postal code': 'zip',
  country: 'country',
  company: 'company',
  'job title': 'jobTitle',
  occupation: 'jobTitle',
  website: 'website',
}

function fieldsIn(item: Record<string, unknown>): EnpassField[] {
  return listOf(item.fields)
    .map(recordOf)
    .filter((one) => !one.deleted && stringOf(one.type) !== 'section')
    .map((one) => ({
      label: stringOf(one.label),
      type: stringOf(one.type),
      value: stringOf(one.value),
      sensitive: Boolean(one.sensitive),
    }))
    .filter((one) => one.value !== '')
}

function extraOf(field: EnpassField): Extra {
  const kind: FieldKind =
    field.type === 'totp'
      ? 'totp'
      : field.type === 'date'
        ? 'date'
        : field.sensitive || field.type === 'password' || field.type === 'pin'
          ? 'hidden'
          : 'text'
  return { name: field.label || field.type, value: field.value, kind }
}

function takeFirst(fields: EnpassField[], ...types: string[]): string {
  const at = fields.findIndex((one) => types.includes(one.type))
  return at < 0 ? '' : (fields.splice(at, 1)[0]?.value ?? '')
}

export function parseEnpass(text: string): Imported {
  const root = recordOf(jsonOf(text))
  const into = new Collector('Enpass')
  const paths = folderPaths(
    listOf(root.folders).map((one) => {
      const folder = recordOf(one)
      return {
        id: stringOf(folder.uuid),
        name: stringOf(folder.title),
        parent: stringOf(folder.parent_uuid) || null,
      }
    }),
  )
  for (const raw of listOf(root.items)) {
    const item = recordOf(raw)
    const category = stringOf(item.category)
    const title = stringOf(item.title)
    const note = stringOf(item.note)
    const fields = fieldsIn(item)
    const folderId = stringOf(listOf(item.folders)[0])
    const parts = {
      created: dateOf(item.createdAt),
      modified: dateOf(item.updated_at),
      pinned: Boolean(item.favorite),
      trashed: Boolean(item.trashed),
      folder: paths.get(folderId) ?? null,
    }
    const hasLogin = fields.some((one) => one.type === 'password' || one.type === 'username')
    if (category === 'creditcard') {
      into.add(
        itemOf(
          cardOf({
            title,
            note,
            holder: takeFirst(fields, 'ccName'),
            number: takeFirst(fields, 'ccNumber'),
            code: takeFirst(fields, 'ccCvc'),
            pin: takeFirst(fields, 'ccPin'),
            expiry: takeFirst(fields, 'ccExpiry'),
            fields: fieldsOf(fields.map(extraOf)),
          }),
          parts,
        ),
      )
    } else if (category === 'note') {
      into.add(itemOf(noteOf(title, note, fieldsOf(fields.map(extraOf))), parts))
    } else if (category === 'identity') {
      const values: Partial<Record<IdentityKey, string>> = {}
      const rest: Extra[] = []
      for (const field of fields) {
        const key = IDENTITY_LABELS[field.label.trim().toLowerCase()]
        if (key !== undefined && values[key] === undefined) values[key] = field.value
        else rest.push(extraOf(field))
      }
      into.add(itemOf(identityOf({ title, note, values, extra: rest }), parts))
    } else if (category === 'login' || category === 'password' || hasLogin) {
      const username = takeFirst(fields, 'username')
      const email = takeFirst(fields, 'email')
      const password = takeFirst(fields, 'password')
      const totp = takeFirst(fields, 'totp')
      const urls: string[] = []
      for (let url = takeFirst(fields, 'url'); url !== ''; url = takeFirst(fields, 'url'))
        urls.push(url)
      into.add(
        itemOf(
          loginOf({
            title,
            note,
            username,
            email,
            password,
            totp,
            urls,
            fields: fieldsOf(fields.map(extraOf)),
          }),
          parts,
        ),
      )
      if (category !== 'login' && category !== 'password') {
        into.skip(`Kept as a login: Orden has no kind for Enpass's "${category}".`, title)
      }
    } else {
      unknownKind(into, category || 'item', title, note, fields.map(extraOf), parts)
    }
  }
  return into.result()
}
