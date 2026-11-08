import type { Invite } from '@orden/pass/wire'
import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { BASE, request } from '../api'
import { roomDelay } from '../backoff'
import { log } from '../log'
import { passOn } from '../settings.svelte'
import { hub } from '../sync2/hub.svelte'
import { deviceRows } from './device-rows'
import { syncOnce } from './exchange'
import { pass } from './store.svelte'
import type { PassCall } from './sync'
import { PassApi } from './sync'
import type { SyncWorld } from './sync-world'
import { invitesOf } from './synced'

export type PassSyncState =
  'off' | 'syncing' | 'synced' | 'offline' | 'old-server' | 'conflict' | 'other-account'

const SETTLE = 800
const EVERY = 5 * 60_000

function callWith(token: string): PassCall {
  return (path, method, body) =>
    request(path, {
      ...(method ? { method } : {}),
      ...(body === undefined ? {} : { body }),
      token,
    })
}

class PassSync {
  state = $state<PassSyncState>('off')
  at = $state<number | null>(null)
  invites = $state.raw<Invite[]>([])

  private running: Promise<void> | null = null
  private again = false
  private backfilled = false

  async refresh(): Promise<void> {
    if (this.running) {
      this.again = true
      await this.running
      return
    }
    this.running = this.run().finally(() => {
      this.running = null
    })
    await this.running
    if (!this.again) return
    this.again = false
    await this.refresh()
  }

  signedOut(): void {
    this.backfilled = false
    this.state = 'off'
    pass.conflict = false
  }

  private worldFor(id: string, email: string, token: string): SyncWorld {
    return {
      api: new PassApi(callWith(token), () => hub.device),
      rows: deviceRows,
      account: id,
      email,
      exclusive: (run) => pass.exclusive(run),
      shown: (update) => {
        pass.shown(update)
      },
      tookKeyring: (row) => {
        pass.tookKeyring(row)
      },
      conflicted: (on) => {
        pass.conflict = on
      },
      invited: (invites) => {
        this.invites = invites
      },
      distrusted: (problem) => {
        pass.distrusted(problem)
      },
      files: async () => (await import('./file-sync')).worldFiles(BASE, token),
    }
  }

  private async run(): Promise<void> {
    const user = account.user
    const token = account.token
    if (!user || !token) {
      this.state = 'off'
      return
    }
    if (pass.state === 'loading') await pass.start()
    this.state = 'syncing'
    try {
      const outcome = await syncOnce(this.worldFor(user.id, user.email, token))
      this.state = outcome
      if (outcome === 'synced') this.at = Date.now()
      if (outcome === 'synced' && pass.state === 'open' && !this.backfilled) {
        this.backfilled = true
        if ((await pass.backfillTrust()) > 0) void this.refresh()
      }
    } catch (error) {
      log('warn', `pass: sync stopped: ${error instanceof Error ? error.message : String(error)}`)
      this.state = 'offline'
    }
  }
}

export const passSync = new PassSync()

let started = false

export function startPassSync(): void {
  if (started) return
  started = true

  let timer: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let tries = 0
  const now = () => {
    clearTimeout(retry)
    if (!passOn()) return
    void passSync.refresh().then(() => {
      clearTimeout(retry)
      if (passSync.state !== 'offline') {
        tries = 0
        return
      }
      tries++
      retry = setTimeout(now, roomDelay(tries))
    })
  }
  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(now, SETTLE)
  }
  pass.onLocalChange(soon)
  hub.on('pass', now)
  hub.opened(now)
  setInterval(now, EVERY)
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', now)
    window.addEventListener('online', now)
  }
  void invitesOf(deviceRows)
    .then((invites) => {
      passSync.invites = invites
    })
    .catch(() => undefined)

  $effect.root(() => {
    $effect(() => {
      const who = account.user?.id ?? null
      untrack(() => {
        if (who) now()
        else passSync.signedOut()
      })
    })

    $effect(() => {
      if (pass.state !== 'open') return
      untrack(now)
    })
  })
}
