import { describe, expect, test } from 'vitest'
import { base64Length, isBase64 } from './shape'
import {
  changesIn,
  inviteIn,
  isPassId,
  isSealed,
  itemRowIn,
  keyringRowIn,
  linkRowIn,
  memberIn,
  MOST_ITEM_BYTES,
  vaultRowIn,
  versionIn,
} from './wire'

const KEYRING = {
  v: 1,
  pub: 'AAAA',
  private: 'AAAA',
  password: { salt: 'AAAAAAAAAAA=', m: 65536, t: 3, p: 1, sealed: 'AAAA' },
  recovery: null,
  at: 1,
}

const VAULT = {
  id: 'vault-one',
  rev: 1,
  meta: 'AAAA',
  key: 'AAAA',
  keyVersion: 1,
  role: 'owner',
  owner: true,
  members: 1,
  deleted: false,
  proof: null,
  handovers: [],
  accepted: null,
}

const ITEM = {
  vault: 'vault-one',
  id: 'item-one',
  rev: 2,
  key: 'AAAA',
  body: 'AAAA',
  keyVersion: 1,
  at: 5,
  deleted: false,
}

describe('base64 as the account keeps it', () => {
  test('is measured in bytes and must be written the one way', () => {
    expect(base64Length('')).toBe(0)
    expect(base64Length('AAAA')).toBe(3)
    expect(base64Length('AA==')).toBe(1)
    expect(base64Length('AAA=')).toBe(2)
    expect(base64Length('AB==')).toBeNull()
    expect(base64Length('AAB=')).toBeNull()
    expect(base64Length('A-_A')).toBeNull()
    expect(isBase64('AAAA', 3, 3)).toBe(true)
    expect(isBase64('AAAA', 4)).toBe(false)
    expect(isBase64('AAAAAAAA', 1, 3)).toBe(false)
  })
})

describe('the shapes the account answers with', () => {
  test('read back what they are', () => {
    expect(keyringRowIn({ keyring: KEYRING, rev: 1 })).toEqual({ keyring: KEYRING, rev: 1 })
    expect(vaultRowIn(VAULT)).toEqual(VAULT)
    expect(vaultRowIn({ ...VAULT, meta: '', key: null, deleted: true })).not.toBeNull()
    expect(itemRowIn(ITEM)).toEqual(ITEM)
    expect(itemRowIn({ ...ITEM, key: '', body: '', deleted: true })).not.toBeNull()
    expect(versionIn({ rev: 1, key: 'AAAA', body: 'AAAA', keyVersion: 1, at: 1 })).not.toBeNull()
    const invite = {
      vault: 'vault-one',
      from: 'a@b.c',
      fromName: 'A',
      role: 'viewer',
      key: null,
      meta: 'AAAA',
      keyVersion: 1,
      fromKey: null,
      proof: null,
      pin: null,
    }
    expect(inviteIn(invite)).toEqual(invite)
    const member = {
      email: 'a@b.c',
      name: '',
      role: 'editor',
      state: 'confirm',
      pub: 'AAAA',
      signPub: null,
      vouch: null,
    }
    expect(memberIn(member)).toEqual(member)
    const link = {
      id: 'link-one',
      vault: 'vault-one',
      item: 'item-one',
      expires: 9,
      views: null,
      seen: 0,
      created: 1,
    }
    expect(linkRowIn(link)).toEqual(link)
    const changes = {
      seq: 3,
      more: false,
      keyring: null,
      vaults: [VAULT],
      items: [ITEM],
      invites: [],
    }
    expect(changesIn(changes)).toEqual(changes)
  })

  test('and refuse anything else', () => {
    expect(isPassId('short')).toBe(false)
    expect(isPassId('a/b/c/d/e')).toBe(false)
    expect(isSealed('A'.repeat(MOST_ITEM_BYTES + 4), MOST_ITEM_BYTES)).toBe(false)
    expect(keyringRowIn({ keyring: { ...KEYRING, v: 2 }, rev: 1 })).toBeNull()
    expect(keyringRowIn({ keyring: KEYRING, rev: 0 })).toBeNull()
    expect(vaultRowIn({ ...VAULT, role: 'admin' })).toBeNull()
    expect(vaultRowIn({ ...VAULT, meta: '' })).toBeNull()
    expect(vaultRowIn({ ...VAULT, proof: { by: 'AAAA', sig: 'AAAA', vouch: null } })).toBeNull()
    expect(vaultRowIn({ ...VAULT, handovers: [{ to: 'AAAA' }] })).toBeNull()
    expect(vaultRowIn({ ...VAULT, accepted: 'yes' })).toBeNull()
    expect(inviteIn({ ...changesInvite(), fromKey: { pub: 'AAAA', signPub: 'AAAA' } })).toBeNull()
    expect(itemRowIn({ ...ITEM, rev: 0 })).toBeNull()
    expect(itemRowIn({ ...ITEM, body: '' })).toBeNull()
    expect(itemRowIn({ ...ITEM, deleted: true })).toBeNull()
    expect(memberIn({ email: '', name: '', role: 'editor', state: 'active', pub: null })).toBeNull()
    expect(
      memberIn({ email: 'a@b.c', name: '', role: 'editor', state: 'removed', pub: null }),
    ).toBeNull()
    expect(
      linkRowIn({
        id: 'link-one',
        vault: 'vault-one',
        item: 'item-one',
        expires: 9,
        views: 0,
        seen: 0,
        created: 1,
      }),
    ).toBeNull()
    expect(
      changesIn({ seq: 1, more: false, keyring: null, vaults: [{}], items: [], invites: [] }),
    ).toBeNull()
    for (const junk of [null, 1, 'x', [], {}]) {
      expect(vaultRowIn(junk)).toBeNull()
      expect(itemRowIn(junk)).toBeNull()
      expect(changesIn(junk)).toBeNull()
    }
  })
})

function changesInvite() {
  return {
    vault: 'vault-one',
    from: 'a@b.c',
    fromName: '',
    role: 'viewer',
    key: null,
    meta: 'AAAA',
  }
}
