import {
  answerOf,
  changeOf,
  LOG_ROWS,
  patchOf,
  queryOf,
  rowOf,
  StoreError,
  TABLES,
  type Answers,
  type Change,
  type Opened,
  type Query,
  type Rows,
  type SyncStore,
  type TableName,
} from './store'

type Row = Record<string, unknown>

function copied(row: Row): Row {
  const out: Row = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Uint8Array ? value.slice() : value
  }
  return out
}

interface Tables {
  keyed: Map<TableName, Map<string, Row>>
  log: Row[]
}

function emptyTables(): Tables {
  const keyed = new Map<TableName, Map<string, Row>>()
  for (const name of Object.keys(TABLES) as TableName[]) {
    if (TABLES[name].key !== null) keyed.set(name, new Map())
  }
  return { keyed, log: [] }
}

export class MemoryStore {
  private tables = emptyTables()
  private clean = true
  private readonly device: string
  writes = 0

  constructor(device = 'memory-device') {
    this.device = device
  }

  open(): SyncStore {
    const opened: Opened = {
      device: this.device,
      wasClean: this.clean,
      schema: 1,
      recovered: false,
    }
    this.clean = false
    let closed = false

    const alive = () => {
      if (closed) throw new StoreError('the sync store is closed')
    }

    return {
      opened,
      read: <const Q extends readonly Query[]>(queries: Q): Promise<Answers<Q>> => {
        alive()
        return Promise.resolve(this.read(queries))
      },
      write: (changes: readonly Change[]): Promise<number[]> => {
        alive()
        return Promise.resolve(this.write(changes))
      },
      cleanExit: (clean: boolean) => {
        alive()
        this.clean = clean
        return Promise.resolve()
      },
      close: () => {
        closed = true
        return Promise.resolve()
      },
    }
  }

  private rowsOf(table: TableName): Map<string, Row> {
    const rows = this.tables.keyed.get(table)
    if (!rows) throw new StoreError(`${table} rows have no key`)
    return rows
  }

  private read<const Q extends readonly Query[]>(queries: Q): Answers<Q> {
    return queries.map((query) => {
      queryOf(query)
      if (query.t === 'get') {
        const row = this.rowsOf(query.table).get(query.key)
        return answerOf(query, row ? copied(row) : null)
      }
      return answerOf(query, this.scanned(query.table, query.space).map(copied))
    }) as Answers<Q>
  }

  private scanned(table: TableName, space: string | undefined): Row[] {
    const spec = TABLES[table]
    const all =
      spec.key === null
        ? this.tables.log
        : [...this.rowsOf(table).values()].sort((a, b) => order(table, a, b))
    if (space === undefined || spec.space === null) return all
    const column = spec.space
    return all.filter((row) => row[column] === space)
  }

  private write(changes: readonly Change[]): number[] {
    for (const change of changes) changeOf(change)
    const counts = changes.map((change) => applied(this.tables, change))
    this.writes += 1
    return counts
  }

  rows<T extends TableName>(table: T): Rows[T][] {
    return this.scanned(table, undefined).map((row) => rowOf(table, copied(row)))
  }
}

function order(table: TableName, a: Row, b: Row): number {
  if (table === 'outbox') {
    const age = Number(a.made_at) - Number(b.made_at)
    if (age !== 0) return age
  }
  const key = TABLES[table].key ?? ''
  return String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0
}

function applied(tables: Tables, change: Change): number {
  const spec = TABLES[change.table]
  switch (change.t) {
    case 'put': {
      const row = rowOf(change.table, change.row) as unknown as Row
      if (spec.key === null) {
        tables.log.push(copied(row))
        if (tables.log.length > LOG_ROWS) tables.log.splice(0, tables.log.length - LOG_ROWS)
        return 1
      }
      tables.keyed.get(change.table)?.set(String(row[spec.key]), copied(row))
      return 1
    }
    case 'patch': {
      const rows = tables.keyed.get(change.table)
      const was = rows?.get(change.key)
      if (!rows || !was) return 0
      rows.set(change.key, { ...was, ...copied(patchOf(change.table, change.set)) })
      return 1
    }
    case 'delete':
      return tables.keyed.get(change.table)?.delete(change.key) ? 1 : 0
    case 'clear': {
      const column = spec.space
      if (column === null) return 0
      if (spec.key === null) {
        const before = tables.log.length
        tables.log = tables.log.filter((row) => row[column] !== change.space)
        return before - tables.log.length
      }
      const rows = tables.keyed.get(change.table)
      let count = 0
      for (const [key, row] of rows ?? []) {
        if (row[column] !== change.space) continue
        rows?.delete(key)
        count += 1
      }
      return count
    }
  }
}
