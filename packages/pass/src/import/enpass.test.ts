import { describe, expect, it } from 'vitest'
import { totpOf } from './build'
import { parseEnpass } from './enpass'

const field = (type: string, label: string, value: string, sensitive = 0, deleted = 0) => ({
  type,
  label,
  value,
  sensitive,
  deleted,
  order: 0,
  uid: 0,
})

const EXPORT = JSON.stringify({
  folders: [
    { uuid: 'f1', title: 'Work', parent_uuid: '' },
    { uuid: 'f2', title: 'Mail', parent_uuid: 'f1' },
  ],
  items: [
    {
      category: 'login',
      title: 'Mail',
      note: 'n\nm',
      favorite: 1,
      trashed: 0,
      createdAt: 1666449561,
      updated_at: 1666449999,
      folders: ['f2'],
      fields: [
        field('username', 'Username', 'jörg'),
        field('email', 'E-mail', 'jorg@example.com'),
        field('password', 'Password', 'pw', 1),
        field('url', 'Website', 'https://mail.example.com'),
        field('url', 'Website 2', 'https://webmail.example.com'),
        field('totp', 'TOTP', 'JBSWY3DPEHPK3PXP', 1),
        field('section', 'More', ''),
        field('text', 'Security answer', 'blue', 1),
        field('text', 'Old', 'gone', 0, 1),
        field('text', 'Empty', ''),
      ],
    },
    {
      category: 'creditcard',
      title: 'Amex',
      trashed: 1,
      fields: [
        field('ccName', 'Cardholder', 'Emily Sample'),
        field('ccNumber', 'Number', '3782 822463 10005'),
        field('ccCvc', 'CVC', '1234', 1),
        field('ccPin', 'PIN', '9874', 1),
        field('ccExpiry', 'Expiry date', '03/23'),
        field('ccBankname', 'Bank', 'Big Bank'),
      ],
    },
    { category: 'note', title: 'Memo', note: 'text' },
    {
      category: 'identity',
      title: 'Me',
      fields: [
        field('text', 'First name', 'Ada'),
        field('text', 'Last name', 'Lovelace'),
        field('date', 'Birthday', '1815-12-10'),
        field('text', 'Shoe size', '38'),
      ],
    },
    { category: 'travel', title: 'Trip', note: 'Rome', fields: [field('text', 'Booking', 'ABC')] },
  ],
})

describe('parseEnpass', () => {
  it('reads logins, cards, notes, identities and folders', () => {
    const { vaults, skipped } = parseEnpass(EXPORT)
    const items = vaults[0]?.items ?? []
    const by = new Map(items.map((one) => [one.content.title, one]))
    expect(by.get('Mail')).toMatchObject({
      folder: 'Work/Mail',
      pinned: true,
      trashed: false,
      created: 1666449561000,
      modified: 1666449999000,
      content: {
        kind: 'login',
        username: 'jörg',
        email: 'jorg@example.com',
        password: 'pw',
        totp: totpOf('JBSWY3DPEHPK3PXP'),
        websites: [{ url: 'https://mail.example.com/' }, { url: 'https://webmail.example.com/' }],
      },
    })
    expect(by.get('Mail')?.content.fields.map((f) => [f.name, f.kind, f.value])).toEqual([
      ['Security answer', 'hidden', 'blue'],
    ])
    expect(by.get('Amex')).toMatchObject({
      trashed: true,
      content: {
        kind: 'card',
        brand: 'amex',
        number: '378282246310005',
        expiry: '2023-03',
        code: '1234',
        pin: '9874',
      },
    })
    expect(by.get('Memo')?.content).toMatchObject({ kind: 'note', note: 'text' })
    expect(by.get('Me')?.content).toMatchObject({
      kind: 'identity',
      values: { firstName: 'Ada', lastName: 'Lovelace', birthdate: '1815-12-10' },
    })
    expect(by.get('Trip')?.content).toMatchObject({ kind: 'note', note: 'Rome' })
    expect(skipped.map((one) => one.title)).toEqual(['Trip'])
  })
})
