import { mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'
import { settle } from '../../../../../test/effects/settle'

const asked = vi.hoisted(() => [] as string[])
const ALLOWANCE = { awakeS: 0, cpuS: 0, homeBytes: 0, egressBytes: 0 }
const MACHINE = {
  allowed: true,
  used: ALLOWANCE,
  limit: { awakeS: 3600, cpuS: 3600, homeBytes: 1e9, egressBytes: 1e9 },
  resetAt: 0,
  machine: {
    id: 'm1',
    state: 'asleep',
    held: false,
    host: 'hetzner',
    server: {
      type: 'cx43',
      location: 'fsn1',
      cores: 8,
      memoryGb: 16,
      diskGb: 160,
      price: 16.49,
      currency: 'EUR',
      spent: 7.31,
    },
    disk: { used: 1e9, total: 160e9 },
  },
}
vi.mock('../../../accounts/src/api', async (original) => {
  const { ApiError, ...rest } = await original<typeof import('../../../accounts/src/api')>()
  return {
    ...rest,
    ApiError,
    account: {
      accountToken: 'token',
      user: null,
      spaces: [],
      forgetWithSession: () => undefined,
      holdsNoAccount: () => undefined,
    },
    request: (path: string) => {
      asked.push(path)
      if (path === '/v2/online/machine') return Promise.resolve(MACHINE)
      if (path === '/v2/online/terms') return Promise.resolve({ terms: [] })
      return Promise.reject(new ApiError(404, 'not here'))
    },
  }
})
const OnlinePane = (await import('./OnlinePane.svelte')).default

test('Settings > Online terminal shows its one machine and asks for no machine to choose from (#2474)', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const pane = mount(OnlinePane, { target })
  await settle()
  await vi.waitFor(() => expect(target.textContent).toContain('CX43'))
  const row = target.querySelector('.online .orden-setting')
  expect(row?.textContent).toContain('Machine')
  expect(row?.textContent).toContain('Falkenstein')
  expect(row?.textContent).toMatch(/this\smonth/)
  expect([...(row?.querySelectorAll('button') ?? [])].map((one) => one.textContent.trim())).toEqual(['Start'])
  expect(target.querySelector('.picker')).toBe(null)
  expect(target.textContent).not.toMatch(/\b(Choose|Change|Resize)\b/)
  expect(asked.some((path) => path.includes('/v2/online/types'))).toBe(false)
  await unmount(pane)
  target.remove()
})
