import { describe, expect, it } from 'vitest'
import { newKey, WrongSecret } from './crypto'
import { openForDevice, pinIn, sealForDevice } from './device'

const SMALL = { m: 64, t: 1, p: 1 }

describe('pinIn', () => {
  it('keeps 4 to 12 digits, trimmed', () => {
    expect(pinIn(' 1234 ')).toBe('1234')
    expect(pinIn('123456789012')).toBe('123456789012')
    for (const bad of ['123', '1234567890123', '12a4', '12 34', '١٢٣٤', ''])
      expect(pinIn(bad)).toBeNull()
  })
})

describe('device seals', () => {
  it('opens with the device secret alone', async () => {
    const root = newKey()
    const secret = newKey()
    const sealed = await sealForDevice(root, secret)
    expect(sealed).toMatchObject({ way: 'device', salt: null, tries: 0 })
    expect(await openForDevice(sealed, secret)).toEqual(root)
    await expect(openForDevice(sealed, newKey())).rejects.toThrow(WrongSecret)
  })

  it('opens with the device secret and the PIN', async () => {
    const root = newKey()
    const secret = newKey()
    const sealed = await sealForDevice(root, secret, '2468', SMALL)
    expect(sealed.way).toBe('pin')
    expect(await openForDevice(sealed, secret, ' 2468', SMALL)).toEqual(root)
    await expect(openForDevice(sealed, secret, '2469', SMALL)).rejects.toThrow(WrongSecret)
    await expect(openForDevice(sealed, secret, undefined, SMALL)).rejects.toThrow(WrongSecret)
    await expect(openForDevice(sealed, secret, 'abcd', SMALL)).rejects.toThrow(WrongSecret)
    await expect(openForDevice(sealed, newKey(), '2468', SMALL)).rejects.toThrow(WrongSecret)
    await expect(
      openForDevice({ ...sealed, way: 'device' }, secret, '2468', SMALL),
    ).rejects.toThrow(WrongSecret)
    await expect(openForDevice({ ...sealed, salt: null }, secret, '2468', SMALL)).rejects.toThrow(
      WrongSecret,
    )
  })

  it('refuses to seal with a PIN that is not one', async () => {
    await expect(sealForDevice(newKey(), newKey(), '12', SMALL)).rejects.toThrow('PIN')
  })
})
