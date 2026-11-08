import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { migrateLocal, rowsLocal } from '../../../scripts/local-d1'

const FOLDER = fileURLToPath(new URL('../../../services/sync/migrations/', import.meta.url))
const MIGRATIONS = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.sql'))
  .sort()

test('wrangler applies every migration in order to an empty local D1', () => {
  const state = mkdtempSync(join(tmpdir(), 'orden-local-d1-'))
  try {
    migrateLocal(state)
    expect(rowsLocal(state, 'select name from d1_migrations order by id')).toEqual(
      MIGRATIONS.map((name) => ({ name })),
    )
    expect(migrateLocal(state)).not.toContain('🕒')
  } finally {
    rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
}, 600_000)
