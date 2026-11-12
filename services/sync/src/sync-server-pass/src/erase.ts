import { SEQ } from './seq'

const OWNED = 'select id from pass_vaults where owner_id = ?1'

export const PASS_ERASED: readonly (readonly [table: string, sql: string])[] = [
  ['pass_seq', 'update pass_seq set seq = seq + 1 where id = 1'],
  [
    'leftovers',
    `insert or ignore into leftovers (what, since)
     select 'pass/files/' || item_id || '/' || file_id || '/' || part, ?3 from pass_file_parts
      where vault_id in (${OWNED})`,
  ],
  ['pass_file_parts', `delete from pass_file_parts where vault_id in (${OWNED})`],
  [
    'pass_file_parts',
    `update pass_file_parts set user_id = coalesce(
       (select owner_id from pass_vaults where id = pass_file_parts.vault_id), '')
      where user_id = ?1`,
  ],
  ['pass_links', `delete from pass_links where user_id = ?1 or vault_id in (${OWNED})`],
  ['pass_versions', `delete from pass_versions where vault_id in (${OWNED})`],
  ['pass_items', `delete from pass_items where vault_id in (${OWNED})`],
  [
    'pass_members',
    `delete from pass_members where vault_id in (${OWNED}) and state in ('pending', 'confirm')`,
  ],
  ['pass_members', `update pass_members set key = null where vault_id in (${OWNED})`],
  [
    'pass_vaults',
    `update pass_vaults set seq = ${SEQ}
      where id in (select vault_id from pass_members where email = ?2 or user_id = ?1)`,
  ],
  [
    'pass_vaults',
    `update pass_vaults set owner_id = '', meta = '', rev = rev + 1, deleted_at = ?3, seq = ${SEQ}
      where owner_id = ?1`,
  ],
  ['pass_members', 'update pass_members set invited_by = null where invited_by = ?1'],
  [
    'pass_members',
    `update pass_members
        set state = 'removed', key = null, user_id = null, invited_by = null,
            email = 'erased-' || lower(hex(randomblob(12))), seq = ${SEQ}
      where (email = ?2 or user_id = ?1) and state = 'active'
        and vault_id in (select id from pass_vaults where deleted_at is null)`,
  ],
  ['pass_members', 'delete from pass_members where email = ?2 or user_id = ?1'],
  [
    'pass_vaults',
    `delete from pass_vaults where deleted_at is not null
        and not exists (select 1 from pass_members where vault_id = pass_vaults.id)`,
  ],
  ['pass_keyrings', 'delete from pass_keyrings where user_id = ?1'],
]
