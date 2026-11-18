import { flushSync } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { closed, showing, target, typed } from '../test/drawn'
import { PASSWORD, opened, pass } from '../test/opened'

const delivered = vi.hoisted(() => [] as string[])
vi.mock('../../files-out/src/save', () => ({
  deliver: (name: string) => {
    delivered.push(name)
    return Promise.resolve(name)
  },
}))

const { PassUi } = await import('../../pass-sync/src/ui.svelte')
const PassSettings = (await import('./PassSettings.svelte')).default

beforeAll(opened)

afterEach(closed)

function shownOn(tab: 'general' | 'export') {
  const ui = new PassUi(null)
  ui.show({ settingsTab: tab })
  showing(PassSettings, { ui })
}

async function until(ready: () => boolean): Promise<void> {
  await vi.waitFor(
    () => {
      flushSync()
      expect(ready()).toBe(true)
    },
    { timeout: 5000, interval: 20 },
  )
}

describe('Pass settings', () => {
  test('a row is its switch', () => {
    shownOn('general')
    const row = [...target.querySelectorAll<HTMLButtonElement>('[role=switch]')].find(
      (one) => one.textContent.trim() === 'Sign in automatically',
    )
    expect(row?.getAttribute('aria-checked')).toBe('false')
    row?.click()
    flushSync()
    expect(pass.settings.autoLogin).toBe(true)
    expect(row?.getAttribute('aria-checked')).toBe('true')
    row?.click()
    expect(pass.settings.autoLogin).toBe(false)
  })

  test('export asks for the Pass password, and says when it is wrong', async () => {
    shownOn('export')
    const csv = [...target.querySelectorAll<HTMLButtonElement>('[role=radio]')].find(
      (one) => one.textContent.trim() === 'CSV',
    )
    csv?.click()
    flushSync()
    const field = () => target.querySelector<HTMLInputElement>('input[type=password]')
    typed(field(), 'not it')
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await until(() => target.querySelector('[role=alert]') !== null)
    expect(target.querySelector('[role=alert]')?.textContent).toContain('Wrong password')
    expect(delivered).toEqual([])

    typed(field(), PASSWORD)
    target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await until(() => delivered.length > 0)
    expect(delivered[0]).toMatch(/^orden-pass-/)
  })
})
