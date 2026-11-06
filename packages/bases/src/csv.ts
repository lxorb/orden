import { isDate, isLink, text } from './expr/runtime'
import type { Value } from './types'

export function csvValue(value: Value): string {
  if (value === null) return ''
  if (Array.isArray(value)) return value.map(csvValue).filter(Boolean).join(', ')
  if (isLink(value)) {
    return value.display ?? (value.target.split('/').pop() ?? value.target).replace(/\.md$/i, '')
  }
  if (isDate(value)) {
    return value.time ? `${value.iso} ${value.time.slice(0, 5)}` : value.iso
  }
  return text(value)
}

export function sheetSafe(cell: string): string {
  if (!/^[=+\-@\t\r]/.test(cell) || !Number.isNaN(Number(cell))) return cell
  return `'${cell}`
}

const quoted = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)

export function csvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((row) => row.map(quoted).join(',')).join('\r\n') + '\r\n'
}
