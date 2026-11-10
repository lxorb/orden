import { describe, expect, test } from 'vitest'
import { BROWSERS, MAIN_BROWSERS, MAIN_NOTES, NOTES_APPS, SETTING_NAMES } from './catalog'
import {
  type Answers,
  firstStep,
  keyKindOf,
  markdownStyleFor,
  matching,
  offersApiKey,
  phoneBringing,
  type Reach,
  shows,
  type Step,
  stepAfter,
  STEPS,
  typedName,
} from './flow'
import { keptProgress } from './kept'

const answers = (change: Partial<Answers> = {}): Answers => ({
  browser: null,
  notes: null,
  code: null,
  ...change,
})

const reach = (change: Partial<Reach> = {}): Reach => ({
  signedIn: false,
  importable: () => true,
  signIns: true,
  phone: false,
  heard: false,
  connected: false,
  ...change,
})

function walk(given: Answers, at: Reach): Step[] {
  const seen: Step[] = [firstStep(given, at)]
  while (seen.at(-1) !== 'welcome') seen.push(stepAfter(seen.at(-1) ?? 'welcome', given, at))
  return seen
}

describe('the setup', () => {
  test('asks in the order David settled', () => {
    expect(STEPS).toEqual([
      'account',
      'appearance',
      'heard',
      'browser',
      'import',
      'notes',
      'code',
      'ai',
      'welcome',
    ])
  })

  test('walks every step for a known browser it can read', () => {
    expect(walk(answers({ browser: 'chrome' }), reach())).toEqual(STEPS)
  })

  test('starts past the log in for someone already signed in', () => {
    expect(firstStep(answers(), reach({ signedIn: true }))).toBe('appearance')
  })

  test('offers no import without a browser, or for one it cannot read here', () => {
    expect(walk(answers(), reach())).not.toContain('import')
    expect(walk(answers({ browser: 'chrome' }), reach({ importable: () => false }))).not.toContain(
      'import',
    )
    expect(stepAfter('browser', answers({ browser: 'chrome' }), reach())).toBe('import')
    expect(stepAfter('browser', answers(), reach())).toBe('notes')
  })

  test('ends on the welcome screen and stays there', () => {
    expect(stepAfter('ai', answers(), reach())).toBe('welcome')
    expect(stepAfter('welcome', answers(), reach())).toBe('welcome')
  })

  test('drops the AI step only where nothing could be connected', () => {
    const web = reach({ signIns: false })
    expect(shows('ai', answers({ code: 'no' }), web)).toBe(false)
    expect(shows('ai', answers({ code: 'yes' }), web)).toBe(true)
    expect(shows('ai', answers(), web)).toBe(true)
    expect(shows('ai', answers({ code: 'no' }), reach())).toBe(true)
  })
})

describe('the setup on a phone', () => {
  const phone = (change: Partial<Reach> = {}) => reach({ phone: true, ...change })

  test('asks the same in the same order, without the browser, its import and the code', () => {
    expect(walk(answers({ browser: 'chrome' }), phone())).toEqual([
      'account',
      'appearance',
      'heard',
      'notes',
      'ai',
      'welcome',
    ])
  })

  test('does not ask again how people heard of Orden', () => {
    expect(walk(answers(), phone({ heard: true }))).not.toContain('heard')
    expect(walk(answers(), reach({ heard: true }))).toContain('heard')
  })

  test('skips the AI when one already reaches the account', () => {
    expect(walk(answers(), phone({ connected: true }))).not.toContain('ai')
    expect(walk(answers(), phone({ signIns: false }))).toContain('ai')
  })

  test('brings Notion and Markdown from Files, and leaves the rest to a computer', () => {
    expect(phoneBringing('notion', 'files')).toBe('files')
    expect(phoneBringing('markdown', 'folder')).toBe('files')
    expect(phoneBringing('obsidian', 'vault')).toBe('computer')
    expect(phoneBringing('apple', 'apple')).toBe('computer')
    expect(phoneBringing('joplin', null)).toBeNull()
  })
})

describe('Use an API key', () => {
  test('is hidden only from people who said they do not write code', () => {
    expect(offersApiKey('no')).toBe(false)
    expect(offersApiKey('yes')).toBe(true)
  })

  test('stays for people who skipped the question', () => {
    expect(offersApiKey(null)).toBe(true)
  })

  test('connects a pasted key to the maker it belongs to', () => {
    expect(keyKindOf(`sk-ant-api03-${'a'.repeat(30)}`)).toBe('anthropic')
    expect(keyKindOf(`sk-proj-${'a'.repeat(30)}`)).toBe('openai')
    expect(keyKindOf(`AIza${'a'.repeat(30)}`)).toBe('gemini')
    expect(keyKindOf('sk-short')).toBeNull()
    expect(keyKindOf(`gsk_${'a'.repeat(30)}`)).toBeNull()
  })
})

describe('the markdown display', () => {
  test('is clean for people coming from Notion, Apple Notes, Evernote, Keep and Roam', () => {
    for (const app of ['notion', 'apple', 'evernote', 'keep', 'roam']) {
      expect(markdownStyleFor(app), app).toBe('clean')
    }
  })

  test('is live preview for Obsidian, Markdown, Bear and Logseq', () => {
    for (const app of ['obsidian', 'markdown', 'bear', 'logseq']) {
      expect(markdownStyleFor(app), app).toBe('live')
    }
  })

  test('keeps Orden’s default without an app it knows', () => {
    expect(markdownStyleFor(null)).toBeNull()
    expect(markdownStyleFor('joplin')).toBeNull()
  })

  test('names only apps the notes step lists', () => {
    const listed = NOTES_APPS.map((one) => one.id)
    for (const app of [
      'notion',
      'apple',
      'evernote',
      'keep',
      'roam',
      'obsidian',
      'markdown',
      'bear',
      'logseq',
    ]) {
      expect(listed).toContain(app)
    }
  })
})

describe('the lists', () => {
  test('show the four main browsers and notes apps first', () => {
    expect(MAIN_BROWSERS.every((id) => BROWSERS.some((one) => one.id === id))).toBe(true)
    expect(MAIN_NOTES.every((id) => NOTES_APPS.some((one) => one.id === id))).toBe(true)
  })

  test('put the apps Orden imports before the ones it does not yet', () => {
    const supported = NOTES_APPS.map((one) => one.bring !== null)
    expect(supported.indexOf(false)).toBeGreaterThan(0)
    expect(supported.slice(supported.indexOf(false))).not.toContain(true)
  })

  test('leave to-do apps to a later step', () => {
    expect(NOTES_APPS.map((one) => one.id)).not.toContain('todoist')
  })

  test('preset only settings Orden already has', () => {
    const named = Object.keys(SETTING_NAMES)
    for (const one of BROWSERS) {
      expect(
        Object.keys(one.preset ?? {}).every((setting) => named.includes(setting)),
        one.id,
      ).toBe(true)
    }
  })

  test('find by any part of the name', () => {
    expect(matching(BROWSERS, 'fox').map((one) => one.id)).toEqual(['firefox'])
    expect(matching(BROWSERS, '  ').length).toBe(BROWSERS.length)
  })

  test('name what was typed when nothing matches', () => {
    expect(typedName('  netscape navigator ')).toBe('Netscape Navigator')
  })
})

describe('what the setup keeps', () => {
  test('reads a step and its answers back', () => {
    expect(
      keptProgress({ step: 'notes', answers: { browser: 'safari', notes: null, code: 'no' } }),
    ).toEqual({ step: 'notes', answers: { browser: 'safari', notes: null, code: 'no' } })
  })

  test('remembers that it is done', () => {
    expect(keptProgress('done')).toBe('done')
  })

  test('shows nothing to people who never started it', () => {
    expect(keptProgress(null)).toBeNull()
    expect(keptProgress({ step: 'nowhere' })).toBeNull()
  })

  test('drops answers it cannot read', () => {
    expect(keptProgress({ step: 'ai', answers: { browser: 4, code: 'maybe' } })).toEqual({
      step: 'ai',
      answers: { browser: null, notes: null, code: null },
    })
  })
})
