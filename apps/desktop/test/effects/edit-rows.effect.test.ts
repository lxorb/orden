import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const { account } = await import('../../src/lib/accounts/src/account.svelte')
const { NameRow } = await import('../../src/lib/accounts-ui/src/api')
let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
function draw() {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(NameRow, { target })
  flushSync()
}
afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  account.user = null
  vi.restoreAllMocks()
})
const field = () => document.querySelector<HTMLInputElement>('form.fields input')
const button = (words: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent.trim() === words)
test('shows the name as words with an Edit button, and nothing to type into until Edit is pressed (#2328)', () => {
  account.user = { id: 'u1', email: 'ada@example.com', name: 'Ada' }
  draw()
  expect(target.querySelector('.text')?.textContent).toBe('Ada')
  expect(target.querySelector('input')).toBeNull()
  expect(target.querySelector('button[aria-label="Edit display name"]')).not.toBeNull()
  expect(field()).toBeNull()
})
test('Edit opens a sheet holding the name, whose Save waits for a change and Cancel leaves it as it was', async () => {
  account.user = { id: 'u1', email: 'ada@example.com', name: 'Ada' }
  const renamed = vi.spyOn(account, 'rename').mockResolvedValue()
  draw()
  target.querySelector<HTMLButtonElement>('button[aria-label="Edit display name"]')?.click()
  flushSync()
  await vi.waitFor(() => expect(field()?.value).toBe('Ada'))
  expect(button('Save')?.disabled).toBe(true)
  button('Cancel')?.click()
  flushSync()
  await vi.waitFor(() => expect(field()).toBeNull())
  expect(renamed).not.toHaveBeenCalled()
})
test('Save renames once the name changed, and closes the sheet', async () => {
  account.user = { id: 'u1', email: 'ada@example.com', name: 'Ada' }
  const renamed = vi.spyOn(account, 'rename').mockResolvedValue()
  draw()
  target.querySelector<HTMLButtonElement>('button[aria-label="Edit display name"]')?.click()
  flushSync()
  await vi.waitFor(() => expect(field()).not.toBeNull())
  const input = field()
  if (input) {
    input.value = ' Ada Lovelace '
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  flushSync()
  expect(button('Save')?.disabled).toBe(false)
  button('Save')?.click()
  flushSync()
  await vi.waitFor(() => expect(renamed).toHaveBeenCalledWith('Ada Lovelace'))
  await vi.waitFor(() => expect(field()).toBeNull())
})
