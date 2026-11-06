import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Saved {
  v: 1 | 2
  session: string
  at: number
  seq: number
  cols: number
  rows: number
  screen: string
  program: string | null
  folder: string | null
}

export function isSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/.test(id)
}

export class Saves {
  private readonly dir: string

  constructor(state: string) {
    this.dir = join(state, 'sessions')
  }

  write(saved: Saved): void {
    mkdirSync(this.dir, { recursive: true })
    const file = join(this.dir, `${saved.session}.json`)
    writeFileSync(`${file}.tmp`, JSON.stringify(saved))
    renameSync(`${file}.tmp`, file)
  }

  all(): Saved[] {
    let names: string[]
    try {
      names = readdirSync(this.dir).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }
    const out: Saved[] = []
    for (const name of names) {
      const saved = savedOf(readJson(join(this.dir, name)))
      if (saved) out.push(saved)
    }
    return out.sort((a, b) => a.at - b.at)
  }

  forget(session: string): void {
    rmSync(join(this.dir, `${session}.json`), { force: true })
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function savedOf(value: unknown): Saved | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Partial<Saved>
  if (one.v !== 1 && one.v !== 2) return null
  if (typeof one.session !== 'string' || !isSessionId(one.session)) return null
  if (typeof one.at !== 'number' || typeof one.seq !== 'number') return null
  if (typeof one.cols !== 'number' || typeof one.rows !== 'number') return null
  if (typeof one.screen !== 'string') return null
  return {
    v: one.v,
    session: one.session,
    at: one.at,
    seq: one.seq,
    cols: one.cols,
    rows: one.rows,
    screen: one.screen,
    program: typeof one.program === 'string' ? one.program : null,
    folder: typeof one.folder === 'string' ? one.folder : null,
  }
}
