import { describe, expect, it } from 'vitest'
import { totpOf } from './build'
import { keeperFolderOf, parseKeeper } from './keeper'

const OTP = 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&issuer=&algorithm=SHA1&digits=6&period=30'

const JSON_EXPORT = JSON.stringify({
  shared_folders: [{ uid: 'sf1', path: 'Team\\Ops' }],
  records: [
    {
      title: 'Amazon',
      login: 'me@example.com',
      password: 'pw',
      login_url: 'https://amazon.com',
      notes: 'n',
      last_modified: 1764674791,
      $type: 'login',
      custom_fields: {
        $oneTimeCode: OTP,
        $url: ['https://login.amazon.com', 'https://logout.amazon.com'],
        '$text:some label': 'some text',
        '$secret:recovery': 'hidden',
      },
      folders: [{ folder: 'Shopping\\Online' }],
    },
    {
      title: 'Visa',
      $type: 'bankCard',
      custom_fields: {
        $paymentCard: {
          cardNumber: '4532123456789010',
          cardExpirationDate: '06/2030',
          cardSecurityCode: '347',
        },
        '$text:cardholderName': 'Sarah Johnson',
        $pinCode: '8426',
      },
      folders: [{ shared_folder: 'Team\\Ops' }],
    },
    {
      title: 'Passport',
      $type: 'passport',
      custom_fields: {
        '$accountNumber:passportNumber': '543826194',
        $name: { first: 'Jennifer', middle: 'Lynn', last: 'Williams' },
        $birthDate: 648597600000,
        $expirationDate: 2005596000000,
      },
    },
    {
      title: 'Home',
      $type: 'address',
      custom_fields: {
        $address: {
          street1: '742 Evergreen',
          street2: 'Apt 3B',
          city: 'Springfield',
          state: 'OR',
          zip: '97477',
          country: 'US',
        },
      },
    },
    { title: 'Secret note', $type: 'encryptedNotes', notes: 'top secret' },
    {
      title: 'Server',
      $type: 'sshKeys',
      login: 'root',
      custom_fields: { $keyPair: { publicKey: 'ssh-ed25519 AAA', privateKey: '-----BEGIN-----' } },
    },
    {
      title: 'Wifi',
      $type: 'wifiCredentials',
      password: 'wpa-pw',
      custom_fields: { '$text:SSID': 'home' },
    },
    { title: 'DB', $type: 'databaseCredentials', login: 'admin', password: 'dbpw' },
    { title: 'Photo', $type: 'photo', notes: 'beach' },
  ],
})

describe('keeperFolderOf', () => {
  it('splits on single backslashes and keeps doubled ones', () => {
    expect(keeperFolderOf('Work\\Projects\\2025')).toBe('Work/Projects/2025')
    expect(keeperFolderOf('Dev\\Name\\\\with')).toBe('Dev/Name\\with')
  })
})

describe('parseKeeper json', () => {
  it('reads each kind of record', () => {
    const { vaults, skipped } = parseKeeper(JSON_EXPORT)
    const all = vaults.flatMap((v) => v.items.map((item) => ({ vault: v.name, item })))
    const by = new Map(all.map((one) => [one.item.content.title, one]))
    expect(by.get('Amazon')?.item).toMatchObject({
      folder: 'Shopping/Online',
      modified: 1764674791000,
      content: {
        kind: 'login',
        email: 'me@example.com',
        totp: totpOf(OTP),
        websites: [
          { url: 'https://amazon.com/' },
          { url: 'https://login.amazon.com/' },
          { url: 'https://logout.amazon.com/' },
        ],
      },
    })
    expect(by.get('Amazon')?.item.content.fields.map((f) => [f.name, f.kind, f.value])).toEqual([
      ['some label', 'text', 'some text'],
      ['recovery', 'hidden', 'hidden'],
    ])
    expect(by.get('Visa')?.vault).toBe('Team/Ops')
    expect(by.get('Visa')?.item.content).toMatchObject({
      kind: 'card',
      holder: 'Sarah Johnson',
      expiry: '2030-06',
      code: '347',
      pin: '8426',
    })
    expect(by.get('Passport')?.item.content).toMatchObject({
      kind: 'identity',
      values: {
        passport: '543826194',
        firstName: 'Jennifer',
        lastName: 'Williams',
        birthdate: '1990-07-21',
      },
    })
    expect(by.get('Home')?.item.content).toMatchObject({
      values: { street: '742 Evergreen, Apt 3B', city: 'Springfield', zip: '97477' },
    })
    expect(by.get('Secret note')?.item.content).toMatchObject({ kind: 'note', note: 'top secret' })
    expect(by.get('Server')?.item.content).toMatchObject({
      kind: 'ssh',
      publicKey: 'ssh-ed25519 AAA',
    })
    expect(by.get('Wifi')?.item.content).toMatchObject({
      kind: 'wifi',
      ssid: 'home',
      password: 'wpa-pw',
    })
    expect(by.get('DB')?.item.content).toMatchObject({ kind: 'login', username: 'admin' })
    expect(by.get('Photo')?.item.content).toMatchObject({ kind: 'note', note: 'beach' })
    expect(skipped.map((s) => s.title).sort()).toEqual(['DB', 'Photo'])
  })
})

describe('parseKeeper csv', () => {
  it('reads the columns and the custom pairs', () => {
    const csv =
      'Personal\\Mail,Mail,me@example.com,"p,w",https://mail.example.com,"a\nb",,TFC:Keeper,JBSWY3DPEHPK3PXP,PIN,1234\n' +
      ',Shared one,bob,pw,,,Team,\n'
    const { vaults } = parseKeeper(csv)
    const items = vaults.flatMap((v) => v.items)
    expect(items[0]).toMatchObject({
      folder: 'Personal/Mail',
      content: {
        email: 'me@example.com',
        password: 'p,w',
        note: 'a\nb',
        totp: totpOf('JBSWY3DPEHPK3PXP'),
      },
    })
    expect(items[0]?.content.fields.map((f) => [f.name, f.value])).toEqual([['PIN', '1234']])
    expect(vaults.map((v) => v.name)).toEqual(['Keeper', 'Team'])
  })
})
