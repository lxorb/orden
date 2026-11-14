import type { Opened } from '@orden/pass/keys'
import { sealVault, wrapVaultKey } from '@orden/pass/keys'
import { acceptedOf, keyProofOf } from '@orden/pass/trust'
import type { VaultMeta } from '@orden/pass/types'
import type { VaultRow } from './local'

export const FIRST_KEY_VERSION = 1

export async function madeVaultRow(
  opened: Opened,
  id: string,
  key: Uint8Array<ArrayBuffer>,
  meta: VaultMeta,
): Promise<VaultRow> {
  const signer = opened.signer
  const pub = opened.pair.pub
  return {
    id,
    rev: 1,
    meta: await sealVault(key, id, meta),
    key: await wrapVaultKey(key, pub, id),
    keyVersion: FIRST_KEY_VERSION,
    role: 'owner',
    owner: pub,
    members: 1,
    pending: true,
    deleted: false,
    proof: signer ? await keyProofOf(signer, id, FIRST_KEY_VERSION, key, null) : null,
    accepted: signer ? await acceptedOf(signer, id, signer.pub) : null,
    handovers: [],
  }
}
