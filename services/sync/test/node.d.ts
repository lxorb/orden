interface ImportMeta {
  url: string
}

declare module 'node:fs' {
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8' | 'latin1'): string
  export function writeFileSync(path: string, contents: string): void
  export function statSync(path: string): { isDirectory(): boolean }
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare module 'node:crypto' {
  interface Hash {
    update(data: string | Uint8Array, encoding?: 'utf8' | 'latin1'): Hash
    digest(encoding: 'hex'): string
  }

  export function createHash(algorithm: 'sha256'): Hash
}

declare module 'node:module' {
  export function createRequire(from: string): { resolve(id: string): string }
}

declare const process: { argv: string[] }

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
  export function pathToFileURL(path: string): URL
}

declare module 'node:sqlite' {
  type SQLValue = null | number | bigint | string | Uint8Array

  interface StatementSync {
    get(...values: SQLValue[]): unknown
    all(...values: SQLValue[]): unknown[]
    run(...values: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  }

  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
