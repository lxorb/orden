import { describe, expect, test } from 'vitest'
import { commitment, digits as pairing, newNonce } from '../../pairing'

/** The vault's six digits, as vault.svelte.ts asks for them. */
const digits = (...parts: [string, string, string, string]) =>
  pairing('nib ai vault digits', ...parts)
import {
  authOf,
  fingerprint,
  idOf,
  newDeviceKey,
  newVaultKey,
  open,
  seal,
  unwrap,
  wrap,
} from './crypto'

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
    const asking = await newDeviceKey()
    const answering = await newDeviceKey()
    expect(asking.id).toMatch(/^[a-f0-9]{32}$/)
    expect(await idOf(asking.pub)).toBe(asking.id)
    const [mine, theirs] = [newNonce(), newNonce()]
    const shown = await digits(asking.pub, mine, theirs, answering.pub)
    expect(shown).toMatch(/^\d{3} \d{3}$/)
    expect(await digits(asking.pub, mine, theirs, answering.pub)).toBe(shown)
  })

  /** What makes the digits worth comparing: they turn on a nonce the answering device
   *  picks only after the asking one is bound to its key, so a key cannot be ground
   *  beforehand to show the digits somebody else's would. */
  test('the digits turn on every part, and a key is bound before the answer is picked', async () => {
    const asking = await newDeviceKey()
    const swapped = await newDeviceKey()
    const answering = await newDeviceKey()
    const mine = newNonce()
    const bound = await commitment(asking.pub, mine)
    expect(await commitment(asking.pub, mine)).toBe(bound)
    expect(await commitment(swapped.pub, mine)).not.toBe(bound)
    expect(await commitment(asking.pub, newNonce())).not.toBe(bound)

    // The same key under two answers shows two different codes: nothing computed before
    // the answer says what the digits will be.
    const codes = new Set<string>()
    for (let tries = 0; tries < 20; tries++) {
      codes.add(await digits(asking.pub, mine, newNonce(), answering.pub))
    }
    expect(codes.size).toBeGreaterThan(15)

    const theirs = newNonce()
    const shown = await digits(asking.pub, mine, theirs, answering.pub)
    expect(await digits(swapped.pub, mine, theirs, answering.pub)).not.toBe(shown)
    expect(await digits(asking.pub, newNonce(), theirs, answering.pub)).not.toBe(shown)
    expect(await digits(asking.pub, mine, theirs, swapped.pub)).not.toBe(shown)
  })

  test('the token the account asks for is the vault key’s, and says nothing of it', async () => {
    const key = newVaultKey()
    const token = await authOf(key)
    expect(await authOf(key)).toBe(token)
    expect(await authOf(newVaultKey())).not.toBe(token)
    expect(atob(token)).not.toContain(String.fromCharCode(...key))
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
