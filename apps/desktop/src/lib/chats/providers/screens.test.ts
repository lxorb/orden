import { expect, test } from 'vitest'
import { Cancelled, Screens } from './screens.svelte'

test('a provider asks one thing at a time, in order, and can be turned down', async () => {
  const screens = new Screens()
  const code = screens.ask({ kind: 'code', label: 'Code' })
  const password = screens.ask({ kind: 'password', label: 'Password' })
  expect(screens.asking?.prompt.kind).toBe('code')
  screens.asking?.answer('12345')
  await expect(code).resolves.toBe('12345')
  expect(screens.asking?.prompt.kind).toBe('password')
  screens.asking?.cancel()
  await expect(password).rejects.toBeInstanceOf(Cancelled)
  expect(screens.asking).toBeNull()
})

test('a screen stays until it is taken away, and cancelling clears it too', async () => {
  const screens = new Screens()
  screens.show({ kind: 'qr', data: 'pair', label: 'Scan' })
  expect(screens.screen?.kind).toBe('qr')
  screens.show(null)
  expect(screens.screen).toBeNull()
  screens.show({ kind: 'wait', label: 'Waiting' })
  const asked = screens.ask({ kind: 'text', label: 'Name' })
  screens.cancelAll()
  await expect(asked).rejects.toBeInstanceOf(Cancelled)
  expect(screens.screen).toBeNull()
})
