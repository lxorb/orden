import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const NATIVE = /<select\b|<datalist\b|<input\b[^>]*\btype=["'](?:time|date|datetime-local|month|week|color)["']/
test('the time tracker draws no field the browser draws for itself: times and dates are Orden’s own', () => {
  const native = readdirSync(HERE)
    .filter((name) => name.endsWith('.svelte'))
    .filter((name) => NATIVE.test(readFileSync(`${HERE}${name}`, 'utf8')))
  expect(native).toEqual([])
})
