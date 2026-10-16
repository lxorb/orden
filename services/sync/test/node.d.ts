/** The pieces of Node the tests run on, declared here rather than pulled in
 *  with @types/node.
 *
 *  The Worker itself is typed against workers-types, and the two disagree
 *  about half the globals - Request, Response, fetch, crypto. Bringing Node's
 *  types in alongside would leave which one wins to declaration order. The
 *  tests need three modules, one property and one global, so they are written
 *  out: what is used is visible, and nothing else changes shape. Widen this when
 *  a test reaches for something new.
 *
 *  The last of them is not the tests' own: scripts/blog-css.ts builds the
 *  stylesheet a published page is served with, and publishing.test.ts imports it
 *  to say that the committed one is still what it writes. A script that writes a
 *  file needs rather more of Node than a test does.
 *
 *  The same reasoning as EmailSender in src/types.ts, from the other side. */

interface ImportMeta {
  /** The file's own URL, which is how the migrations folder is found. */
  url: string
}

declare module 'node:fs' {
  export function readdirSync(path: string): string[]
  /** latin1 is how a font is read: one character to a byte, which is a string
   *  `btoa` takes and a hash can be made of without a reading in between. */
  export function readFileSync(path: string, encoding: 'utf8' | 'latin1'): string
  export function writeFileSync(path: string, contents: string): void
  /** Only the one question, asked by the test that walks the source: is this a
   *  folder to go into, or a file to read? */
  export function statSync(path: string): { isDirectory(): boolean }
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare module 'node:crypto' {
  interface Hash {
    update(data: string, encoding?: 'utf8' | 'latin1'): Hash
    digest(encoding: 'hex'): string
  }

  export function createHash(algorithm: 'sha256'): Hash
}

declare module 'node:module' {
  /** Enough of a require to ask where a package's own file is: the generator
   *  bakes KaTeX's stylesheet and faces in, and resolves the package rather than
   *  naming a version, so a page cannot be dressed by a release the editor does
   *  not render with. */
  export function createRequire(from: string): { resolve(id: string): string }
}

/** Only what says whether a script was run rather than imported. */
declare const process: { argv: string[] }

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
  export function pathToFileURL(path: string): URL
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
