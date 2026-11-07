import { describe, expect, it } from 'vitest'
import type { Content, ContentOf, ItemKind } from '../types'
import { normalizeUrl } from '../urls'
import { totpOf } from './build'
import { parseOnePassword } from './onepassword'
import type { Imported, ImportedItem } from './types'

const URI = 'otpauth://totp/Dropbox:me?secret=JBSWY3DPEHPK3PXP'

function find(result: Imported, title: string): ImportedItem {
  const found = result.vaults
    .flatMap((vault) => vault.items)
    .find((one) => one.content.title === title)
  if (!found) throw new Error(`no item ${title}`)
  return found
}

function as<K extends ItemKind>(content: Content, kind: K): ContentOf<K> {
  expect(content.kind).toBe(kind)
  return content as ContentOf<K>
}

const pux = (
  category: string,
  title: string,
  details: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  uuid: title,
  favIndex: 0,
  createdAt: 1600000000,
  updatedAt: 1600000600,
  state: 'active',
  categoryUuid: category,
  overview: { subtitle: '', title, url: '', urls: [], tags: [], ps: 0, pbe: 0, pgrng: false },
  details: { loginFields: [], notesPlain: '', sections: [], passwordHistory: [], ...details },
  ...extra,
})

const EXPORT = {
  accounts: [
    {
      attrs: {
        accountName: 'Me',
        name: 'Me',
        avatar: '',
        email: 'me@example.com',
        uuid: 'a',
        domain: 'https://my.1password.com/',
      },
      vaults: [
        {
          attrs: { uuid: 'v1', desc: '', avatar: '', name: 'Private', type: 'P' },
          items: [
            pux(
              '001',
              'Dropbox',
              {
                loginFields: [
                  {
                    value: 'dröp@example.com',
                    id: '',
                    name: 'login',
                    fieldType: 'E',
                    designation: 'username',
                  },
                  {
                    value: 'pa"ss',
                    id: '',
                    name: 'password',
                    fieldType: 'P',
                    designation: 'password',
                  },
                  { value: '✓', id: '', name: 'remember', fieldType: 'C' },
                ],
                notesPlain: 'note\nwith lines',
                sections: [
                  {
                    title: 'Security',
                    name: 'sec',
                    fields: [
                      {
                        title: 'one-time password',
                        id: 'TOTP_1',
                        value: { totp: URI },
                        indexAtSource: 0,
                        guarded: false,
                        multiline: false,
                        dontGenerate: false,
                        inputTraits: {},
                      },
                      { title: 'PIN', id: 'pin', value: { concealed: '4321' } },
                      { title: 'Since', id: 'since', value: { date: 1600000000 } },
                      {
                        title: 'Mail',
                        id: 'mail',
                        value: { email: { email_address: 'alt@example.com', provider: null } },
                      },
                      {
                        title: 'Attachment',
                        id: 'file',
                        value: { file: { fileName: 'scan.pdf', documentId: 'd' } },
                      },
                    ],
                  },
                ],
              },
              {
                favIndex: 1,
                overview: {
                  title: 'Dropbox',
                  url: 'https://www.dropbox.com',
                  urls: [
                    { label: '', url: 'https://www.dropbox.com' },
                    { label: 'alt', url: 'https://db.tt' },
                  ],
                  tags: ['Cloud/Storage', 'Work'],
                },
              },
            ),
            pux('002', 'Visa', {
              sections: [
                {
                  title: '',
                  name: '',
                  fields: [
                    { title: 'cardholder name', id: 'cardholder', value: { string: 'Jö Doe' } },
                    { title: 'type', id: 'type', value: { creditCardType: 'visa' } },
                    {
                      title: 'number',
                      id: 'ccnum',
                      value: { creditCardNumber: '4111 1111 1111 1111' },
                    },
                    { title: 'verification number', id: 'cvv', value: { concealed: '999' } },
                    { title: 'expiry date', id: 'expiry', value: { monthYear: 202709 } },
                    { title: 'issuing bank', id: 'bank', value: { string: 'UBS' } },
                  ],
                },
              ],
            }),
            pux('003', 'Notiz', { notesPlain: 'Grüße' }, { state: 'archived' }),
            pux('004', 'Ich', {
              sections: [
                {
                  title: 'Identification',
                  name: 'name',
                  fields: [
                    { title: 'first name', id: 'firstname', value: { string: 'Jo' } },
                    { title: 'last name', id: 'lastname', value: { string: 'Doe' } },
                    { title: 'birth date', id: 'birthdate', value: { date: 631152000 } },
                    { title: 'nickname', id: 'nick', value: { string: 'JD' } },
                  ],
                },
                {
                  title: 'Address',
                  name: 'address',
                  fields: [
                    {
                      title: 'address',
                      id: 'address',
                      value: {
                        address: {
                          street: 'Main 1',
                          city: 'Basel',
                          country: 'ch',
                          zip: '4000',
                          state: 'BS',
                        },
                      },
                    },
                    { title: 'phone', id: 'defphone', value: { phone: '+41 61' } },
                  ],
                },
              ],
            }),
            pux('005', 'Router admin', { password: 'admin123' }),
            pux('109', 'Heim', {
              sections: [
                {
                  title: '',
                  name: '',
                  fields: [
                    { title: 'network name', id: 'network_name', value: { string: 'HomeNet' } },
                    {
                      title: 'wireless password',
                      id: 'wireless_password',
                      value: { concealed: 'wifipw' },
                    },
                    { title: 'security', id: 'wireless_security', value: { menu: 'wpa2p' } },
                    { title: 'base station name', id: 'name', value: { string: 'Box' } },
                  ],
                },
              ],
            }),
            pux('114', 'Server', {
              sections: [
                {
                  title: '',
                  name: '',
                  fields: [
                    {
                      title: 'private key',
                      id: 'private_key',
                      value: {
                        sshKey: {
                          privateKey: '-----BEGIN-----',
                          metadata: {
                            publicKey: 'ssh-ed25519 PUB',
                            fingerprint: 'SHA256:f',
                            keyType: 'ed25519',
                            privateKey: '-----BEGIN-----',
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            }),
            pux('106', 'Pass', {
              sections: [
                {
                  title: '',
                  name: '',
                  fields: [{ title: 'number', id: 'number', value: { string: 'X1' } }],
                },
              ],
            }),
            pux('999', 'Odd', { notesPlain: 'odd' }),
          ],
        },
        {
          attrs: { uuid: 'v2', desc: '', avatar: '', name: 'Shared', type: 'U' },
          items: [pux('003', 'Shared note', { notesPlain: 'x' })],
        },
      ],
    },
  ],
}

describe('parseOnePassword 1PUX', () => {
  const result = parseOnePassword({
    'export.attributes': new Uint8Array(),
    'export.data': new TextEncoder().encode(JSON.stringify(EXPORT)),
  })

  it('keeps the vaults', () => {
    expect(result.vaults.map((vault) => vault.name)).toEqual(['Private', 'Shared'])
  })

  it('reads a login', () => {
    const dropbox = find(result, 'Dropbox')
    const login = as(dropbox.content, 'login')
    expect(login.email).toBe('dröp@example.com')
    expect(login.password).toBe('pa"ss')
    expect(login.totp).toEqual(totpOf(URI))
    expect(login.note).toBe('note\nwith lines')
    expect(login.websites.map((one) => one.url)).toEqual([
      normalizeUrl('https://www.dropbox.com'),
      normalizeUrl('https://db.tt'),
    ])
    expect(login.fields.map((one) => [one.name, one.kind, one.value])).toEqual([
      ['PIN', 'hidden', '4321'],
      ['Since', 'date', '2020-09-13'],
      ['Mail', 'text', 'alt@example.com'],
    ])
    expect(dropbox).toMatchObject({
      pinned: true,
      folder: 'Cloud/Storage',
      created: 1600000000000,
      modified: 1600000600000,
    })
    expect(result.skipped).toContainEqual({
      reason: expect.stringContaining('file'),
      title: 'Dropbox',
    })
  })

  it('reads a card, an archived note, an identity, a password, wifi, ssh and other kinds', () => {
    expect(as(find(result, 'Visa').content, 'card')).toMatchObject({
      holder: 'Jö Doe',
      number: '4111111111111111',
      brand: 'visa',
      code: '999',
      expiry: '2027-09',
    })
    expect(as(find(result, 'Visa').content, 'card').fields.map((one) => one.value)).toEqual(['UBS'])
    expect(find(result, 'Notiz').trashed).toBe(true)
    const me = as(find(result, 'Ich').content, 'identity')
    expect(me.values).toMatchObject({
      firstName: 'Jo',
      lastName: 'Doe',
      birthdate: '1990-01-01',
      street: 'Main 1',
      city: 'Basel',
      zip: '4000',
      state: 'BS',
      country: 'ch',
      phone: '+41 61',
    })
    expect(me.sections[0]?.fields.map((one) => one.value)).toEqual(['JD'])
    expect(as(find(result, 'Router admin').content, 'login').password).toBe('admin123')
    expect(as(find(result, 'Heim').content, 'wifi')).toMatchObject({
      ssid: 'HomeNet',
      password: 'wifipw',
      security: 'wpa2',
    })
    expect(as(find(result, 'Server').content, 'ssh')).toMatchObject({
      privateKey: '-----BEGIN-----',
      publicKey: 'ssh-ed25519 PUB',
    })
    const passport = as(find(result, 'Pass').content, 'custom')
    expect(passport.template).toBe('Passport')
    expect(passport.sections[0]?.fields[0]?.value).toBe('X1')
    expect(find(result, 'Odd').content.kind).toBe('note')
    expect(result.skipped).toContainEqual({ reason: expect.stringContaining('999'), title: 'Odd' })
  })

  it('reads export.data unzipped too', () => {
    expect(parseOnePassword(JSON.stringify(EXPORT)).vaults).toHaveLength(2)
    expect(() => parseOnePassword({ 'nothing.txt': new Uint8Array() })).toThrow()
  })
})

describe('parseOnePassword 1PIF', () => {
  const SEP = '***5642bee8-a5ff-11dc-8314-0800200c9a66***'
  const records = [
    {
      uuid: 'fold1',
      typeName: 'system.folder.Regular',
      title: 'Arbeit',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      uuid: 'fold2',
      typeName: 'system.folder.Regular',
      title: 'Kunden',
      folderUuid: 'fold1',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      uuid: 'l1',
      typeName: 'webforms.WebForm',
      title: 'Webmail',
      location: 'https://mail.example.com',
      folderUuid: 'fold2',
      faveIndex: 3,
      createdAt: 1500000000,
      updatedAt: 1500000100,
      secureContents: {
        fields: [
          { value: 'kunde', name: 'user', type: 'T', designation: 'username' },
          { value: 'geheim', name: 'pass', type: 'P', designation: 'password' },
        ],
        URLs: [
          { label: 'web', url: 'https://mail.example.com' },
          { label: 'alt', url: 'https://mx.example.com' },
        ],
        notesPlain: 'Notiz "1"',
        sections: [
          {
            name: 'otp',
            title: 'OTP',
            fields: [{ k: 'concealed', n: 'TOTP_abc', t: 'code', v: URI }],
          },
        ],
      },
    },
    {
      uuid: 'c1',
      typeName: 'wallet.financial.CreditCard',
      title: 'Karte',
      trashed: true,
      createdAt: 1,
      updatedAt: 1,
      secureContents: {
        cardholder: 'Ann',
        ccnum: '5555555555554444',
        cvv: '111',
        expiry_mm: '7',
        expiry_yy: '2029',
      },
    },
    {
      uuid: 'n1',
      typeName: 'securenotes.SecureNote',
      title: 'Plain',
      createdAt: 1,
      updatedAt: 1,
      secureContents: { notesPlain: 'π' },
    },
    {
      uuid: 'm1',
      typeName: 'wallet.membership.Membership',
      title: 'Gym',
      createdAt: 1,
      updatedAt: 1,
      secureContents: {
        sections: [
          {
            name: '',
            title: '',
            fields: [{ k: 'string', n: 'member_name', t: 'member', v: 'Ann' }],
          },
        ],
      },
    },
    { uuid: 't1', typeName: 'system.Tombstone', title: 'gone', createdAt: 1, updatedAt: 1 },
  ]
  const result = parseOnePassword(records.map((one) => `${JSON.stringify(one)}\n${SEP}`).join('\n'))

  it('reads logins with folders, totp and favourites', () => {
    const mail = find(result, 'Webmail')
    const login = as(mail.content, 'login')
    expect(login.username).toBe('kunde')
    expect(login.password).toBe('geheim')
    expect(login.totp).toEqual(totpOf(URI))
    expect(login.websites).toHaveLength(2)
    expect(login.note).toBe('Notiz "1"')
    expect(mail).toMatchObject({ folder: 'Arbeit/Kunden', pinned: true, created: 1500000000000 })
  })

  it('reads cards, notes, other wallet kinds and drops tombstones', () => {
    const card = find(result, 'Karte')
    expect(card.trashed).toBe(true)
    expect(as(card.content, 'card')).toMatchObject({
      holder: 'Ann',
      brand: 'mastercard',
      expiry: '2029-07',
      code: '111',
    })
    expect(find(result, 'Plain').content.note).toBe('π')
    expect(as(find(result, 'Gym').content, 'custom').template).toBe('Membership')
    expect(
      result.vaults.flatMap((vault) => vault.items).map((one) => one.content.title),
    ).not.toContain('gone')
  })
})

describe('parseOnePassword CSV', () => {
  it('reads the 1Password 8 CSV', () => {
    const csv = [
      'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes,Extra',
      `Shop,https://shop.example.com,me@example.com,pw,${URI},true,false,Shopping,"zwei\nZeilen",value`,
      'Old,https://old.example.com,olduser,pw2,,false,true,,,',
    ].join('\n')
    const result = parseOnePassword(csv)
    const shop = find(result, 'Shop')
    const login = as(shop.content, 'login')
    expect(login.email).toBe('me@example.com')
    expect(login.totp).toEqual(totpOf(URI))
    expect(login.note).toBe('zwei\nZeilen')
    expect(login.fields.map((one) => [one.name, one.value])).toEqual([['Extra', 'value']])
    expect(shop).toMatchObject({ pinned: true, trashed: false, folder: 'Shopping' })
    expect(find(result, 'Old').trashed).toBe(true)
    expect(as(find(result, 'Old').content, 'login').username).toBe('olduser')
  })
})
