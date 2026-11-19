// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { mermaidSvg } from './mermaid-turns'

test('a diagram that fails to draw leaves nothing behind in the page', async () => {
  await expect(mermaidSvg('broken-one', 'flowchart TD\n  A[[[', { startOnLoad: false })).rejects.toThrow()
  expect(document.body.querySelector('[id^="dbroken-one"], #broken-one')).toBeNull()
})

test('a failed drawing does not hold up the next one', async () => {
  await mermaidSvg('broken-two', 'flowchart TD\n  A[[[', { startOnLoad: false }).catch(() => undefined)
  const next = mermaidSvg('after-broken', 'pie\n  "a" : 1', { startOnLoad: false })
  await expect(
    Promise.race([
      next.then(
        () => 'drawn',
        () => 'failed',
      ),
      new Promise((done) => setTimeout(() => done('stuck'), 4000)),
    ]),
  ).resolves.not.toBe('stuck')
})
