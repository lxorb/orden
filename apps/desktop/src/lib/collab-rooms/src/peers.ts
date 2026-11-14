import type { Peer } from '@orden/editor'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { accentColour, accentFor } from '../../accents'
import { faceUrl } from '../../accounts/src/api'
import { isNumber, isRecord, isString } from '../../platform/src/api'

interface Named {
  name: string
  accent: string
  person?: string
  id?: string
  face?: string
}

interface Someone {
  key: string
  name: string
  face: string | null
  fill: string
}

export interface Seen {
  people: Someone[]
  mine: number
}

export interface Here {
  id: number
  who: Named
  said: Record<string, unknown>
}

export function relative(text: Y.Text, at: number): unknown {
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, at))
}

function isCount(value: unknown): boolean {
  return isNumber(value) && Number.isInteger(value) && value >= 0
}

function isPlace(value: unknown): boolean {
  return isRecord(value) && isCount(value.client) && isCount(value.clock)
}

function isPosition(value: unknown): boolean {
  if (!isRecord(value)) return false

  const { type, item, tname, assoc } = value
  if (type !== undefined && type !== null && !isPlace(type)) return false
  if (item !== undefined && item !== null && !isPlace(item)) return false
  if (tname !== undefined && tname !== null && !isString(tname)) return false

  return assoc === undefined || assoc === null || isNumber(assoc)
}

function absolute(doc: Y.Doc, held: unknown): number | null {
  if (!isPosition(held)) return null

  const found = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(held),
    doc,
  )

  return found ? found.index : null
}

const LONGEST_NAME = 64
const HASH = /^[a-f0-9]{64}$/
const WORD = /^[\w-]{1,64}$/

function namedIn(value: unknown): Named | null {
  if (!isRecord(value) || !isRecord(value.who)) return null
  if (!isString(value.who.name) || !isString(value.who.accent)) return null

  const { person, id, face } = value.who
  return {
    name: value.who.name.slice(0, LONGEST_NAME),
    accent: value.who.accent,
    ...(isString(person) ? { person: person.slice(0, LONGEST_NAME) } : {}),
    ...(isString(id) && WORD.test(id) ? { id } : {}),
    ...(isString(face) && HASH.test(face) ? { face } : {}),
  }
}

function seenIn(here: readonly Here[], mine: Named | null, scheme: 'dark' | 'light'): Seen {
  const self = mine?.id ?? mine?.person
  const people = new Map<string, Someone>()
  let own = 0
  for (const { who } of here) {
    const key = who.id ?? who.person
    if (!key || key === self) {
      own++
      continue
    }
    people.set(key, {
      key,
      name: who.person ?? who.name,
      face: faceUrl(who.face) ?? null,
      fill: accentFor(key, scheme),
    })
  }
  return { people: [...people.values()], mine: own }
}

export function whoElse(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { here: Here[]; nameOf: (who: Named) => string; seen: Seen } {
  const here: Here[] = []

  for (const [id, state] of awareness.getStates()) {
    if (id === doc.clientID) continue

    const who = namedIn(state)
    if (who && isRecord(state)) here.push({ id, who, said: state })
  }

  const mine = namedIn(awareness.getLocalState())
  const people = new Set(
    [mine, ...here.map((one) => one.who)]
      .map((one) => one?.person)
      .filter((one): one is string => !!one),
  )
  const byPerson = people.size > 1

  return {
    here,
    nameOf: (who) => (byPerson ? who.person : who.name) ?? who.name,
    seen: seenIn(here, mine, scheme),
  }
}

export function peersIn(
  awareness: Awareness,
  doc: Y.Doc,
  scheme: 'dark' | 'light',
): { present: number; carets: Peer[]; seen: Seen } {
  const { here, nameOf, seen } = whoElse(awareness, doc, scheme)
  const carets: Peer[] = []

  for (const { id, who, said } of here) {
    if (!isRecord(said.caret)) continue

    const head = absolute(doc, said.caret.head)
    const anchor = absolute(doc, said.caret.anchor)
    if (head === null) continue

    const name = nameOf(who)
    carets.push({
      id,
      name,
      colour: accentColour(who.accent, scheme),
      face: name === who.person ? (faceUrl(who.face) ?? undefined) : undefined,
      head,
      anchor: anchor ?? head,
    })
  }

  return { present: here.length, carets, seen }
}
