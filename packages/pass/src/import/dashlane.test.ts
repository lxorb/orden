import { describe, expect, it } from 'vitest'
import { totpOf } from './build'
import { parseDashlane } from './dashlane'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

const CREDENTIALS =
  'username,username2,username3,title,password,note,url,category,otpSecret\n' +
  'me@example.com,alt,,GitHub,"pa""ss",,https://github.com,Work,JBSWY3DPEHPK3PXP\n' +
  'jörg,,,Bank,pw,"two\nlines",https://bank.example.com,,\n'
const NOTES = 'title,note\nWi-Fi,"code: 1234\nsecond"\n'
const PAYMENTS =
  'type,account_name,account_holder,cc_number,code,expiration_month,expiration_year,routing_number,account_number,country,issuing_bank\n' +
  'payment_card,My Visa,Ada Lovelace,4111 1111 1111 1111,123,4,2029,,,GB,Bank\n' +
  'bank,Checking,Ada Lovelace,,,,,021000021,000123456,US,Bank\n'
const IDS =
  'type,number,name,issue_date,expiration_date,place_of_issue,state\n' +
  'passport,X1234567,Ada Lovelace,2020-01-01,2030-01-01,London,\n' +
  'card,ID-99,Ada Lovelace,,,,\n'
const PERSONAL =
  'type,title,first_name,middle_name,last_name,login,date_of_birth,place_of_birth,email,email_type,item_name,phone_number,address,country,state,city,zip,address_recipient,address_building,address_apartment,address_floor,address_door_code,job_title,url\n' +
  'name,Ms,Ada,,Lovelace,,1815-12-10,London,,,Me,,,,,,,,,,,,,\n' +
  'address,,,,,,,,,,Home,,12 Rue Ünique,FR,,Paris,75001,Ada,B,3,2,4711,,\n'

describe('parseDashlane', () => {
  it('reads every file of the zip', () => {
    const { vaults, skipped } = parseDashlane({
      'credentials.csv': utf8(CREDENTIALS),
      'securenotes.csv': utf8(NOTES),
      'payments.csv': utf8(PAYMENTS),
      'ids.csv': utf8(IDS),
      'personalInfo.csv': utf8(PERSONAL),
      'readme.txt': utf8('x'),
    })
    expect(skipped).toEqual([])
    const items = vaults[0]?.items ?? []
    const byTitle = new Map(items.map((one) => [one.content.title, one]))
    expect(byTitle.get('GitHub')).toMatchObject({
      folder: 'Work',
      content: {
        kind: 'login',
        email: 'me@example.com',
        password: 'pa"ss',
        totp: totpOf('JBSWY3DPEHPK3PXP'),
      },
    })
    expect(byTitle.get('GitHub')?.content.fields.map((f) => [f.name, f.value])).toEqual([
      ['Username 2', 'alt'],
    ])
    expect(byTitle.get('Bank')?.content).toMatchObject({ username: 'jörg', note: 'two\nlines' })
    expect(byTitle.get('Wi-Fi')?.content).toMatchObject({
      kind: 'note',
      note: 'code: 1234\nsecond',
    })
    expect(byTitle.get('My Visa')?.content).toMatchObject({
      kind: 'card',
      holder: 'Ada Lovelace',
      number: '4111111111111111',
      brand: 'visa',
      expiry: '2029-04',
      code: '123',
    })
    expect(byTitle.get('Checking')?.content.kind).toBe('note')
    expect(
      byTitle.get('Checking')?.content.fields.find((f) => f.name === 'Account number'),
    ).toMatchObject({
      kind: 'hidden',
      value: '000123456',
    })
    expect(byTitle.get('Passport (Ada Lovelace)')?.content).toMatchObject({
      kind: 'identity',
      values: { passport: 'X1234567', fullName: 'Ada Lovelace' },
    })
    expect(byTitle.get('Me')?.content).toMatchObject({
      values: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        birthdate: '1815-12-10',
        fullName: 'Ada Lovelace',
      },
    })
    expect(byTitle.get('Home')?.content).toMatchObject({
      values: {
        street: '12 Rue Ünique, B, 3',
        floor: '2',
        city: 'Paris',
        zip: '75001',
        country: 'FR',
      },
    })
  })

  it('reads one csv by its header', () => {
    const items = parseDashlane(CREDENTIALS).vaults[0]?.items ?? []
    expect(items).toHaveLength(2)
  })

  it('says when a file is not one it knows', () => {
    expect(parseDashlane('a,b\n1,2\n').skipped).toHaveLength(1)
  })
})
