import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const { instructionsKept } = await (await import('../../ai-chat/src/api')).keptInstructions()
const StandingInstructions = (await import('./StandingInstructions.svelte')).default
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  instructionsKept.set('')
})
async function field() {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(StandingInstructions, { target })
  close = () => void unmount(shown).then(() => target.remove())
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('textarea')?.disabled).toBe(false)
  })
  const box = target.querySelector('textarea')
  if (!box) throw new Error('no field')
  return { target, box }
}
function type(box: HTMLTextAreaElement, text: string) {
  box.dispatchEvent(new FocusEvent('focus'))
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  box.dispatchEvent(new FocusEvent('blur'))
  flushSync()
}
test('custom instructions typed in Settings are kept for every chat, and Clear takes them away (#2422)', async () => {
  const { target, box } = await field()
  expect(box.placeholder).toContain('keep explanations short')
  type(box, 'Keep explanations short and concise.')
  expect(instructionsKept.text).toBe('Keep explanations short and concise.')
  const clear = [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Clear')
  clear?.click()
  flushSync()
  expect(instructionsKept.text).toBe('')
  expect(box.value).toBe('')
  expect([...target.querySelectorAll('button')].some((one) => one.textContent.trim() === 'Clear')).toBe(false)
})
test('the field shows instructions kept before, and a change from another window while it is not being typed in (#2422)', async () => {
  instructionsKept.set('Answer in German.')
  const { box } = await field()
  expect(box.value).toBe('Answer in German.')
  instructionsKept.set('Answer in English.')
  flushSync()
  expect(box.value).toBe('Answer in English.')
})
