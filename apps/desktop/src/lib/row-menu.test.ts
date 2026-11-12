import { beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const shareable = { yes: false }

const writable = { yes: true }

vi.mock('./sharing.svelte', () => ({
  canShareItem: () => shareable.yes,
  canWriteAt: () => writable.yes,
  shareThisFile: () => undefined,
}))

const { bookmarkAll, rowMenu } = await import('./row-menu')
const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')
const { hiddenKinds } = await import('./settings.svelte')
const { PROTECTION_WORD } = await import('./protect/gate')
type Entry = import('./workspace.svelte').Entry

function note(path: string): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  }
}

function folder(path: string, children: Entry[] = []): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  }
}

const nested = folder('/s/A', [note('/s/A/A.md'), note('/s/A/B.md')])
const plain = folder('/s/Projects', [note('/s/Projects/plan.md')])
const loose = note('/s/loose.md')
const paper = note('/s/paper.pdf')
const tree = folder('/s', [nested, plain, loose, paper])

function labels(entry: Entry): string[] {
  return rowMenu(entry).flatMap((one) => (one === null ? [] : [one.label]))
}

beforeEach(() => {
  hiddenKinds.hidden = [PROTECTION_WORD]
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/s' }]
  workspace.activeSpaceId = 's'
  workspace.tree = tree
  workspace.clearSelection()
  shareable.yes = false
  writable.yes = true
  workspace.archive.forget('/s')
})

describe('every row', () => {
  const rows = [nested, plain, loose, paper]

  test('offers no folder, anywhere, under any name', () => {
    for (const entry of rows) {
      for (const label of labels(entry)) {
        expect(label.toLowerCase(), entry.path).not.toContain('folder')
      }
    }
  })

  test('opens, renames and deletes, in that order', () => {
    for (const entry of rows) {
      const said = labels(entry)

      expect(said, entry.path).not.toContain('Open')
      expect(said, entry.path).toContain('Rename')
      expect(said.at(-1), entry.path).toBe('Delete')
    }
  })

  test('moves on a touch screen only', () => {
    for (const entry of rows) expect(labels(entry), entry.path).not.toContain('Move')

    viewport.device = 'phone'
    try {
      for (const entry of rows) expect(labels(entry), entry.path).toContain('Move')
      workspace.select('/s/loose.md')
      workspace.toggleSelect('/s/paper.pdf')
      expect(labels(loose)).toContain('Move')
    } finally {
      viewport.device = 'desktop'
    }
  })
})

describe('a note', () => {
  test('can hold a note, and can be copied', () => {
    expect(labels(loose)).toEqual([
      'New note inside',
      'Rename',
      'Choose an icon',
      'Set cover',
      'Archive',
      'Protect',
      'Duplicate',
      'Delete',
    ])
  })
})

describe('a note, with chats to send it to', () => {
  test('offers no Send to chat', async () => {
    const { account } = await import('./account.svelte')
    Object.defineProperty(account, 'accountToken', { value: 'signed in' })
    expect(labels(loose)).not.toContain('Send to chat')
  })
})

describe('new note inside', () => {
  test('offers every kind, each made in the row', async () => {
    const row = rowMenu(plain).find((one) => one?.label === 'New note inside')
    const kinds = (await row?.more?.()) ?? []
    expect(kinds.map((one) => one?.label).filter((label) => label !== 'New chat')).toEqual([
      'New note',
      'New canvas',
      'New page note',
      'New web note',
    ])

    const made = (['createNote', 'createCanvas', 'createPages', 'createWebsite'] as const).map(
      (name) => vi.spyOn(workspace, name).mockResolvedValue(undefined),
    )
    for (const one of kinds) if (one?.label !== 'New chat') one?.run()
    await vi.waitFor(() => {
      for (const spy of made) expect(spy).toHaveBeenCalledWith('/s/Projects')
    })
  })
})

describe('a note that holds notes', () => {
  test('is the same menu', () => {
    expect(labels(nested)).toEqual(labels(loose))
  })
})

describe('a folder nobody has written a note in', () => {
  test('offers exactly what a note offers, less the cover and the side', () => {
    expect(labels(plain)).toEqual(labels(nested).filter((one) => one !== 'Set cover'))
  })
})

describe('a chat', () => {
  test('can wear an icon, and nothing else a note looks like', () => {
    const said = labels(note('/s/Team.chat'))

    expect(said).toContain('Choose an icon')
    expect(said).not.toContain('Set cover')
    expect(said).not.toContain('New note inside')
  })
})

describe('a paper', () => {
  test('holds nothing, wears an icon and duplicates as a paper', () => {
    expect(labels(paper)).toEqual([
      'Rename',
      'Choose an icon',
      'Archive',
      'Protect',
      'Duplicate',
      'Delete',
    ])
  })
})

describe('a file with nowhere of its own to write an icon', () => {
  const kinds = [
    '/s/paper.pdf',
    '/s/photo.png',
    '/s/Mail.application',
    '/s/Table.base',
    '/s/Old.webloc',
  ]

  test('still offers the picker, every kind of it', () => {
    for (const path of kinds) expect(labels(note(path)), path).toContain('Choose an icon')
  })

  test('wears the icon from the space, and puts it down again', async () => {
    const { iconChoice } = await import('./icon-choice.svelte')
    const { chosenIcon } = await import('./chosen-icon')
    const { wear } = await import('./icon-target')
    const press = (path: string, label: string) =>
      rowMenu(note(path))
        .find((one) => one?.label === label)
        ?.run()

    for (const path of kinds) {
      press(path, 'Choose an icon')
      const asked = iconChoice.target
      expect(asked, path).not.toBeNull()
      if (asked) wear(asked, 'rocket', null)
      iconChoice.close()
      expect(chosenIcon(path), path).toBe('rocket')

      press(path, path.endsWith('.webloc') ? 'Reset to site icon' : 'Remove icon')
      expect(chosenIcon(path), path).toBeNull()
    }
  })
})

describe('a file the account has a copy of', () => {
  test('says who else may have it, beside what the space says about it', () => {
    shareable.yes = true

    expect(labels(loose)).toEqual([
      'New note inside',
      'Rename',
      'Choose an icon',
      'Set cover',
      'Archive',
      'Protect',
      'Share',
      'Duplicate',
      'Delete',
    ])
  })

  test('and a note that holds notes is shared as the note it is drawn as', () => {
    shareable.yes = true

    expect(labels(nested)).toEqual([
      'New note inside',
      'Rename',
      'Choose an icon',
      'Set cover',
      'Archive',
      'Protect',
      'Share',
      'Duplicate',
      'Delete',
    ])
  })

  test('and so can a paper', () => {
    shareable.yes = true

    expect(labels(paper)).toEqual([
      'Rename',
      'Choose an icon',
      'Archive',
      'Protect',
      'Share',
      'Duplicate',
      'Delete',
    ])
  })
})

describe('a row that is part of a selection of several', () => {
  test('stands for the lot, and offers only what makes sense for a lot', () => {
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/paper.pdf')

    expect(labels(loose)).toEqual(['Open all', 'Archive', 'Delete 2 items'])
  })

  test('and a tab menu bookmarks the lot, or takes the lot out once all are in', () => {
    const paths = ['/s/loose.md', '/s/A']
    const press = (label: string) =>
      bookmarkAll(paths)
        .find((one) => one?.label === label)
        ?.run()
    press('Add to Essentials')

    expect(workspace.bookmarks.list.map((one) => one.path)).toEqual(['loose.md', 'A/A.md'])
    expect(bookmarkAll(paths).map((one) => one?.label)).toEqual(['Remove from Essentials'])

    press('Remove from Essentials')
    expect(workspace.bookmarks.list).toEqual([])
  })

  test('while a selection of one is an ordinary row', () => {
    workspace.select('/s/loose.md')
    expect(labels(loose)).not.toContain('Open all')
  })
})

describe('a space shared to be read', () => {
  const WRITING = [
    'New note inside',
    'Rename',
    'Move',
    'Choose an icon',
    'Remove icon',
    'Set cover',
    'Change cover',
    'Remove cover',
    'Archive',
    'Duplicate',
    'Delete',
  ]

  test('a row offers to open it and nothing that writes', () => {
    writable.yes = false
    viewport.device = 'phone'
    try {
      for (const entry of [nested, plain, loose, paper]) {
        const said = labels(entry)
        expect(said, entry.path).not.toContain('Open')
        for (const label of WRITING) expect(said, entry.path).not.toContain(label)
      }
    } finally {
      viewport.device = 'desktop'
    }
  })

  test('nor does a selection of several', () => {
    writable.yes = false
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/paper.pdf')

    expect(labels(loose)).toEqual(['Open all'])
  })
})

describe('the archive', () => {
  test('is offered on every row, and not in a space shared to be read', () => {
    for (const entry of [nested, plain, loose, paper]) expect(labels(entry)).toContain('Archive')

    writable.yes = false
    expect(labels(loose)).not.toContain('Archive')
  })

  test('and a folder holding something archived is not deleted from its menu', async () => {
    await workspace.archive.change('/s', ['Projects/plan.md'], [])

    expect(workspace.keepsArchived('/s/Projects')).toBe(true)
    expect(workspace.keepsArchived('/s/loose.md')).toBe(false)
  })

  test('and a selection counts only the rows that can go', async () => {
    await workspace.archive.change('/s', ['Projects/plan.md'], [])
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/Projects')

    expect(labels(loose)).toContain('Delete 1 item')
  })
})

describe('another sync tool’s copy', () => {
  const clash = note('/s/loose (# Name clash 2026-10-05 a1b2c3C #).md')
  const orphan = note('/s/gone (# Name clash 2026-10-05 a1b2c3C #).md')

  beforeEach(() => {
    workspace.tree = folder('/s', [nested, plain, loose, paper, clash, orphan])
  })

  test('offers to compare it with the note it was made of, after the ways to open it', () => {
    const said = labels(clash)

    expect(said[0]).toBe('Compare with original')
    expect(said.at(-1)).toBe('Delete')
  })

  test('and opens the note with the copy to its side', async () => {
    const opened: string[] = []
    const openRow = vi.spyOn(workspace, 'openRow').mockImplementation((path) => {
      opened.push(`here ${path}`)
      return Promise.resolve()
    })
    const openAside = vi.spyOn(workspace, 'openAside').mockImplementation((path) => {
      opened.push(`aside ${path}`)
      return Promise.resolve()
    })

    rowMenu(clash)
      .find((one) => one?.label === 'Compare with original')
      ?.run()
    await vi.waitFor(() => expect(opened).toHaveLength(2))

    expect(opened).toEqual(['here /s/loose.md', `aside ${clash.path}`])
    openRow.mockRestore()
    openAside.mockRestore()
  })

  test('is the plain menu once the note it was made of has gone', () => {
    expect(labels(orphan)).toEqual(labels(loose))
  })
})

describe('search', () => {
  test('is never left out from a row', () => {
    for (const entry of [nested, plain, loose, paper]) {
      expect(labels(entry)).not.toContain('Search here again')
    }
  })

  test('but a row left out before can be searched again, and only that row', () => {
    workspace.excluded.toggle(plain.path)
    const inside = plain.children[0]

    expect(labels(plain)).toContain('Search here again')
    expect(inside && labels(inside)).not.toContain('Search here again')

    rowMenu(plain)
      .find((one) => one?.label === 'Search here again')
      ?.run()
    expect(workspace.excluded.has(plain.path)).toBe(false)
    expect(labels(plain)).not.toContain('Search here again')
  })
})

describe('the undo', () => {
  test('is not in a row’s menu, nor a selection’s', () => {
    const undo = vi.spyOn(workspace, 'undoLabel', 'get').mockReturnValue('Undo deleting plan')

    expect(labels(loose).at(-1)).toBe('Delete')
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/paper.pdf')
    expect(labels(loose).at(-1)).toBe('Delete 2 items')
    undo.mockRestore()
  })
})
