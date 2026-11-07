import { describe, expect, it } from 'vitest'
import { WrongSecret, type KdfParams } from './crypto'
import { blank, newEnvelope } from './envelope'
import { exportCsv, exportJson, isSealedExport, openExport, sealExport } from './export'
import { cardOf, fieldOf, identityOf, loginOf, noteOf } from './import/build'
import { csvRecords } from './import/csv'
import { importFile, guessSource } from './import/index'
import type { Envelope, VaultMeta } from './types'

const FAST: KdfParams = { m: 64, t: 1, p: 1 }
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

const meta = (name: string, folders: VaultMeta['folders'] = []): VaultMeta => ({
  v: 1,
  name,
  description: '',
  color: 'blue',
  icon: 'home',
  folders,
  hidePasswordsFromViewers: false,
})

function envelope(content: Envelope['content'], extra: Partial<Envelope> = {}): Envelope {
  return { ...newEnvelope(content, 1_700_000_000_000), ...extra }
}

const login = envelope(
  loginOf({
    title: 'Grüße "Bank"',
    email: 'me@example.com',
    username: 'me',
    password: 'p,a"ss\nword',
    totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
    urls: ['https://bank.example.com/login', 'https://m.bank.example.com'],
    note: 'line 1\nline 2',
    fields: [fieldOf('PIN', '1234', 'hidden')],
  }),
  { pinned: true, folder: 'f2', modified: 1_700_000_100_000 },
)
const vaults = [
  {
    meta: meta('Personal', [
      { id: 'f1', name: 'Money', parent: null },
      { id: 'f2', name: 'Banks', parent: 'f1' },
    ]),
    items: [
      login,
      envelope(noteOf('Note', '日本語')),
      envelope(
        cardOf({ title: 'Visa', number: '4111 1111 1111 1111', expiry: '04/29', code: '123' }),
      ),
      envelope(identityOf({ values: { firstName: 'Ada', lastName: 'Lovelace' } }), { trashed: 5 }),
      envelope({ ...blank('wifi'), title: 'Home', ssid: 'home', password: 'pw' }),
    ],
  },
  { meta: meta('Work'), items: [envelope(loginOf({ title: 'Work', password: 'x' }))] },
]

describe('exportJson', () => {
  it('reads back through the Orden import as the same items', () => {
    const text = exportJson(vaults)
    expect(JSON.parse(text)).toMatchObject({ format: 'orden-pass', version: 1 })
    expect(guessSource('pass.json', text)).toBe('orden')
    const back = importFile('orden', 'pass.json', utf8(text))
    expect(back.skipped).toEqual([])
    expect(back.vaults.map((v) => v.name)).toEqual(['Personal', 'Work'])
    const personal = back.vaults[0]?.items ?? []
    expect(personal.map((one) => one.content)).toEqual(vaults[0]?.items.map((one) => one.content))
    expect(personal[0]).toMatchObject({
      pinned: true,
      trashed: false,
      folder: 'Money/Banks',
      created: 1_700_000_000_000,
      modified: 1_700_000_100_000,
    })
    expect(personal[3]?.trashed).toBe(true)
  })

  it('leaves attachments out', () => {
    const withFile = envelope(noteOf('n', 'x'), {
      attachments: [{ id: 'a', name: 'a.txt', type: 'text/plain', size: 1, key: 'k' }],
    })
    const text = exportJson([{ meta: meta('V'), items: [withFile] }])
    expect(text).not.toContain('a.txt')
  })
})

describe('exportCsv', () => {
  it('writes the logins that are not in the trash', () => {
    const items = [
      login,
      envelope(noteOf('n', 'x')),
      envelope(loginOf({ title: 'gone', password: 'x' }), { trashed: 1 }),
    ]
    const text = exportCsv(items)
    expect(text.split('\r\n')[0]).toBe('name,url,email,username,password,totp,note')
    const rows = csvRecords(text)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      name: 'Grüße "Bank"',
      url: 'https://bank.example.com/login, https://m.bank.example.com/',
      email: 'me@example.com',
      username: 'me',
      password: 'p,a"ss\nword',
      totp: login.content.kind === 'login' ? login.content.totp : '',
      note: 'line 1\nline 2',
    })
  })

  it('keeps a spreadsheet from reading a cell as a formula, and a password exactly as it is', () => {
    const risky = envelope(
      loginOf({
        title: '=HYPERLINK("https://evil.example","x")',
        username: '+1+1',
        email: '@SUM(A1)',
        password: '-2+3',
        note: '\tcmd',
      }),
    )
    const rows = csvRecords(exportCsv([risky]))
    expect(rows[0]).toMatchObject({
      name: `'=HYPERLINK("https://evil.example","x")`,
      username: "'+1+1",
      email: "'@SUM(A1)",
      password: '-2+3',
      note: "'\tcmd",
    })
  })

  it('reads back through the CSV import', () => {
    const back = importFile('csv', 'x.csv', utf8(exportCsv([login])))
    const content = back.vaults[0]?.items[0]?.content
    expect(content?.kind).toBe('login')
    if (content?.kind !== 'login' || login.content.kind !== 'login') return
    expect(content.password).toBe(login.content.password)
    expect(content.websites).toEqual(login.content.websites)
    expect(content.totp).toBe(login.content.totp)
  })
})

describe('sealExport', () => {
  it('opens with the passphrase', async () => {
    const text = exportJson(vaults)
    const sealed = await sealExport(text, 'correct horse', FAST)
    const parsed = JSON.parse(sealed) as Record<string, unknown>
    expect(parsed).toMatchObject({
      format: 'orden-pass-sealed',
      version: 1,
      kdf: { m: 64, t: 1, p: 1 },
    })
    expect(sealed).not.toContain('Personal')
    expect(isSealedExport(sealed)).toBe(true)
    expect(isSealedExport(text)).toBe(false)
    expect(guessSource('x.json', sealed)).toBe('orden')
    expect(await openExport(sealed, 'correct horse')).toBe(text)
  })

  it('refuses a wrong passphrase', async () => {
    const sealed = await sealExport('secret', 'right', FAST)
    await expect(openExport(sealed, 'wrong')).rejects.toBeInstanceOf(WrongSecret)
  })

  it('refuses a tampered seal', async () => {
    const sealed = JSON.parse(await sealExport('secret', 'right', FAST)) as Record<string, string>
    const bytes = atob(sealed.sealed ?? '')
    const flipped = bytes.slice(0, -1) + String.fromCharCode(bytes.charCodeAt(bytes.length - 1) ^ 1)
    const tampered = JSON.stringify({ ...sealed, sealed: btoa(flipped) })
    await expect(openExport(tampered, 'right')).rejects.toBeInstanceOf(WrongSecret)
  })

  it('refuses stretching it cannot trust and what is not a sealed export', async () => {
    const sealed = JSON.parse(await sealExport('secret', 'right', FAST)) as Record<string, unknown>
    const huge = JSON.stringify({ ...sealed, kdf: { ...(sealed.kdf as object), m: 1 << 30 } })
    await expect(openExport(huge, 'right')).rejects.toThrow(/key stretching/)
    await expect(openExport('{"format":"other"}', 'right')).rejects.toThrow(/not a sealed export/)
    await expect(openExport('nope', 'right')).rejects.toThrow(/not a sealed export/)
  })

  it('the Orden import asks for the passphrase first', async () => {
    const sealed = await sealExport('{}', 'right', FAST)
    expect(() => importFile('orden', 'x.json', utf8(sealed))).toThrow(/passphrase/)
  })
})
