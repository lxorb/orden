import { describe, expect, it } from 'vitest'
import { parseNordPass } from './nordpass'

const HEAD =
  'name,url,additional_urls,username,password,note,cardholdername,cardnumber,cvc,pin,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state,type,custom_fields\n'

describe('parseNordPass', () => {
  it('reads every type', () => {
    const csv =
      HEAD +
      'Social,,,,,,,,,,,,,,,,,,,,,folder,\n' +
      'Site,https://example.com,"[""https://example.net"",""https://example.org""]",hello@example.com,pw,"a\nb",,,,,,,Social,,,,,,,,,password,"[{""label"":""Secret Q"",""type"":""hidden"",""value"":""blue""}]"\n' +
      'Visa,,,,,,Ünal Holder,4024007103939509,123,9999,01 / 29,12345,,,,,,,,,,credit_card,\n' +
      'Me,,,,,note me,,,,,,123456,,Ada Lovelace,123456789,ada@example.com,Street 1,Floor 2,Köln,Germany,NRW,identity,\n' +
      'Memo,,,,,just text,,,,,,,,,,,,,,,,note,\n' +
      'Thing,,,,,,,,,,,,,,,,,,,,,passkey,\n'
    const { vaults, skipped } = parseNordPass(csv)
    const items = vaults[0]?.items ?? []
    const by = new Map(items.map((one) => [one.content.title, one]))
    expect(items).toHaveLength(5)
    expect(by.get('Site')).toMatchObject({
      folder: 'Social',
      content: {
        kind: 'login',
        email: 'hello@example.com',
        note: 'a\nb',
        websites: [
          { url: 'https://example.com/' },
          { url: 'https://example.net/' },
          { url: 'https://example.org/' },
        ],
        fields: [{ name: 'Secret Q', kind: 'hidden', value: 'blue' }],
      },
    })
    expect(by.get('Visa')?.content).toMatchObject({
      kind: 'card',
      holder: 'Ünal Holder',
      expiry: '2029-01',
      code: '123',
      pin: '9999',
    })
    expect(by.get('Me')?.content).toMatchObject({
      kind: 'identity',
      values: { fullName: 'Ada Lovelace', phone: '123456789', city: 'Köln', zip: '123456' },
    })
    expect(by.get('Memo')?.content).toMatchObject({ kind: 'note', note: 'just text' })
    expect(by.get('Thing')?.content.kind).toBe('note')
    expect(skipped.map((one) => one.title)).toEqual(['Thing'])
  })
})
