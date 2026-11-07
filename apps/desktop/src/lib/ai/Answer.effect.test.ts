import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'
import Answer from './Answer.svelte'

test('an answer reads in the direction of its own words, not the app’s', () => {
  const target = document.createElement('div')
  document.body.append(target)
  for (const live of [false, true]) {
    const drawn = mount(Answer, { target, props: { html: '<p>Herons stand still.</p>', live } })
    flushSync()
    expect(target.querySelector('.words')?.getAttribute('dir')).toBe('auto')
    void unmount(drawn)
  }
  target.remove()
})
