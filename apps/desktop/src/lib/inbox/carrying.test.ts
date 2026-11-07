import { describe, expect, test } from 'vitest'
import { type Carrying, carriedFrom, carriedItems, madeByOrden, todosOut } from './carrying'
import type { Item } from './items'

function world(files: Record<string, string>, kept = true) {
  const disk = new Map(Object.entries(files))
  const inbox = new Map<string, Item>()
  const heads: string[] = []
  const carrying: Carrying = {
    read: (path) => Promise.resolve(disk.get(path) ?? null),
    meta: (path) => (path === 'Inbox.md' ? { 'done-on': 'zzz:20260101' } : null),
    write: (path, text) => {
      disk.set(path, text)
      return Promise.resolve()
    },
    remove: (path) => {
      disk.delete(path)
      return Promise.resolve()
    },
    carried: (items) => {
      for (const one of items) if (!inbox.has(one.id)) inbox.set(one.id, one)
      return Promise.resolve()
    },
    headed: (text) => {
      if (text.trim()) heads.push(text.trim())
      return Promise.resolve()
    },
    kept: () => Promise.resolve(kept),
  }
  return { disk, inbox, heads, carrying }
}

describe('an old inbox carried into the account', () => {
  test('moves every to-do with its fields, and the file goes only once they are kept', async () => {
    const files = {
      '.Inbox.md': [
        '- [ ] Call the bank 📅 2026-11-07 ⏫ #money',
        '  - [ ] the form',
        '- [x] Water the plants ✅ 2026-11-06',
        '- [-] Old plan',
      ].join('\n'),
    }
    const waiting = world(files, false)
    expect(await carriedFrom('.Inbox.md', waiting.carrying, true)).toBe('waiting')
    expect(waiting.disk.has('.Inbox.md')).toBe(true)
    expect(waiting.inbox.size).toBe(3)

    const done = world(files)
    expect(await carriedFrom('.Inbox.md', done.carrying, true)).toBe('carried')
    expect(done.disk.has('.Inbox.md')).toBe(false)
    const fields = [...done.inbox.values()].map((one) => one.fields)
    expect(fields.map((one) => one.text)).toEqual(['Call the bank', 'Water the plants', 'Old plan'])
    expect(fields[0]).toMatchObject({ due: '2026-11-07', priority: 2, tags: ['money'] })
    expect(fields[0]?.rest).toBe('  - [ ] the form')
    expect(fields[1]).toMatchObject({ status: 'x', completed: '2026-11-06' })
    expect(fields[2]).toMatchObject({ status: '-' })
  })

  test('carried twice, or from two devices, makes the same to-dos once', async () => {
    const text = '- [ ] Milk\n- [ ] Milk\n- [ ] Bread\n'
    expect(carriedItems(text).map((one) => one.id)).toEqual(carriedItems(text).map((one) => one.id))
    expect(new Set(carriedItems(text).map((one) => one.id)).size).toBe(3)
    const first = world({ '.Inbox.md': text }, false)
    await carriedFrom('.Inbox.md', first.carrying, true)
    await carriedFrom('.Inbox.md', first.carrying, true)
    expect(first.inbox.size).toBe(3)
  })

  test('leaves the file when it changed while the to-dos were carried', async () => {
    const one = world({ '.Inbox.md': '- [ ] Milk\n' })
    const read = (path: string) => Promise.resolve(one.disk.get(path) ?? null)
    let reads = 0
    one.carrying.read = (path) => {
      reads += 1
      if (reads === 2) one.disk.set(path, '- [ ] Milk\n- [ ] Eggs\n')
      return read(path)
    }
    expect(await carriedFrom('.Inbox.md', one.carrying, true)).toBe('waiting')
    expect(one.disk.get('.Inbox.md')).toContain('Eggs')
  })

  test('keeps words that are not to-dos in the inbox head', async () => {
    const one = world({ '.Inbox.md': 'Things to sort\n\n- [ ] Milk\n' })
    await carriedFrom('.Inbox.md', one.carrying, true)
    expect(one.heads).toEqual(['Things to sort'])
  })
})

describe('a note once picked as the inbox', () => {
  test('gives up its to-dos and keeps everything else, code and front matter as they were', async () => {
    const note = [
      '---',
      'inbox: yes',
      '---',
      '# Inbox',
      '',
      '- [ ] Call the bank',
      '  more about it',
      '',
      'A paragraph',
      '```',
      '- [ ] not a to-do',
      '```',
    ].join('\n')
    const one = world({ 'Lists/Inbox.md': note })
    expect(await carriedFrom('Lists/Inbox.md', one.carrying, false)).toBe('carried')
    const left = one.disk.get('Lists/Inbox.md') ?? ''
    expect(left).toContain('# Inbox')
    expect(left).toContain('A paragraph')
    expect(left).toContain('- [ ] not a to-do')
    expect(left).not.toContain('Call the bank')
    expect(left).not.toContain('more about it')
    expect([...one.inbox.values()].map((item) => item.fields.text)).toEqual(['Call the bank'])
  })

  test('is not written when it holds no to-dos', async () => {
    const one = world({ 'Notes.md': '# Notes\n' })
    expect(await carriedFrom('Notes.md', one.carrying, false)).toBe('carried')
    expect(one.disk.get('Notes.md')).toBe('# Notes\n')
  })

  test('splits to-dos from the rest by lines', () => {
    expect(todosOut('- [ ] A\nword\n- [x] B\n  under B\n')).toEqual({
      kept: 'word\n',
      todos: '- [ ] A\n- [x] B\n  under B\n',
    })
  })
})

test('an Inbox.md is Orden’s own only when it holds nothing but to-dos', () => {
  expect(madeByOrden('- [ ] A\n  - [ ] B\n\n- [x] C\n')).toBe(true)
  expect(madeByOrden('# My inbox\n- [ ] A\n')).toBe(false)
})
