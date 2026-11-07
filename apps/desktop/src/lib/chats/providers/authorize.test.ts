import { expect, test, vi } from 'vitest'

const calls: string[] = []
let answer: (value: Record<string, string>) => void = () => undefined
let refuse: (error: Error) => void = () => undefined

vi.mock('../../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tauri')>()),
  openExternal: (url: string) => {
    calls.push(`open ${url}`)
    return Promise.resolve()
  },
  invoke: (command: string) => {
    calls.push(command)
    if (command === 'oauth_loopback_open') return Promise.resolve({ id: 'one', port: 4321 })
    if (command === 'oauth_loopback_wait')
      return new Promise((resolve, reject) => {
        answer = resolve
        refuse = reject
      })
    if (command === 'oauth_loopback_close') refuse(new Error('the sign-in was stopped'))
    return Promise.resolve()
  },
}))

const { authorize } = await import('./authorize')
const { Screens } = await import('./screens.svelte')

test('signing in shows the link to finish it in the browser until the answer comes', async () => {
  calls.length = 0
  const screens = new Screens()
  const said = authorize((loopback) => `https://sign.in/?back=${loopback}`, screens)
  await vi.waitFor(() => expect(calls).toContain('oauth_loopback_wait'))
  expect(screens.screen).toEqual({
    kind: 'link',
    url: 'https://sign.in/?back=http://127.0.0.1:4321',
    label: 'Finish signing in in your browser',
  })
  answer({ code: 'c' })
  await expect(said).resolves.toEqual({ code: 'c' })
  expect(screens.screen).toBeNull()
  expect(calls).not.toContain('oauth_loopback_close')
})

test('cancelling while the browser is open stops the sign-in and its listener', async () => {
  calls.length = 0
  const screens = new Screens()
  const said = authorize(() => 'https://sign.in/', screens)
  await vi.waitFor(() => expect(calls).toContain('oauth_loopback_wait'))
  screens.cancelAll()
  await expect(said).rejects.toThrow('the sign-in was stopped')
  expect(calls).toContain('oauth_loopback_close')
  expect(screens.screen).toBeNull()
  screens.cancelAll()
  expect(calls.filter((one) => one === 'oauth_loopback_close').length).toBe(2)
})
