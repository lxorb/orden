import { describe, expect, test } from 'vitest'
import { defaultLanguage, languageNames, nameOfLanguage, rewriteMessages, VERBS } from './rewrite'

describe('the verbs', () => {
  test('are the four, with the two about length first', () => {
    expect(VERBS.map((one) => one.id)).toEqual(['shorter', 'longer', 'grammar', 'translate'])
  })
})

describe('what one rewrite sends', () => {
  const selection = 'A heron stands still in the shallows.'

  test('is the instruction and the selection, and nothing else', () => {
    const messages = rewriteMessages('shorter', 'German', selection)

    expect(messages).toHaveLength(2)
    expect(messages[1]).toEqual({ role: 'user', content: selection })
    expect(messages[0]?.role).toBe('system')
  })

  test('says what each verb is for', () => {
    expect(rewriteMessages('shorter', 'German', selection)[0]?.content).toContain('fewer words')
    expect(rewriteMessages('longer', 'German', selection)[0]?.content).toContain('greater length')
    expect(rewriteMessages('grammar', 'German', selection)[0]?.content).toContain('grammar')
    expect(rewriteMessages('translate', 'German', selection)[0]?.content).toContain('into German')
  })

  test('asks every verb for the text and nothing around it', () => {
    for (const verb of VERBS) {
      const said = rewriteMessages(verb.id, 'German', selection)[0]?.content ?? ''
      expect(said, verb.id).toContain('nothing else')
      expect(said, verb.id).toContain('no code fence')
      expect(said, verb.id).toContain('markdown')
    }
  })

  test('leaves the language out of the three verbs that have no use for one', () => {
    for (const verb of ['shorter', 'longer', 'grammar'] as const) {
      expect(rewriteMessages(verb, 'German', selection)[0]?.content, verb).not.toContain('German')
    }
  })
})

describe('the language a translation goes into', () => {
  test('is offered as the languages the app itself has', () => {
    const ids = languageNames().map((one) => one.id)
    expect(ids).toContain('en')
    expect(ids).toContain('de')
    expect(ids).not.toContain('system')
  })

  test('is named in the language itself, which is what a model should be told', () => {
    expect(nameOfLanguage('de')).toBe('Deutsch')
    expect(nameOfLanguage('ja')).toBe('日本語')
  })

  test('falls back to English for a language nothing here knows', () => {
    expect(nameOfLanguage('xx')).toBe('English')
    expect(defaultLanguage('xx')).toBe('en')
  })

  test('is the app’s own language where nib has one', () => {
    expect(defaultLanguage('fr')).toBe('fr')
  })
})
