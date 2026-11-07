import { describe, expect, it } from 'vitest'
import { totpOf } from './build'
import { parseKeePass } from './keepass'

const OTP = 'otpauth://totp/KeePass:me?secret=JBSWY3DPEHPK3PXP'
const BIN = 'cmVjeWNsZWJpbg=='

const entry = (strings: Record<string, string>, extra = '', times = '') =>
  `<Entry><UUID>x</UUID>${times}${Object.entries(strings)
    .map(
      ([key, value]) =>
        `<String><Key>${key}</Key><Value${key === 'Password' || key === 'Secret' ? ' ProtectInMemory="True"' : ''}>${value}</Value></String>`,
    )
    .join(
      '',
    )}${extra}<History><Entry><String><Key>Title</Key><Value>old</Value></String></Entry></History></Entry>`

const XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile>
  <Meta><DatabaseName>Mine</DatabaseName><RecycleBinEnabled>True</RecycleBinEnabled><RecycleBinUUID>${BIN}</RecycleBinUUID></Meta>
  <Root>
    <Group>
      <UUID>root</UUID><Name>Database</Name>
      ${entry(
        {
          Title: 'Top',
          UserName: 'me@example.com',
          Password: 'p&amp;w',
          URL: 'https://a.example.com',
          Notes: 'l1\nl2',
          otp: OTP,
          KP2A_URL_1: 'https://b.example.com',
          Secret: 'hide',
          Shown: 'see',
          Empty: '',
        },
        '<Binary><Key>file.txt</Key><Value Ref="0"/></Binary>',
        '<Times><CreationTime>2024-01-02T03:04:05Z</CreationTime><LastModificationTime>2024-02-02T03:04:05Z</LastModificationTime></Times>',
      )}
      <Group>
        <UUID>g1</UUID><Name>Email</Name>
        <Group>
          <UUID>g2</UUID><Name>Wörk</Name>
          ${entry({ Title: 'Deep', UserName: 'bob', Password: 'pw' })}
          ${entry({ Title: 'Just a note', Notes: 'remember' })}
        </Group>
      </Group>
      <Group>
        <UUID>${BIN}</UUID><Name>Papierkorb</Name>
        ${entry({ Title: 'Gone', Password: 'x' })}
      </Group>
    </Group>
    <DeletedObjects/>
  </Root>
</KeePassFile>`

describe('parseKeePass', () => {
  it('reads entries, their group paths, fields, 2FA and the recycle bin', () => {
    const { vaults, skipped } = parseKeePass(XML)
    expect(vaults.map((v) => v.name)).toEqual(['Mine'])
    const items = vaults[0]?.items ?? []
    expect(items.map((one) => one.content.title)).toEqual(['Top', 'Deep', 'Just a note', 'Gone'])
    const [top, deep, note, gone] = items
    expect(top).toMatchObject({
      folder: null,
      trashed: false,
      created: Date.parse('2024-01-02T03:04:05Z'),
      modified: Date.parse('2024-02-02T03:04:05Z'),
      content: {
        kind: 'login',
        email: 'me@example.com',
        password: 'p&w',
        note: 'l1\nl2',
        totp: totpOf(OTP),
        websites: [{ url: 'https://a.example.com/' }, { url: 'https://b.example.com/' }],
      },
    })
    expect(top?.content.fields.map((f) => [f.name, f.kind, f.value])).toEqual([
      ['Secret', 'hidden', 'hide'],
      ['Shown', 'text', 'see'],
    ])
    expect(deep).toMatchObject({ folder: 'Email/Wörk', content: { username: 'bob' } })
    expect(note).toMatchObject({
      folder: 'Email/Wörk',
      content: { kind: 'note', note: 'remember' },
    })
    expect(gone).toMatchObject({ trashed: true, folder: null })
    expect(skipped).toEqual([{ reason: 'Its attachments did not come in.', title: 'Top' }])
  })

  it('says when values are still encrypted', () => {
    const xml = `<KeePassFile><Root><Group><Name>R</Name><Entry><String><Key>Title</Key><Value>T</Value></String><String><Key>Password</Key><Value Protected="True">AAAA</Value></String></Entry></Group></Root></KeePassFile>`
    const { vaults, skipped } = parseKeePass(xml)
    expect(skipped[0]?.title).toBe('T')
    expect(vaults[0]?.items[0]?.content).toMatchObject({ kind: 'note', title: 'T' })
  })

  it('finds a recycle bin by name when the meta names none', () => {
    const xml = `<KeePassFile><Root><Group><Name>R</Name><Group><Name>Recycle Bin</Name>${entry({ Title: 'T', Password: 'p' })}</Group></Group></Root></KeePassFile>`
    expect(parseKeePass(xml).vaults[0]?.items[0]?.trashed).toBe(true)
  })

  it('refuses another XML file', () => {
    expect(() => parseKeePass('<html></html>')).toThrow()
  })
})
