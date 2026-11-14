import { fingerprintOf } from '@orden/pass/crypto'
import { isSignPub } from '@orden/pass/shape'
import { safetyCodeOf } from '@orden/pass/trust'
import type { DeviceRows } from './synced'

export interface PersonKey {
  pub: string
  signPub: string | null
}

export type Known = 'new' | 'seen' | 'confirmed' | 'changed'

export interface Person {
  email: string
  key: PersonKey | null
  code: string | null
  known: Known
}

interface Pinned extends PersonKey {
  confirmed: boolean
}

const PEOPLE = 'people'

export class PersonChanged extends Error {
  constructor(readonly email: string) {
    super('Their key is not the one this device knew. Check their safety code with them again.')
    this.name = 'PersonChanged'
  }
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pinnedIn(value: unknown): Pinned | null {
  if (!isFields(value)) return null
  const { pub, signPub, confirmed } = value
  if (typeof pub !== 'string' || typeof confirmed !== 'boolean') return null
  if (!(signPub === null || isSignPub(signPub))) return null
  return { pub, signPub, confirmed }
}

async function pinsOf(rows: DeviceRows): Promise<Map<string, Pinned>> {
  const raw = await rows.read(PEOPLE)
  const pins = new Map<string, Pinned>()
  if (!isFields(raw)) return pins
  for (const [email, one] of Object.entries(raw)) {
    const pinned = pinnedIn(one)
    if (pinned) pins.set(email, pinned)
  }
  return pins
}

async function keepPin(rows: DeviceRows, email: string, pin: Pinned): Promise<void> {
  const pins = await pinsOf(rows)
  pins.set(email, pin)
  await rows.keep(PEOPLE, Object.fromEntries(pins))
}

function sameKey(pin: PersonKey, key: PersonKey): boolean {
  return pin.pub === key.pub && pin.signPub === key.signPub
}

function knownOf(pin: Pinned | undefined, key: PersonKey): Known {
  if (!pin) return 'new'
  if (pin.signPub === null && key.signPub !== null && pin.pub === key.pub) return 'seen'
  if (!sameKey(pin, key)) return 'changed'
  return pin.confirmed ? 'confirmed' : 'seen'
}

export async function codeOf(key: PersonKey): Promise<string> {
  return key.signPub === null
    ? await fingerprintOf(key.pub)
    : await safetyCodeOf({ pub: key.pub, signPub: key.signPub })
}

export async function personOf(
  rows: DeviceRows,
  email: string,
  key: PersonKey | null,
): Promise<Person> {
  if (key === null) return { email, key, code: null, known: 'new' }
  const known = knownOf((await pinsOf(rows)).get(email), key)
  return { email, key, code: await codeOf(key), known }
}

export async function seenPerson(rows: DeviceRows, email: string, key: PersonKey): Promise<Known> {
  const pin = (await pinsOf(rows)).get(email)
  const known = knownOf(pin, key)
  if (known === 'new' || (known === 'seen' && pin?.signPub !== key.signPub)) {
    await keepPin(rows, email, { ...key, confirmed: false })
  }
  return known
}

export async function confirmedPerson(rows: DeviceRows, person: Person): Promise<Person> {
  if (person.key === null) throw new Error('They have not set up Pass yet.')
  await keepPin(rows, person.email, { ...person.key, confirmed: true })
  return { ...person, known: 'confirmed' }
}

export async function isConfirmed(
  rows: DeviceRows,
  email: string,
  key: PersonKey,
): Promise<boolean> {
  return knownOf((await pinsOf(rows)).get(email), key) === 'confirmed'
}
