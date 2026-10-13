/** The vault, started on this device: its roads out (the account's routes, the secret
 *  store, the AI store and the plans' sign-ins) and when it reads again - a sign-in, a
 *  word from the hub, a change made here, the window coming back, and every few
 *  minutes besides. Fetched with the AI store, after the first paint. */

import { mount, unmount, untrack } from 'svelte'
import { account } from '../../account.svelte'
import { request } from '../../api'
import { deviceName } from '../../device'
import { forget, keep, parsed, storedText } from '../../stored'
import { hub } from '../../sync2/hub.svelte'
import { isLocal, type ProviderKind } from '../providers'
import { forgetKey, keysMoved, readSecret, writeKey, writeSecret } from '../keys'
import { ai } from '../store.svelte'
import type { Base, Contents } from './merge'
import { Vault, type VaultWorld } from './vault.svelte'
import VaultApprove from './VaultApprove.svelte'

/** How long a run of changes is waited out before the vault is written once. */
const SETTLE = 800
/** How often it reads again with nothing said. */
const EVERY = 5 * 60_000

/** Whether an account of this kind is reached with a key of its own. */
const keyed = (kind: ProviderKind) => !isLocal(kind) && kind !== 'chatgpt'

const baseKey = (id: string) => `nib:ai-vault-base:${id}`

/** Who each program and ChatGPT says is signed in here, where it has said. */
async function signIns(): Promise<Record<string, string>> {
  if (__EVEN_PLUGIN__) return {}
  const { plans } = await import('../local/status.svelte')
  const seen: Record<string, string> = {}
  for (const one of ai.accounts) {
    const who = isLocal(one.kind)
      ? plans.of(one.id).account
      : one.kind === 'chatgpt'
        ? (plans.chatgpt?.email ?? null)
        : null
    if (who) seen[one.id] = who
  }
  return seen
}

const world: VaultWorld = {
  account: () => (account.user && account.token ? account.user.id : null),
  call: (path, method, body) =>
    request(path, {
      ...(method ? { method } : {}),
      ...(body === undefined ? {} : { body }),
      ...(account.token ? { token: account.token } : {}),
    }),
  readSecret,
  writeSecret,
  deviceName,
  async local(): Promise<Contents> {
    const keys: Record<string, string> = {}
    for (const one of ai.accounts) {
      if (!keyed(one.kind)) continue
      const key = await readSecret(one.id).catch(() => null)
      if (key) keys[one.id] = key
    }
    return { accounts: ai.state, keys, seen: await signIns() }
  },
  async apply(contents, before) {
    for (const [id, key] of Object.entries(contents.keys)) {
      if (before.keys[id] !== key) await writeKey(id, key, true)
    }
    for (const id of Object.keys(before.keys)) {
      if (!(id in contents.keys)) await forgetKey(id, true)
    }
    ai.adopt(contents.accounts)
  },
  loadBase: (id) => (parsed(storedText(baseKey(id))) as Base | null) ?? null,
  keepBase: (id, base) => {
    if (base) keep(baseKey(id), JSON.stringify(base))
    else forget(baseKey(id))
  },
}

export const vault = new Vault(world)

let started = false

/** Starts the vault, once. */
export function startVault(): void {
  if (started) return
  started = true

  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void vault.refresh(), SETTLE)
  }
  ai.onLocalChange(soon)
  keysMoved(soon)
  hub.on('ai', () => void vault.refresh())
  setInterval(() => void vault.refresh(), EVERY)
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => void vault.refresh())
  }

  $effect.root(() => {
    // A sign-in reads the vault; signing out stops reading it.
    $effect(() => {
      const who = account.user?.id ?? null
      untrack(() => {
        if (who) void vault.refresh()
        else vault.signedOut()
      })
    })

    // A device asking for the key: the bubble, while one asks.
    const asking = $derived(vault.asking.length > 0)
    $effect(() => {
      if (!asking) return
      const bubble = untrack(() => mount(VaultApprove, { target: document.body, props: { vault } }))
      return () => void unmount(bubble, { outro: true })
    })
  })
}
