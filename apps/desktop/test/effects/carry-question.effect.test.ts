import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The question a chat's pointer carried into another space puts (B542): the keyboard
 *  starts on "Only the file", on a Mac as anywhere else, so Enter, or a key held down
 *  from the move that asked it, keeps the chat's history where it is.
 *
 *  In the jsdom project because buttons need a document. */

const mac = vi.hoisted(() => ({ on: false }))

vi.mock('../../src/lib/tauri', async (actual) => ({
  ...(await actual<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  platform: () => (mac.on ? 'macos' : 'windows'),
}))

/** The sheet rises through the Web Animations API, which jsdom does not implement. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

for (const on of [false, true]) {
  test(`Enter answers Only the file${on ? ', on a Mac too' : ''}`, async () => {
    mac.on = on
    const { prompt } = await import('../../src/lib/prompt.svelte')
    const { carryQuestion } = await import('../../src/lib/workspace/chat-leaving')
    const PromptSheet = (await import('../../src/lib/PromptSheet.svelte')).default
    const shown = mount(PromptSheet, { target })
    close = () => void unmount(shown)

    const answer = prompt.choose(carryQuestion(['Plans'], 'Work', 'Family'))
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const focused = document.activeElement
    expect(focused?.textContent.trim()).toBe('Only the file')
    // Enter on a focused button is its click.
    if (focused instanceof HTMLButtonElement) focused.click()
    expect(await answer).toBe('file')
  })
}
