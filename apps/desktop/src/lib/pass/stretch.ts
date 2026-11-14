import { invoke, isNative } from '../platform/src/api'

export interface StretchParams {
  m: number
  t: number
  p: number
}

function base64(bytes: Uint8Array): string {
  let said = ''
  for (const one of bytes) said += String.fromCharCode(one)
  return btoa(said)
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const said = atob(text)
  const bytes = new Uint8Array(said.length)
  for (let at = 0; at < said.length; at++) bytes[at] = said.charCodeAt(at)
  return bytes
}

export function nativeStretch(
  secret: string,
  salt: Uint8Array,
  params: StretchParams,
): Promise<Uint8Array<ArrayBuffer>> | null {
  if (!isNative) return null
  return invoke<string>('pass_stretch', {
    secret: secret.normalize('NFC'),
    salt: base64(salt),
    m: params.m,
    t: params.t,
    p: params.p,
  }).then(bytesOf)
}
