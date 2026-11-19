import { Annotation, type Transaction } from '@codemirror/state'

export const external = Annotation.define<boolean>()

export const isExternal = (transaction: Transaction): boolean => transaction.annotation(external) === true
