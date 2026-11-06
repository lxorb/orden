import { log } from '../log'
import { movedTo, relativeTo, samePath, within } from '../space-paths'

export type Kind = 'file' | 'folder' | 'space'

export type FileOp = (
  | {
      op: 'created'
      path: string
      kind: Exclude<Kind, 'space'>
      root: string | null
      key?: string
      back?: string
      putBack?: true
    }
  | {
      op: 'moved'
      from: string
      to: string
      kind: Kind
      root: string | null
      into?: string | null
    }
  | {
      op: 'removed'
      path: string
      kind: Kind
      root: string | null
      back?: string
    }
) & {
  heard?: true
}

export type Follower = (op: FileOp) => unknown

export type Doer = (op: FileOp, run: () => Promise<unknown>) => Promise<void>

export class FileOps {
  private readonly followers = new Set<Follower>()
  private doer: Doer | null = null

  doneBy(doer: Doer): () => void {
    this.doer = doer
    return () => {
      if (this.doer === doer) this.doer = null
    }
  }

  async doing(op: FileOp, run: () => Promise<unknown>): Promise<void> {
    if (this.doer) await this.doer(op, run)
    else await run()
  }

  follow(follower: Follower): () => void {
    this.followers.add(follower)
    return () => this.followers.delete(follower)
  }

  async tell(op: FileOp): Promise<void> {
    const waiting: Promise<unknown>[] = []

    for (const follower of this.followers) {
      try {
        const left = follower(op)
        if (left instanceof Promise) waiting.push(left.catch((error: unknown) => failed(op, error)))
      } catch (error) {
        failed(op, error)
      }
    }

    await Promise.all(waiting)
  }
}

function failed(op: FileOp, error: unknown) {
  log(
    'error',
    `a store did not follow ${op.op} ${op.op === 'moved' ? op.from : op.path}: ${String(error)}`,
  )
}

export interface KeptByPath {
  moved?(from: string, to: string, root: string | null, into?: string | null): void
  gone?(path: string, root: string | null): void
  spaceMoved?(from: string, to: string): void
  forget?(root: string): void
}

export function keeping(store: KeptByPath): Follower {
  return (op) => {
    if (op.op === 'removed') {
      if (op.kind === 'space') store.forget?.(op.path)
      else store.gone?.(op.path, op.root)
    } else if (op.op === 'moved') {
      if (op.kind === 'space') store.spaceMoved?.(op.from, op.to)
      else store.moved?.(op.from, op.to, op.root, op.into === undefined ? op.root : op.into)
    }
  }
}

export interface Moving {
  root: string
  was: string
  there: string
  now: string | null
  across: boolean
}

export function moving(from: string, to: string, root: string, into?: string | null): Moving {
  const there = into ?? root
  const now = within(there, to, there)
  return {
    root,
    was: relativeTo(root, from),
    there,
    now,
    across: now === null || !samePath(there, root),
  }
}

export function carried<T>(
  held: Iterable<T>,
  move: Moving,
  pathOf: (one: T) => string | null,
  at: (one: T, path: string) => T,
): { left: T[]; went: T[] } {
  const left: T[] = []
  const went: T[] = []
  for (const one of held) {
    const path = pathOf(one)
    const landed =
      path === null || !move.was ? null : movedTo(path, move.was, move.now ?? '', move.root)
    if (landed === null) left.push(one)
    else if (move.now !== null) went.push(at(one, landed))
  }
  return { left, went }
}
