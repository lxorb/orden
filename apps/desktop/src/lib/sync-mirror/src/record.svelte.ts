import { isWebTarget } from '@orden/markdown/links'
import {
  log,
  insideSpace,
  withinSpace,
  forget,
  isRecord,
  keepJson,
  stored,
  invoke,
} from '../../platform/src/api'
import type { FileOp } from '../../workspace/file-ops'
import type { Answer, Clash } from './conflicts'

const STORAGE_KEY = 'orden:sync-log'

const KEPT = 60

interface Pass {
  at: number
  space: string
  pulled: number
  pushed: number
  clashed: number
  failed: string | null
}

interface Saved {
  passes?: unknown
  clashes?: unknown
}

function isPass(value: unknown): value is Pass {
  if (!value || typeof value !== 'object') return false
  const one = value as Partial<Pass>

  return typeof one.at === 'number' && typeof one.space === 'string'
}

function isClash(value: unknown): value is Clash {
  if (!value || typeof value !== 'object') return false
  const one = value as Partial<Clash>

  return typeof one.path === 'string' && typeof one.id === 'string' && typeof one.at === 'number'
}

class Record {
  passes = $state<Pass[]>([])

  clashes = $state<Clash[]>([])

  readonly waiting = $derived(this.clashes.length)

  restore() {
    const held: unknown = stored(STORAGE_KEY)
    const saved: Saved = isRecord(held) ? held : {}

    this.passes = Array.isArray(saved.passes) ? saved.passes.filter(isPass).slice(0, KEPT) : []
    this.clashes = Array.isArray(saved.clashes) ? saved.clashes.filter(isClash) : []
  }

  wrote(pass: Pass) {
    if (!pass.pulled && !pass.pushed && !pass.clashed && !pass.failed) return

    this.passes = [pass, ...this.passes].slice(0, KEPT)
    this.persist()
  }

  clash(clash: Clash) {
    const same = (one: Clash) => one.id === clash.id || one.path === clash.path
    this.clashes = this.clashes.some(same)
      ? this.clashes.map((one) => (same(one) ? clash : one))
      : [...this.clashes, clash]
    this.persist()
  }

  notes: {
    at(id: string): string | null
    of(path: string): string | null
    moved?(from: string, to: string): unknown
  } | null = null

  follow(op: FileOp) {
    if (op.op === 'created') return
    const from = op.op === 'moved' ? op.from : op.path
    const under = (path: string) => {
      const was = from.replace(/\\/g, '/')
      const one = path.replace(/\\/g, '/')
      return one === was ? '' : one.startsWith(`${was}/`) ? one.slice(was.length) : null
    }
    if (!this.clashes.some((one) => under(one.path) !== null)) return

    this.clashes =
      op.op === 'moved'
        ? this.clashes.map((one) => {
            const rest = under(one.path)
            return rest === null ? one : { ...one, path: op.to + rest }
          })
        : this.clashes.filter((one) => under(one.path) === null)
    this.persist()
  }

  readonly held = $derived(new Set(this.clashes.map((one) => one.path)))

  async settle(clash: Clash, answer: Answer): Promise<void> {
    const recorded = this.notes?.at(clash.id) ?? null
    const judged = await placed(clash.path)
    const followed =
      recorded !== null &&
      judged !== null &&
      recorded !== judged &&
      this.notes?.of(judged) === null &&
      (await invoke<string>('read_note', { path: judged }).then(
        () => true,
        () => false,
      ))
    const now = followed ? null : recorded
    const there = now === null && !followed ? (this.notes?.of(clash.path) ?? null) : null
    const elsewhere = there !== null && there !== clash.id
    const path = await placed(now ?? clash.path)
    if (path === null) {
      log('warn', 'sync: a note waiting to be settled is in no space, so it was let go of')
      this.forget(clash.path)
      return
    }

    if (elsewhere) {
      log('warn', 'sync: a note waiting to be settled has gone, so its other copy is kept beside')
      if (answer !== 'mine') {
        const [{ conflictPath }, { writeDown }] = await Promise.all([
          import('@orden/markdown/paths'),
          import('./write-down'),
        ])
        await writeDown(conflictPath(path), clash.theirs)
      }
      this.forget(clash.path)
      return
    }

    if (answer === 'theirs') {
      const { writeDown } = await import('./write-down')
      await writeDown(path, clash.theirs)
      const { workspace } = await import('../../workspace.svelte')
      workspace.reload(path, clash.theirs)
    }

    if (answer === 'both' && isWebTarget(path)) {
      const [{ settleShortcuts }, { writeDown }] = await Promise.all([
        import('@orden/scan/settle'),
        import('./write-down'),
      ])
      const ours = await invoke<string>('read_note', { path }).catch(() => null)
      if (ours !== null) {
        const one = settleShortcuts(path, ours, clash.theirs, false)
        await writeDown(path, one, ours)
        const { workspace } = await import('../../workspace.svelte')
        workspace.reload(path, one)
      }
    } else if (answer === 'both') {
      const [{ conflictPath }, { writeDown }] = await Promise.all([
        import('@orden/markdown/paths'),
        import('./write-down'),
      ])
      await writeDown(conflictPath(path), clash.theirs)
    }

    this.forget(clash.path)
    if (followed) void this.notes?.moved?.(recorded, path)
  }

  forget(path: string) {
    this.clashes = this.clashes.filter((one) => one.path !== path)
    this.persist()
  }

  clear() {
    this.passes = []
    this.persist()
  }

  forgetEverything() {
    this.passes = []
    this.clashes = []

    forget(STORAGE_KEY)
  }

  private persist() {
    keepJson(STORAGE_KEY, { passes: this.passes, clashes: this.clashes })
  }
}

export const record = new Record()

async function placed(path: string): Promise<string | null> {
  const { workspace } = await import('../../workspace.svelte')

  for (const space of workspace.spaces) {
    const relative = withinSpace(space.root, path)
    if (relative !== null) return insideSpace(space.root, relative)
  }

  return null
}
