import { Annotation, type Transaction } from '@codemirror/state'

/** Marks a change as content put into the view from outside - a note being
 *  loaded, a version restored, a sync bringing over what another machine
 *  wrote - rather than something anyone typed here.
 *
 *  It has a file of its own because two unrelated parts of the editor need the
 *  same distinction: the view, which must not hand such a change back to the
 *  app as an edit it made, and read-only mode, which refuses every change that
 *  is not one of these. */
export const external = Annotation.define<boolean>()

/** Whether a transaction is carrying content from outside the editor. */
export function isExternal(transaction: Transaction): boolean {
  return transaction.annotation(external) === true
}
