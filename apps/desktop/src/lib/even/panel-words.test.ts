import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SCRIPTS, undrawable } from '@orden/glasses'
import { i18n, t } from '../i18n.svelte'
import { forgetPanelLanguage, panelDrawable, panelWord } from './panel-words'

async function reading(language: string): Promise<void> {
  i18n.choice = language
  await i18n.load()
  forgetPanelLanguage()
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  })
})

afterEach(async () => {
  await reading('en')
  vi.unstubAllGlobals()
})

describe('a language the firmware can draw', () => {
  test('is what the panel is written in', async () => {
    await reading('de')

    expect(panelDrawable()).toBe(true)
    expect(t('Settings')).not.toBe('Settings')
    expect(panelWord('Settings')).toBe(t('Settings'))
  })

  test('and every word of it reaches the glass as words', async () => {
    await reading('de')

    const said = ['Settings', 'Switch space', 'Voice off', 'Done'].map((one) => panelWord(one))
    expect(undrawable(said.join(' '))).toBe(0)
  })
})

describe('a language the firmware has no glyphs for', () => {
  test('is drawn as boxes, which is what this is about', async () => {
    await reading('th')

    expect(t('Settings')).not.toBe('Settings')
    expect(undrawable(t('Settings'))).toBeGreaterThan(0.3)
  })

  test('so the panel says it in English instead', async () => {
    await reading('th')

    expect(panelDrawable()).toBe(false)
    expect(panelWord('Settings')).toBe('Settings')
    expect(panelWord('Switch space')).toBe('Switch space')
    expect(undrawable(panelWord('Voice off'))).toBe(0)
  })

  test('and fills in what a string was given, the way the catalogue would have', async () => {
    await reading('th')

    expect(panelWord('Page {page} of {count}', { page: 2, count: 8 })).toBe('Page 2 of 8')
  })

  test('while the phone keeps the reader’s own language', async () => {
    await reading('th')

    expect(t('Settings')).not.toBe('Settings')
  })
})

describe('the decision itself', () => {
  test('is asked once per language, and again when the reader changes it', async () => {
    await reading('de')
    expect(panelDrawable()).toBe(true)

    i18n.choice = 'th'
    await i18n.load()
    expect(panelDrawable()).toBe(false)
  })

  test('and English is drawable, which is the one catalogue there is no file for', async () => {
    await reading('en')

    expect(panelDrawable()).toBe(true)
    expect(panelWord('Settings')).toBe('Settings')
  })
})

describe('the rule is about scripts rather than languages', () => {
  test('every language in a script the font lacks is answered the same way', async () => {
    for (const one of ['hi', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'pa', 'gu']) {
      await reading(one)
      expect(panelDrawable(), one).toBe(false)
      expect(panelWord('Settings'), one).toBe('Settings')
    }
  })

  test('and Arabic answers for every language written in it', async () => {
    for (const one of ['ar', 'fa', 'ps', 'ur']) {
      await reading(one)
      expect(panelDrawable(), one).toBe(false)
    }
  })

  test('while every script the font has keeps its own words', async () => {
    for (const one of ['de', 'fr', 'gsw', 'ru', 'uk', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'yue']) {
      await reading(one)
      expect(panelDrawable(), one).toBe(true)
      expect(panelWord('Settings'), one).toBe(t('Settings'))
    }
  })
})

describe('every catalogue is in a script the list names', () => {
  test('and no language is named twice', () => {
    const where = resolve(import.meta.dirname, '../../locales')
    const catalogues = readdirSync(where)
      .filter((one) => one.endsWith('.ts'))
      .map((one) => one.replace('.ts', ''))
    const listed = SCRIPTS.flatMap((one) => one.languages)

    expect(catalogues.length).toBeGreaterThan(30)
    expect(listed).toContain('en')
    expect(catalogues.filter((one) => !listed.includes(one))).toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
  })
})

describe('a catalogue added after the rule', () => {
  test('is drawn in its own words where the font has the script', async () => {
    await reading('yue')

    expect(panelDrawable()).toBe(true)
    expect(t('Switch space')).not.toBe('Switch space')
    expect(panelWord('Switch space')).toBe(t('Switch space'))
    const said = ['Settings', 'Switch space', 'Change note', 'Voice off', 'Done']
    expect(undrawable(said.map((one) => panelWord(one)).join(' '))).toBe(0)
  })
})
