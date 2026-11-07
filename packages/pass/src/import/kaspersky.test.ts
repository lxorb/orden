import { describe, expect, it } from 'vitest'
import { parseKaspersky } from './kaspersky'

const TXT = `Websites

Website name: Google
Website URL: https://accounts.google.com
Login name: personal
Login: me@gmail.com
Password: p: w
Comment: first line
second line

---

Website name: Bänk
Website URL: bank.example.com
Login: jörg
Password: pw
Comment:

---

Applications

Application: Skype
Login: skypeuser
Password: sk
Comment:

---

Other Accounts

Account name: Router
Login: admin
Password: admin
Comment: in the hall

---

Notes

Name: Shopping
Text: milk
eggs

---
`

describe('parseKaspersky', () => {
  it('reads websites, applications, other accounts and notes', () => {
    const items = parseKaspersky(TXT.replace(/\n/g, '\r\n')).vaults[0]?.items ?? []
    expect(items.map((one) => one.content.title)).toEqual([
      'Google',
      'Bänk',
      'Skype',
      'Router',
      'Shopping',
    ])
    const [google, bank, skype, router, shopping] = items
    expect(google?.content).toMatchObject({
      kind: 'login',
      email: 'me@gmail.com',
      password: 'p: w',
      note: 'first line\nsecond line',
      websites: [{ url: 'https://accounts.google.com/' }],
      fields: [{ name: 'Login name', value: 'personal' }],
    })
    expect(bank?.content).toMatchObject({
      username: 'jörg',
      note: '',
      websites: [{ url: 'https://bank.example.com/' }],
    })
    expect(skype).toMatchObject({ folder: 'Applications', content: { username: 'skypeuser' } })
    expect(router).toMatchObject({ folder: 'Other Accounts', content: { note: 'in the hall' } })
    expect(shopping?.content).toMatchObject({ kind: 'note', note: 'milk\neggs' })
  })
})
