import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import QrCode from './QrCode.svelte'
import { idle } from '../../../../test/effects/settle'

let target: HTMLElement
let close: () => void = () => undefined

afterEach(() => {
  close()
  target.remove()
})

function shown(value: string) {
  target = document.createElement('div')
  document.body.append(target)
  const one = mount(QrCode, { target, props: { value, label: 'QR code for the link' } })
  close = () => void unmount(one)
  flushSync()
}

test('a link is drawn as a square a camera reads, named for those who cannot see it', async () => {
  shown('https://orden.so/s/abc')
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('svg')).not.toBeNull()
  })
  expect(target.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('QR code for the link')
})

test('nothing is drawn for no text', async () => {
  shown('')
  await idle(20)
  expect(target.innerHTML).not.toContain('<svg')
})
