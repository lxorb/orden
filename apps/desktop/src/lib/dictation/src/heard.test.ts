import { describe, expect, test } from 'vitest'
import { cleaned, promptOf } from './heard'

describe('the prompt', () => {
  test('names the words around the field, then the text it continues', () => {
    expect(promptOf('Kannst du bitte', ['Sync Worker', 'Emil'])).toBe(
      'Sync Worker, Emil. Kannst du bitte',
    )
  })

  test('is the names alone in an empty field, and nothing with neither', () => {
    expect(promptOf('', ['Jürgen Weißmüller'])).toBe('Jürgen Weißmüller')
    expect(promptOf('   ', [])).toBe('')
  })

  test('names each once, and leaves out what is not a name', () => {
    const long = 'a title that goes on far longer than any name anybody would ever say'
    expect(promptOf('', ['Tauri', ' Tauri ', '', long])).toBe('Tauri')
  })

  test('keeps the end of a long text, from the start of a word', () => {
    const before = `${'Wort '.repeat(100)}und dann das Ende`
    const prompt = promptOf(before, [])
    expect(prompt.endsWith('und dann das Ende')).toBe(true)
    expect(prompt.length).toBeLessThanOrEqual(160)
    expect(prompt.startsWith('Wort')).toBe(true)
  })

  test('fits the route, dropping names rather than cutting one in half', () => {
    const names = Array.from({ length: 60 }, (_one, at) => `Name${at}`)
    const prompt = promptOf('x '.repeat(200), names)
    expect(prompt.length).toBeLessThanOrEqual(300)
    expect(prompt).toMatch(/^Name0, Name1, .*Name\d+\. x/)
  })
})

describe('an answer', () => {
  test.each([
    ['Untertitel der Amara.org-Community', '', 0, ''],
    ['Thank you for watching.', '', 0, ''],
    ['Untertitel im Auftrag des ZDF, 2021', '', 0, ''],
    ['Schick mir die Folien. Untertitel der Amara.org-Community', '', 3, 'Schick mir die Folien.'],
    ['Obrigado.', '', 0.4, ''],
    ['E aí', '', 0.2, ''],
    ['Danke.', '', 1.4, 'Danke.'],
    [
      'Sophie, Herr Bäumler, Daniel, Priya, Emil.',
      'Sophie, Herr Bäumler, Daniel, Priya, Emil',
      2,
      '',
    ],
    ['Emil', 'Sophie, Emil', 0.8, 'Emil'],
    ['Ask Emil about it.', 'Sophie, Emil', 2, 'Ask Emil about it.'],
  ])(
    'loses credits, a lone filler and the prompt handed back from %j, keeping what was said',
    (said, prompt, seconds, kept) => {
      expect(cleaned(said, prompt, seconds)).toBe(kept)
    },
  )
})
