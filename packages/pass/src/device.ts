import { base64, joined, randomBytes, unbase64 } from './bytes'
import type { KdfParams } from './crypto'
import { open, PIN_KDF, seal, stretch, subkey, WrongSecret } from './crypto'

export interface DeviceSeal {
  way: 'device' | 'pin'
  salt: string | null
  sealed: string
  tries: number
}

const SALT = 16

export function pinIn(text: string): string | null {
  const pin = text.trim()
  return /^[0-9]{4,12}$/.test(pin) ? pin : null
}

async function deviceKey(
  deviceSecret: Uint8Array<ArrayBuffer>,
  pin: { pin: string; salt: Uint8Array<ArrayBuffer>; params: KdfParams } | null,
): Promise<Uint8Array<ArrayBuffer>> {
  const stretched = pin === null ? new Uint8Array(0) : await stretch(pin.pin, pin.salt, pin.params)
  return await subkey(joined(deviceSecret, stretched), 'orden pass device')
}

export async function sealForDevice(
  root: Uint8Array<ArrayBuffer>,
  deviceSecret: Uint8Array<ArrayBuffer>,
  pin?: string,
  params: KdfParams = PIN_KDF,
): Promise<DeviceSeal> {
  if (pin === undefined) {
    const key = await deviceKey(deviceSecret, null)
    return { way: 'device', salt: null, sealed: await seal(key, root, 'local', 'device'), tries: 0 }
  }
  const checked = pinIn(pin)
  if (checked === null) throw new Error('pass: a PIN is 4 to 12 digits')
  const salt = randomBytes(SALT)
  const key = await deviceKey(deviceSecret, { pin: checked, salt, params })
  return { way: 'pin', salt: base64(salt), sealed: await seal(key, root, 'local', 'pin'), tries: 0 }
}

function saltOf(text: string | null): Uint8Array<ArrayBuffer> {
  if (text === null) throw new WrongSecret()
  try {
    return unbase64(text)
  } catch {
    throw new WrongSecret()
  }
}

export async function openForDevice(
  deviceSeal: DeviceSeal,
  deviceSecret: Uint8Array<ArrayBuffer>,
  pin?: string,
  params: KdfParams = PIN_KDF,
): Promise<Uint8Array<ArrayBuffer>> {
  if (deviceSeal.way === 'device')
    return await open(await deviceKey(deviceSecret, null), deviceSeal.sealed, 'local', 'device')
  const checked = pin === undefined ? null : pinIn(pin)
  if (checked === null) throw new WrongSecret()
  const key = await deviceKey(deviceSecret, { pin: checked, salt: saltOf(deviceSeal.salt), params })
  return await open(key, deviceSeal.sealed, 'local', 'pin')
}
