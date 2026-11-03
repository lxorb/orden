/** An `Inbox.md` Orden made, moved into the space's own inbox (#1044): nothing lost,
 *  nothing twice, the reader's own note never touched, and safe to run again, from two
 *  devices, and with the note changing under it. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
  clear: () => kept.clear(),
})

const { madeByOrden, moveOldInbox } = await import('./inbox-move')
const { setInbox } = await import('./inbox')

const ROOT = '/spaces/Work'
const OLD = `${ROOT}/Inbox.md`
const OWN = `${ROOT}/.Inbox.md`

/** A disk, and what the move did to it. */
function rig(files: Record<string, string>) {
  const disk = new Map(Object.entries(files))
  const made: string[] = []
  const trash: string[] = []
  let meanwhile: (() => void) | null = null
  return {
    disk,
    made,
    trash,
    /** Something written between the move's first read and its last. */
    then(change: () => void) {
      meanwhile = change
    },
    moving: {
      read: (path: string) => Promise.resolve(disk.get(path) ?? null),
      write: (path: string, text: string, fresh: boolean) => {
        disk.set(path, text)
        if (fresh) made.push(path)
        const now = meanwhile
        meanwhile = null
        now?.()
        return Promise.resolve()
      },
      remove: (path: string) => {
        trash.push(`${path}: ${disk.get(path) ?? ''}`)
        disk.delete(path)
        return Promise.resolve()
      },
    },
  }
}

beforeEach(() => kept.clear())

describe('an Inbox.md Orden made', () => {
  test('is task lines and what the task view writes under one, and nothing else', () => {
    expect(madeByOrden('')).toBe(true)
    expect(madeByOrden('- [ ] Call the bank 📅 2026-10-06\n- [x] Post it ✅ 2026-10-01\n')).toBe(
      true,
    )
    expect(
      madeByOrden(
        '- [ ] Buy milk\n  oat, not soy\n  - words [at:: 2026-10-01T09:00]\n  - [ ] Two litres\n\n* [/] Started\n',
      ),
    ).toBe(true)
    expect(madeByOrden('# Inbox\n- [ ] Buy milk\n')).toBe(false)
    expect(madeByOrden('---\ntags: [x]\n---\n- [ ] Buy milk\n')).toBe(false)
    expect(madeByOrden('- [ ] Buy milk\nRemember the receipts.\n')).toBe(false)
    expect(madeByOrden('  indented before any task\n')).toBe(false)
    expect(madeByOrden('- plain list item\n')).toBe(false)
  })

  test('moves into the space’s own inbox and goes to the trash, nothing left in the space', async () => {
    const one = rig({ [OLD]: '- [ ] Call the bank\n- [ ] Buy milk\n  oat\n' })
    expect(await moveOldInbox(ROOT, one.moving)).toBe('moved')
    expect(one.disk.get(OWN)).toBe('- [ ] Call the bank\n- [ ] Buy milk\n  oat\n')
    expect(one.disk.has(OLD)).toBe(false)
    expect(one.made).toEqual([OWN])
    // Recoverable all the same: the delete is one with a version kept.
    expect(one.trash).toEqual([`${OLD}: - [ ] Call the bank\n- [ ] Buy milk\n  oat\n`])
  })

  test('joins an own inbox already there, adding only what it does not hold', async () => {
    const one = rig({
      [OLD]: '- [ ] Call the bank\n- [ ] Buy milk\n',
      [OWN]: '- [ ] Buy milk\n- [ ] Added since the update\n',
    })
    expect(await moveOldInbox(ROOT, one.moving)).toBe('moved')
    expect(one.disk.get(OWN)).toBe(
      '- [ ] Buy milk\n- [ ] Added since the update\n- [ ] Call the bank\n',
    )
    expect(one.made).toEqual([])
  })

  test('run again, or after a crash between the two writes, adds nothing twice', async () => {
    const one = rig({ [OLD]: '- [ ] Call the bank\n' })
    // A crash after the own inbox was written and before the note went.
    one.disk.set(OWN, '- [ ] Call the bank\n')
    expect(await moveOldInbox(ROOT, one.moving)).toBe('moved')
    expect(one.disk.get(OWN)).toBe('- [ ] Call the bank\n')
    expect(await moveOldInbox(ROOT, one.moving)).toBe('none')
    expect(one.disk.get(OWN)).toBe('- [ ] Call the bank\n')
  })

  test('brought back by another device, with a task added there, moves that task too', async () => {
    const one = rig({ [OLD]: '- [ ] Call the bank\n' })
    await moveOldInbox(ROOT, one.moving)
    // An older Orden on another device added a task to the old note, and sync brought
    // it back: an edit beats a delete.
    one.disk.set(OLD, '- [ ] Call the bank\n- [ ] From the old phone\n')
    expect(await moveOldInbox(ROOT, one.moving)).toBe('moved')
    expect(one.disk.get(OWN)).toBe('- [ ] Call the bank\n- [ ] From the old phone\n')
    expect(one.disk.has(OLD)).toBe(false)
  })

  test('changed while it was being moved, stays for the next run, which takes it all', async () => {
    const one = rig({ [OLD]: '- [ ] Call the bank\n' })
    one.then(() => one.disk.set(OLD, '- [ ] Call the bank\n- [ ] Typed just now\n'))
    expect(await moveOldInbox(ROOT, one.moving)).toBe('kept')
    expect(one.disk.get(OLD)).toBe('- [ ] Call the bank\n- [ ] Typed just now\n')

    expect(await moveOldInbox(ROOT, one.moving)).toBe('moved')
    expect(one.disk.get(OWN)).toBe('- [ ] Call the bank\n- [ ] Typed just now\n')
  })

  test('empty, goes without making an own inbox for nothing', async () => {
    const one = rig({ [OLD]: '' })
    expect(await moveOldInbox(ROOT, one.moving)).toBe('moved')
    expect(one.disk.has(OWN)).toBe(false)
    expect(one.disk.has(OLD)).toBe(false)
  })
})

describe('an Inbox.md that is the reader’s', () => {
  test('edited into a note of their own, is kept as it is', async () => {
    const words = '# Inbox\n\nThings to sort on Sunday.\n\n- [ ] Buy milk\n'
    const one = rig({ [OLD]: words })
    expect(await moveOldInbox(ROOT, one.moving)).toBe('kept')
    expect(one.disk.get(OLD)).toBe(words)
    expect(one.disk.has(OWN)).toBe(false)
    expect(one.trash).toEqual([])
  })

  test('chosen as the space’s inbox, is kept and stays the inbox', async () => {
    setInbox(ROOT, 'Inbox.md')
    const one = rig({ [OLD]: '- [ ] Buy milk\n' })
    expect(await moveOldInbox(ROOT, one.moving)).toBe('kept')
    expect(one.disk.get(OLD)).toBe('- [ ] Buy milk\n')
    expect(one.disk.has(OWN)).toBe(false)
  })

  test('not there at all, is nothing to do', async () => {
    const one = rig({})
    expect(await moveOldInbox(ROOT, one.moving)).toBe('none')
    expect([...one.disk.keys()]).toEqual([])
  })
})
