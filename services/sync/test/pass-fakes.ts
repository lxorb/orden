import type { Keyring } from '@orden/pass/keyring'
import type { Changes, ItemRow, VaultRow } from '@orden/pass/wire'
import { type Answer, call, signIn, type TestEnv } from './harness'

export interface Said {
  error?: string
  rev?: number
  at?: number
  ok?: boolean
  state?: string
  keyVersion?: number
  current?: ItemRow | VaultRow | { keyring: Keyring; rev: number } | null
}

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))

export const sealed = (length = 48): string =>
  base64(crypto.getRandomValues(new Uint8Array(length)))

export const anId = (): string =>
  base64(crypto.getRandomValues(new Uint8Array(12)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

export function aKeyring(at = 1, pub = sealed(65)): Keyring {
  return {
    v: 1,
    pub,
    private: sealed(200),
    password: { salt: sealed(16), m: 65536, t: 3, p: 1, sealed: sealed(60) },
    recovery: null,
    at,
  }
}

export interface Person {
  email: string
  token: string
  id: string
}

export async function person(env: TestEnv, email: string): Promise<Person> {
  const token = await signIn(env, email)
  const row = env.db.prepare('select id from users where email = ?').get(email) as { id: string }
  return { email, token, id: row.id }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export function passCall<T = Said>(
  env: TestEnv,
  who: Person,
  method: Method,
  path: string,
  body?: unknown,
): Promise<Answer<T>> {
  return call<T>(env, `/v2/pass${path}`, {
    method,
    token: who.token,
    ...(body === undefined ? {} : { body }),
  })
}

export function pass(env: TestEnv) {
  return {
    keyring: (who: Person, rev = 0, keyring: Keyring = aKeyring()) =>
      passCall(env, who, 'PUT', '/keyring', { keyring, rev }),

    vault: (who: Person, id: string, rev = 0, meta = sealed(), key: string | null = sealed()) =>
      passCall(env, who, 'PUT', `/vaults/${id}`, { rev, meta, key }),

    item: (who: Person, vault: string, id: string, rev = 0, keyVersion = 1) =>
      passCall(env, who, 'PUT', `/items/${vault}/${id}`, {
        rev,
        key: sealed(),
        body: sealed(120),
        keyVersion,
      }),

    changes: async (who: Person, since = 0) =>
      (await passCall<Changes>(env, who, 'GET', `/changes?since=${String(since)}`)).json,

    invite: (
      who: Person,
      vault: string,
      email: string,
      role = 'editor',
      key: string | null = sealed(),
      keyVersion = 1,
    ) => passCall(env, who, 'POST', `/vaults/${vault}/invites`, { email, role, key, keyVersion }),

    accept: (who: Person, vault: string) => passCall(env, who, 'POST', `/invites/${vault}/accept`),
  }
}

export async function sharedVault(
  env: TestEnv,
  owner: Person,
  member: Person,
  role = 'editor',
): Promise<string> {
  const api = pass(env)
  const vault = anId()
  await api.vault(owner, vault)
  await api.invite(owner, vault, member.email, role)
  await api.accept(member, vault)
  return vault
}
