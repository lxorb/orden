import type { FileOp } from '../workspace/file-ops'

type OwedOp = FileOp

export interface Owing {
  id: string
  what: { kind: 'wrote'; path: string; text: string } | { kind: 'op'; op: FileOp; entry?: string }
}

const MOST_OWED = 1_000

export async function takeOwed(
  engine: {
    saved(path: string, text: string): Promise<void>
    entryAt(path: string): { id: string } | null | undefined
  },
  item: Owing,
  follow: (op: OwedOp) => unknown,
): Promise<void> {
  if (item.what.kind === 'wrote') {
    await engine.saved(item.what.path, item.what.text)
    return
  }
  const op = item.what.op
  if (op.op === 'created') {
    if (engine.entryAt(op.path)) return
  } else if (op.kind !== 'space') {
    const there = engine.entryAt(op.op === 'moved' ? op.from : op.path)
    if (!there || (item.what.entry !== undefined && there.id !== item.what.entry)) return
  }
  await follow(op)
}

export class Owed {
  private readonly owing: Owing[] = []
  private next = 0

  constructor(private readonly say: (item: Owing) => void) {}

  add(what: Owing['what']): void {
    if (what.kind === 'wrote') {
      const last = this.owing.map((one) => one.what.kind).lastIndexOf('op')
      const at = this.owing.findIndex(
        (one, index) => index > last && one.what.kind === 'wrote' && one.what.path === what.path,
      )
      if (at >= 0) this.owing.splice(at, 1)
    }
    if (this.owing.length >= MOST_OWED) {
      const old = this.owing.findIndex((one) => one.what.kind === 'wrote')
      this.owing.splice(Math.max(old, 0), 1)
    }
    const item = { id: `${this.next++}`, what }
    this.owing.push(item)
    this.say(item)
  }

  clear(): void {
    this.owing.length = 0
  }

  done(id: string): void {
    const at = this.owing.findIndex((one) => one.id === id)
    if (at >= 0) this.owing.splice(at, 1)
  }

  resend(): void {
    for (const item of this.owing) this.say(item)
  }

  drain(): Owing[] {
    return this.owing.splice(0)
  }

  get size(): number {
    return this.owing.length
  }
}
