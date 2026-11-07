import { describe, expect, it } from 'vitest'
import type { Content, ContentOf, ItemKind } from '../types'
import { normalizeUrl } from '../urls'
import { totpOf } from './build'
import { parseBitwarden } from './bitwarden'
import type { Imported, ImportedItem } from './types'

const URI = 'otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'

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

const base = {
  id: 'x',
  organizationId: null,
  folderId: null,
  reprompt: 0,
  favorite: false,
  fields: [],
  collectionIds: null,
  creationDate: '2024-01-02T03:04:05.000Z',
  revisionDate: '2024-02-03T04:05:06.000Z',
  deletedDate: null,
}

const EXPORT = {
  encrypted: false,
  folders: [
    { id: 'f1', name: 'Finanzen/Banken' },
    { id: 'f2', name: 'Social' },
  ],
  items: [
    {
      ...base,
      type: 1,
      name: 'GitHub',
      notes: 'Zeile 1\nZeile "2"',
      favorite: true,
      folderId: 'f2',
      fields: [
        { name: 'Recovery', value: 'abc-def', type: 1, linkedId: null },
        { name: 'Plain', value: 'größe', type: 0, linkedId: null },
        { name: 'Flag', value: 'true', type: 2, linkedId: null },
        { name: 'Linked', value: null, type: 3, linkedId: 100 },
      ],
      login: {
        uris: [
          { match: null, uri: 'https://github.com/login' },
          { match: 1, uri: 'https://gist.github.com' },
          { match: 3, uri: 'https://exact.example.com/a' },
          { match: 5, uri: 'https://never.example.com' },
        ],
        username: 'octo@example.com',
        password: 'hunter2',
        totp: URI,
        fido2Credentials: [
          {
            credentialId: 'b5f5e5c6-0000-4000-8000-000000000001',
            keyType: 'public-key',
            keyAlgorithm: 'ECDSA',
            keyCurve: 'P-256',
            keyValue: 'MIGHAgEAMBMG',
            rpId: 'github.com',
            userHandle: 'dXNlcg',
            userName: 'octo',
            counter: '7',
            rpName: 'GitHub',
            userDisplayName: 'Octo Cat',
            discoverable: 'true',
            creationDate: '2024-01-02T03:04:05.000Z',
          },
        ],
      },
    },
    {
      ...base,
      type: 1,
      name: 'Bank',
      folderId: 'f1',
      deletedDate: '2024-03-01T00:00:00.000Z',
      login: { uris: [], username: 'kunde42', password: 'pw', totp: null },
    },
    { ...base, type: 2, name: 'Notiz', notes: 'Ünïcödé', secureNote: { type: 0 } },
    {
      ...base,
      type: 3,
      name: 'Amex',
      card: {
        cardholderName: 'Jo Doe',
        brand: 'Amex',
        number: '378282246310005',
        expMonth: '4',
        expYear: '28',
        code: '1234',
      },
    },
    {
      ...base,
      type: 4,
      name: 'Ich',
      identity: {
        title: 'Mx',
        firstName: 'Jo',
        middleName: null,
        lastName: 'Doe',
        address1: 'Main St 1',
        address2: 'Apt 2',
        address3: null,
        city: 'Bern',
        state: 'BE',
        postalCode: '3000',
        country: 'CH',
        company: 'ACME',
        email: 'jo@example.com',
        phone: '+41 31 000',
        ssn: '756.1234',
        username: 'jodoe',
        passportNumber: 'P1',
        licenseNumber: 'L1',
      },
    },
    {
      ...base,
      type: 5,
      name: 'Deploy key',
      sshKey: {
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
        publicKey: 'ssh-ed25519 AAAAC3',
        keyFingerprint: 'SHA256:xyz',
      },
    },
    { ...base, type: 9, name: 'Unknown', notes: 'what is this' },
  ],
}

describe('parseBitwarden JSON', () => {
  const result = parseBitwarden(JSON.stringify(EXPORT, null, 2))

  it('reads a login with its uris, fields, totp and passkey', () => {
    const github = find(result, 'GitHub')
    const login = as(github.content, 'login')
    expect(login.email).toBe('octo@example.com')
    expect(login.username).toBe('')
    expect(login.password).toBe('hunter2')
    expect(login.totp).toEqual(totpOf(URI))
    expect(login.note).toBe('Zeile 1\nZeile "2"')
    expect(login.websites).toEqual([
      { url: normalizeUrl('https://github.com/login'), match: 'domain' },
      { url: normalizeUrl('https://gist.github.com'), match: 'host' },
      { url: normalizeUrl('https://exact.example.com/a'), match: 'exact' },
      { url: normalizeUrl('https://never.example.com'), match: 'never' },
    ])
    expect(login.fields.map((one) => [one.name, one.kind, one.value])).toEqual([
      ['Recovery', 'hidden', 'abc-def'],
      ['Plain', 'text', 'größe'],
      ['Flag', 'text', 'true'],
    ])
    expect(login.passkeys[0]).toMatchObject({
      rpId: 'github.com',
      rpName: 'GitHub',
      userName: 'octo',
      userDisplayName: 'Octo Cat',
      userHandle: 'dXNlcg',
      privateKey: 'MIGHAgEAMBMG',
      counter: 7,
      algorithm: -7,
      created: Date.parse('2024-01-02T03:04:05.000Z'),
    })
    expect(github).toMatchObject({
      pinned: true,
      trashed: false,
      folder: 'Social',
      created: Date.parse('2024-01-02T03:04:05.000Z'),
      modified: Date.parse('2024-02-03T04:05:06.000Z'),
    })
  })

  it('reads the trash, notes, cards, identities and ssh keys', () => {
    const bank = find(result, 'Bank')
    expect(bank.trashed).toBe(true)
    expect(bank.folder).toBe('Finanzen/Banken')
    expect(as(bank.content, 'login').username).toBe('kunde42')
    expect(find(result, 'Notiz').content.note).toBe('Ünïcödé')
    expect(as(find(result, 'Amex').content, 'card')).toMatchObject({
      holder: 'Jo Doe',
      brand: 'amex',
      expiry: '2028-04',
      code: '1234',
    })
    const me = as(find(result, 'Ich').content, 'identity')
    expect(me.values).toMatchObject({
      firstName: 'Jo',
      lastName: 'Doe',
      fullName: 'Jo Doe',
      street: 'Main St 1\nApt 2',
      zip: '3000',
      ssn: '756.1234',
      passport: 'P1',
      license: 'L1',
      company: 'ACME',
    })
    expect(me.sections[0]?.fields.map((one) => [one.name, one.value])).toEqual([
      ['Title', 'Mx'],
      ['Username', 'jodoe'],
    ])
    const ssh = as(find(result, 'Deploy key').content, 'ssh')
    expect(ssh.publicKey).toBe('ssh-ed25519 AAAAC3')
    expect(ssh.fields[0]?.value).toBe('SHA256:xyz')
  })

  it('keeps an unknown type as a note and says so', () => {
    expect(find(result, 'Unknown').content.kind).toBe('note')
    expect(result.skipped).toEqual([{ reason: expect.stringContaining('9'), title: 'Unknown' }])
  })

  it('puts an organization export into its collections', () => {
    const org = parseBitwarden(
      JSON.stringify({
        encrypted: false,
        collections: [{ id: 'c1', organizationId: 'o', name: 'Team' }],
        items: [{ ...base, type: 2, name: 'Shared', notes: 'n', collectionIds: ['c1'] }],
      }),
    )
    expect(org.vaults.map((vault) => vault.name)).toEqual(['Team'])
  })

  it('asks for an unencrypted export', () => {
    const encrypted = parseBitwarden(
      JSON.stringify({ encrypted: true, passwordProtected: true, salt: 's', data: '2.abc' }),
    )
    expect(encrypted.vaults).toEqual([])
    expect(encrypted.skipped[0]?.reason).toMatch(/encrypted/i)
    expect(() => parseBitwarden('{"hello": 1}')).toThrow()
  })
})

describe('parseBitwarden CSV', () => {
  const csv = [
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
    `Social,1,login,Mastodon,"a note, with comma","Recovery: r1\nPIN: 0000",0,"https://mastodon.social,https://elk.zone",me@example.com,pw,${URI}`,
    ',,note,Notiz,"zwei\r\nZeilen",,0,,,,',
    ',,login,,,,0,,,,',
    'Ünï,,login,Café,,,0,https://café.example.com,barista,,',
  ].join('\n')
  const result = parseBitwarden(`\uFEFF${csv}`)

  it('reads logins and notes with folders and fields', () => {
    const mastodon = find(result, 'Mastodon')
    const login = as(mastodon.content, 'login')
    expect(mastodon).toMatchObject({ pinned: true, folder: 'Social' })
    expect(login.email).toBe('me@example.com')
    expect(login.note).toBe('a note, with comma')
    expect(login.totp).toEqual(totpOf(URI))
    expect(login.websites.map((one) => one.url)).toEqual([
      normalizeUrl('https://mastodon.social'),
      normalizeUrl('https://elk.zone'),
    ])
    expect(login.fields.map((one) => [one.name, one.value])).toEqual([
      ['Recovery', 'r1'],
      ['PIN', '0000'],
    ])
    expect(find(result, 'Notiz').content).toMatchObject({ kind: 'note', note: 'zwei\r\nZeilen' })
    expect(find(result, 'Café').folder).toBe('Ünï')
    expect(result.vaults[0]?.items).toHaveLength(3)
  })
})
