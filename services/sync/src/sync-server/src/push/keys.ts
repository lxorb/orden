const encoder = new TextEncoder()

export function base64url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
  const padded = plain + '='.repeat((4 - (plain.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  return bytes
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export async function signedToken(
  header: Record<string, string>,
  claims: Record<string, string | number>,
  key: CryptoKey,
): Promise<string> {
  const head = base64url(encoder.encode(JSON.stringify(header)))
  const body = base64url(encoder.encode(JSON.stringify(claims)))
  const algorithm =
    key.algorithm.name === 'ECDSA'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: key.algorithm.name }
  const signature = await crypto.subtle.sign(algorithm, key, encoder.encode(`${head}.${body}`))
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`
}

export function p256(publicRaw: Uint8Array, privateRaw: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64url(publicRaw.slice(1, 33)),
    y: base64url(publicRaw.slice(33, 65)),
    d: base64url(privateRaw),
    ext: true,
  }
}

function pemBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\\n/g, '')
  return fromBase64url(body.replace(/\+/g, '-').replace(/\//g, '_'))
}

export function pemKey(pem: string, kind: 'rsa' | 'ec'): Promise<CryptoKey> {
  const algorithm =
    kind === 'rsa'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' }
  return crypto.subtle.importKey('pkcs8', pemBytes(pem), algorithm, false, ['sign'])
}
