import { describe, expect, it } from 'vitest'
import { newKey, newPair, seal, WrongSecret } from './crypto'
import { blank, newEnvelope } from './envelope'
import { KdfTooCostly } from './kdf'
import {
  changePassword,
  isOldPasswordSeal,
  keyringIn,
  newKeyring,
  newRecovery,
  openedWith,
  openItem,
  openVault,
  openVersion,
  openWithPassword,
  openWithRecovery,
  recoveryCode,
  recoveryKey,
  sealedRevOf,
  sealItem,
  sealVault,
  sealVersion,
  unwrapVaultKey,
  withSigner,
  wrapVaultKey,
} from './keys'
import { isSignedBy, signatureOf, statementOf } from './sign'
import type { VaultMeta } from './types'

const AT = { keyVersion: 1, rev: 1 }

const SMALL = { m: 64, t: 1, p: 1 }

describe('recovery codes', () => {
  it('round-trips in upper case groups of four', async () => {
    const bytes = newKey()
    const code = await recoveryCode(bytes)
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{1,4})+$/)
    expect(code.replace(/-/g, '')).toHaveLength(55)
    expect(await recoveryKey(code)).toEqual(bytes)
  })

  it('forgives case, spaces and look-alike letters', async () => {
    const bytes = newKey()
    const code = await recoveryCode(bytes)
    const typed = ` ${code.toLowerCase().replace(/-/g, ' ').replace(/1/g, 'l').replace(/0/g, 'o')} `
    expect(await recoveryKey(typed)).toEqual(bytes)
    expect(await recoveryKey(code.replace(/1/g, 'I'))).toEqual(bytes)
  })

  it('refuses a mistyped code', async () => {
    const code = await recoveryCode(newKey())
    const letters = code.replace(/-/g, '')
    const first = letters.startsWith('A') ? 'B' : 'A'
    expect(await recoveryKey(first + letters.slice(1))).toBeNull()
    expect(await recoveryKey(letters.slice(0, -1))).toBeNull()
    expect(await recoveryKey(letters + 'A')).toBeNull()
    expect(await recoveryKey(letters.slice(0, -1) + 'U')).toBeNull()
    expect(await recoveryKey('')).toBeNull()
  })

  it('refuses padding bits that are not zero', async () => {
    const letters = (await recoveryCode(newKey())).replace(/-/g, '')
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    const last = alphabet.indexOf(letters.at(-1) ?? '0')
    const changed = letters.slice(0, -1) + (alphabet[last ^ 1] ?? '')
    expect(await recoveryKey(changed)).toBeNull()
  })
})

describe('keyring', () => {
  it('opens with the password and the recovery code', async () => {
    const { keyring, opened, recovery } = await newKeyring('correct horse', SMALL)
    const byPassword = await openWithPassword(keyring, 'correct horse')
    expect(byPassword.root).toEqual(opened.root)
    expect(byPassword.pair).toEqual(opened.pair)
    expect((await openWithRecovery(keyring, recovery)).root).toEqual(opened.root)
    expect(keyring).toMatchObject({ v: 1, pub: opened.pair.pub, password: SMALL })
    expect(keyringIn(JSON.parse(JSON.stringify(keyring)))).toEqual(keyring)
  })

  it('refuses a wrong password or recovery code', async () => {
    const { keyring } = await newKeyring('correct horse', SMALL)
    await expect(openWithPassword(keyring, 'wrong horse')).rejects.toThrow(WrongSecret)
    await expect(openWithRecovery(keyring, await recoveryCode(newKey()))).rejects.toThrow(
      WrongSecret,
    )
    await expect(openWithRecovery(keyring, 'nonsense')).rejects.toThrow(WrongSecret)
    await expect(openWithRecovery({ ...keyring, recovery: null }, 'x')).rejects.toThrow(WrongSecret)
  })

  it('refuses parameters out of range as a wrong secret', async () => {
    const { keyring } = await newKeyring('pw', SMALL)
    const bad = { ...keyring, password: { ...keyring.password, m: 4 } }
    await expect(openWithPassword(bad, 'pw')).rejects.toThrow(WrongSecret)
  })

  it('changes the password', async () => {
    const { keyring, opened, recovery } = await newKeyring('old', SMALL)
    const changed = await changePassword(keyring, opened, 'new', SMALL)
    expect((await openWithPassword(changed, 'new')).root).toEqual(opened.root)
    await expect(openWithPassword(changed, 'old')).rejects.toThrow(WrongSecret)
    expect((await openWithRecovery(changed, recovery)).root).toEqual(opened.root)
  })

  it('makes a new recovery code that replaces the old one', async () => {
    const { keyring, opened, recovery } = await newKeyring('pw', SMALL)
    const renewed = await newRecovery(keyring, opened)
    expect(renewed.recovery).not.toBe(recovery)
    expect((await openWithRecovery(renewed.keyring, renewed.recovery)).root).toEqual(opened.root)
    await expect(openWithRecovery(renewed.keyring, recovery)).rejects.toThrow(WrongSecret)
    expect((await openWithPassword(renewed.keyring, 'pw')).root).toEqual(opened.root)
  })

  it('refuses a malformed keyring', async () => {
    const { keyring } = await newKeyring('pw', SMALL)
    for (const bad of [
      null,
      [],
      { ...keyring, v: 2 },
      { ...keyring, pub: 1 },
      { ...keyring, pub: 'not base64!' },
      { ...keyring, recovery: 5 },
      { ...keyring, at: 'now' },
      { ...keyring, password: { ...keyring.password, m: 2 ** 23 } },
      { ...keyring, password: { ...keyring.password, at: 'now' } },
      { ...keyring, sign: { pub: 'AAAA', private: keyring.sign?.private } },
      { ...keyring, password: { ...keyring.password, t: 0 } },
      { ...keyring, password: { ...keyring.password, p: 9 } },
      { ...keyring, password: { ...keyring.password, salt: 'AAAA' } },
      { ...keyring, password: { ...keyring.password, sealed: undefined } },
    ])
      expect(keyringIn(bad)).toBeNull()
    expect(keyringIn({ ...keyring, recovery: null })).toMatchObject({ recovery: null })
  })

  it('holds a signing pair, its private half sealed under the root key', async () => {
    const { keyring, opened } = await newKeyring('pw', SMALL)
    expect(opened.signer?.pub).toBe(keyring.sign?.pub)
    const again = await openWithPassword(keyring, 'pw')
    const said = statementOf('test', 'one')
    expect(await isSignedBy(keyring.sign!.pub, said, await signatureOf(again.signer!, said))).toBe(
      true,
    )
    const swapped = {
      ...keyring,
      sign: { ...keyring.sign!, pub: (await newKeyring('x', SMALL)).keyring.sign!.pub },
    }
    await expect(openWithPassword(swapped, 'pw')).rejects.toThrow(WrongSecret)
  })

  it('gives an older keyring without a signing pair one, keeping everything else', async () => {
    const { keyring, opened } = await newKeyring('pw', SMALL)
    const older = { ...keyring }
    delete older.sign
    const read = keyringIn(JSON.parse(JSON.stringify(older)))!
    expect(read.sign).toBeUndefined()
    const plain = await openWithPassword(read, 'pw')
    expect(plain.signer).toBeNull()
    const made = await withSigner(read, plain)
    expect(made.opened.signer).not.toBeNull()
    expect(made.keyring.at).toBeGreaterThan(read.at)
    expect((await openedWith(made.keyring, opened.root)).signer?.pub).toBe(made.keyring.sign?.pub)
    expect(await withSigner(made.keyring, made.opened)).toEqual(made)
  })

  it('binds the password seal to the keyring’s public key, and still opens an older seal', async () => {
    const { keyring, opened } = await newKeyring('pw', SMALL)
    expect(isOldPasswordSeal(keyring)).toBe(false)
    const other = await newKeyring('pw', SMALL)
    const mixed = { ...other.keyring, password: keyring.password }
    await expect(openWithPassword(mixed, 'pw')).rejects.toThrow(WrongSecret)
    const moved = { ...keyring, password: { ...keyring.password, at: keyring.password.at! + 1 } }
    await expect(openWithPassword(moved, 'pw')).rejects.toThrow(WrongSecret)

    const old = await legacyPasswordSeal(opened.root, 'pw')
    const older = { ...keyring, password: old }
    expect(isOldPasswordSeal(older)).toBe(true)
    expect((await openWithPassword(older, 'pw')).root).toEqual(opened.root)
    const upgraded = await changePassword(older, opened, 'pw', SMALL)
    expect(isOldPasswordSeal(upgraded)).toBe(false)
    expect((await openWithPassword(upgraded, 'pw')).root).toEqual(opened.root)
  })

  it('refuses to stretch a password with more memory or passes than Pass allows', async () => {
    const { keyring } = await newKeyring('pw', SMALL)
    for (const costly of [{ m: 262145 }, { m: 1048576 }, { t: 11 }]) {
      const asked = { ...keyring, password: { ...keyring.password, ...costly } }
      expect(keyringIn(JSON.parse(JSON.stringify(asked)))).not.toBeNull()
      await expect(openWithPassword(asked, 'pw')).rejects.toThrow(KdfTooCostly)
    }
  })
})

async function legacyPasswordSeal(root: Uint8Array<ArrayBuffer>, password: string) {
  const { stretch, subkey } = await import('./crypto')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await subkey(await stretch(password, salt, SMALL), 'orden pass password')
  const { base64 } = await import('./bytes')
  return { salt: base64(salt), ...SMALL, sealed: await seal(key, root, 'root', 'password') }
}

describe('vaults and items', () => {
  const meta: VaultMeta = {
    v: 1,
    name: 'Home',
    description: '',
    color: 'teal',
    icon: 'key',
    folders: [],
    hidePasswordsFromViewers: false,
  }

  it('seals and opens a vault and its key', async () => {
    const pair = await newPair()
    const vaultKey = newKey()
    const wrapped = await wrapVaultKey(vaultKey, pair.pub, 'v1')
    expect(await unwrapVaultKey(wrapped, pair, 'v1')).toEqual(vaultKey)
    await expect(unwrapVaultKey(wrapped, pair, 'v2')).rejects.toThrow(WrongSecret)
    await expect(unwrapVaultKey(wrapped, await newPair(), 'v1')).rejects.toThrow(WrongSecret)
    const sealed = await sealVault(vaultKey, 'v1', meta)
    expect(await openVault(vaultKey, 'v1', sealed)).toEqual(meta)
    await expect(openVault(vaultKey, 'v2', sealed)).rejects.toThrow(WrongSecret)
  })

  it('seals and opens an item', async () => {
    const vaultKey = newKey()
    const envelope = newEnvelope({ ...blank('login'), title: 'Bank', password: 'p' }, 7)
    const { key, body, itemKey } = await sealItem(vaultKey, 'v1', 'i1', envelope, AT)
    const opened = await openItem(vaultKey, 'v1', 'i1', key, body, 1)
    expect(opened.envelope).toEqual(envelope)
    expect(opened.itemKey).toEqual(itemKey)
    expect(opened.rev).toBe(1)
    const again = await sealItem(vaultKey, 'v1', 'i1', envelope, AT, itemKey)
    expect((await openItem(vaultKey, 'v1', 'i1', again.key, again.body, 1)).itemKey).toEqual(
      itemKey,
    )
  })

  it('binds an item to its key version and its sealed revision, which anybody can read', async () => {
    const vaultKey = newKey()
    const envelope = newEnvelope(blank('note'), 1)
    const sealed = await sealItem(vaultKey, 'v1', 'i1', envelope, { keyVersion: 3, rev: 7 })
    expect(sealedRevOf(sealed.body)).toBe(7)
    expect((await openItem(vaultKey, 'v1', 'i1', sealed.key, sealed.body, 3)).rev).toBe(7)
    await expect(openItem(vaultKey, 'v1', 'i1', sealed.key, sealed.body, 2)).rejects.toThrow(
      WrongSecret,
    )
    const bytes = Uint8Array.from(atob(sealed.body), (one) => one.charCodeAt(0))
    bytes[7] = 9
    const bumped = btoa(String.fromCharCode(...bytes))
    expect(sealedRevOf(bumped)).toBe(9)
    await expect(openItem(vaultKey, 'v1', 'i1', sealed.key, bumped, 3)).rejects.toThrow(WrongSecret)
  })

  it('still opens an item sealed before it carried its revision', async () => {
    const vaultKey = newKey()
    const itemKey = newKey()
    const envelope = newEnvelope(blank('note'), 1)
    const key = await seal(vaultKey, itemKey, 'item-key', 'v1', 'i1')
    const body = await seal(itemKey, JSON.stringify(envelope), 'item', 'v1', 'i1')
    expect(sealedRevOf(body)).toBeNull()
    const opened = await openItem(vaultKey, 'v1', 'i1', key, body, 4)
    expect(opened).toMatchObject({ envelope, rev: null })
  })

  it('seals an older version apart from the item, under its revision', async () => {
    const vaultKey = newKey()
    const envelope = newEnvelope({ ...blank('login'), title: 'Old' }, 1)
    const item = await sealItem(vaultKey, 'v1', 'i1', envelope, AT)
    const version = await sealVersion(vaultKey, 'v1', 'i1', 4, envelope, item.itemKey)
    expect(
      (await openVersion(vaultKey, 'v1', 'i1', 4, version.key, version.body)).envelope,
    ).toEqual(envelope)
    await expect(openVersion(vaultKey, 'v1', 'i1', 5, version.key, version.body)).rejects.toThrow(
      WrongSecret,
    )
    await expect(openItem(vaultKey, 'v1', 'i1', version.key, version.body, 1)).rejects.toThrow(
      WrongSecret,
    )
    await expect(openVersion(vaultKey, 'v1', 'i1', 1, item.key, item.body)).rejects.toThrow(
      WrongSecret,
    )
    const legacy = await seal(item.itemKey, JSON.stringify(envelope), 'item', 'v1', 'i1')
    expect((await openVersion(vaultKey, 'v1', 'i1', 2, item.key, legacy)).envelope).toEqual(
      envelope,
    )
  })

  it('refuses an item moved to another id or vault, or given another key', async () => {
    const vaultKey = newKey()
    const envelope = newEnvelope(blank('note'), 1)
    const one = await sealItem(vaultKey, 'v1', 'i1', envelope, AT)
    const two = await sealItem(vaultKey, 'v1', 'i2', envelope, AT)
    for (const [vault, id, key, body, key2] of [
      ['v1', 'i2', one.key, one.body, vaultKey],
      ['v2', 'i1', one.key, one.body, vaultKey],
      ['v1', 'i1', one.key, one.body, newKey()],
      ['v1', 'i1', two.key, one.body, vaultKey],
      ['v1', 'i1', one.key, two.body, vaultKey],
    ] as const)
      await expect(openItem(key2, vault, id, key, body, 1)).rejects.toThrow(WrongSecret)
  })

  it('reports a genuine item of the wrong shape as unreadable', async () => {
    const vaultKey = newKey()
    const itemKey = newKey()
    const key = await seal(vaultKey, itemKey, 'item-key', 'v1', 'i1')
    for (const text of ['{"content":{"kind":"note","title":1}}', 'not json']) {
      const body = await seal(itemKey, text, 'item', 'v1', 'i1')
      await expect(openItem(vaultKey, 'v1', 'i1', key, body, 1)).rejects.toThrow(
        'pass: unreadable item',
      )
    }
  })
})
