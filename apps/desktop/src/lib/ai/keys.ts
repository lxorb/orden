/** Where a provider's API key lives, which is on the device and nowhere else.
 *
 *  A key is the reader's own and worth money to whoever takes it, so nib puts it
 *  where the platform puts secrets and keeps it out of everything that can be
 *  copied: not in the note, not in the space, not on the account, not in sync, and
 *  never in a log or an error. The account holds one OpenAI key, for the glasses,
 *  and that one is a different key for a different thing; the AI pane says so.
 *
 *  Three platforms, three stores, one pair of calls:
 *
 *  - The desktop app: the machine's own keychain, through the Rust commands. The
 *    Credential Manager on Windows, the Keychain on macOS, the Secret Service on
 *    Linux. See src-tauri/src/secrets.rs.
 *  - The phone app: `EncryptedSharedPreferences`, which is a file encrypted with a
 *    key held in the phone's hardware Keystore, reached through the activity. See
 *    the Secrets bridge in MainActivity.kt.
 *  - A browser: IndexedDB, which is the browser's own storage and is not a secret
 *    store at all. Anything else would be worse - a key in the page's memory only
 *    is a key retyped on every reload - so it is kept there and the pane says
 *    plainly that the browser is holding it.
 *
 *  Read back rather than write-only, because the request is made by the page: a
 *  store that could not be read would mean nib could not ask anything. */

import { frameWord } from '../mobile/bridge'
import { isMobile, isNative, invoke } from '../tauri'
import type { Provider } from './providers'

/** What the activity puts in the page; see MainActivity.kt.
 *
 *  Each takes the word the activity says to the page and to nothing else. The bridge
 *  object is injected into every frame of the webview - a page a note embeds, a block
 *  of a note's own HTML - and without the word a framed page could ask for every key
 *  on the phone. See `frameWord` in mobile/bridge.ts. */
interface Secrets {
  secretRead(said: string, name: string): string | null
  secretWrite(said: string, name: string, secret: string): void
  secretForget(said: string, name: string): void
}

/** The activity's side of the bridge, or nothing anywhere else. Checked member by
 *  member, so the cast only names a shape that has just been shown to be there. */
function bridge(): Secrets | undefined {
  const found: unknown = (globalThis as { __NIB_SYSTEM__?: unknown }).__NIB_SYSTEM__
  if (typeof found !== 'object' || found === null) return undefined

  const shape = found as Partial<Secrets>
  return typeof shape.secretRead === 'function' &&
    typeof shape.secretWrite === 'function' &&
    typeof shape.secretForget === 'function'
    ? (shape as Secrets)
    : undefined
}

/** Whether the key is kept somewhere the operating system guards, as opposed to in
 *  the browser's own storage. What the pane says one line about. */
export function keysAreGuarded(): boolean {
  return isNative
}

/** The key a provider is reached with, or the empty string where it has none - a
 *  local model, or one whose key has not been typed yet.
 *
 *  Never cached. A key read once and held in a variable is a key in the heap for as
 *  long as the app is open, and every reader of this awaits a request anyway. */
export async function readKey(provider: Provider): Promise<string> {
  const found = await read(provider.id)
  return found ?? ''
}

/** Whether a key is on this device for that provider, without handing it back. What
 *  the pane shows: "set", and never the key. */
export async function hasKey(id: string): Promise<boolean> {
  return !!(await read(id))
}

export async function writeKey(id: string, secret: string): Promise<void> {
  const trimmed = secret.trim()
  if (!trimmed) {
    await forgetKey(id)
    return
  }

  const phone = isMobile ? bridge() : undefined
  if (phone) phone.secretWrite(await frameWord(), id, trimmed)
  else await invoke<null>('secret_write', { name: id, secret: trimmed })
}

export async function forgetKey(id: string): Promise<void> {
  const phone = isMobile ? bridge() : undefined
  if (phone) phone.secretForget(await frameWord(), id)
  else await invoke<null>('secret_forget', { name: id })
}

/** One read, whichever store answers it. The value crossing the bridge is unknown
 *  until it has been looked at, however sure the signature above is. */
async function read(id: string): Promise<string | null> {
  const phone = isMobile ? bridge() : undefined
  const found: unknown = phone
    ? phone.secretRead(await frameWord(), id)
    : await invoke<unknown>('secret_read', { name: id })
  return typeof found === 'string' && found ? found : null
}
