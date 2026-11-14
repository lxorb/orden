import { same } from '@orden/pass/bytes'
import { isProven, ownersFrom, pinnedOwnerOf } from '@orden/pass/trust'
import type { VaultRow as WireVault } from '@orden/pass/wire'
import type { VaultRow } from './local'
import type { TrustReason } from './trust-problem'

export async function vaultDistrust(
  me: string | null,
  row: WireVault,
  key: Uint8Array<ArrayBuffer>,
  local: VaultRow | undefined,
  held: Uint8Array<ArrayBuffer> | undefined,
): Promise<TrustReason | null> {
  if (local && row.keyVersion < local.keyVersion) return 'older'
  if (local?.keyVersion === row.keyVersion) {
    return held === undefined || same(key, held) ? null : 'swapped'
  }
  const pinned = me === null ? null : await pinnedOwnerOf(me, row.id, row.accepted)
  if (pinned === null) {
    if (!local) return 'unasked'
    if (row.proof === null) return 'unproven'
    const once = await isProven(row.id, row.keyVersion, key, row.proof, [row.proof.by])
    return once ? null : 'unproven'
  }
  const owners = await ownersFrom(row.id, pinned, row.handovers)
  return (await isProven(row.id, row.keyVersion, key, row.proof, owners)) ? null : 'unproven'
}

export async function ownersOf(
  me: string | null,
  vault: string,
  row: Pick<VaultRow, 'accepted' | 'handovers'>,
): Promise<string[]> {
  const pinned = me === null ? null : await pinnedOwnerOf(me, vault, row.accepted ?? null)
  return pinned === null ? [] : await ownersFrom(vault, pinned, row.handovers ?? [])
}
