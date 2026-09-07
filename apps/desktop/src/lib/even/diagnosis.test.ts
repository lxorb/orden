import { expect, test } from 'vitest'
import { diagnosis } from './diagnosis.svelte'

/** The panel showed itself only once the bridge had given up looking, which
 *  meant a build where nothing worked at all was a build that said nothing at
 *  all: two devices went out with no way to tell a missing channel from a
 *  missing bundle. It opens first now, and is dismissed rather than earned. */
test('the diagnosis is open before anything has happened', () => {
  expect(diagnosis.open).toBe(true)
})

test('it says which build it is before the bridge has answered', () => {
  // The first line, and the one that answers whether the build somebody just
  // shipped is the build that is running.
  const build = diagnosis.facts.find((fact) => fact.name === 'build')

  expect(build?.value).toContain('under test')
  expect(diagnosis.facts[0]).toBe(build)
})

test('a tap closes it, and another opens it again', () => {
  diagnosis.toggle()
  expect(diagnosis.open).toBe(false)

  diagnosis.toggle()
  expect(diagnosis.open).toBe(true)
})
