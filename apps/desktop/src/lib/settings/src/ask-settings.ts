import type { SettingsSectionId } from '@orden/contracts'
import type { Field, Pane } from './fields'
import type { Place } from './settings-search'

export interface Offer {
  id: string
  section: SettingsSectionId
  label: string
  where: string
  field?: Field
}

type Value = string | number | boolean

export interface Change {
  offer: Offer
  field: Field
  to: Value
  from: string
  shown: string
}

export interface Answer {
  say: string
  show: Offer[]
  changes: Change[]
}

const SHOWN_AT_MOST = 3

const ASK = `You help someone find and change settings in Orden, a notes app. The settings are listed below, one per line: id | where it is | kind | value now | choices. Reply with one JSON object and nothing else: {"say": a short answer of one or two sentences in the reader's language, "show": the ids of at most ${SHOWN_AT_MOST} settings that answer the question, "change": a list of {"id": an id, "to": the new value}}. Put a setting in "change" only when the reader asks for it to change, and only one marked as changeable; "to" is one of its choices, true or false for a switch, or a number in its range for a slider. The reader confirms each change before it is made.`

function changeable(field: Field): boolean {
  if (field.shown?.() === false) return false
  if (field.kind === 'switch') return !(field.locked?.() ?? false)
  return ['select', 'segmented', 'swatches', 'slider'].includes(field.kind)
}

function choices(field: Field): { value: string; label: string }[] {
  if (field.kind === 'select' || field.kind === 'swatches') return field.options
  if (field.kind === 'segmented') return field.options.filter((one) => !one.disabled)
  return []
}

function valueWord(field: Field, value: Value): string {
  if (field.kind === 'switch') return value ? 'On' : 'Off'
  if (field.kind === 'slider') return `${String(value)}${field.unit ?? ''}`
  return choices(field).find((one) => one.value === value)?.label ?? String(value)
}

export function offers(
  panes: readonly Pane[],
  places: readonly Place[],
  titleOf: (section: SettingsSectionId) => string,
): Offer[] {
  const fields = panes.flatMap((pane) =>
    pane.groups.flatMap((group) =>
      group.fields
        .filter((field) => field.shown?.() !== false)
        .map((field) => ({
          section: pane.id,
          label: field.label,
          where: [pane.label, group.title, field.label].filter(Boolean).join(' > '),
          field,
        })),
    ),
  )
  const spots = places.map((place) => ({
    section: place.section,
    label: place.label,
    where: [titleOf(place.section), place.label].filter(Boolean).join(' > '),
  }))
  return [...fields, ...spots].map((one, at) => ({ id: `s${at + 1}`, ...one }))
}

function line(offer: Offer): string {
  const field = offer.field
  if (!field || !changeable(field)) return `${offer.id} | ${offer.where} | where only`
  const now = valueWord(field, field.get())
  if (field.kind === 'switch') return `${offer.id} | ${offer.where} | switch | ${now} | true, false`
  if (field.kind === 'slider') {
    const range = `${field.min} to ${field.max} by ${field.step}`
    return `${offer.id} | ${offer.where} | slider | ${now} | ${range}`
  }
  const listed = choices(field)
    .map((one) => (one.label === one.value ? one.value : `${one.value} (${one.label})`))
    .join(', ')
  return `${offer.id} | ${offer.where} | choice | ${now} | ${listed}`
}

export function brief(all: readonly Offer[]): string {
  return `${ASK}\n\n${all.map(line).join('\n')}`
}

function valueFor(field: Field, to: unknown): Value | null {
  if (field.kind === 'switch') return typeof to === 'boolean' ? to : null
  if (field.kind === 'slider') {
    if (typeof to !== 'number' || !Number.isFinite(to) || to < field.min || to > field.max) {
      return null
    }
    return Math.min(field.max, field.min + Math.round((to - field.min) / field.step) * field.step)
  }
  if (typeof to !== 'string') return null
  return choices(field).some((one) => one.value === to) ? to : null
}

export function answerOf(reply: string, all: readonly Offer[]): Answer {
  const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  const read = JSON.parse(json) as Record<string, unknown>
  const byId = new Map(all.map((one) => [one.id, one]))
  const listed = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

  const show = [
    ...new Set(listed(read.show).filter((one): one is string => typeof one === 'string')),
  ]
    .map((id) => byId.get(id))
    .filter((one): one is Offer => !!one)
    .slice(0, SHOWN_AT_MOST)

  const changes: Change[] = []
  for (const asked of listed(read.change)) {
    if (!asked || typeof asked !== 'object') continue
    const { id, to } = asked as { id?: unknown; to?: unknown }
    const offer = typeof id === 'string' ? byId.get(id) : undefined
    const field = offer?.field
    if (!offer || !field || !changeable(field)) continue
    if (changes.some((one) => one.offer.id === offer.id)) continue
    const value = valueFor(field, to)
    if (value === null || value === field.get()) continue
    const from = valueWord(field, field.get())
    changes.push({ offer, field, to: value, from, shown: valueWord(field, value) })
  }

  const say = typeof read.say === 'string' ? read.say.trim() : ''
  return { say, show, changes }
}

export function apply(change: Change): boolean {
  const { field, to } = change
  if (!changeable(field) || valueFor(field, to) === null) return false
  if (field.get() === to) return true
  if (field.kind === 'switch' && typeof to === 'boolean') field.set(to)
  else if (field.kind === 'slider' && typeof to === 'number') field.set(to)
  else if (
    (field.kind === 'select' || field.kind === 'segmented' || field.kind === 'swatches') &&
    typeof to === 'string'
  )
    field.set(to)
  else return false
  return true
}
