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

export async function opens(commitment: string, pub: string, nonce: string): Promise<boolean> {
  const committed = bytesOf(commitment)
  const key = bytesOf(pub)
  const once = bytesOf(nonce)
  if (!committed || !key || !once) return false
  return hexOf(await digest(key, once)) === hexOf(committed)
}
