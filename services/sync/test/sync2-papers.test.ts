/** The paper a page note holds, under sync v2 (#551): part of the note, and so never an
 *  entry of the tree of its own. A page note and its paper are one thing on the account,
 *  kept by the note's id (`/v1/notes/:id/paper`, papers.test.ts); a second entry for the
 *  paper, paired with the note by name, is what a rename left behind under the old name
 *  on every other device. The engine itself, run against the Worker's own routes. */

import { afterEach, beforeEach, expect, test } from 'vitest'
import app from '../src/index'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

interface SpaceState {
  id: string
}

interface Core {
  spaces: Map<string, SpaceState>
  addSpace(id: string, root: string, role: string): unknown[]
  commit(changes: unknown[]): Promise<void>
}

interface Device {
  root: string
  disk: {
    write(path: string, text: string): Promise<void>
    writeBytes(path: string, bytes: Uint8Array): Promise<void>
    move(from: string, to: string): Promise<void>
  }
  engine: {
    core: Core
    pass(space: string): Promise<{ finished: boolean } | null>
    created(path: string, folder: boolean, text?: string): Promise<string | null>
    moved(from: string, to: string): Promise<void>
  }
}

interface Kit {
  testDevice(making: {
    fetch: (request: Request) => Promise<Response>
    token: string
    files?: Record<string, string | Uint8Array>
  }): Promise<Device>
  firstPass(core: Core, space: SpaceState, v1: null): Promise<boolean>
}

async function kit(): Promise<Kit> {
  const at = (file: string) =>
    new URL(`../../../apps/desktop/src/lib/sync2/${file}`, import.meta.url).href
  const [device, migrate] = await Promise.all([
    import(/* @vite-ignore */ at('test-device.ts')),
    import(/* @vite-ignore */ at('migrate.ts')),
  ])
  return { ...(device as object), ...(migrate as object) } as Kit
}

const PAGES = '{\n\t"nodes": [],\n\t"edges": []\n}\n'
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n')

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'pages@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Lectures' } })).json.space.id
})

afterEach(() => env.close())

/** What the account's tree holds, live: each path and its kind. */
function onAccount(): string[] {
  const rows = env.db
    .prepare('select path, kind from notes where space_id = ? and deleted = 0 order by path')
    .all(space) as { path: string; kind: string }[]
  return rows.map((row) => `${row.path} ${row.kind}`)
}

async function synced(files: Record<string, string | Uint8Array>) {
  const engine = await kit()
  const device = await engine.testDevice({
    fetch: async (request) => await app.fetch(request, env),
    token,
    files,
  })
  const core = device.engine.core
  await core.commit(core.addSpace(space, device.root, 'owner'))
  const state = core.spaces.get(space)
  if (!state) throw new Error('the space was not added')
  expect(await engine.firstPass(core, state, null)).toBe(true)
  await rooms.settle()
  const pass = async () => {
    expect((await device.engine.pass(space))?.finished).toBe(true)
    await rooms.settle()
  }
  await pass()
  return { device, pass }
}

test('a folder read for the first time holds the page note and not its paper', async () => {
  await synced({
    'Lecture.pages': PAGES,
    'Lecture.pages.pdf': PDF,
    // Somebody's own PDF that happens to be named so: no note beside it, so a PDF.
    'Report.pages.pdf': PDF,
  })

  expect(onAccount()).toEqual(['Lecture.pages pages', 'Report.pages.pdf file'])
})

test('a PDF turned into a page note leaves the tree as the note takes it in', async () => {
  const { device, pass } = await synced({ 'Notes.md': 'words\n' })
  const at = (path: string) => `${device.root}/${path}`

  await device.disk.writeBytes(at('Week 1.pdf'), PDF)
  await device.engine.created(at('Week 1.pdf'), false)
  await pass()
  expect(onAccount()).toEqual(['Notes.md note', 'Week 1.pdf file'])

  // What turning it does (pages/from-pdf.ts): the note written, the PDF moved in under it.
  await device.disk.write(at('Week 1.pages'), PAGES)
  await device.engine.created(at('Week 1.pages'), false, PAGES)
  await device.disk.move(at('Week 1.pdf'), at('Week 1.pages.pdf'))
  await device.engine.moved(at('Week 1.pdf'), at('Week 1.pages.pdf'))
  // And a watcher that hears the paper arrive as a new file of its own.
  await device.engine.created(at('Week 1.pages.pdf'), false)
  await pass()

  expect(onAccount()).toEqual(['Notes.md note', 'Week 1.pages pages'])
})
