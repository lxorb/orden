import { describe, expect, test } from 'vitest'
import { captionIn, languageIn } from '@orden/markdown/code'
import { fenceLanguage, fenceLanguages } from './languages'

describe('a code block with a caption after its language', () => {
  test('is highlighted as JavaScript when typed before the languages have loaded', async () => {
    const support = await fenceLanguage('js title="app.js"')?.load()
    expect(support?.language.name).toBe('javascript')
  })

  test('is highlighted as the language its header names', async () => {
    await fenceLanguages()
    for (const [info, name] of [
      ['js title="app.js"', 'JavaScript'],
      ['ts title="server.ts"', 'TypeScript'],
      ['py title="main.py"', 'Python'],
      ['sh title="install"', 'Shell'],
    ] as const) {
      expect(languageIn(info)).not.toBe('')
      expect(captionIn(info)).not.toBe('')
      expect(fenceLanguage(info)?.name).toBe(name)
    }
  })
})
