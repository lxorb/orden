import { base64, unbase64, utf8 } from './bytes'

export { isSignature, isSignPub } from './shape'

export interface Signer {
  pub: string
  priv: JsonWebKey
}

const CURVE = { name: 'ECDSA', namedCurve: 'P-256' } as const
const HASHED = { name: 'ECDSA', hash: 'SHA-256' } as const
const POINT = 65
const SIGNATURE = 64

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

export async function newSigner(): Promise<Signer> {
  const pair = await subtle().generateKey(CURVE, true, ['sign', 'verify'])
  return {
    pub: base64(new Uint8Array(await subtle().exportKey('raw', pair.publicKey))),
    priv: await subtle().exportKey('jwk', pair.privateKey),
  }
}

export function statementOf(kind: string, ...parts: string[]): Uint8Array<ArrayBuffer> {
  if ([kind, ...parts].some((one) => one.includes('\n'))) {
    throw new Error('pass: a statement holds a newline')
  }
  return utf8(`orden pass sign\n${kind}\n${parts.join('\n')}`)
}

export async function signatureOf(
  signer: Signer,
  statement: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const key = await subtle().importKey('jwk', signer.priv, CURVE, false, ['sign'])
  return base64(new Uint8Array(await subtle().sign(HASHED, key, statement)))
}

function bytesOf(text: string, length: number): Uint8Array<ArrayBuffer> | null {
  try {
    const bytes = unbase64(text)
    return bytes.length === length ? bytes : null
  } catch {
    return null
  }
}

export async function isSignedBy(
  pub: string,
  statement: Uint8Array<ArrayBuffer>,
  signature: string,
): Promise<boolean> {
  const point = bytesOf(pub, POINT)
  const signed = bytesOf(signature, SIGNATURE)
  if (point === null || signed === null) return false
  try {
    const key = await subtle().importKey('raw', point, CURVE, false, ['verify'])
    return await subtle().verify(HASHED, key, signed, statement)
  } catch {
    return false
  }
}

export async function digestOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return base64(new Uint8Array(await subtle().digest('SHA-256', bytes)))
}
