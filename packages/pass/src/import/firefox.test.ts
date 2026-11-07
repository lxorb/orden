import { describe, expect, it } from 'vitest'
import { parseFirefox } from './firefox'

const CSV = [
  '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"',
  '"https://accounts.example.com","ana@example.com","pw ""1""","","https://login.example.com","{a}","1700000000000","1700000500000","1700000900000"',
  '"https://shop.example.co.uk","café","pw2","","","{b}","1600000000000","",""',
  '"chrome://FirefoxAccounts","x","y","Firefox Accounts credentials","","{c}","1","1","1"',
].join('\r\n')

describe('parseFirefox', () => {
  it('reads logins, both addresses and the times', () => {
    const { vaults } = parseFirefox(CSV)
    const items = vaults[0]?.items ?? []
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      created: 1_700_000_000_000,
      modified: 1_700_000_900_000,
      content: {
        kind: 'login',
        title: 'accounts.example.com',
        email: 'ana@example.com',
        password: 'pw "1"',
        websites: [
          { url: 'https://accounts.example.com/', match: 'domain' },
          { url: 'https://login.example.com/', match: 'domain' },
        ],
      },
    })
    expect(items[1]?.content).toMatchObject({
      username: 'café',
      websites: [{ url: 'https://shop.example.co.uk/' }],
    })
    expect(items[1]?.modified).toBeNull()
  })
})
