import type { Stretcher } from '@orden/pass/crypto'
import { stretch, useStretcher } from '@orden/pass/crypto'
import { isNative } from '../../platform/src/api'
import { nativeStretch } from './stretch'

const nativeStretcher: Stretcher = async (secret, salt, params) => {
  const asked = nativeStretch(secret, salt, params)
  if (asked) {
    try {
      return await asked
    } catch {
      useStretcher(null)
    }
  }
  useStretcher(null)
  return await stretch(secret, salt, params)
}

export function stretcherHere(): Stretcher | null {
  return isNative ? nativeStretcher : null
}

export function useNativeStretcher(): void {
  const stretcher = stretcherHere()
  if (stretcher) useStretcher(stretcher)
}
