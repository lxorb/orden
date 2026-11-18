import type { Content } from '../types'
import {
  Collector,
  type Extra,
  cardOf,
  fieldKindOf,
  fieldsOf,
  identityOf,
  itemOf,
  listOf,
  loginOf,
  noteOf,
  pick,
  recordOf,
  stringOf,
  unknownKind,
} from './build'
import { csvRecords, type CsvRecord } from './csv'
import type { Imported } from './types'

function jsonList(text: string): unknown[] {
  if (text.trim() === '') return []
  try {
    return listOf(JSON.parse(text))
  } catch {
    return []
  }
}

function customFieldsOf(row: CsvRecord): Extra[] {
  return jsonList(pick(row, 'custom_fields')).map((one) => {
    const field = recordOf(one)
    return {
      name: stringOf(field.label) || stringOf(field.name),
      value: stringOf(field.value),
      kind: fieldKindOf(stringOf(field.type)),
    }
  })
}

export function parseNordPass(text: string): Imported {
  const into = new Collector('NordPass')
  for (const row of csvRecords(text)) {
    const type = pick(row, 'type')
    const title = pick(row, 'name')
    const note = pick(row, 'note')
    const extra = customFieldsOf(row)
    const parts = { folder: pick(row, 'folder') }
    const add = (content: Content): void => {
      into.add(itemOf(content, parts))
    }
    switch (type) {
      case 'folder':
        break
      case 'password':
      case 'login':
        add(
          loginOf({
            title,
            note,
            username: pick(row, 'username'),
            email: pick(row, 'email'),
            password: pick(row, 'password'),
            urls: [pick(row, 'url'), ...jsonList(pick(row, 'additional_urls')).map(stringOf)],
            fields: fieldsOf(extra),
          }),
        )
        break
      case 'credit_card':
        add(
          cardOf({
            title,
            note,
            holder: pick(row, 'cardholdername'),
            number: pick(row, 'cardnumber'),
            code: pick(row, 'cvc'),
            pin: pick(row, 'pin'),
            expiry: pick(row, 'expirydate'),
            fields: fieldsOf([{ name: 'ZIP', value: pick(row, 'zipcode') }, ...extra]),
          }),
        )
        break
      case 'identity':
        add(
          identityOf({
            title,
            note,
            values: {
              fullName: pick(row, 'full_name'),
              email: pick(row, 'email'),
              phone: pick(row, 'phone_number'),
              street: pick(row, 'address1'),
              floor: pick(row, 'address2'),
              zip: pick(row, 'zipcode'),
              city: pick(row, 'city'),
              state: pick(row, 'state'),
              country: pick(row, 'country'),
            },
            extra,
          }),
        )
        break
      case 'note':
        add(noteOf(title, note, fieldsOf(extra)))
        break
      default:
        unknownKind(into, type || 'item', title, note, extra, parts)
    }
  }
  return into.result()
}
