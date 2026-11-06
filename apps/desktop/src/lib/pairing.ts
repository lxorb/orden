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

export function newNonce(): string {
  return base64(globalThis.crypto.getRandomValues(new Uint8Array(32)))
}

export async function commitment(pub: string, nonce: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', joined(bytesOf(pub), bytesOf(nonce)))
  return base64(new Uint8Array(digest))
}

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
