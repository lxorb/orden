import { describe, expect, test } from 'vitest'
import { resolveNote } from '@orden/editor'
import {
  folderFor,
  folderNote,
  folderNotePath,
  isFolderNote,
  nestedIn,
  noteToNest,
  renameSteps,
  unnesting,
} from './folder-notes'
import { rewriteLinks } from './link-rewrite'
import { noteName } from './space-paths'
import type { Entry } from './workspace.svelte'

function note(path: string): Entry {
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  }
}

function folder(path: string, children: Entry[] = []): Entry {
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  }
}

describe('the folder a note would become', () => {
  test('is the note without its extension', () => {
    expect(folderFor('/s/A.md')).toBe('/s/A')
    expect(folderFor('/s/Work/Quarter plan.markdown')).toBe('/s/Work/Quarter plan')
  })

  test('and a path a desktop wrote with backslashes keeps them', () => {
    expect(folderFor('C:\\Nib\\Notes\\A.md')).toBe('C:\\Nib\\Notes\\A')
  })

  test('and a file that is not a note answers itself back', () => {
    expect(folderFor('/s/paper.pdf')).toBe('/s/paper.pdf')
    expect(folderFor('/s/Board.canvas')).toBe('/s/Board.canvas')
  })
})

describe('the note a folder would be drawn as', () => {
  test('is the folder name inside the folder', () => {
    expect(folderNotePath('/s/A')).toBe('/s/A/A.md')
    expect(folderNotePath('/s/Work/Quarter plan')).toBe('/s/Work/Quarter plan/Quarter plan.md')
  })

  test('and keeps the separator the platform wrote', () => {
    expect(folderNotePath('C:\\Nib\\Notes\\A')).toBe('C:\\Nib\\Notes\\A\\A.md')
  })

  test('and a note sitting in the folder it names is that note', () => {
    expect(isFolderNote('/s/A/A.md')).toBe(true)
    expect(isFolderNote('C:\\Nib\\A\\A.markdown')).toBe(true)
  })

  test('while a note beside its folder, or any other note in it, is not', () => {
    expect(isFolderNote('/s/A.md')).toBe(false)
    expect(isFolderNote('/s/A/B.md')).toBe(false)
    expect(isFolderNote('/s/A/index.md')).toBe(false)
    expect(isFolderNote('/s/A/A.pdf')).toBe(false)
  })
})

describe('the note a folder is drawn as', () => {
  test('is the one that shares the folder name', () => {
    const entry = folder('/s/A', [note('/s/A/A.md'), note('/s/A/B.md')])
    expect(folderNote(entry)?.path).toBe('/s/A/A.md')
  })

  test('or the index note a vault or a site generator put there', () => {
    expect(folderNote(folder('/s/A', [note('/s/A/index.md')]))?.path).toBe('/s/A/index.md')
    expect(folderNote(folder('/s/A', [note('/s/A/INDEX.md')]))?.path).toBe('/s/A/INDEX.md')
    expect(folderNote(folder('/s/A', [note('/s/A/_index.md')]))?.path).toBe('/s/A/_index.md')
  })

  test('and the folder own name wins over an index beside it', () => {
    const entry = folder('/s/A', [note('/s/A/index.md'), note('/s/A/A.md')])
    expect(folderNote(entry)?.path).toBe('/s/A/A.md')
  })

  test('and nothing for a folder that merely holds notes', () => {
    expect(folderNote(folder('/s/Work', [note('/s/Work/plan.md')]))).toBeNull()
    expect(folderNote(folder('/s/Empty'))).toBeNull()
  })

  test('nor a note whose name differs only in case', () => {
    expect(folderNote(folder('/s/Notes', [note('/s/Notes/notes.md')]))).toBeNull()
  })

  test('nor a canvas or a PDF of the folder name, which no plugin reads as one', () => {
    expect(folderNote(folder('/s/A', [note('/s/A/A.canvas')]))).toBeNull()
    expect(folderNote(folder('/s/A', [note('/s/A/A.pdf')]))).toBeNull()
  })

  test('and never anything for a note, which holds nothing', () => {
    expect(folderNote(note('/s/A.md'))).toBeNull()
  })
})

describe('what the tree draws under the row', () => {
  test('is everything but the note itself, because the note is the row', () => {
    const entry = folder('/s/A', [note('/s/A/A.md'), note('/s/A/B.md'), folder('/s/A/Deep')])
    expect(nestedIn(entry).map((one) => one.path)).toEqual(['/s/A/B.md', '/s/A/Deep'])
  })

  test('and everything a plain folder holds', () => {
    const entry = folder('/s/Work', [note('/s/Work/plan.md')])
    expect(nestedIn(entry).map((one) => one.path)).toEqual(['/s/Work/plan.md'])
  })

  test('and leaves out an index note the same way, since that is the row too', () => {
    const entry = folder('/s/A', [note('/s/A/index.md'), note('/s/A/B.md')])
    expect(nestedIn(entry).map((one) => one.path)).toEqual(['/s/A/B.md'])
  })
})

describe('nesting a note in a note', () => {
  const tree = folder('/s', [
    folder('/s/Work', [note('/s/Work/plan.md')]),
    folder('/s/Journal', [note('/s/Journal/Journal.md')]),
    note('/s/A.md'),
    note('/s/paper.pdf'),
  ])

  test('makes the folder out of the note the drop landed on', () => {
    expect(noteToNest(tree, folderFor('/s/A.md'))).toBe('/s/A.md')
  })

  test('and nothing when a folder of that name already exists', () => {
    const beside = folder('/s', [folder('/s/A', [note('/s/A/x.md')]), note('/s/A.md')])
    expect(noteToNest(beside, '/s/A')).toBeNull()
  })

  test('nor for a folder no note beside it is named after', () => {
    expect(noteToNest(tree, '/s/Work')).toBeNull()
  })

  test('nor for a file that is not a note', () => {
    expect(noteToNest(tree, folderFor('/s/paper.pdf'))).toBeNull()
  })

  test('and finds a note deeper in the space as readily as one at the top', () => {
    expect(noteToNest(tree, folderFor('/s/Work/plan.md'))).toBe('/s/Work/plan.md')
  })

  test('nothing at all before the space has been read', () => {
    expect(noteToNest(null, '/s/A')).toBeNull()
  })
})

describe('the way back out', () => {
  test('a folder left holding nothing but its own note stops being one', () => {
    const entry = folder('/s/A', [note('/s/A/A.md')])
    expect(unnesting(entry)).toEqual({ note: '/s/A/A.md', into: '/s', folder: '/s/A' })
  })

  test('and one that still holds something stays a folder', () => {
    const entry = folder('/s/A', [note('/s/A/A.md'), note('/s/A/B.md')])
    expect(unnesting(entry)).toBeNull()
  })

  test('while an empty folder is not a nested note that came apart', () => {
    expect(unnesting(folder('/s/A'))).toBeNull()
  })

  test('and a folder holding only an index note is left exactly as it is', () => {
    expect(unnesting(folder('/s/A', [note('/s/A/index.md')]))).toBeNull()
  })

  test('and a path a desktop wrote with backslashes comes back up the same way', () => {
    const entry = folder('C:\\Nib\\Notes\\A', [note('C:\\Nib\\Notes\\A\\A.md')])

    expect(unnesting(entry)).toEqual({
      note: 'C:\\Nib\\Notes\\A\\A.md',
      into: 'C:\\Nib\\Notes',
      folder: 'C:\\Nib\\Notes\\A',
    })
  })
})

describe('renaming the row', () => {
  test('renames the note and then the folder', () => {
    expect(renameSteps('/s/A/A.md', 'B')).toEqual([
      { path: '/s/A/A.md', name: 'B.md' },
      { path: '/s/A', name: 'B' },
    ])
  })

  test('keeping the extension the note was written with', () => {
    expect(renameSteps('/s/A/A.markdown', 'B')[0]).toEqual({
      path: '/s/A/A.markdown',
      name: 'B.markdown',
    })
  })

  test('and taking a name typed with the extension on it', () => {
    expect(renameSteps('/s/A/A.md', 'B.md')).toEqual([
      { path: '/s/A/A.md', name: 'B.md' },
      { path: '/s/A', name: 'B' },
    ])
  })

  test('a name that is only a dot in it is a name, not an extension', () => {
    expect(renameSteps('/s/A/A.md', 'Q1 v1.2')).toEqual([
      { path: '/s/A/A.md', name: 'Q1 v1.2.md' },
      { path: '/s/A', name: 'Q1 v1.2' },
    ])
  })

  test('and nothing at all for a field somebody cleared', () => {
    expect(renameSteps('/s/A/A.md', '   ')).toEqual([])
  })

  test('and renames only the folder where the note inside is an index', () => {
    expect(renameSteps('/s/A/index.md', 'B')).toEqual([{ path: '/s/A', name: 'B' }])
    expect(renameSteps('/s/A/_index.md', 'B')).toEqual([{ path: '/s/A', name: 'B' }])
  })
})

describe('the links to a note that has just been nested', () => {
  const index = (paths: string[], from: string | null = null) => ({
    notes: paths.map((path) => ({
      path,
      name: noteName(path),
      headings: [],
      blocks: [],
      aliases: [],
    })),
    files: [],
    path: from,
    read: () => Promise.resolve(null),
  })

  test('[[A]] means the note before it is nested', () => {
    expect(resolveNote(index(['A.md', 'B.md']), 'A')?.path).toBe('A.md')
  })

  test('and means the same note afterwards, from outside its folder', () => {
    expect(resolveNote(index(['A/A.md', 'B.md']), 'A')?.path).toBe('A/A.md')
  })

  test('and from a note nested inside it', () => {
    expect(resolveNote(index(['A/A.md', 'A/B.md'], 'A/B.md'), 'A')?.path).toBe('A/A.md')
  })

  test('so the rewrite the move runs changes no bare wikilink', () => {
    const text = 'See [[A]] and [[A|the plan]] and [[A#Why]].\n'
    const move = { from: 'A.md', to: 'A/A.md' }

    expect(rewriteLinks(text, 'B.md', move, () => true)).toBe(text)
  })

  test('while a link that spelled the path out is pointed at the new one', () => {
    const move = { from: 'A.md', to: 'A/A.md' }

    expect(rewriteLinks('[the plan](A.md)\n', 'B.md', move, () => true)).toBe(
      '[the plan](A/A.md)\n',
    )
  })
})
