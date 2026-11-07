import { describe, expect, it } from 'vitest'
import { csvText } from './csv'
import type { Content, ContentOf, ItemKind } from '../types'
import { normalizeUrl } from '../urls'
import { totpOf } from './build'
import { parseLastPass } from './lastpass'
import type { Imported, ImportedItem } from './types'

const SECRET = 'JBSWY3DPEHPK3PXP'

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

const card = [
  'NoteType:Credit Card',
  'Language:en-US',
  'Name on Card:Jürg Muster',
  'Type:Visa',
  'Number:4111111111111111',
  'Security Code:123',
  'Start Date:January,2020',
  'Expiration Date:March,2027',
  'Notes:first line',
  'second: line',
].join('\n')

const address = [
  'NoteType:Address',
  'Language:en-US',
  'Title:mr',
  'First Name:Jürg',
  'Middle Name:',
  'Last Name:Muster',
  'Username:jm',
  'Gender:m',
  'Birthday:February,3,1985',
  'Company:ACME',
  'Address 1:Hauptstrasse 5',
  'Address 2:Postfach',
  'Address 3:',
  'City / Town:Luzern',
  'County:',
  'State:LU',
  'Zip / Postal Code:6000',
  'Country:CH',
  'Timezone:',
  'Email Address:jm@example.com',
  'Phone:{"num":"41000000","ext":"","cc3l":"CHE"}',
  'Evening Phone:',
  'Mobile Phone:{"num":"79000","ext":"","cc3l":"CHE"}',
  'Fax:',
  'Notes:',
].join('\n')

const ssh = [
  'NoteType:SSH Key',
  'Language:en-US',
  'Bit Strength:256',
  'Format:OpenSSH',
  'Passphrase:pp',
  'Private Key:-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXk',
  '-----END OPENSSH PRIVATE KEY-----',
  'Public Key:ssh-ed25519 AAAA',
  'Hostname:host.example.com',
  'Date:',
  'Notes:',
].join('\n')

const wifi = [
  'NoteType:Wi-Fi Password',
  'Language:en-US',
  'SSID:Büro',
  'Password:wlan-pw',
  'Connection Type:',
  'Connection Mode:',
  'Authentication:WPA2 Personal',
  'Encryption:AES',
  'Notes:',
].join('\n')

const bank = [
  'NoteType:Bank Account',
  'Language:en-US',
  'Bank Name:UBS',
  'Account Number:123',
  'PIN:9',
  'Notes:x',
].join('\n')

const rows = [
  ['url', 'username', 'password', 'totp', 'extra', 'name', 'grouping', 'fav'],
  [
    'https://accounts.example.com/login',
    'me@example.com',
    'p,w"1',
    SECRET,
    'login note\nline 2',
    'Example',
    'Work\\Projects',
    '1',
  ],
  ['https://a.example.com\nhttps://b.example.com', 'meier', 'pw', '', '', 'Multi', '(none)', '0'],
  ['http://sn', '', '', '', 'just a note, ünïcödé', 'Plain note', 'Notes', '0'],
  ['http://sn', '', '', '', card, 'My card', '', '0'],
  ['http://sn', '', '', '', address, 'Home', '', '0'],
  ['http://sn', '', '', '', ssh, 'Key', '', '0'],
  ['http://sn', '', '', '', wifi, 'Wlan', '', '0'],
  ['http://sn', '', '', '', bank, 'Konto', '', '0'],
  ['', '', '', '', '', '', '', '0'],
]

describe('parseLastPass', () => {
  const result = parseLastPass(csvText(rows))

  it('reads logins with folders, favourites, totp and several urls', () => {
    const example = find(result, 'Example')
    const login = as(example.content, 'login')
    expect(login.email).toBe('me@example.com')
    expect(login.password).toBe('p,w"1')
    expect(login.totp).toEqual(totpOf(SECRET))
    expect(login.note).toBe('login note\nline 2')
    expect(login.websites).toEqual([
      { url: normalizeUrl('https://accounts.example.com/login'), match: 'domain' },
    ])
    expect(example).toMatchObject({ pinned: true, folder: 'Work/Projects' })
    const multi = find(result, 'Multi')
    expect(as(multi.content, 'login').username).toBe('meier')
    expect(as(multi.content, 'login').websites).toHaveLength(2)
    expect(multi.folder).toBeNull()
    expect(result.vaults[0]?.items).toHaveLength(8)
  })

  it('reads secure notes, cards, addresses, ssh keys and wifi', () => {
    const plain = find(result, 'Plain note')
    expect(plain.content).toMatchObject({ kind: 'note', note: 'just a note, ünïcödé' })
    expect(plain.folder).toBe('Notes')
    const myCard = as(find(result, 'My card').content, 'card')
    expect(myCard).toMatchObject({
      holder: 'Jürg Muster',
      number: '4111111111111111',
      brand: 'visa',
      code: '123',
      expiry: '2027-03',
      note: 'first line\nsecond: line',
    })
    expect(myCard.fields.map((one) => [one.name, one.value])).toEqual([
      ['Start Date', 'January,2020'],
    ])
    const home = as(find(result, 'Home').content, 'identity')
    expect(home.values).toMatchObject({
      firstName: 'Jürg',
      lastName: 'Muster',
      fullName: 'Jürg Muster',
      birthdate: '1985-02-03',
      street: 'Hauptstrasse 5\nPostfach',
      city: 'Luzern',
      zip: '6000',
      email: 'jm@example.com',
      phone: '41000000',
      secondPhone: '79000',
      company: 'ACME',
    })
    expect(home.sections[0]?.fields.map((one) => one.name)).toEqual(['Title', 'Username'])
    const key = as(find(result, 'Key').content, 'ssh')
    expect(key.privateKey).toBe(
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----',
    )
    expect(key.publicKey).toBe('ssh-ed25519 AAAA')
    expect(key.fields.find((one) => one.name === 'Passphrase')?.kind).toBe('hidden')
    expect(as(find(result, 'Wlan').content, 'wifi')).toMatchObject({
      ssid: 'Büro',
      password: 'wlan-pw',
      security: 'wpa2',
    })
  })

  it('keeps an unknown note type as a note and says so', () => {
    const konto = find(result, 'Konto').content
    expect(konto).toMatchObject({ kind: 'note', note: 'x' })
    expect(konto.fields.map((one) => [one.name, one.kind])).toEqual([
      ['Bank Name', 'text'],
      ['Account Number', 'text'],
      ['PIN', 'hidden'],
    ])
    expect(result.skipped).toEqual([
      { reason: expect.stringContaining('Bank Account'), title: 'Konto' },
    ])
  })

  it('refuses another CSV', () => {
    expect(() => parseLastPass('name,url,username,password\nx,y,z,w\n')).toThrow()
  })
})
