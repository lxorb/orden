import { blank, newEnvelope } from '@orden/pass/envelope'
import type { Item } from '@orden/pass/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { closed, draw, landed, target } from '../test/drawn'

const fake = vi.hoisted(() => ({
  pass: { items: [], deletedElsewhere: vi.fn(), restoreDeleted: vi.fn() },
}))

vi.mock('../../pass-sync/src/store.svelte', () => ({ pass: fake.pass }))

const DeletedElsewhere = (await import('./DeletedElsewhere.svelte')).default

const GONE: Item = {
  ...newEnvelope({ ...blank('login'), title: 'Bank' }, 1),
  id: 'i1',
  vault: 'v1',
  rev: 3,
}

beforeEach(() => {
  fake.pass.deletedElsewhere.mockReset().mockResolvedValue([GONE])
  fake.pass.restoreDeleted.mockReset().mockResolvedValue({ ...GONE, id: 'i2' })
  landed()
})

afterEach(closed)

describe('items deleted on another device', () => {
  test('are listed in the trash and restored as a copy', async () => {
    draw(DeletedElsewhere, {})
    await vi.waitFor(() => expect(target.querySelector('[data-gone="i1"]')).not.toBe(null))
    expect(target.textContent).toContain('Deleted on another device')
    const restore = [...target.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Restore')!
    restore.click()
    await vi.waitFor(() => expect(fake.pass.restoreDeleted).toHaveBeenCalledWith(GONE))
    await vi.waitFor(() => expect(target.querySelector('[data-gone="i1"]')).toBe(null))
  })

  test('show nothing when nothing was', async () => {
    fake.pass.deletedElsewhere.mockResolvedValue([])
    draw(DeletedElsewhere, {})
    await vi.waitFor(() => expect(fake.pass.deletedElsewhere).toHaveBeenCalled())
    expect(target.textContent.trim()).toBe('')
  })
})
