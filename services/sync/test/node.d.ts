/** The pieces of Node the tests run on, declared here rather than pulled in
 *  with @types/node.
 *
 *  The Worker itself is typed against workers-types, and the two disagree
 *  about half the globals - Request, Response, fetch, crypto. Bringing Node's
 *  types in alongside would leave which one wins to declaration order. The
 *  tests need three modules and one property, so they are written out: what is
 *  used is visible, and nothing else changes shape. Widen this when a test
 *  reaches for something new.
 *
 *  The same reasoning as EmailSender in src/types.ts, from the other side. */

interface ImportMeta {
  /** The file's own URL, which is how the migrations folder is found. */
  url: string
}

declare module 'node:fs' {
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}

declare module 'node:sqlite' {
  /** What SQLite takes and gives back. A row is an object of these, but only
   *  the caller knows which columns it asked for, so a read comes back as
   *  `unknown` and is named at the point of use. */
  type SQLValue = null | number | bigint | string | Uint8Array

  interface StatementSync {
    get(...values: SQLValue[]): unknown
    all(...values: SQLValue[]): unknown[]
    run(...values: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  }

  export class DatabaseSync {
    constructor(path: string)
    /** Runs a script of statements, which is what a migration is. */
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
