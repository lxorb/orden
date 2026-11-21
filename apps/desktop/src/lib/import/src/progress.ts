import type { Trouble } from './plan'

export type Phase = 'reading' | 'writing' | 'checking' | 'review' | 'failed' | 'interrupted'
export type RowKind = 'notes' | 'files' | 'skipped' | 'failed'
export interface Row {
  kind: RowKind
  path: string
  why?: string
}
const SHARES: Readonly<Record<'reading' | 'writing' | 'checking', readonly [number, number]>> = {
  reading: [0, 0.4],
  writing: [0.4, 0.9],
  checking: [0.9, 1],
}
export function overall(phase: Phase, done: number, total: number): number {
  if (phase === 'review') return 1
  if (phase === 'failed' || phase === 'interrupted') return 0
  const [from, to] = SHARES[phase]
  const part = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  return from + (to - from) * part
}
export function timeLeft(elapsed: number, fraction: number): string | null {
  if (fraction < 0.05 || elapsed < 1500 || fraction >= 1) return null
  const seconds = Math.max(1, Math.round(((elapsed / fraction) * (1 - fraction)) / 1000))
  if (seconds < 60) return `About ${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'} remaining`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `About ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} remaining`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const said = `About ${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`
  return rest ? `${said} and ${String(rest)} ${rest === 1 ? 'minute' : 'minutes'} remaining` : `${said} remaining`
}
export interface Tally {
  notes: number
  files: number
  skipped: number
  failed: number
}
export function tallied(rows: readonly Row[]): Tally {
  const tally: Tally = { notes: 0, files: 0, skipped: 0, failed: 0 }
  for (const row of rows) tally[row.kind] += 1
  return tally
}
export function failing(rows: Row[], path: string, why: string): Row[] {
  const at = rows.findIndex((row) => row.path === path && (row.kind === 'notes' || row.kind === 'files'))
  const failed: Row = { kind: 'failed', path, why }
  return at < 0 ? [...rows, failed] : rows.map((row, index) => (index === at ? failed : row))
}
export const troubleRows = (kind: 'skipped' | 'failed', troubles: readonly Trouble[]): Row[] =>
  troubles.map((one) => ({ kind, path: one.path, why: one.why }))
export const lostRows = (lost: readonly string[]): Row[] =>
  lost.map((said) => ({ kind: 'skipped', path: '', why: said }))
export interface Asked {
  from: string
  where: string | null
  space: string
  rows: readonly Row[]
}
const plural = (count: number, one: string, many = `${one}s`) => `${String(count)} ${count === 1 ? one : many}`
const listed = (row: Row) => (row.path ? `- ${row.path}${row.why ? `: ${row.why}` : ''}` : `- ${row.why ?? ''}`)
export function fixPrompt(asked: Asked): string {
  const tally = tallied(asked.rows)
  const failed = asked.rows.filter((row) => row.kind === 'failed')
  const skipped = asked.rows.filter((row) => row.kind === 'skipped')
  const where = asked.where ? ` (${asked.where})` : ''
  const lost = [
    skipped.length ? `${plural(skipped.length, 'file')} ${skipped.length === 1 ? 'was' : 'were'} skipped` : '',
    failed.length ? `${String(failed.length)} failed` : '',
  ].filter(Boolean)
  const lines = [
    `I am importing ${asked.from}${where} into Orden, as the new space “${asked.space}”.`,
    `${plural(tally.notes, 'note')} and ${plural(tally.files, 'other file')} were imported. ${lost.join(' and ')}.`,
  ]
  if (failed.length) lines.push('', 'These files failed:', ...failed.map(listed))
  if (skipped.length) lines.push('', 'These files were skipped:', ...skipped.map(listed))
  lines.push('', 'Fix these files in the source so Orden can import them, or tell me why they can’t be imported.')
  return lines.join('\n')
}
export function tabName(phase: Phase, fraction: number, failed: number): string {
  if (phase === 'review') return failed ? `${String(failed)} failed` : 'Import ready'
  if (phase === 'failed') return 'Import failed'
  if (phase === 'interrupted') return 'Import'
  return `Importing ${String(Math.round(fraction * 100))}%`
}
