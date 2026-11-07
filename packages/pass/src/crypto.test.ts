import { argon2idAsync } from '@noble/hashes/argon2.js'
import { describe, expect, it } from 'vitest'
import { base64, unbase64, utf8 } from './bytes'
import {
  fingerprintOf,
  kdfParamsIn,
  newKey,
  newPair,
  open,
  openText,
  PASSWORD_KDF,
  PIN_KDF,
  seal,
  stretch,
  subkey,
  unwrapWith,
  useStretcher,
  WrongSecret,
  wrapTo,
} from './crypto'

const SMALL = { m: 64, t: 1, p: 1 }

function hex(bytes: Uint8Array): string {
  return [...bytes].map((one) => one.toString(16).padStart(2, '0')).join('')
}

function fromHex(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array((text.match(/../g) ?? []).map((pair) => parseInt(pair, 16)))
}

function filled(length: number, value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(value)
}

describe('argon2id', () => {
  it('matches RFC 9106 §5.3', async () => {
    const tag = await argon2idAsync(filled(32, 1), filled(16, 2), {
      m: 32,
      t: 3,
      p: 4,
      dkLen: 32,
      key: filled(8, 3),
      personalization: filled(12, 4),
    })
    expect(hex(tag)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659')
  })

  it('stretches as the reference implementation does', async () => {
    const stretched = await stretch('password', utf8('somesalt'), { m: 65536, t: 2, p: 1 })
    expect(hex(stretched)).toBe('09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7')
  }, 60_000)

  it('hands the work to a faster stretcher when one is set, with the same answer', async () => {
    const salt = utf8('somesalt')
    const slow = await stretch('pässword', salt, { m: 64, t: 1, p: 1 })
    const asked: string[] = []
    useStretcher(async (secret, given, params) => {
      asked.push(secret)
      return await argon2idAsync(utf8(secret), given, { ...params, dkLen: 32 }).then(
        (bytes) => new Uint8Array(bytes),
      )
    })
    try {
      expect(await stretch('pa\u0308ssword', salt, { m: 64, t: 1, p: 1 })).toEqual(slow)
      expect(asked).toEqual(['pässword'])
      await expect(stretch('x', salt, { m: 1, t: 1, p: 1 })).rejects.toThrow(WrongSecret)
      useStretcher(async () => new Uint8Array(16))
      await expect(stretch('x', salt, { m: 64, t: 1, p: 1 })).rejects.toThrow('wrong length')
    } finally {
      useStretcher(null)
    }
  })

  it('normalises the secret to NFC', async () => {
    const salt = utf8('saltsalt')
    expect(await stretch('é', salt, SMALL)).toEqual(await stretch('é', salt, SMALL))
  })

  it('refuses parameters out of range and short salts', async () => {
    await expect(stretch('pw', utf8('short'), SMALL)).rejects.toThrow(WrongSecret)
    await expect(stretch('pw', utf8('saltsalt'), { m: 4, t: 1, p: 1 })).rejects.toThrow(WrongSecret)
    await expect(stretch('pw', utf8('saltsalt'), { m: 64, t: 11, p: 1 })).rejects.toThrow(
      WrongSecret,
    )
  })
})

describe('kdfParamsIn', () => {
  it('keeps what is in range', () => {
    expect(kdfParamsIn(PASSWORD_KDF)).toEqual(PASSWORD_KDF)
    expect(kdfParamsIn(PIN_KDF)).toEqual(PIN_KDF)
    expect(kdfParamsIn({ m: 8, t: 1, p: 1, extra: 1 })).toEqual({ m: 8, t: 1, p: 1 })
    expect(kdfParamsIn({ m: 262144, t: 10, p: 4 })).toEqual({ m: 262144, t: 10, p: 4 })
  })

  it('refuses what is not', () => {
    for (const bad of [
      null,
      'x',
      { m: 7, t: 1, p: 1 },
      { m: 262145, t: 1, p: 1 },
      { m: 1048576, t: 1, p: 1 },
      { m: 16, t: 1, p: 4 },
      { m: 64, t: 0, p: 1 },
      { m: 64, t: 11, p: 1 },
      { m: 64, t: 1, p: 0 },
      { m: 64, t: 1, p: 5 },
      { m: 64.5, t: 1, p: 1 },
      { m: '64', t: 1, p: 1 },
      { t: 1, p: 1 },
    ])
      expect(kdfParamsIn(bad)).toBeNull()
  })
})

describe('subkey', () => {
  it('matches RFC 5869 test case 1', async () => {
    const okm = await subkey(
      filled(22, 0x0b),
      fromHex('f0f1f2f3f4f5f6f7f8f9'),
      fromHex('000102030405060708090a0b0c'),
    )
    expect(hex(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf')
  })

  it('matches RFC 5869 test case 3', async () => {
    const okm = await subkey(filled(22, 0x0b), '')
    expect(hex(okm)).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d')
  })
})

describe('seal and open', () => {
  it('round-trips bytes and text', async () => {
    const key = newKey()
    const sealed = await seal(key, 'grüße', 'item', 'v1', 'i1')
    expect(await openText(key, sealed, 'item', 'v1', 'i1')).toBe('grüße')
    const bytes = new Uint8Array([0, 1, 2, 255])
    expect(await open(key, await seal(key, bytes, 'file'), 'file')).toEqual(bytes)
  })

  it('seals the same text differently each time', async () => {
    const key = newKey()
    expect(await seal(key, 'x', 'item')).not.toBe(await seal(key, 'x', 'item'))
  })

  it('refuses another key, label or context', async () => {
    const key = newKey()
    const sealed = await seal(key, 'secret', 'item', 'v1', 'i1')
    await expect(open(newKey(), sealed, 'item', 'v1', 'i1')).rejects.toThrow(WrongSecret)
    await expect(open(key, sealed, 'vault', 'v1', 'i1')).rejects.toThrow(WrongSecret)
    await expect(open(key, sealed, 'item', 'v1', 'i2')).rejects.toThrow(WrongSecret)
    await expect(open(key, sealed, 'item', 'v1')).rejects.toThrow(WrongSecret)
    await expect(open(key, sealed, 'item', 'v1\ni1')).rejects.toThrow(Error)
  })

  it('refuses a tampered, short or broken seal', async () => {
    const key = newKey()
    const bytes = unbase64(await seal(key, 'secret', 'item'))
    for (const at of [0, 12, bytes.length - 1]) {
      const changed = bytes.slice()
      changed[at] = (changed[at] ?? 0) ^ 1
      await expect(open(key, base64(changed), 'item')).rejects.toThrow(WrongSecret)
    }
    await expect(open(key, base64(bytes.slice(0, 27)), 'item')).rejects.toThrow(WrongSecret)
    await expect(open(key, 'not base64!', 'item')).rejects.toThrow(WrongSecret)
    await expect(open(key, '', 'item')).rejects.toThrow(WrongSecret)
  })

  it('refuses a key that is not 32 bytes and a context with a newline', async () => {
    await expect(seal(new Uint8Array(16), 'x', 'item')).rejects.toThrow('32 bytes')
    await expect(seal(newKey(), 'x', 'item', 'a\nb')).rejects.toThrow('newline')
  })

  it('reports text that is not utf8 as a wrong secret', async () => {
    const key = newKey()
    const sealed = await seal(key, new Uint8Array([0xff]), 'item')
    await expect(openText(key, sealed, 'item')).rejects.toThrow(WrongSecret)
  })
})

describe('wrapTo and unwrapWith', () => {
  it('round-trips to the pair it was wrapped to', async () => {
    const pair = await newPair()
    const key = newKey()
    const wrapped = await wrapTo(key, pair.pub, 'vault-key', 'v1')
    expect(await unwrapWith(wrapped, pair, 'vault-key', 'v1')).toEqual(key)
    expect(unbase64(wrapped)).toHaveLength(65 + 12 + 32 + 16)
  })

  it('refuses another pair, label, context or a tampered wrap', async () => {
    const pair = await newPair()
    const wrapped = await wrapTo(newKey(), pair.pub, 'vault-key', 'v1')
    await expect(unwrapWith(wrapped, await newPair(), 'vault-key', 'v1')).rejects.toThrow(
      WrongSecret,
    )
    await expect(unwrapWith(wrapped, pair, 'item-key', 'v1')).rejects.toThrow(WrongSecret)
    await expect(unwrapWith(wrapped, pair, 'vault-key', 'v2')).rejects.toThrow(WrongSecret)
    const bytes = unbase64(wrapped)
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1
    await expect(unwrapWith(base64(bytes), pair, 'vault-key', 'v1')).rejects.toThrow(WrongSecret)
    await expect(unwrapWith('AAAA', pair, 'vault-key', 'v1')).rejects.toThrow(WrongSecret)
  })
})

describe('fingerprintOf', () => {
  it('shows eight groups of four hex digits, the same for the same key', async () => {
    const pair = await newPair()
    const print = await fingerprintOf(pair.pub)
    expect(print).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){7}$/)
    expect(await fingerprintOf(pair.pub)).toBe(print)
    expect(await fingerprintOf((await newPair()).pub)).not.toBe(print)
  })
})
