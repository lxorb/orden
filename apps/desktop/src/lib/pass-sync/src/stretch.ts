import { base64, unbase64 } from '@orden/pass/bytes'
import { invoke, isNative } from '../../platform/src/api'

export interface StretchParams {
  m: number
  t: number
  p: number
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
  }).then(unbase64)
}
