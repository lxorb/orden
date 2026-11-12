import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { portProvided, providePort } from '@orden/contracts'
import {
  CALM,
  Clock,
  markersIn,
  ReferenceAccount,
  type Report,
  SEEDED,
  simulate,
  type Step,
} from '@orden/sync-core/sim'
import { MemoryDisk, MemoryStore } from '../src/api'
import { firstPass } from '../src/migrate'
import { madeTwice } from '../src/twins'
import { SpaceState } from '../src/places'
import type { EntryRow } from '../src/store'
import { EngineDevice, freshDevice } from './sim-device'

const settle: Step = { t: 'wait', ticks: 40 }

function road(script: readonly Step[]): Promise<Report> {
  return simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script,
    device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
  })
}

function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}

const PLAN = 0

const SHELL = [
  'workspace.svelte',
  'workspace/',
  'account.svelte',
  'settings.svelte',
  'tauri',
  'stored',
  'api',
  'new-tab',
]

function sources(folder: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) out.push(...sources(path))
    else if (/\.(?:ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

describe('the module stands on its own', () => {
  test('its api loads with no port bound, and binds nothing itself', () => {
    expect(portProvided('sync.account')).toBe(false)
    expect(portProvided('sync.workspace')).toBe(false)
    expect(new MemoryStore('d').rows('spaces')).toEqual([])
    expect(new MemoryDisk().files.size).toBe(0)
  })

  test('reaches the shell, the account and the host only through ports', () => {
    const reaching: string[] = []
    for (const file of sources(join(import.meta.dirname, '../src'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/from\s+'(\.\.\/\.\.\/[^']+)'|import\('(\.\.\/\.\.\/[^']+)'\)/g)) {
        const target = (match[1] ?? match[2] ?? '').slice('../../'.length)
        if (SHELL.some((one) => target === one || target.startsWith(one)))
          reaching.push(`${file.slice(file.lastIndexOf('/') + 1)} -> ${target}`)
      }
    }
    expect(reaching).toEqual([])
  })
})

describe('a device that has never synced', () => {
  test('reads the whole tree from the feed at cursor 0, and writes every note to its disk', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await freshDevice(account, 'fresh-empty')
    expect(await firstPass(here.engine.core, here.space(), null)).toBe(true)
    await here.engine.pass('sim')

    const names = [...here.space().entries.values()].map((one) => one.name).sort()
    expect(names).toEqual(SEEDED.map((one) => one.name).sort())
    for (const note of SEEDED) {
      expect(here.space().entries.get(note.id)?.name).toBe(note.name)
      expect(here.disk.files.get(`/fresh/fresh-empty/${note.name}`)).toBe(note.text)
    }
    expect(here.space().outbox).toEqual([])
  })

  test('whose disk already holds the notes claims them at their place, and makes nothing twice', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const files = Object.fromEntries(SEEDED.map((one) => [one.name, one.text]))
    const here = await freshDevice(account, 'fresh-held', files)
    const before = (await account.view()).entries.map((one) => one.id).sort()

    expect(await firstPass(here.engine.core, here.space(), null)).toBe(true)
    await here.engine.pass('sim')

    const after = await account.view()
    expect(after.entries.map((one) => one.id).sort()).toEqual(before)
    expect(after.entries.map((one) => one.name).sort()).toEqual(['Ideas.md', 'Plan.md'])
    for (const note of SEEDED) expect(here.space().at(note.name)?.id).toBe(note.id)
    expect(here.disk.files.size).toBe(SEEDED.length)
    expect(here.space().outbox).toEqual([])
  })
})

describe('a name made twice', () => {
  function row(id: string, name: string, local: string, hash: string, deleted = false): EntryRow {
    return {
      id,
      space_id: 's',
      kind: 'file',
      parent: null,
      name,
      local_path: local,
      file_key: hash,
      written_hash: hash,
      mtime: null,
      size: null,
      seq: 1,
      deleted,
    }
  }

  function space(rows: EntryRow[]) {
    return new SpaceState(
      { space_id: 's', root: '/r', cursor: 9, role: 'owner', store: null },
      rows,
      [],
      'd',
      { platform: 'linux', foldsCase: true } as never,
    )
  }

  test('a numbered twin goes back to its name once the original is gone with the same bytes', () => {
    expect(
      madeTwice(
        space([row('a', 'Photo.png', '', 'p1', true), row('b', 'Photo 2.png', 'Photo 2.png', 'p1')]),
      ),
    ).toEqual([{ from: 'Photo 2.png', to: 'Photo.png' }])
  })

  test('a numbered name the reader chose, or other bytes, is kept', () => {
    expect(madeTwice(space([row('b', 'Plan 2.pdf', 'Plan 2.pdf', 'h1')]))).toEqual([])
    expect(
      madeTwice(
        space([row('a', 'Plan.pdf', '', 'old', true), row('b', 'Plan 2.pdf', 'Plan 2.pdf', 'new')]),
      ),
    ).toEqual([])
  })

  test('two notes of one name made apart are two notes, the second numbered', async () => {
    const make = (device: number, marker: string): Step => ({
      t: 'act',
      device,
      action: { t: 'create', folder: null, name: 'Untitled.md', words: marker },
    })
    const report = await road([
      { t: 'offline', device: 0 },
      make(0, 'mk201z'),
      make(1, 'mk202z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(report.account.entries.map((one) => one.name).sort()).toEqual([
      'Ideas.md',
      'Plan.md',
      'Untitled 2.md',
      'Untitled.md',
    ])
  })
})

describe('offline, then back', () => {
  test('what was typed offline waits in the outbox and goes up on the first pass online', async () => {
    const report = await road([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'mk401z' } },
      { t: 'pass', device: 0 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(markersIn(textOf(report, 'Plan.md'))).toContain('mk401z')
  })

  test('an edit made offline and one made elsewhere merge character by character, with no copy', async () => {
    const report = await road([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'mk101z' } },
      { t: 'act', device: 1, action: { t: 'type', note: PLAN, at: 1, words: 'mk102z' } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
    expect(markersIn(textOf(report, 'Plan.md'))).toEqual(
      expect.arrayContaining(['mk101z', 'mk102z']),
    )
    expect(report.account.entries.filter((one) => one.name.includes('from another'))).toEqual([])
  })
})

describe('ports', () => {
  test('a port bound by the shell is what the module reads', () => {
    const unbind = providePort('sync.clock', { now: () => 42, waited: () => Promise.resolve() })
    expect(portProvided('sync.clock')).toBe(true)
    unbind()
    expect(portProvided('sync.clock')).toBe(false)
  })
})
