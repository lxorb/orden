import { Annotation, type Transaction } from '@codemirror/state'

export const external = Annotation.define<boolean>()

export function isExternal(transaction: Transaction): boolean {
  return transaction.annotation(external) === true
}
