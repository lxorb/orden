import { describe, expect, it } from 'vitest'
import type { Totp, TotpAlgorithm } from './totp'
import { code, totpIn, totpUri } from './totp'

function base32(text: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const one of new TextEncoder().encode(text)) bits += one.toString(2).padStart(8, '0')
  let out = ''
  for (let at = 0; at < bits.length; at += 5)
    out += alphabet[parseInt(bits.slice(at, at + 5).padEnd(5, '0'), 2)] ?? ''
  return out
}

const SEEDS: Record<TotpAlgorithm, string> = {
  SHA1: '12345678901234567890',
  SHA256: '12345678901234567890123456789012',
  SHA512: '1234567890123456789012345678901234567890123456789012345678901234',
}

const VECTORS: [number, TotpAlgorithm, string][] = [
  [59, 'SHA1', '94287082'],
  [59, 'SHA256', '46119246'],
  [59, 'SHA512', '90693936'],
  [1111111109, 'SHA1', '07081804'],
  [1111111109, 'SHA256', '68084774'],
  [1111111109, 'SHA512', '25091201'],
  [1111111111, 'SHA1', '14050471'],
  [1111111111, 'SHA256', '67062674'],
  [1111111111, 'SHA512', '99943326'],
  [1234567890, 'SHA1', '89005924'],
  [1234567890, 'SHA256', '91819424'],
  [1234567890, 'SHA512', '93441116'],
  [2000000000, 'SHA1', '69279037'],
  [2000000000, 'SHA256', '90698825'],
  [2000000000, 'SHA512', '38618901'],
  [20000000000, 'SHA1', '65353130'],
  [20000000000, 'SHA256', '77737706'],
  [20000000000, 'SHA512', '47863826'],
]

describe('code', () => {
  it.each(VECTORS)('matches RFC 6238 at %i with %s', async (seconds, algorithm, expected) => {
    const totp: Totp = {
      secret: base32(SEEDS[algorithm]),
      algorithm,
      digits: 8,
      period: 30,
      issuer: '',
      label: '',
    }
    expect((await code(totp, seconds * 1000)).code).toBe(expected)
  })

  it('counts the seconds left', async () => {
    const totp = totpIn('JBSWY3DPEHPK3PXP JBSW')
    if (totp === null) throw new Error('no totp')
    expect((await code(totp, 59_000)).remaining).toBe(1)
    expect((await code(totp, 60_000)).remaining).toBe(30)
    expect((await code(totp, 75_500)).code).toMatch(/^\d{6}$/)
  })
})

describe('totpIn', () => {
  it('reads an otpauth address', () => {
    expect(
      totpIn(
        'otpauth://totp/ACME%20Co:john@example.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60',
      ),
    ).toEqual({
      secret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      issuer: 'ACME Co',
      label: 'john@example.com',
    })
  })

  it('takes the issuer from the label when the address has none, and fills defaults', () => {
    expect(totpIn('otpauth://totp/GitHub:me?secret=jbswy3dpehpk3pxp')).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      issuer: 'GitHub',
      label: 'me',
    })
    expect(totpIn('otpauth://totp/me?secret=JBSWY3DP')).toMatchObject({ issuer: '', label: 'me' })
  })

  it('reads a bare secret', () => {
    expect(totpIn(' jbsw y3dp ehpk 3pxp ')).toMatchObject({
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
      period: 30,
    })
  })

  it('refuses what it cannot use', () => {
    for (const bad of [
      'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1',
      'otpauth://totp/x',
      'otpauth://totp/x?secret=JBSW1',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=5',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=9',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=301',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
      'JBSWY3DP',
      'not a secret at all',
      '',
    ])
      expect(totpIn(bad)).toBeNull()
  })

  it('round-trips through its address', () => {
    const totp: Totp = {
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA512',
      digits: 7,
      period: 45,
      issuer: 'A:B & C',
      label: 'me@x.y',
    }
    expect(totpIn(totpUri(totp))).toEqual({ ...totp, issuer: 'A:B & C' })
    const plain = { ...totp, issuer: '' }
    expect(totpIn(totpUri(plain))).toEqual(plain)
  })
})
