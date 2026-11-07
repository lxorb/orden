import { describe, expect, it } from 'vitest'
import { totpOf } from './build'
import { columnsOf, csvLooksLike, parseCsv } from './generic'

describe('parseCsv', () => {
  it('finds the columns by their names', () => {
    const csv =
      'Account,Website,Login,E-mail,Passwd,OTP,Comments,Group,Security PIN,Colour\n' +
      'Mail,"https://a.example.com, https://b.example.com",bob,bob@example.com,"p,w",JBSWY3DPEHPK3PXP,"x\ny",Work/Mail,1234,blue\n' +
      'Memo,,,,,,just a note,,,\n'
    const items = parseCsv(csv).vaults[0]?.items ?? []
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      folder: 'Work/Mail',
      content: {
        kind: 'login',
        title: 'Mail',
        username: 'bob',
        email: 'bob@example.com',
        password: 'p,w',
        totp: totpOf('JBSWY3DPEHPK3PXP'),
        note: 'x\ny',
        websites: [{ url: 'https://a.example.com/' }, { url: 'https://b.example.com/' }],
      },
    })
    expect(items[0]?.content.fields.map((f) => [f.name, f.kind, f.value])).toEqual([
      ['Security PIN', 'hidden', '1234'],
      ['Colour', 'text', 'blue'],
    ])
    expect(items[1]?.content).toMatchObject({ kind: 'note', note: 'just a note' })
  })

  it('refuses a file with no password column', () => {
    expect(csvLooksLike(['a', 'b'])).toBe(false)
    expect(() => parseCsv('a,b\n1,2\n')).toThrow()
    expect(columnsOf(['Name', 'URL', 'Password'])).toEqual({ title: 0, url: 1, password: 2 })
  })
})
