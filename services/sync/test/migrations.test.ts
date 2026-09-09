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
