import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SHEET = fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url))

const rules = [
  ...readFileSync(SHEET, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, selectors = '', body = '']) => ({
  selectors: selectors
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean),
  body,
}))

const placedWhereItStands = (body: string) =>
  /position:\s*absolute/.test(body) &&
  !/(^|[;\s])(top|left|right|bottom|inset[\w-]*)\s*:/.test(body)

test('a mark a written page places where it stands hangs on its own positioned box, so it scrolls with it', () => {
  const marks = rules.flatMap((rule) =>
    placedWhereItStands(rule.body)
      ? rule.selectors.filter((one) => one.startsWith('#write') && /::(before|after)$/.test(one))
      : [],
  )
  expect(marks).toContain('#write ul > li::before')

  const loose = marks.filter((mark) => {
    const host = mark.replace(/::(before|after)$/, '')
    return !rules.some(
      (rule) => rule.selectors.includes(host) && /position:\s*relative/.test(rule.body),
    )
  })
  expect(loose).toEqual([])
})

test('code on a written page reads left to right, whatever the page around it', () => {
  expect(
    rules.some(
      (rule) => rule.selectors.includes('#write pre') && /direction:\s*ltr/.test(rule.body),
    ),
  ).toBe(true)
})
