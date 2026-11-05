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

/** What silence came back as when #1128 was measured, and what it must not eat. */
describe('an answer', () => {
  test('loses the credits Whisper writes for a quiet room', () => {
    expect(cleaned('Untertitel der Amara.org-Community', '', 0)).toBe('')
    expect(cleaned('Thank you for watching.', '', 0)).toBe('')
    expect(cleaned('Untertitel im Auftrag des ZDF, 2021', '', 0)).toBe('')
  })

  test('and the credits on the end of real words', () => {
    expect(cleaned('Schick mir die Folien. Untertitel der Amara.org-Community', '', 3)).toBe(
      'Schick mir die Folien.',
    )
  })

  test('loses a lone filler from a stretch with hardly any speech', () => {
    expect(cleaned('Obrigado.', '', 0.4)).toBe('')
    expect(cleaned('E aí', '', 0.2)).toBe('')
  })

  test('but keeps the same word actually said', () => {
    expect(cleaned('Danke.', '', 1.4)).toBe('Danke.')
  })

  test('loses the prompt handed back as the transcript', () => {
    const prompt = 'Sophie, Herr Bäumler, Daniel, Priya, Emil'
    expect(cleaned('Sophie, Herr Bäumler, Daniel, Priya, Emil.', prompt, 2)).toBe('')
  })

  test('but keeps a name from the prompt said on its own', () => {
    expect(cleaned('Emil', 'Sophie, Emil', 0.8)).toBe('Emil')
    expect(cleaned('Ask Emil about it.', 'Sophie, Emil', 2)).toBe('Ask Emil about it.')
  })
})
