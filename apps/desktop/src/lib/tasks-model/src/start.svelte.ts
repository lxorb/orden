import { portOf, whenPortProvided } from '@orden/contracts'
import { openTodoDisk } from './disk'
import { todoServer } from './server'
import { TodoStore, type StoreWorld } from './store.svelte'

const LOOK_AGAIN = 60_000

const DEVICE = 'orden:todos-device'

const OWNER = 'orden:todos-owner'

const browserWorld: StoreWorld = {
  openDisk: openTodoDisk,
  now: () => Date.now(),
  channel: (name) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)),
  warn: (message) => console.warn(message),
  later: (run, ms) => {
    const handle = setTimeout(run, ms)
    return () => clearTimeout(handle)
  },
}

export const todos = new TodoStore(browserWorld)

function device(): string {
  const storage = portOf('sync.storage')
  const held = storage.ok ? storage.value.text(DEVICE) : null
  if (held) return held
  const made = crypto.randomUUID().replace(/-/g, '')
  if (storage.ok) storage.value.keepText(DEVICE, made)
  return made
}

function ownerOf(token: string | null, user: { id: string } | null): string | null {
  const storage = portOf('sync.storage')
  if (token === null) {
    if (storage.ok) storage.value.forget(OWNER)
    return null
  }
  if (user) {
    if (storage.ok) storage.value.keepText(OWNER, user.id)
    return user.id
  }
  return storage.ok ? storage.value.text(OWNER) : null
}

let started = false

export function startTodos(): void {
  if (started) return
  started = true
  whenPortProvided('sync.account', (account) => {
    $effect.root(() => {
      $effect(() => {
        const token = account.token
        const user = account.user
        const owner = ownerOf(token, user)
        void todos.opened({
          owner,
          server: owner && token ? todoServer(token) : null,
          device: device(),
        })
      })
    })
  })
  if (typeof window === 'undefined') return
  const again = () => {
    if (document.visibilityState === 'visible') void todos.exchange()
  }
  document.addEventListener('visibilitychange', again)
  window.addEventListener('online', again)
  window.addEventListener('focus', again)
  setInterval(again, LOOK_AGAIN)
}
