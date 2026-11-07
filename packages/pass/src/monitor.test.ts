import { describe, expect, it } from 'vitest'
import { blank, newEnvelope } from './envelope'
import { fieldOf, loginOf, noteOf } from './import/build'
import type { LoginParts } from './import/build'
import { FLAGS, activeLogins, flagsOf, isLoginItem, report, watchedLogins } from './monitor'
import { strengthOf } from './strength'
import { TWO_FACTOR_SITES, offersTwoFactor } from './two-factor'
import type { Content, Item, Passkey } from './types'

const STRONG = 'vH7#qL2!xR9$mW4&zT6^pK3'
const TOTP = 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

function item(id: string, content: Content, extra: Partial<Item> = {}): Item {
  return { ...newEnvelope(content, 1), id, vault: 'v', rev: 1, ...extra }
}

function login(id: string, parts: LoginParts, extra: Partial<Item> = {}): Item {
  return item(id, loginOf({ title: id, ...parts }), extra)
}

const passkey: Passkey = {
  id: 'p',
  rpId: 'github.com',
  rpName: 'GitHub',
  userName: 'me',
  userDisplayName: 'me',
  userHandle: 'aGFuZGxl',
  credentialId: 'Y3JlZA',
  privateKey: 'a2V5',
  algorithm: -7,
  counter: 0,
  created: 1,
  note: '',
}

describe('the 2FA list', () => {
  it('knows the big sites and reads case-blind', () => {
    expect(TWO_FACTOR_SITES.size).toBeGreaterThan(1000)
    expect(offersTwoFactor('github.com')).toBe(true)
    expect(offersTwoFactor(' GitHub.com ')).toBe(true)
    expect(offersTwoFactor('example.org')).toBe(false)
  })
})

describe('report', () => {
  it('starts from a strong password', () => {
    expect(strengthOf(STRONG).strength).toBe('strong')
    expect(strengthOf('password').strength).not.toBe('strong')
  })

  it('finds weak passwords but not empty ones', () => {
    const r = report([
      login('weak', { password: 'password' }),
      login('strong', { password: STRONG }),
      login('empty', { password: '' }),
    ])
    expect(r.weak).toEqual(['weak'])
  })

  it('finds reused passwords case-sensitively and says where', () => {
    const r = report([
      login('a', { password: STRONG }),
      login('b', { password: STRONG }),
      login('c', { password: STRONG.toUpperCase() }),
      login('d', { password: '' }),
      login('e', { password: '' }),
      login('f', { password: STRONG }, { trashed: 9 }),
    ])
    expect([...r.reused.keys()].sort()).toEqual(['a', 'b'])
    expect(r.reused.get('a')).toEqual(['b'])
    expect(r.reused.get('b')).toEqual(['a'])
  })

  it('finds inactive 2FA only on sites that offer it', () => {
    const r = report([
      login('bare', { password: STRONG, urls: ['https://www.github.com/login'] }),
      login('nowhere', { password: STRONG, urls: ['https://example.org'] }),
      login('totp', { password: STRONG, urls: ['https://github.com'], totp: TOTP }),
      login('field', {
        password: STRONG,
        urls: ['https://github.com'],
        fields: [fieldOf('Backup', TOTP, 'totp')],
      }),
      login('emptyField', {
        password: STRONG,
        urls: ['https://gist.github.com'],
        fields: [{ id: 'x', name: 'Backup', kind: 'totp', value: ' ' }],
      }),
      login('passkey', { password: STRONG, urls: ['https://github.com'], passkeys: [passkey] }),
    ])
    expect(r.inactive2fa.sort()).toEqual(['bare', 'emptyField'])
  })

  it('leaves excluded items out of everything but excluded', () => {
    const r = report(
      [
        login('x', { password: 'password', urls: ['https://github.com'] }, { monitored: false }),
        login('y', { password: 'password' }),
      ],
      new Set(['x', 'y']),
    )
    expect(r.excluded).toEqual(['x'])
    expect(r.weak).toEqual(['y'])
    expect(r.reused.size).toBe(0)
    expect(r.inactive2fa).toEqual([])
    expect(r.compromised).toEqual(['y'])
  })

  it('reads only logins that are not in the trash', () => {
    const items = [
      login('trashed', { password: 'password' }, { trashed: 3 }),
      item('note', noteOf('n', 'password')),
      item('card', blank('card')),
      login('kept', { password: 'password' }),
    ]
    const r = report(items, new Set(['trashed', 'note', 'kept']))
    expect(r.weak).toEqual(['kept'])
    expect(r.compromised).toEqual(['kept'])
    expect(activeLogins(items).map((one) => one.id)).toEqual(['kept'])
    expect(watchedLogins(items).map((one) => one.id)).toEqual(['kept'])
    expect(items.filter(isLoginItem).map((one) => one.id)).toEqual(['trashed', 'kept'])
  })
})

describe('flagsOf', () => {
  it('lists an item’s flags in FLAGS order', () => {
    const items = [
      login('a', { password: 'password', urls: ['https://github.com'] }),
      login('b', { password: 'password' }),
      login('c', { password: STRONG }, { monitored: false }),
      login('d', { password: STRONG }),
    ]
    const r = report(items, new Set(['a']))
    expect(flagsOf(items[0]!, r)).toEqual(['compromised', 'weak', 'reused', 'inactive2fa'])
    expect(flagsOf(items[1]!, r)).toEqual(['weak', 'reused'])
    expect(flagsOf(items[2]!, r)).toEqual(['excluded'])
    expect(flagsOf(items[3]!, r)).toEqual([])
    expect(FLAGS).toEqual(['compromised', 'weak', 'reused', 'inactive2fa', 'excluded'])
  })
})
