import { scopeFor } from './expr/compile'
import { refusing, underGuard } from './expr/pattern'
import { compileFilters } from './filter'
import { scalarValue } from './note-values'
import { fillTemplate, type Filling } from './templates'
import type { Base, Context, Row, Value } from './types'
import { text } from './expr/runtime'

export type Trigger = { added: true } | { property: string; is?: string }

export interface Automation {
  when: Trigger
  set: Record<string, string>
  move?: string
  notify?: string
  off?: boolean
  kept: Record<string, unknown>
}

type Plain = Record<string, unknown>

const isPlain = (value: unknown): value is Plain =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const word = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined

const KNOWN = ['when', 'set', 'move', 'notify', 'off']

function readTrigger(raw: unknown): Trigger | null {
  if (raw === 'added') return { added: true }
  if (!isPlain(raw)) return null
  if (raw.added === true) return { added: true }
  const property = word(raw.property)
  if (!property) return null
  const is = word(raw.is)
  return is === undefined ? { property } : { property, is }
}

export function readAutomations(base: Base): Automation[] {
  const raw = base.orden.kept.automations
  if (!Array.isArray(raw)) return []
  return raw.flatMap((one): Automation[] => {
    if (!isPlain(one)) return []
    const when = readTrigger(one.when)
    if (!when) return []
    const automation: Automation = {
      when,
      set: isPlain(one.set)
        ? Object.fromEntries(
            Object.entries(one.set).map(([key, value]) => [key, word(value) ?? '']),
          )
        : {},
      kept: Object.fromEntries(Object.entries(one).filter(([key]) => !KNOWN.includes(key))),
    }
    const move = word(one.move)
    if (move !== undefined) automation.move = move
    const notify = word(one.notify)
    if (notify !== undefined) automation.notify = notify
    if (one.off === true) automation.off = true
    return [automation]
  })
}

function plainOf(automation: Automation): Plain {
  const when = 'added' in automation.when ? 'added' : { ...automation.when }
  return {
    when,
    ...(Object.keys(automation.set).length ? { set: automation.set } : {}),
    ...(automation.move === undefined ? {} : { move: automation.move }),
    ...(automation.notify === undefined ? {} : { notify: automation.notify }),
    ...(automation.off ? { off: true } : {}),
    ...automation.kept,
  }
}

export function withAutomations(base: Base, automations: readonly Automation[]): Base {
  const kept = { ...base.orden.kept }
  if (automations.length) kept.automations = automations.map(plainOf)
  else Reflect.deleteProperty(kept, 'automations')
  return { ...base, orden: { ...base.orden, kept } }
}

export interface Effect {
  set: Record<string, Value | null>
  move?: string
  notify: string[]
}

function wordsOf(value: Value | undefined): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.flatMap(wordsOf)
  return [text(value).toLowerCase()]
}

function matches(value: Value | undefined, is: string): boolean {
  return wordsOf(value).includes(is.trim().toLowerCase())
}

function triggered(when: Trigger, before: Row | undefined, after: Row): boolean {
  if ('added' in when) return before === undefined
  if (before === undefined) return false
  const key = when.property.replace(/^note\./, '')
  const was = before.note[key]
  const now = after.note[key]
  if (when.is === undefined) return wordsOf(was).join('\n') !== wordsOf(now).join('\n')
  return matches(now, when.is) && !matches(was, when.is)
}

function settled(words: string): Value | null {
  if (words.trim() === '') return null
  return scalarValue(words.trim())
}

export function fired(
  automations: readonly Automation[],
  before: Row | undefined,
  after: Row,
  filling: Omit<Filling, 'title'>,
): Effect | null {
  if (after.kind !== 'note') return null
  const fill = (words: string) => fillTemplate(words, { ...filling, title: after.file.basename })
  let effect: Effect | null = null
  for (const automation of automations) {
    if (automation.off || !triggered(automation.when, before, after)) continue
    effect ??= { set: {}, notify: [] }
    for (const [key, words] of Object.entries(automation.set))
      effect.set[key] = settled(fill(words))
    if (automation.move !== undefined) effect.move = fill(automation.move)
    if (automation.notify !== undefined) effect.notify.push(fill(automation.notify))
  }
  return effect
}

export function rowsInBase(
  base: Base,
  rows: readonly Row[],
  context: Context,
): { rows: Row[]; partial: boolean } {
  const { value, partial } = refusing(() => rows.filter((row) => inBase(base, row, context)))
  return { rows: value, partial }
}

export function inBase(base: Base, row: Row, context: Context): boolean {
  if (row.kind !== 'note') return false
  return underGuard(base.guarded, () =>
    compileFilters(base.filters).test(scopeFor(row, context, base.formulas)),
  )
}
