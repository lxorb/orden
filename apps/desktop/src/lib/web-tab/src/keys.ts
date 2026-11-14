import type { PressedKey } from '@orden/contracts'
import { isRecord } from '../../platform/src/api'

export function readPressed(value: unknown): PressedKey | null {
  if (!isRecord(value)) return null

  const { key, code, ctrl, shift, alt, repeat, down } = value
  if (typeof key !== 'string' || !key || typeof code !== 'string') return null

  return {
    key,
    code,
    ctrl: ctrl === true,
    shift: shift === true,
    alt: alt === true,
    repeat: repeat === true,
    down: down === true,
  }
}
