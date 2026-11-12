import { isNative } from './ports'

type MetaValue = string | number | Uint8Array | null

export interface MetaRow {
  key: string
  value: MetaValue
}

export interface SpaceRow {
  space_id: string
  root: string
  cursor: number
  role: string | null
  store: string | null
}

export interface EntryRow {
  id: string
  space_id: string
  kind: string
  parent: string | null
  name: string
  local_path: string
  file_key: string | null
  written_hash: string | null
  mtime: number | null
  size: number | null
  seq: number | null
  deleted: boolean
}

export interface WrittenRow {
  id: string
  text: string
}

export interface DocRow {
  id: string
  epoch: number
  client_id: number
  confirmed: Uint8Array
  confirmed_sv: Uint8Array
  pending: Uint8Array | null
  pending_at: number | null
}

export interface OutboxRow {
  op_id: string
  space_id: string
  op: Uint8Array
  seen: number
  made_at: number
}

export interface HeldRow {
  id: string
  remote: Uint8Array
  remote_sv: Uint8Array
  device: string | null
  at: number
}

export interface FileStateRow {
  hash: string
  state: string
}

export interface WebRow {
  key: string
  fence: number | null
  version: number | null
  applied: number | null
}

export interface LogRow {
  at: number
  space: string | null
  pulled: number | null
  pushed: number | null
  failed: string | null
}

export interface Rows {
  meta: MetaRow
  spaces: SpaceRow
  entries: EntryRow
  written: WrittenRow
  docs: DocRow
  outbox: OutboxRow
  held: HeldRow
  files: FileStateRow
  web: WebRow
  log: LogRow
}

export type TableName = keyof Rows

export type KeyedTable = Exclude<TableName, 'log'>

export type SpacedTable = 'entries' | 'outbox' | 'log'

interface Keys {
  meta: 'key'
  spaces: 'space_id'
  entries: 'id'
  written: 'id'
  docs: 'id'
  outbox: 'op_id'
  held: 'id'
  files: 'hash'
  web: 'key'
}

type Kind = 'text' | 'integer' | 'bool' | 'blob' | 'packed' | 'any'

interface Column {
  name: string
  kind: Kind
  required: boolean
}

export interface TableSpec {
  key: string | null
  space: string | null
  columns: readonly Column[]
}

const maybe = (name: string, kind: Kind): Column => ({ name, kind, required: false })
const always = (name: string, kind: Kind): Column => ({ name, kind, required: true })

export const TABLES: Readonly<Record<TableName, TableSpec>> = {
  meta: { key: 'key', space: null, columns: [always('key', 'text'), maybe('value', 'any')] },
  spaces: {
    key: 'space_id',
    space: null,
    columns: [
      always('space_id', 'text'),
      always('root', 'text'),
      always('cursor', 'integer'),
      maybe('role', 'text'),
      maybe('store', 'text'),
    ],
  },
  entries: {
    key: 'id',
    space: 'space_id',
    columns: [
      always('id', 'text'),
      always('space_id', 'text'),
      always('kind', 'text'),
      maybe('parent', 'text'),
      always('name', 'text'),
      always('local_path', 'text'),
      maybe('file_key', 'text'),
      maybe('written_hash', 'text'),
      maybe('mtime', 'integer'),
      maybe('size', 'integer'),
      maybe('seq', 'integer'),
      always('deleted', 'bool'),
    ],
  },
  written: { key: 'id', space: null, columns: [always('id', 'text'), always('text', 'packed')] },
  docs: {
    key: 'id',
    space: null,
    columns: [
      always('id', 'text'),
      always('epoch', 'integer'),
      always('client_id', 'integer'),
      always('confirmed', 'blob'),
      always('confirmed_sv', 'blob'),
      maybe('pending', 'blob'),
      maybe('pending_at', 'integer'),
    ],
  },
  outbox: {
    key: 'op_id',
    space: 'space_id',
    columns: [
      always('op_id', 'text'),
      always('space_id', 'text'),
      always('op', 'blob'),
      always('seen', 'integer'),
      always('made_at', 'integer'),
    ],
  },
  held: {
    key: 'id',
    space: null,
    columns: [
      always('id', 'text'),
      always('remote', 'blob'),
      always('remote_sv', 'blob'),
      maybe('device', 'text'),
      always('at', 'integer'),
    ],
  },
  files: { key: 'hash', space: null, columns: [always('hash', 'text'), always('state', 'text')] },
  web: {
    key: 'key',
    space: null,
    columns: [
      always('key', 'text'),
      maybe('fence', 'integer'),
      maybe('version', 'integer'),
      maybe('applied', 'integer'),
    ],
  },
  log: {
    key: null,
    space: 'space',
    columns: [
      always('at', 'integer'),
      maybe('space', 'text'),
      maybe('pulled', 'integer'),
      maybe('pushed', 'integer'),
      maybe('failed', 'text'),
    ],
  },
}

export const LOG_ROWS = 1000

export interface Get<T extends KeyedTable = KeyedTable> {
  t: 'get'
  table: T
  key: string
}

export interface Scan<T extends TableName = TableName> {
  t: 'scan'
  table: T
  space?: string
}

export type Query =
  { [T in KeyedTable]: Get<T> }[KeyedTable] | { [T in TableName]: Scan<T> }[TableName]

export type Answer<Q> =
  Q extends Get<infer T> ? Rows[T] | null : Q extends Scan<infer T> ? Rows[T][] : never

export type Answers<Q extends readonly Query[]> = { -readonly [I in keyof Q]: Answer<Q[I]> }

export const get = <T extends KeyedTable>(table: T, key: string): Get<T> => ({
  t: 'get',
  table,
  key,
})

export const scan = <T extends TableName>(table: T): Scan<T> => ({ t: 'scan', table })

export const scanSpace = <T extends SpacedTable>(table: T, space: string): Scan<T> => ({
  t: 'scan',
  table,
  space,
})

export interface Put<T extends TableName = TableName> {
  t: 'put'
  table: T
  row: Rows[T]
}

export interface Patch<T extends KeyedTable = KeyedTable> {
  t: 'patch'
  table: T
  key: string
  set: Partial<Omit<Rows[T], Keys[T]>>
}

export interface Delete {
  t: 'delete'
  table: KeyedTable
  key: string
}

export interface Clear {
  t: 'clear'
  table: SpacedTable
  space: string
}

export type Change =
  | { [T in TableName]: Put<T> }[TableName]
  | { [T in KeyedTable]: Patch<T> }[KeyedTable]
  | Delete
  | Clear

export const put = <T extends TableName>(table: T, row: Rows[T]): Put<T> => ({
  t: 'put',
  table,
  row,
})

export const patch = <T extends KeyedTable>(
  table: T,
  key: string,
  set: Partial<Omit<Rows[T], Keys[T]>>,
): Patch<T> => ({ t: 'patch', table, key, set })

export const remove = (table: KeyedTable, key: string): Delete => ({ t: 'delete', table, key })

export const clear = (table: SpacedTable, space: string): Clear => ({ t: 'clear', table, space })

export interface Opened {
  device: string
  wasClean: boolean
  schema: number
  recovered: boolean
}

export interface SyncStore {
  readonly opened: Opened
  read<const Q extends readonly Query[]>(queries: Q): Promise<Answers<Q>>
  write(changes: readonly Change[]): Promise<number[]>
  cleanExit(clean: boolean): Promise<void>
  close(): Promise<void>
}

export async function openSyncStore(
  account: string,
  leads = false,
  device?: string,
): Promise<SyncStore> {
  if (isNative()) {
    const { openNative } = await import('./native-sync-store')
    return openNative(account, leads, device)
  }
  const { openWeb } = await import('../../web/sync-store')
  return openWeb(account, device)
}

export async function deviceOfSyncStore(account: string): Promise<string | null> {
  if (isNative()) {
    const { deviceNative } = await import('./native-sync-store')
    return deviceNative(account)
  }
  const { deviceWeb } = await import('../../web/sync-store')
  return deviceWeb(account)
}

export async function forgetSyncStore(account: string): Promise<void> {
  if (isNative()) {
    const { forgetNative } = await import('./native-sync-store')
    return forgetNative(account)
  }
  const { forgetWeb } = await import('../../web/sync-store')
  return forgetWeb(account)
}

export class StoreError extends Error {
  override name = 'StoreError'
}

function tableNamed(name: string): TableSpec {
  if (!(name in TABLES)) throw new StoreError(`the sync store has no table ${name}`)
  return TABLES[name as TableName]
}

const fits = (value: unknown): value is number => Number.isSafeInteger(value)

function holds(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case 'text':
    case 'packed':
      return typeof value === 'string'
    case 'integer':
      return fits(value)
    case 'bool':
      return typeof value === 'boolean'
    case 'blob':
      return value instanceof Uint8Array
    case 'any':
      return typeof value === 'string' || fits(value) || value instanceof Uint8Array
  }
}

function checked(table: string, column: Column, value: unknown): unknown {
  if (value === null || value === undefined) {
    if (column.required) throw new StoreError(`${table}.${column.name} may not be empty`)
    return null
  }
  if (!holds(column.kind, value)) {
    throw new StoreError(`${table}.${column.name} does not take ${describe(value)}`)
  }
  return value
}

function describe(value: unknown): string {
  if (value instanceof Uint8Array) return `${value.length} bytes`
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 40))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return typeof value
}

export function rowOf<T extends TableName>(table: T, value: unknown): Rows[T] {
  if (typeof value !== 'object' || value === null) {
    throw new StoreError(`a ${table} row is not an object`)
  }
  const given = value as Record<string, unknown>
  const spec = TABLES[table]
  for (const name of Object.keys(given)) {
    if (!spec.columns.some((column) => column.name === name)) {
      throw new StoreError(`${table} has no column ${name}`)
    }
  }

  const row: Record<string, unknown> = {}
  for (const column of spec.columns) row[column.name] = checked(table, column, given[column.name])
  return row as unknown as Rows[T]
}

export function patchOf(table: KeyedTable, set: unknown): Record<string, unknown> {
  if (typeof set !== 'object' || set === null) {
    throw new StoreError(`a patch of ${table} is not an object`)
  }
  const spec = TABLES[table]
  const entries = Object.entries(set)
  if (entries.length === 0) throw new StoreError(`a patch of ${table} changes nothing`)

  const out: Record<string, unknown> = {}
  for (const [name, value] of entries) {
    const column = spec.columns.find((one) => one.name === name)
    if (!column) throw new StoreError(`${table} has no column ${name}`)
    if (name === spec.key) throw new StoreError(`a patch of ${table} cannot change its ${name}`)
    out[name] = checked(table, column, value)
  }
  return out
}

export function changeOf(change: Change): Change {
  const spec = tableNamed(change.table)
  switch (change.t) {
    case 'put':
      rowOf(change.table, change.row)
      return change
    case 'patch':
      patchOf(change.table, change.set)
      return change
    case 'delete':
      if (spec.key === null) throw new StoreError(`${change.table} rows have no key`)
      return change
    case 'clear':
      if (spec.space === null) throw new StoreError(`${change.table} rows belong to no space`)
      return change
  }
}

export function queryOf(query: Query): Query {
  const spec = tableNamed(query.table)
  if (query.t === 'get' && spec.key === null) {
    throw new StoreError(`${query.table} rows have no key`)
  }
  if (query.t === 'scan' && query.space !== undefined && spec.space === null) {
    throw new StoreError(`${query.table} rows belong to no space`)
  }
  return query
}

export function answerOf<Q extends Query>(query: Q, value: unknown): Answer<Q> {
  if (query.t === 'get') {
    return (value === null || value === undefined ? null : rowOf(query.table, value)) as Answer<Q>
  }
  if (!Array.isArray(value)) throw new StoreError(`a scan of ${query.table} did not answer rows`)
  return value.map((row) => rowOf(query.table, row)) as Answer<Q>
}

export function openedOf(value: unknown): Opened {
  const said = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const { device, wasClean, schema, recovered } = said
  if (
    typeof device !== 'string' ||
    typeof wasClean !== 'boolean' ||
    !fits(schema) ||
    typeof recovered !== 'boolean'
  ) {
    throw new StoreError('the sync store answered an odd opening')
  }
  return { device, wasClean, schema, recovered }
}

export function countsOf(value: unknown, changes: number): number[] {
  if (!Array.isArray(value) || value.length !== changes || !value.every(fits)) {
    throw new StoreError('the sync store answered an odd count')
  }
  return value
}
