/** The six digits two screens compare while a device is let in, the one way both the AI
 *  vault (ai/vault) and web logins (web-tab/approval.svelte.ts) work them out.
 *
 *  Three steps, so that nobody between the two screens - the account's service included -
 *  can choose a key that shows the same digits: the asking device commits to its public key
 *  and a nonce (`commitment`), a device that holds the key answers with a nonce of its own,
 *  and only then does the asking device reveal its key and nonce, which both the service and
 *  the answering device check against the commitment. The digits are worked out from both
 *  keys and both nonces (`digits`), so a key swapped in had to be chosen before the answering
 *  nonce existed. The account's half of the checks is services/sync/src/pairing.ts.
 *
 *  Keys and nonces travel as base64, the way both kinds of device key already do. */

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

function base64(bytes: Uint8Array): string {
  let text = ''
  for (const one of bytes) text += String.fromCharCode(one)
  return btoa(text)
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at)
  return bytes
}

function joined(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const all = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    all.set(one, at)
    at += one.length
  }
  return all
}

/** A fresh nonce for one asking, from either side. */
export function newNonce(): string {
  return base64(globalThis.crypto.getRandomValues(new Uint8Array(32)))
}

/** What a device asking to be let in says first: SHA-256 of its key and its nonce. */
export async function commitment(pub: string, nonce: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', joined(bytesOf(pub), bytesOf(nonce)))
  return base64(new Uint8Array(digest))
}

/** The six digits both screens show: SHA-256 over what they are for, the asking device's
 *  key and nonce, and the answering device's nonce and key, read as a number, mod 10^6, in
 *  two groups of three. `purpose` keeps the vault's digits and web logins' apart. */
export async function digits(
  purpose: string,
  asking: string,
  askingNonce: string,
  answeringNonce: string,
  answering: string,
): Promise<string> {
  const said = joined(
    new TextEncoder().encode(purpose),
    bytesOf(asking),
    bytesOf(askingNonce),
    bytesOf(answeringNonce),
    bytesOf(answering),
  )
  const digest = new Uint8Array(await subtle().digest('SHA-256', said))
  let number = 0
  for (const one of digest.slice(0, 6)) number = (number * 256 + one) % 1_000_000
  const six = String(number).padStart(6, '0')
  return `${six.slice(0, 3)} ${six.slice(3)}`
}
