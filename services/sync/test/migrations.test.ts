/** The migrations as migrations: run against the schema that was there before
 *  them, on rows that schema allowed.
 *
 *  Every other test here runs against the whole folder applied to an empty
 *  database, which is the right thing for a route and no test at all for a
 *  backfill: the rows a backfill exists for cannot be written once the migration
 *  that fixes them has run. So this file builds the database up to one
 *  migration, puts yesterday's rows in, and then applies the next. */

import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url))
const MIGRATIONS = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.sql'))
  .sort()

function sql(name: string): string {
  return readFileSync(FOLDER + name, 'utf8')
}

/** A database with every migration up to and including this one applied. */
function upTo(last: string): DatabaseSync {
  const database = new DatabaseSync(':memory:')

  for (const name of MIGRATIONS) {
    database.exec(sql(name))
    if (name === last) return database
  }

  throw new Error(`no migration named ${last}`)
}

/** The account, space and note every case below needs, written with the columns
 *  the schema had at that point. */
function seed(database: DatabaseSync): void {
  database.exec(`insert into users (id, email, created_at) values ('u', 'a@b.c', 1)`)
  database.exec(
    `insert into spaces (id, user_id, name, created_at, updated_at)
     values ('sp', 'u', 'Space', 1, 1)`,
  )
}

function indexes(database: DatabaseSync, table: string): string[] {
  return database
    .prepare(`select name from sqlite_master where type = 'index' and tbl_name = ?`)
    .all(table)
    .map((row) => String((row as { name: string | null }).name))
}

describe('0017, the notes deleted before Recently deleted existed', () => {
  /** A note as a delete wrote it before 0011: flagged, and no stamp. */
  function deletedLongAgo(database: DatabaseSync, id: string, at: number): void {
    database.exec(
      `insert into notes (id, space_id, path, seq, updated_at, deleted, size, hash)
       values ('${id}', 'sp', '${id}.md', 1, ${at}, 1, 12, 'abc')`,
    )
  }

  test('stamps them with when the delete was written', () => {
    const database = upTo('0016_guests.sql')
    seed(database)
    deletedLongAgo(database, 'old', 1_700_000_000_000)

    database.exec(sql('0017_deleted_at.sql'))

    const row = database.prepare(`select deleted_at from notes where id = 'old'`).get()
    expect(row).toEqual({ deleted_at: 1_700_000_000_000 })
    database.close()
  })

  test('leaves a live note alone', () => {
    const database = upTo('0016_guests.sql')
    seed(database)
    database.exec(
      `insert into notes (id, space_id, path, seq, updated_at, deleted, size, hash)
       values ('live', 'sp', 'live.md', 1, 5, 0, 12, 'abc')`,
    )

    database.exec(sql('0017_deleted_at.sql'))

    expect(database.prepare(`select deleted_at from notes where id = 'live'`).get()).toEqual({
      deleted_at: null,
    })
    database.close()
  })

  test('leaves a note already in Recently deleted where it was', () => {
    const database = upTo('0016_guests.sql')
    seed(database)
    database.exec(
      `insert into notes (id, space_id, path, seq, updated_at, deleted, deleted_at, size, hash)
       values ('kept', 'sp', 'kept.md', 1, 9, 1, 7, 12, 'abc')`,
    )

    database.exec(sql('0017_deleted_at.sql'))

    expect(database.prepare(`select deleted_at from notes where id = 'kept'`).get()).toEqual({
      deleted_at: 7,
    })
    database.close()
  })

  test('indexes what the purge looks for', () => {
    const database = upTo('0017_deleted_at.sql')
    expect(indexes(database, 'notes')).toContain('notes_deleted_at')
    database.close()
  })
})

describe('0022, the plaintext OpenAI key an older build stored', () => {
  /** The settings blob as a build before this one wrote it: the key in the clear,
   *  beside the choices that are settings like any other. */
  function chose(database: DatabaseSync, id: string, settings: string): void {
    database.exec(
      `insert into users (id, email, created_at, settings)
       values ('${id}', '${id}@b.c', 1, '${settings}')`,
    )
  }

  test('is dropped, and the rest of the settings stay', () => {
    const database = upTo('0021_domain_proof.sql')
    chose(
      database,
      'one',
      '{"glassesKey":"sk-proj-secret","glassesModel":"gpt-6-astra","vim":true}',
    )

    database.exec(sql('0022_openai_key.sql'))

    const row = database.prepare(`select settings, openai_key from users where id = 'one'`).get()
    const { settings, openai_key: sealed } = row as { settings: string; openai_key: unknown }
    expect(JSON.parse(settings)).toEqual({ glassesModel: 'gpt-6-astra', vim: true })
    expect(settings).not.toContain('sk-proj-secret')
    // Not carried over: it cannot be encrypted here, and the pane asks for it again.
    expect(sealed).toBeNull()
    database.close()
  })

  test('leaves an account that never set one exactly as it was', () => {
    const database = upTo('0021_domain_proof.sql')
    chose(database, 'two', '{"vim":true}')

    database.exec(sql('0022_openai_key.sql'))

    const row = database.prepare(`select settings from users where id = 'two'`).get()
    expect(JSON.parse((row as { settings: string }).settings)).toEqual({ vim: true })
    database.close()
  })

  test('indexes what the cache sweep looks for', () => {
    const database = upTo('0022_openai_key.sql')
    expect(indexes(database, 'cached')).toContain('cached_until')
    database.close()
  })
})
