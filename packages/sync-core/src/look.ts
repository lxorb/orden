export type LookScheme = 'dark' | 'light' | 'system'

export type LookValue = string | number | boolean

export type LookValues = Record<string, Record<string, LookValue>>

export interface Look {
  theme: string
  scheme: LookScheme
  values: LookValues
  css?: string
}

export const MOST_LOOK_CSS = 32 * 1024

const THEME = /^(?:[a-z0-9][a-z0-9-]{0,38}|file:[^/\\\p{Cc}]{1,64})$/u

const NAME = /^[A-Za-z0-9*:._-]{1,64}$/

const SCHEMES: readonly string[] = ['dark', 'light', 'system']

const FIELDS: readonly string[] = ['theme', 'scheme', 'values', 'css']

const MOST_DRAWERS = 40
const MOST_VALUES = 40
const LONGEST_VALUE = 200
const NAMED = 64

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValue(value: unknown): value is LookValue {
  if (typeof value === 'string') return value.length <= LONGEST_VALUE
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'boolean'
}

function isScheme(value: unknown): value is LookScheme {
  return typeof value === 'string' && SCHEMES.includes(value)
}

function valuesWrong(value: unknown): string | null {
  if (!isFields(value)) return 'look.values must be an object'

  const drawers = Object.entries(value)
  if (drawers.length > MOST_DRAWERS) return `look.values holds at most ${MOST_DRAWERS} themes`

  for (const [drawer, held] of drawers) {
    if (!NAME.test(drawer)) return `${drawer.slice(0, NAMED)} is not a theme`
    if (!isFields(held)) return `look.values.${drawer} must be an object`

    const entries = Object.entries(held)
    if (entries.length > MOST_VALUES) return `look.values.${drawer} holds at most ${MOST_VALUES}`
    for (const [id, one] of entries) {
      if (!NAME.test(id)) return `${id.slice(0, NAMED)} is not a theme setting`
      if (!isValue(one)) return `look.values.${drawer}.${id} is not a setting value`
    }
  }

  return null
}

export function lookWrong(value: unknown): string | null {
  if (!isFields(value)) return 'look must be an object'

  for (const field of Object.keys(value)) {
    if (!FIELDS.includes(field)) return `look has no ${field.slice(0, NAMED)}`
  }

  if (typeof value.theme !== 'string' || !THEME.test(value.theme)) {
    return 'look.theme must be a theme id'
  }
  if (!isScheme(value.scheme)) return `look.scheme must be one of ${SCHEMES.join(', ')}`

  const wrong = valuesWrong(value.values)
  if (wrong) return wrong

  if (
    value.css !== undefined &&
    (typeof value.css !== 'string' || value.css.length > MOST_LOOK_CSS)
  ) {
    return `look.css must be a stylesheet of at most ${MOST_LOOK_CSS} characters`
  }

  return null
}

function valuesIn(value: unknown): LookValues {
  if (!isFields(value)) return {}

  const drawers = Object.entries(value)
    .filter((entry): entry is [string, Fields] => NAME.test(entry[0]) && isFields(entry[1]))
    .slice(0, MOST_DRAWERS)

  return Object.fromEntries(
    drawers.map(([drawer, held]) => [
      drawer,
      Object.fromEntries(
        Object.entries(held)
          .filter((entry): entry is [string, LookValue] => NAME.test(entry[0]) && isValue(entry[1]))
          .slice(0, MOST_VALUES),
      ),
    ]),
  )
}

export function lookIn(value: unknown): Look | null {
  if (!isFields(value)) return null

  const { theme, scheme, css } = value
  if (typeof theme !== 'string' || !THEME.test(theme) || !isScheme(scheme)) return null

  const look: Look = { theme, scheme, values: valuesIn(value.values) }
  if (typeof css === 'string' && css && css.length <= MOST_LOOK_CSS) look.css = css
  return look
}
