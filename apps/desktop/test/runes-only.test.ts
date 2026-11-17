import { compile } from 'svelte/compiler'
import { expect, test } from 'vitest'
import config from '../svelte.config.js'

test('a component with no runes still compiles in runes mode, so loading it never turns the whole app to legacy reactivity', () => {
  const plain = compile('<div class="track"></div>', {
    ...config.compilerOptions,
    filename: 'Plain.svelte',
  })
  expect(plain.js.code).not.toContain('svelte/internal/flags/legacy')
})
