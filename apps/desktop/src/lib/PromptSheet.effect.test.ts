import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const { prompt } = await import('./prompt.svelte')
const PromptSheet = (await import('./PromptSheet.svelte')).default

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  close = (() => {
    const shown = mount(PromptSheet, { target, intro: false })
    return () => void unmount(shown)
  })()
})

afterEach(() => {
  prompt.dismiss()
  close?.()
  target.remove()
})

const MANY = Array.from({ length: 300 }, (_, at) => ({
  id: `app-${String(at)}`,
  label: `Application ${String(at).padStart(3, '0')}`,
}))

function field(): HTMLInputElement {
  const found = target.querySelector('input')
  if (!found) throw new Error('no field')
  return found
}

function press(key: string, times = 1) {
  for (let at = 0; at < times; at++) {
    field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
  }
}

describe('a find with many answers', () => {
  test('reaches every one of them, with only a window of rows in the page', async () => {
    const picked = prompt.find({ title: 'What does it run?', options: MANY })
    flushSync()
    const drawn = () => target.querySelectorAll('li[data-row]').length
    expect(drawn()).toBeGreaterThan(0)
    expect(drawn()).toBeLessThan(40)

    press('PageDown', 50)
    press('ArrowUp')
    const at = target.querySelector('.found-row.at')
    expect(at?.textContent.trim()).toBe('Application 298')
    expect(drawn()).toBeLessThan(40)

    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(await picked).toBe('app-298')
  })

  test('narrows as it is typed into, and the cursor starts at the top again', async () => {
    const picked = prompt.find({ title: 'What does it run?', options: MANY })
    flushSync()
    press('ArrowDown', 5)
    field().value = '250'
    field().dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(target.querySelector('.found-row.at')?.textContent.trim()).toBe('Application 250')
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(await picked).toBe('app-250')
  })
})
