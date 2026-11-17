import { describe, expect, test } from 'vitest'
import { type Came, guideCards, placeCard } from './guide'

const came = (change: Partial<Came> = {}): Came => ({
  notes: null,
  browser: null,
  ai: false,
  code: null,
  terminals: true,
  ...change,
})

const titles = (given: Came) => guideCards(given).map((one) => one.title)

describe('the guide behind Show me around', () => {
  test('always starts on the sidebar, and shows three to five cards', () => {
    const fewest = guideCards(came())
    expect(fewest[0]?.at).toBe('sidebar')
    expect(fewest).toHaveLength(3)
    const most = guideCards(
      came({ notes: { id: 'notion', name: 'Notion' }, browser: 'Chrome', ai: true }),
    )
    expect(most).toHaveLength(5)
  })

  test('names the notes brought in, and Notion by its pages', () => {
    expect(titles(came({ notes: { id: 'notion', name: 'Notion' } }))).toContain(
      'Your Notion pages are here',
    )
    expect(titles(came({ notes: { id: 'obsidian', name: 'Obsidian' } }))).toContain(
      'Your Obsidian notes are here',
    )
    expect(titles(came())).not.toContain('Your Obsidian notes are here')
  })

  test('says more than Markdown to people from Markdown apps, and to-dos to the rest', () => {
    expect(titles(came({ notes: { id: 'obsidian', name: 'Obsidian' } }))).toContain(
      'More than Markdown',
    )
    expect(titles(came({ notes: { id: 'evernote', name: 'Evernote' } }))).toContain(
      'To-dos in any note',
    )
    expect(titles(came())).toContain('To-dos in any note')
  })

  test('points at the bookmarks brought in, or at web pages as tabs', () => {
    expect(titles(came({ browser: 'Safari' }))).toContain('Your Safari bookmarks')
    expect(titles(came())).toContain('Web pages are tabs')
  })

  test('ends on the AI, or on terminals for people who write code where they exist', () => {
    expect(titles(came({ ai: true, code: 'yes' })).at(-1)).toBe('Ask your AI')
    expect(titles(came({ code: 'yes' })).at(-1)).toBe('Terminals are tabs too')
    expect(titles(came({ code: 'yes', terminals: false }))).not.toContain('Terminals are tabs too')
    expect(titles(came({ code: 'no' }))).not.toContain('Terminals are tabs too')
  })

  test('centres a card without a spotlight when its part is hidden', () => {
    const placed = placeCard(null, { width: 320, height: 140 }, { width: 390, height: 844 })
    expect(placed.spot).toBeNull()
    expect(placed.left).toBe(35)
    expect(placed.top).toBe(352)
  })

  test('sets a card beside what it lights, inside the window', () => {
    const room = { width: 1280, height: 800 }
    const placed = placeCard(
      { x: 0, y: 40, width: 250, height: 700 },
      { width: 320, height: 140 },
      room,
    )
    expect(placed.spot).not.toBeNull()
    expect(placed.left).toBeGreaterThan(250)
    expect(placed.left + 320).toBeLessThanOrEqual(room.width)
  })
})
