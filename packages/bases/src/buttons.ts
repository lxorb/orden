import type { Base, Value } from './types'
import { scalarValue } from './note-values'
import { fillTemplate, type Filling } from './templates'

export interface Button {
  name: string
  set: Record<string, string>
  task?: string
  command?: string
  open?: string
  kept: Record<string, unknown>
}

type Plain = Record<string, unknown>

const isPlain = (value: unknown): value is Plain =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const word = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined

export const BUTTON = 'button.'

export const isButton = (column: string): boolean => column.startsWith(BUTTON)

export function readButtons(base: Base): Button[] {
  const raw = base.orden.kept.buttons
  if (!isPlain(raw)) return []
  return Object.entries(raw).map(([name, one]): Button => {
    const plain = isPlain(one) ? one : {}
    const button: Button = {
      name,
      set: isPlain(plain.set)
        ? Object.fromEntries(
            Object.entries(plain.set).map(([key, value]) => [key, word(value) ?? '']),
          )
        : {},
      kept: Object.fromEntries(
        Object.entries(plain).filter(([key]) => !['set', 'task', 'command', 'open'].includes(key)),
      ),
    }
    for (const key of ['task', 'command', 'open'] as const) {
      const said = word(plain[key])
      if (said !== undefined) button[key] = said
    }
    return button
  })
}

export function withButton(base: Base, name: string, button: Button | null): Base {
  const kept = { ...base.orden.kept }
  const all: Plain = isPlain(kept.buttons) ? { ...kept.buttons } : {}
  if (button === null) Reflect.deleteProperty(all, name)
  else {
    all[name] = {
      ...(Object.keys(button.set).length ? { set: button.set } : {}),
      ...(button.task === undefined ? {} : { task: button.task }),
      ...(button.command === undefined ? {} : { command: button.command }),
      ...(button.open === undefined ? {} : { open: button.open }),
      ...button.kept,
    }
  }
  if (Object.keys(all).length) kept.buttons = all
  else Reflect.deleteProperty(kept, 'buttons')
  return { ...base, orden: { ...base.orden, kept } }
}

export interface Press {
  set: Record<string, Value | null>
  task?: string
  command?: string
  open?: string
}

export function pressed(button: Button, filling: Filling): Press {
  const fill = (words: string) => fillTemplate(words, filling)
  const out: Press = {
    set: Object.fromEntries(
      Object.entries(button.set).map(([key, words]) => {
        const filled = fill(words).trim()
        return [key, filled === '' ? null : scalarValue(filled)]
      }),
    ),
  }
  if (button.task !== undefined) out.task = fill(button.task)
  if (button.command !== undefined) out.command = button.command
  if (button.open !== undefined) out.open = fill(button.open)
  return out
}
