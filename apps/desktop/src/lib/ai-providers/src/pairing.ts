import { base64, unbase64, joined } from '@orden/pass/bytes'

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

export function newNonce(): string {
  return base64(globalThis.crypto.getRandomValues(new Uint8Array(32)))
}

export async function commitment(pub: string, nonce: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', joined(unbase64(pub), unbase64(nonce)))
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
    unbase64(asking),
    unbase64(askingNonce),
    unbase64(answeringNonce),
    unbase64(answering),
  )
  const digest = new Uint8Array(await subtle().digest('SHA-256', said))
  let number = 0
  for (const one of digest.slice(0, 6)) number = (number * 256 + one) % 1_000_000
  const six = String(number).padStart(6, '0')
  return `${six.slice(0, 3)} ${six.slice(3)}`
}
