import { describe, expect, it } from 'vitest'
import { blank, contentIn, envelopeIn, newEnvelope, vaultMetaIn } from './envelope'
import { ITEM_KINDS } from './types'

describe('blank', () => {
  it('makes every kind with its defaults', () => {
    for (const kind of ITEM_KINDS) {
      const content = blank(kind)
      expect(content.kind).toBe(kind)
      expect(content.title).toBe('')
      expect(contentIn(content)).toEqual(content)
    }
    expect(blank('alias')).toMatchObject({ provider: 'manual', enabled: true, mailboxes: [] })
    expect(blank('card').brand).toBe('other')
    expect(blank('wifi').security).toBe('wpa2')
    expect(blank('identity').values).toEqual({})
    expect(blank('login')).toMatchObject({ websites: [], passkeys: [], totp: '' })
  })
})

describe('contentIn', () => {
  it("keeps a custom item's chosen icon", () => {
    const custom = contentIn({ kind: 'custom', title: 'Bike', template: 't', mark: 'bike' })
    expect(custom).toMatchObject({ kind: 'custom', mark: 'bike' })
    expect(contentIn(JSON.parse(JSON.stringify(custom)))).toEqual(custom)
    expect(contentIn({ kind: 'custom', title: 'Bike' })).not.toHaveProperty('mark')
  })

  it('fills what is missing', () => {
    const login = contentIn({
      kind: 'login',
      title: 'Bank',
      websites: [{ url: 'https://bank.example' }],
      passkeys: [{ id: 'p1', rpId: 'bank.example' }],
      fields: [{ id: 'f1', name: 'PIN' }],
    })
    expect(login).toMatchObject({
      kind: 'login',
      title: 'Bank',
      note: '',
      password: '',
      websites: [{ url: 'https://bank.example', match: 'domain' }],
      passkeys: [{ id: 'p1', rpId: 'bank.example', algorithm: -7, counter: 0, created: 0 }],
      fields: [{ id: 'f1', name: 'PIN', kind: 'text', value: '' }],
    })
  })

  it('refuses the wrong type anywhere', () => {
    for (const bad of [
      null,
      'login',
      [],
      {},
      { kind: 1 },
      { kind: 'login', title: 5 },
      { kind: 'login', websites: {} },
      { kind: 'login', websites: [{ url: 1 }] },
      { kind: 'login', fields: [{ id: 'f', value: null }] },
      { kind: 'alias', enabled: 'yes' },
      { kind: 'alias', mailboxes: [1] },
      { kind: 'card', brand: 3 },
      { kind: 'login', passkeys: [{ id: 'p', counter: 'one' }] },
      { kind: 'login', passkeys: [{ id: 'p', counter: Number.NaN }] },
      { kind: 'identity', values: [] },
      { kind: 'identity', values: { email: 5 } },
      { kind: 'custom', sections: [{ id: 's', fields: 'x' }] },
    ])
      expect(contentIn(bad)).toBeNull()
  })

  it('refuses an empty or missing id', () => {
    expect(contentIn({ kind: 'note', fields: [{ id: '' }] })).toBeNull()
    expect(contentIn({ kind: 'note', fields: [{ name: 'x' }] })).toBeNull()
    expect(contentIn({ kind: 'custom', sections: [{ id: '' }] })).toBeNull()
  })

  it('reads a word it does not know as the default', () => {
    expect(contentIn({ kind: 'card', brand: 'unionpay' })).toMatchObject({ brand: 'other' })
    expect(contentIn({ kind: 'wifi', security: 'wpa4' })).toMatchObject({ security: 'wpa2' })
    expect(contentIn({ kind: 'alias', provider: 'fastmail' })).toMatchObject({
      provider: 'manual',
    })
    expect(contentIn({ kind: 'login', websites: [{ url: 'x', match: 'regex' }] })).toMatchObject({
      websites: [{ match: 'domain' }],
    })
    expect(contentIn({ kind: 'passport', title: 'Mine' })).toMatchObject({
      kind: 'custom',
      title: 'Mine',
    })
  })

  it('reads a field of an unknown kind as hidden', () => {
    expect(
      contentIn({ kind: 'note', fields: [{ id: 'f', kind: 'secret-question', value: 'v' }] }),
    ).toMatchObject({ fields: [{ kind: 'hidden', value: 'v' }] })
  })

  it('drops keys and identity values it does not know', () => {
    const identity = contentIn({
      kind: 'identity',
      extra: 1,
      values: { email: 'a@b.c', shoeSize: 44, nickname: 'x' },
    })
    expect(identity).toEqual({
      kind: 'identity',
      title: '',
      note: '',
      fields: [],
      values: { email: 'a@b.c' },
      sections: [],
    })
  })
})

describe('envelopeIn', () => {
  it('round-trips a new envelope', () => {
    const envelope = newEnvelope(blank('login'), 1000)
    expect(envelope).toMatchObject({ created: 1000, modified: 1000, monitored: true, v: 1 })
    expect(envelopeIn(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope)
  })

  it('fills what is missing', () => {
    expect(envelopeIn({ content: { kind: 'note' }, created: 5 })).toEqual({
      v: 1,
      content: blank('note'),
      folder: null,
      trashed: null,
      pinned: false,
      monitored: true,
      attachments: [],
      created: 5,
      modified: 5,
      used: null,
    })
  })

  it('refuses the wrong type, another version and missing content', () => {
    for (const bad of [
      {},
      { content: null },
      { content: { kind: 'note', title: 1 } },
      { content: { kind: 'note' }, v: 2 },
      { content: { kind: 'note' }, pinned: 1 },
      { content: { kind: 'note' }, trashed: 'now' },
      { content: { kind: 'note' }, folder: 3 },
      { content: { kind: 'note' }, attachments: [{ id: 'a', size: '1' }] },
      { content: { kind: 'note' }, attachments: [{ id: '' }] },
    ])
      expect(envelopeIn(bad)).toBeNull()
  })

  it('keeps a trash time and a folder', () => {
    expect(
      envelopeIn({ content: { kind: 'note' }, trashed: 9, folder: 'f1', used: 3 }),
    ).toMatchObject({ trashed: 9, folder: 'f1', used: 3 })
  })
})

describe('vaultMetaIn', () => {
  it('fills defaults and reads unknown words as the default', () => {
    expect(vaultMetaIn({ name: 'Home', color: 'gold', icon: 'rocket' })).toEqual({
      v: 1,
      name: 'Home',
      description: '',
      color: 'purple',
      icon: 'home',
      folders: [],
      hidePasswordsFromViewers: false,
    })
    expect(vaultMetaIn({ color: 'teal', folders: [{ id: 'f', name: 'A' }] })).toMatchObject({
      color: 'teal',
      folders: [{ id: 'f', name: 'A', parent: null }],
    })
  })

  it('keeps a chosen library icon on the vault and its folders', () => {
    const meta = vaultMetaIn({
      name: 'Home',
      mark: 'rocket',
      folders: [
        { id: 'f', name: 'A', mark: 'leaf' },
        { id: 'g', name: 'B' },
      ],
    })
    expect(meta).toMatchObject({ mark: 'rocket', folders: [{ mark: 'leaf' }, { id: 'g' }] })
    expect(meta?.folders[1]).not.toHaveProperty('mark')
    expect(vaultMetaIn(JSON.parse(JSON.stringify(meta)))).toEqual(meta)
    expect(vaultMetaIn({ name: 'Home' })).not.toHaveProperty('mark')
    expect(vaultMetaIn({ name: 'Home', mark: '' })).not.toHaveProperty('mark')
  })

  it('refuses the wrong type', () => {
    expect(vaultMetaIn({ name: 1 })).toBeNull()
    expect(vaultMetaIn({ folders: [{ id: 'f', parent: 2 }] })).toBeNull()
    expect(vaultMetaIn(null)).toBeNull()
  })
})
