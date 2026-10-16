import { describe, expect, test } from 'vitest'
import { digits, fingerprint, newDeviceKey, newVaultKey, open, seal, unwrap, wrap } from './crypto'

describe('the vault’s keys', () => {
  test('a key wrapped to a device opens on that device and no other', async () => {
    const laptop = await newDeviceKey()
    const phone = await newDeviceKey()
    const key = newVaultKey()
    const wrapped = await wrap(key, phone.pub)
    expect(await unwrap(wrapped, phone)).toEqual(key)
    await expect(unwrap(wrapped, laptop)).rejects.toThrow()
  })

  test('a device is filed under its public key, and both screens show the same six digits', async () => {
    const device = await newDeviceKey()
    expect(device.id).toMatch(/^[a-f0-9]{32}$/)
    const shown = await digits(device.pub)
    expect(shown).toMatch(/^\d{3} \d{3}$/)
    expect(await digits(device.pub)).toBe(shown)
    expect(await digits((await newDeviceKey()).pub)).not.toBe(shown)
  })

  test('the vault opens under its key, and not under another or with a byte changed', async () => {
    const key = newVaultKey()
    const sealed = await seal(key, '{"keys":{"anthropic":"sk-ant"}}')
    expect(sealed).not.toContain('sk-ant')
    expect(await open(key, sealed)).toBe('{"keys":{"anthropic":"sk-ant"}}')
    await expect(open(newVaultKey(), sealed)).rejects.toThrow()
    const bytes = atob(sealed)
    const changed = btoa(
      bytes.slice(0, -1) + String.fromCharCode(bytes.charCodeAt(bytes.length - 1) ^ 1),
    )
    await expect(open(key, changed)).rejects.toThrow()
  })

  test('a key’s fingerprint says whether it changed without saying the key', async () => {
    const one = await fingerprint('sk-one')
    expect(one).toBe(await fingerprint('sk-one'))
    expect(one).not.toBe(await fingerprint('sk-two'))
    expect(one).not.toContain('sk-one')
  })
})
