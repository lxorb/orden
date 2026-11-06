import { describe, expect, test } from 'vitest'
import type { LinkWorld } from '../online/link'
import { type AppHeard, AppLink } from './link'
import { appName } from './open'
import { mayHost, programOf } from './words'

describe('what an application runs', () => {
  test('splits a program line as a shell would, and runs no shell', () => {
    expect(programOf('/usr/bin/gimp')).toEqual({ path: '/usr/bin/gimp', args: [] })
    expect(programOf('  code  --new-window  ~/x ')).toEqual({
      path: 'code',
      args: ['--new-window', '~/x'],
    })
    expect(programOf('"/Program Files/App/app.exe" --name "two words" it\\ s')).toEqual({
      path: '/Program Files/App/app.exe',
      args: ['--name', 'two words', 'it s'],
    })
    expect(programOf('echo \'a; rm -rf ~\' "$HOME"')).toEqual({
      path: 'echo',
      args: ['a; rm -rf ~', '$HOME'],
    })
    expect(programOf('x ""')).toEqual({ path: 'x', args: [''] })
  })

  test('is nothing for an empty line or an open quote', () => {
    expect(programOf('')).toBeNull()
    expect(programOf('   ')).toBeNull()
    expect(programOf('app "unclosed')).toBeNull()
  })

  test('runs on a computer only', () => {
    expect(['linux', 'windows', 'macos', 'android', 'ios', 'web'].filter(mayHost)).toEqual([
      'linux',
      'windows',
      'macos',
    ])
  })

  test('is called by its file’s name', () => {
    expect(appName('/notes/GIMP.application')).toBe('GIMP')
    expect(appName('/notes/.application')).toBe('.application')
  })
})

function world() {
  const sockets: {
    url: string
    sent: string[]
    open: boolean
    events: { opened(): void; heard(data: string): void }
  }[] = []
  const made: LinkWorld = {
    base: 'https://nib.test',
    token: () => 'tok',
    device: () => Promise.resolve('dev1'),
    socket: (url, _protocols, events) => {
      const one = { url, sent: [] as string[], open: false, events }
      sockets.push(one)
      return {
        get open() {
          return one.open
        },
        buffered: 0,
        send: (data) => void one.sent.push(String(data)),
        close: () => {
          one.open = false
        },
      }
    },
    after: () => () => undefined,
    now: () => 0,
    hidden: () => false,
    watch: () => () => undefined,
  }
  return { made, sockets }
}

describe('an application’s socket', () => {
  const view = { width: 800, height: 600, dpr: 2, hz: 60 }

  test('says hello with its view and the lock, takes over, and says hello again once it holds it', async () => {
    const { made, sockets } = world()
    const heard: AppHeard[] = []
    const link = new AppLink('app-1', made, (one) => heard.push(one), view)
    link.open()
    await Promise.resolve()
    await Promise.resolve()
    const socket = sockets[0]
    if (!socket) throw new Error('no socket')
    expect(socket.url).toBe('wss://nib.test/v2/apps/app-1/socket')
    socket.open = true
    socket.events.opened()
    expect(socket.sent).toEqual([JSON.stringify({ t: 'hello', hold: true, view })])

    socket.events.heard(JSON.stringify({ t: 'held', by: 'Laptop', since: 1, taken: false }))
    expect(heard.at(-1)).toEqual({ t: 'held', by: 'Laptop', since: 1, taken: false })
    link.take()
    socket.events.heard(JSON.stringify({ t: 'hold' }))
    expect(socket.sent.slice(1)).toEqual([
      JSON.stringify({ t: 'take' }),
      JSON.stringify({ t: 'hello', hold: true, view }),
    ])

    link.resize({ ...view, width: 1024 })
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: 'view', view: { ...view, width: 1024 } }))
    link.close()
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: 'leave' }))
  })
})
