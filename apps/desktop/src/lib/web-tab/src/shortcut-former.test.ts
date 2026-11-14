import { describe, expect, test } from 'vitest'
import { readShortcut } from '@orden/scan/shortcut'

describe('a shortcut an older version wrote', () => {
  const OLD = [
    '[InternetShortcut]',
    'URL=https://svelte.dev/docs',
    'Title=Svelte docs',
    'Nib-Added=2026-09-12T08:30:00.000Z',
    'Nib-Home=https://svelte.dev/',
    'Nib-Icon=https://svelte.dev/favicon.png',
    'Nib-Data=3f9a0c17e2b4d685',
    'Nib-Chosen-Icon=rocket',
    'Nib-Chosen-Color=violet',
    '',
  ].join('\r\n')

  test('is read in full', () => {
    expect(readShortcut(OLD)).toEqual({
      url: 'https://svelte.dev/docs',
      title: 'Svelte docs',
      added: '2026-09-12T08:30:00.000Z',
      home: 'https://svelte.dev/',
      icon: 'https://svelte.dev/favicon.png',
      own: '3f9a0c17e2b4d685',
      chosen: 'rocket',
      chosenColour: 'violet',
    })
  })

  test('gives way to the new name where a newer version wrote both', () => {
    const both = `${OLD}Orden-Icon=https://svelte.dev/new.png\r\n`
    expect(readShortcut(both)?.icon).toBe('https://svelte.dev/new.png')
    const first = OLD.replace('Nib-Icon=', 'Orden-Icon=https://svelte.dev/new.png\r\nNib-Icon=')
    expect(readShortcut(first)?.icon).toBe('https://svelte.dev/new.png')
  })
})
