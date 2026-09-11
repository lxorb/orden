import { describe, expect, test } from 'vitest'

import { folderNameFor } from './importing.svelte'
import type { Picked } from './import/sources'

function picked(name: string, inside = ''): Picked {
  return {
    name,
    webkitRelativePath: inside,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
}

describe('the folder an import makes for itself', () => {
  test('is named after the file that was picked', () => {
    expect(folderNameFor([picked('Travel.enex')], 'evernote')).toBe('Travel')
    expect(folderNameFor([picked('My notes.zip')], 'markdown')).toBe('My notes')
  })

  test('is named after the folder that was dropped', () => {
    expect(
      folderNameFor([picked('2026_01_02.md', 'My graph/journals/2026_01_02.md')], 'logseq'),
    ).toBe('My graph')
  })

  test('is the app it came out of where the file name is one an exporter made up', () => {
    expect(folderNameFor([picked('Export-9f1c2d3e.zip')], 'notion')).toBe('Notion')
    expect(folderNameFor([picked('takeout-20260102.zip')], 'keep')).toBe('Google Keep')
    expect(folderNameFor([picked('backup.zip')], 'bear')).toBe('Bear')
  })

  test('is the app it came out of when several files were picked', () => {
    expect(folderNameFor([picked('Work.enex'), picked('Home.enex')], 'evernote')).toBe('Evernote')
  })

  test('is a name a file may have, whatever the export called itself', () => {
    expect(folderNameFor([picked('Plans: 2026.zip')], 'markdown')).toBe('Plans 2026')
  })
})
