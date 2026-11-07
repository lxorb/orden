import { describe, expect, it } from 'vitest'
import { totpOf } from './build'
import { parseSafari } from './safari'

const OTP = 'otpauth://totp/Example:me?secret=JBSWY3DPEHPK3PXP&issuer=Example'

describe('parseSafari', () => {
  it('reads Safari and Apple Passwords exports with 2FA', () => {
    const csv =
      'Title,URL,Username,Password,Notes,OTPAuth\n' +
      `example.com (me@example.com),https://example.com/,me@example.com,pw,"a\nb",${OTP}\n` +
      'Ünïcode,https://ü.example,ü,pw2,,\n' +
      'broken,https://x.com,,pw3,,not a secret!\n'
    const items = parseSafari(csv).vaults[0]?.items ?? []
    expect(items).toHaveLength(3)
    expect(items[0]?.content).toMatchObject({
      title: 'example.com (me@example.com)',
      email: 'me@example.com',
      note: 'a\nb',
      totp: totpOf(OTP),
    })
    expect(
      items[0]?.content.kind === 'login' && items[0].content.totp.startsWith('otpauth://'),
    ).toBe(true)
    expect(items[1]?.content).toMatchObject({ title: 'Ünïcode', username: 'ü' })
    expect(items[2]?.content).toMatchObject({ totp: 'not a secret!' })
  })
})
