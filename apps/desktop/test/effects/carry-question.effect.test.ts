import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mac = vi.hoisted(() => ({ on: false }))

vi.mock('../../src/lib/platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  platform: () => (mac.on ? 'macos' : 'windows'),
}))

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
    const { carryQuestion } = await import('../../src/lib/workspace/carry-question')
    const PromptSheet = (await import('../../src/lib/PromptSheet.svelte')).default
    const shown = mount(PromptSheet, { target })
    close = () => void unmount(shown)

    const answer = prompt.choose(carryQuestion(['Plans'], 'Work', 'Family'))
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const focused = document.activeElement
    expect(focused?.textContent.trim()).toBe('Only the file')
    if (focused instanceof HTMLButtonElement) focused.click()
    expect(await answer).toBe('file')
  })
}
