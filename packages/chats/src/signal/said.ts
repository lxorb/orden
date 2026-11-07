export type Said = Record<string, unknown>

export function said(value: unknown): Said {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Said) : {}
}

export function maybe(value: unknown): Said | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Said)
    : null
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function list(value: unknown): Said[] {
  return Array.isArray(value) ? value.map(said) : []
}

export function words(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

export function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((one): one is number => typeof one === 'number' && Number.isFinite(one))
    : []
}
