import { mount, unmount, untrack } from 'svelte'
import { account } from '../../accounts/src/api'
import { request } from '../../accounts/src/api'
import { deviceName } from '../../device'
import { forget, keep, keepJson, parsed, storedText } from '../../stored'
import { hub } from '../../sync-client/src/api'
import { NoWord, wordSaid } from '../../mobile/bridge'
import { isNative } from '../../tauri'
import { isLocal, type ProviderKind } from '../providers'
import { forgetKey, keysMoved, readSecret, writeKey, writeSecret } from '../keys'
import { ai } from '../store.svelte'
import type { Base, Contents } from './merge'
import { Vault, type VaultWorld } from './vault.svelte'
import VaultApprove from './VaultApprove.svelte'

const SETTLE = 800
const EVERY = 5 * 60_000

const keyed = (kind: ProviderKind) => !isLocal(kind) && kind !== 'chatgpt'

const baseKey = (id: string) => `orden:ai-vault-base:${id}`

const BROWSER_KEY = 'orden:ai-vault-browser'

export const browserVault = $state({ on: storedText(BROWSER_KEY) === 'yes' })

export async function keepBrowserInVault(on: boolean): Promise<void> {
  browserVault.on = on
  if (on) keep(BROWSER_KEY, 'yes')
  else forget(BROWSER_KEY)
  if (on) {
    await vault.refresh()
    return
  }
  await vault.leave()
}

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
  account: () =>
    account.user && account.token && (isNative || browserVault.on) ? account.user.id : null,
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
      const key = await readSecret(one.id).catch((error: unknown) => {
        if (error instanceof NoWord) throw error
        return null
      })
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
    if (base) keepJson(baseKey(id), base)
    else forget(baseKey(id))
  },
}

export const vault = new Vault(world)

let started = false

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
  hub.opened(() => void vault.refresh())
  setInterval(() => void vault.refresh(), EVERY)
  void wordSaid().then(() => vault.refresh())
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => void vault.refresh())
  }

  $effect.root(() => {
    $effect(() => {
      const who = account.user?.id ?? null
      untrack(() => {
        if (who) void vault.refresh()
        else vault.signedOut()
      })
    })

    const asking = $derived(vault.asking.length > 0)
    $effect(() => {
      if (!asking) return
      const bubble = untrack(() => mount(VaultApprove, { target: document.body, props: { vault } }))
      return () => void unmount(bubble, { outro: true })
    })
  })
}
