import { describe, expect, it } from 'vitest'
import { totpOf } from './build'
import { parseKeePassXC } from './keepassxc'

const OTP = 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&issuer=x'

describe('parseKeePassXC', () => {
  it('reads groups, 2FA, notes, times and the recycle bin', () => {
    const csv = [
      '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"',
      `"Root","Top","me@example.com","pw","https://example.com","","${OTP}","0","2024-02-01T00:00:00Z","2024-01-01T00:00:00Z"`,
      '"Root/Email/Wörk","Deep","bob","p""w","","multi\nline","","0","",""',
      '"Root/Recycle Bin","Gone","","x","","","","0","",""',
      '"Root/Notes","Only a note","","","","just text","","0","",""',
    ].join('\n')
    const items = parseKeePassXC(csv).vaults[0]?.items ?? []
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({
      folder: null,
      created: Date.parse('2024-01-01T00:00:00Z'),
      modified: Date.parse('2024-02-01T00:00:00Z'),
      content: { email: 'me@example.com', totp: totpOf(OTP) },
    })
    expect(items[1]).toMatchObject({
      folder: 'Email/Wörk',
      content: { password: 'p"w', note: 'multi\nline' },
    })
    expect(items[2]).toMatchObject({ trashed: true, folder: null })
    expect(items[3]).toMatchObject({
      folder: 'Notes',
      content: { kind: 'note', note: 'just text' },
    })
  })
})
