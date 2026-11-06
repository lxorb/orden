import type { ChangeSet, SharedDoc, Text } from '@orden/editor'
import type { Replacement } from '@orden/rooms/fold'
import * as Y from 'yjs'
import { HERE } from './door'

interface Op {
  retain?: number
  insert?: unknown
  delete?: number
}

export function replacements(delta: readonly Op[]): Replacement[] {
  const edits: Replacement[] = []
  let at = 0

  for (const op of delta) {
    if (typeof op.retain === 'number') {
      at += op.retain
      continue
    }

    const beside = edits.at(-1)?.to === at ? edits.at(-1) : undefined

    if (typeof op.delete === 'number') {
      if (beside) beside.to = at + op.delete
      else edits.push({ from: at, to: at + op.delete, insert: '' })

      at += op.delete
      continue
    }

    if (typeof op.insert !== 'string') continue

    if (beside) beside.insert += op.insert
    else edits.push({ from: at, to: at, insert: op.insert })
  }

  return edits
}

export function moved(what: string) {
  console.warn(`nib: ${what} was refused - the document is on another note now`)
}

export function replace(text: Y.Text, change: Replacement) {
  if (change.to > change.from) text.delete(change.from, change.to - change.from)
  if (change.insert) text.insert(change.from, change.insert)
}

function unit(words: Text, at: number): number {
  return at < 0 || at >= words.length ? 0 : words.sliceString(at, at + 1).charCodeAt(0)
}

function apply(text: Y.Text, changes: ChangeSet, words: Text) {
  let adjust = 0

  changes.iterChanges((fromA, toA, fromB, toB) => {
    const before = unit(words, fromB - 1)
    const after = unit(words, toB)
    const front = before >= 0xd800 && before <= 0xdbff ? 1 : 0
    const back = after >= 0xdc00 && after <= 0xdfff ? 1 : 0

    replace(text, {
      from: fromA + adjust - front,
      to: toA + adjust + back,
      insert: words.sliceString(fromB - front, toB + back),
    })
    adjust += toB - fromB - (toA - fromA)
  })
}

export function bind(note: SharedDoc, text: Y.Text, holds: () => boolean): () => void {
  const doc = text.doc
  if (!doc) throw new Error('a shared text with no document behind it')

  note.onLocal = (changes: ChangeSet) => {
    if (!holds()) {
      moved('a change made in it')
      return
    }

    doc.transact(() => apply(text, changes, note.roomWords), HERE)
  }

  const heard = (event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (transaction.origin === HERE) return
    if (!holds()) {
      moved('a change from another device')
      return
    }

    const edits = replacements(event.delta as readonly Op[])
    if (edits.length) note.arrived(edits)
  }

  text.observe(heard)

  return () => {
    text.unobserve(heard)
    note.onLocal = null
  }
}
