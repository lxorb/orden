/** The account's half of letting a device in by six digits, the one way the AI vault
 *  (ai/vault.ts) checks it: the asking device committed to
 *  its key and a nonce before anybody answered, and what it reveals has to be what it
 *  committed to. The devices' half, and why the steps are what they are, is
 *  apps/desktop/src/lib/pairing.ts. */

/** Bytes out of base64, or null for text that is not. */
export function bytesOf(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const raw = atob(text)
    const bytes = new Uint8Array(raw.length)
    for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at)
    return bytes
  } catch {
    return null
  }
}

/** SHA-256 over the parts, one after another. */
export async function digest(...parts: Uint8Array<ArrayBuffer>[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    all.set(one, at)
    at += one.length
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all))
}

export function hexOf(bytes: Uint8Array, length = bytes.length): string {
  return [...bytes.slice(0, length)].map((one) => one.toString(16).padStart(2, '0')).join('')
}

/** Whether a key and nonce, as revealed, are what a device committed to. */
export async function opens(commitment: string, pub: string, nonce: string): Promise<boolean> {
  const committed = bytesOf(commitment)
  const key = bytesOf(pub)
  const once = bytesOf(nonce)
  if (!committed || !key || !once) return false
  return hexOf(await digest(key, once)) === hexOf(committed)
}
