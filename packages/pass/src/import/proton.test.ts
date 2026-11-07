import { describe, expect, it } from 'vitest'
import type { Content, ContentOf, ItemKind } from '../types'
import { normalizeUrl } from '../urls'
import { totpOf } from './build'
import { parseProton } from './proton'
import type { Imported, ImportedItem } from './types'

const SECRET = 'JBSWY3DPEHPK3PXP'
const URI = `otpauth://totp/Example:ren%C3%A9?secret=${SECRET}&issuer=Example`

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

const item = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  itemId: 'i',
  shareId: 's',
  state: 1,
  aliasEmail: null,
  contentFormatVersion: 6,
  createTime: 1700000000,
  modifyTime: 1700000500,
  pinned: false,
  ...extra,
  data: { platformSpecific: null, extraFields: [], ...data },
})

const EXPORT = {
  version: '1.30.0',
  userId: 'u1',
  encrypted: false,
  vaults: {
    share1: {
      name: 'Persönlich',
      description: '',
      display: { color: 1, icon: 1 },
      folders: [
        { folderId: 'f2', parentFolderId: 'f1', name: 'Banken' },
        { folderId: 'f1', parentFolderId: null, name: 'Geld' },
      ],
      items: [
        item(
          {
            type: 'login',
            metadata: { name: 'Bank', note: 'line one\nline "two"', itemUuid: 'x' },
            extraFields: [
              { fieldName: 'PIN', type: 'hidden', data: { content: '1234' } },
              { fieldName: 'Backup', type: 'totp', data: { totpUri: URI } },
              {
                fieldName: 'Since',
                type: 'timestamp',
                data: { timestamp: { seconds: 1700000000, nanos: 0 } },
              },
              { fieldName: 'Kundennr', type: 'text', data: { content: 'ÄÖÜ-42' } },
            ],
            content: {
              itemEmail: 'rene@example.com',
              itemUsername: 'rené',
              password: 'p@ss',
              urls: ['https://bank.example.com/login'],
              autofillUrls: [
                { url: 'https://bank.example.com/login', mode: 0 },
                { url: 'https://other.example.org', mode: 1 },
                { url: 'https://never.example.net', mode: 2 },
              ],
              totpUri: URI,
              passkeys: [
                {
                  keyId: 'k1',
                  content: 'AAEC',
                  domain: 'bank.example.com',
                  rpId: 'bank.example.com',
                  rpName: 'Bank',
                  userName: 'rene',
                  userDisplayName: 'René',
                  userId: 'dXNlcg==',
                  createTime: 1700000000,
                  note: '',
                  credentialId: 'Y3JlZA==',
                  userHandle: 'aGFuZGxl',
                },
              ],
            },
          },
          { pinned: true, folderId: 'f2' },
        ),
        item(
          { type: 'note', metadata: { name: 'Geheim', note: 'Ünïcödé 🔐' }, content: {} },
          { state: 2 },
        ),
        item(
          { type: 'alias', metadata: { name: 'Shop alias', note: '' }, content: {} },
          { aliasEmail: 'shop.abc@passmail.net' },
        ),
        item({
          type: 'creditCard',
          metadata: { name: 'Visa', note: '' },
          content: {
            cardholderName: 'René Muster',
            cardType: 0,
            number: '4111 1111 1111 1111',
            verificationNumber: '123',
            expirationDate: '2027-03',
            pin: '9876',
          },
        }),
        item({
          type: 'identity',
          metadata: { name: 'Me', note: '' },
          content: {
            fullName: '',
            firstName: 'René',
            lastName: 'Muster',
            email: 'rene@example.com',
            phoneNumber: '+41 44 000 00 00',
            streetAddress: 'Bahnhofstrasse 1',
            zipOrPostalCode: '8001',
            city: 'Zürich',
            countryOrRegion: 'CH',
            passportNumber: 'X123',
            workEmail: 'rene@work.example',
            extraPersonalDetails: [
              { fieldName: 'Nickname', type: 'text', data: { content: 'Rene' } },
            ],
            extraSections: [
              {
                sectionName: 'Club',
                sectionFields: [{ fieldName: 'Member', type: 'text', data: { content: '77' } }],
              },
            ],
          },
        }),
        item({
          type: 'wifi',
          metadata: { name: 'Home wifi', note: '' },
          content: { ssid: 'Heim', password: 'wifi-pw', security: 3, sections: [] },
        }),
        item({
          type: 'sshKey',
          metadata: { name: 'Server key', note: '' },
          content: {
            privateKey: '-----BEGIN-----\nabc\n-----END-----',
            publicKey: 'ssh-ed25519 AAAA',
            sections: [],
          },
        }),
        item({
          type: 'hologram',
          metadata: { name: 'Future', note: 'from the future' },
          content: {},
        }),
      ],
    },
    share2: { name: 'Work', description: '', display: {}, items: [] },
  },
}

describe('parseProton', () => {
  const result = parseProton(JSON.stringify(EXPORT))

  it('keeps the vaults and drops an empty one', () => {
    expect(result.vaults.map((vault) => vault.name)).toEqual(['Persönlich'])
  })

  it('reads a login with every part', () => {
    const bank = find(result, 'Bank')
    const login = as(bank.content, 'login')
    expect(login.email).toBe('rene@example.com')
    expect(login.username).toBe('rené')
    expect(login.password).toBe('p@ss')
    expect(login.note).toBe('line one\nline "two"')
    expect(login.totp).toEqual(totpOf(URI))
    expect(login.websites).toEqual([
      { url: normalizeUrl('https://bank.example.com/login'), match: 'domain' },
      { url: normalizeUrl('https://other.example.org'), match: 'exact' },
      { url: normalizeUrl('https://never.example.net'), match: 'never' },
    ])
    expect(login.passkeys).toHaveLength(1)
    expect(login.passkeys[0]).toMatchObject({
      rpId: 'bank.example.com',
      userName: 'rene',
      credentialId: 'Y3JlZA==',
      privateKey: 'AAEC',
      created: 1700000000000,
    })
    expect(login.fields.map((one) => [one.name, one.kind, one.value])).toEqual([
      ['PIN', 'hidden', '1234'],
      ['Backup', 'totp', totpOf(URI)],
      ['Since', 'date', '2023-11-14'],
      ['Kundennr', 'text', 'ÄÖÜ-42'],
    ])
    expect(bank).toMatchObject({
      pinned: true,
      trashed: false,
      folder: 'Geld/Banken',
      created: 1700000000000,
      modified: 1700000500000,
    })
  })

  it('reads the trash, an alias, a card, an identity, wifi and ssh', () => {
    const note = find(result, 'Geheim')
    expect(note.trashed).toBe(true)
    expect(note.content.note).toBe('Ünïcödé 🔐')
    expect(as(find(result, 'Shop alias').content, 'alias').address).toBe('shop.abc@passmail.net')
    expect(as(find(result, 'Visa').content, 'card')).toMatchObject({
      holder: 'René Muster',
      number: '4111111111111111',
      brand: 'visa',
      expiry: '2027-03',
      code: '123',
      pin: '9876',
    })
    const me = as(find(result, 'Me').content, 'identity')
    expect(me.values).toMatchObject({
      firstName: 'René',
      lastName: 'Muster',
      fullName: 'René Muster',
      phone: '+41 44 000 00 00',
      street: 'Bahnhofstrasse 1',
      zip: '8001',
      city: 'Zürich',
      country: 'CH',
      passport: 'X123',
      workEmail: 'rene@work.example',
    })
    expect(me.sections.map((one) => [one.name, one.fields.map((f) => f.value)])).toEqual([
      ['Imported', ['Rene']],
      ['Club', ['77']],
    ])
    expect(as(find(result, 'Home wifi').content, 'wifi')).toMatchObject({
      ssid: 'Heim',
      password: 'wifi-pw',
      security: 'wpa3',
    })
    expect(as(find(result, 'Server key').content, 'ssh').publicKey).toBe('ssh-ed25519 AAAA')
  })

  it('keeps an unknown kind as a note and says so', () => {
    expect(as(find(result, 'Future').content, 'note').note).toBe('from the future')
    expect(result.skipped).toEqual([
      { reason: expect.stringContaining('hologram'), title: 'Future' },
    ])
  })

  it('reads the zip and refuses the encrypted export', () => {
    const zipped = parseProton({
      'Proton Pass/data.json': new TextEncoder().encode(JSON.stringify(EXPORT)),
    })
    expect(zipped.vaults[0]?.items).toHaveLength(result.vaults[0]?.items.length ?? -1)
    const pgp = parseProton({ 'Proton Pass/data.pgp': new Uint8Array([1, 2, 3]) })
    expect(pgp.vaults).toEqual([])
    expect(pgp.skipped[0]?.reason).toMatch(/encrypted/)
    expect(parseProton('-----BEGIN PGP MESSAGE-----\nxx').skipped).toHaveLength(1)
    expect(parseProton(JSON.stringify({ encrypted: true, vaults: {} })).skipped).toHaveLength(1)
    expect(() => parseProton({ 'other.txt': new Uint8Array() })).toThrow()
  })

  it('migrates the old username to the email', () => {
    const old = {
      version: '1.10.0',
      vaults: {
        a: {
          name: 'Old',
          items: [
            item({
              type: 'login',
              metadata: { name: 'Legacy', note: '' },
              content: {
                username: 'legacy@example.com',
                password: 'x',
                urls: ['https://a.example.com'],
              },
            }),
          ],
        },
      },
    }
    const login = as(find(parseProton(JSON.stringify(old)), 'Legacy').content, 'login')
    expect(login.email).toBe('legacy@example.com')
    expect(login.username).toBe('')
    expect(login.websites).toEqual([
      { url: normalizeUrl('https://a.example.com'), match: 'domain' },
    ])
  })
})

describe('parseProton CSV', () => {
  const card = JSON.stringify({
    cardholderName: 'Jo',
    number: '5555555555554444',
    verificationNumber: '321',
    expirationDate: '2026-11',
    pin: '',
    note: 'card note',
  }).replace(/"/g, '""')
  const csv = [
    '﻿type,name,url,email,username,password,note,totp,createTime,modifyTime,vault',
    `login,Mail,"https://mail.example.com, https://webmail.example.com",me@example.com,,pw1,"multi\r\nline, ""quoted""",${URI},1700000000,1700000100,Privat`,
    'login,,,,,,,,,,Privat',
    `creditCard,Master,,,,,"${card}",,,,Arbeit`,
    'note,Notiz,,,,,Grüße,,,,Arbeit',
    'sshKey,Key,,,,,only the note,,,,Arbeit',
    '',
  ].join('\r\n')
  const result = parseProton(csv)

  it('groups by vault and reads logins, cards and notes', () => {
    expect(result.vaults.map((vault) => [vault.name, vault.items.length])).toEqual([
      ['Privat', 1],
      ['Arbeit', 3],
    ])
    const mail = find(result, 'Mail')
    const login = as(mail.content, 'login')
    expect(login.email).toBe('me@example.com')
    expect(login.note).toBe('multi\r\nline, "quoted"')
    expect(login.totp).toEqual(totpOf(URI))
    expect(login.websites.map((one) => one.url)).toEqual([
      normalizeUrl('https://mail.example.com'),
      normalizeUrl('https://webmail.example.com'),
    ])
    expect(mail.created).toBe(1700000000000)
    expect(as(find(result, 'Master').content, 'card')).toMatchObject({
      holder: 'Jo',
      brand: 'mastercard',
      expiry: '2026-11',
      code: '321',
      note: 'card note',
    })
    expect(find(result, 'Notiz').content.note).toBe('Grüße')
    expect(result.skipped).toEqual([{ reason: expect.stringContaining('sshKey'), title: 'Key' }])
  })

  it('reads the old CSV whose username is the email', () => {
    const old = parseProton(
      'name,url,username,password,note,totp\nOld,https://x.example.com,old@example.com,pw,,\n',
    )
    const login = as(find(old, 'Old').content, 'login')
    expect(login.email).toBe('old@example.com')
    expect(login.username).toBe('')
  })
})
