import type { Field, FieldKind } from '@orden/pass/types'
import { fieldKindLabel } from './field-words'
import { newId } from './rows'

export function newField(kind: FieldKind): Field {
  return { id: newId(), name: fieldKindLabel(kind), kind, value: '' }
}

export function fieldShape(kind: FieldKind): 'text' | 'hidden' | 'date' {
  return ({ text: 'text', hidden: 'hidden', totp: 'hidden', date: 'date' } as const)[kind]
}
