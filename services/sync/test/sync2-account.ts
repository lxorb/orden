import { TEXT } from '@orden/rooms'
import type { AccountAdapter, AccountView, Route, Seeded } from '@orden/sync-core/sim'
import { frame, nameKey } from '@orden/sync-core'
import * as Y from 'yjs'
import { sha256 } from '../src/crypto'
import { documentOf } from '../src/sync2/docs'
import app from '../src/index'
import type { Note } from '../src/types'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

const OCTETS = 'application/octet-stream'

export class WorkerAccount implements AccountAdapter {
  readonly env: TestEnv
  private readonly rooms: Live
  private readonly ready: Promise<void>
  private space = ''
  private readonly sessions = new Map<string, string>()

  constructor(private readonly seeded: readonly Seeded[]) {
    this.env = testEnv()
    this.rooms = live(this.env)
    this.ready = this.setUp()
  }

  private async setUp() {
    const token = await signIn(this.env, 'sim@example.com')
    this.space = (
      await call(this.env, '/v1/spaces', { token, body: { name: 'Sim' } })
    ).json.space.id

    const db = this.env.db
    let seq = 0
    for (const note of this.seeded) {
      seq += 1
      const hash = await sha256(note.text)
      db.prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash,
                            name, name_key, kind, epoch, epoch_base, doc_seq)
         values (?, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?, 'note', 1, ?, ?)`,
      ).run(
        note.id,
        this.space,
        note.name,
        seq,
        note.text.length,
        hash,
        note.name,
        nameKey(note.name),
        hash,
        seq,
      )
      await this.env.NOTES.put(`spaces/${this.space}/${note.id}`, note.text)
    }
    db.prepare('insert into space_cursor (space_id, next) values (?, ?)').run(this.space, seq + 1)
    db.prepare('update spaces set prepared_at = 1 where id = ?').run(this.space)
  }

  private async session(device: string): Promise<string> {
    const held = this.sessions.get(device)
    if (held) return held

    const token = await signIn(this.env, 'sim@example.com')
    const row = this.env.db
      .prepare('select id, user_id from sessions where token_hash = ?')
      .get(await sha256(token)) as { id: string; user_id: string }
    this.env.db
      .prepare(
        `insert into devices (id, user_id, session_id, name, platform, created_at)
         values (?, ?, ?, ?, 'test', 0)`,
      )
      .run(device, row.user_id, row.id, device)
    this.sessions.set(device, token)
    return token
  }

  async handle(device: string, route: Route, body: Uint8Array): Promise<Uint8Array> {
    await this.ready
    const token = await this.session(device)
    const headers = { authorization: `Bearer ${token}`, accept: OCTETS, 'x-nib-device': device }

    let request: Request
    if (route === 'feed') {
      const { unframe } = await import('@orden/sync-core')
      const since = (unframe(body) as { since?: number } | null)?.since ?? 0
      request = new Request(
        `https://nibeditor.com/v2/spaces/${this.space}/feed?since=${String(since)}`,
        { headers },
      )
    } else {
      const path = route === 'ops' ? `/v2/spaces/${this.space}/ops` : `/v2/docs/${route}`
      request = new Request(`https://nibeditor.com${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': OCTETS },
        body,
      })
    }

    const response = await app.fetch(request, this.env)
    if (response.status === 404 || response.status === 403) {
      const said = await response.json<{ error?: string }>()
      return frame({ refused: response.status, error: said.error ?? '' })
    }
    if (response.status !== 200) {
      throw new Error(`${route} answered ${String(response.status)}: ${await response.text()}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())

    if (route === 'push') await this.rooms.settle()
    return bytes
  }

  async view(): Promise<AccountView> {
    await this.ready
    const db = this.env.db
    const folders = db
      .prepare(
        'select id, parent_id as parent, name, pos from folders where space_id = ? and deleted = 0',
      )
      .all(this.space) as { id: string; parent: string | null; name: string; pos: string | null }[]
    const notes = db
      .prepare('select * from notes where space_id = ? and deleted = 0')
      .all(this.space) as unknown as Note[]

    const texts: Record<string, string> = {}
    for (const note of notes) {
      const held = await documentOf(this.env, note)
      if (!held) continue
      const doc = new Y.Doc()
      Y.applyUpdateV2(doc, held.update)
      texts[note.id] = doc.getText(TEXT).toJSON()
    }

    const versions: string[] = []
    const kept = db
      .prepare(
        `select distinct v.hash from note_versions v join notes n on n.id = v.note_id
          where n.space_id = ?`,
      )
      .all(this.space) as { hash: string }[]
    for (const { hash } of kept) {
      const object = await this.env.NOTES.get(`versions/${hash}`)
      if (object) versions.push(await object.text())
    }

    return {
      entries: [
        ...folders.map((one) => ({
          id: one.id,
          kind: 'folder' as const,
          parent: one.parent,
          name: one.name,
          ...(one.pos === null ? {} : { pos: one.pos }),
        })),
        ...notes.map((one) => ({
          id: one.id,
          kind: 'note' as const,
          parent: one.folder_id ?? null,
          name: one.name ?? one.path,
          ...(placeOf(one) === null ? {} : { pos: placeOf(one) ?? '' }),
        })),
      ],
      texts,
      versions,
    }
  }

  close() {
    this.env.close()
  }
}

function placeOf(note: Note): string | null {
  const pos = (note as unknown as { pos?: unknown }).pos
  return typeof pos === 'string' ? pos : null
}
