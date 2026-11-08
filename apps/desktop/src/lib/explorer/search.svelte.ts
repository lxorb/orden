import { identifier } from '../identifier'
import { within } from '../space-paths'
import { isDesktop } from '../tauri'
import { cancelJob, type Entry, FOUND, type Found, searchBelow } from './commands'

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the searches by job, never drawn
const running = new Map<string, Search>()
let hearing: Promise<unknown> | null = null

function hear(): Promise<unknown> {
  if (!isDesktop) return Promise.resolve()
  hearing ??= import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<{ job: string; found: Found[] }>(FOUND, ({ payload }) => {
        running.get(payload.job)?.heard(payload.found)
      }),
    )
    .catch(() => {
      hearing = null
    })
  return hearing
}

function relativeName(root: string, one: Found): string {
  const folder = within(root, one.within) ?? ''
  return folder ? `${folder}/${one.name}` : one.name
}

export class Search {
  readonly root: string
  readonly query: string
  readonly job = identifier()
  found = $state.raw<Entry[]>([])
  done = $state(false)
  cut = $state(false)

  constructor(root: string, query: string) {
    this.root = root
    this.query = query
  }

  async run(hidden: boolean) {
    running.set(this.job, this)
    try {
      await hear()
      const said = await searchBelow(this.job, this.root, this.query, hidden)
      this.cut = said.cut
    } finally {
      running.delete(this.job)
      this.done = true
    }
  }

  heard(batch: readonly Found[]) {
    this.found = [
      ...this.found,
      ...batch.map((one) => ({ ...one, name: relativeName(this.root, one) })),
    ]
  }

  moved(from: string, to: string): string | null {
    const was = within(this.root, from)
    const now = within(this.root, to)
    if (!was || !now) return null
    this.found = this.found.map((one) => (one.name === was ? { ...one, name: now } : one))
    return now
  }

  movedAll(pairs: readonly { from: string; to: string }[]) {
    const names = pairs.flatMap(({ from, to }) => {
      const was = within(this.root, from)
      const now = within(this.root, to)
      return was && now ? [{ was, now }] : []
    })
    if (!names.length) return
    this.found = this.found.map((one) => {
      const now = names.find(({ was }) => was === one.name)?.now
      return now === undefined ? one : { ...one, name: now }
    })
  }

  stop() {
    if (!this.done) void cancelJob(this.job)
  }
}
